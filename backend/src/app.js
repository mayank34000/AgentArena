import { randomUUID } from "node:crypto";
import express from "express";

import { decodeCursor, encodeCursor, isUuid, parseLimit } from "./cursor.js";
import { inTransaction } from "./db/transaction.js";
import { ApiError, errorHandler } from "./errors.js";
import { isValidIdentity } from "./identity.js";
import {
  contentDigest,
  validateDatasetPayload,
  validateDatasetVersionPayload,
  validateModelPayload,
} from "./validation.js";

const DATASET_FORMAT_VERSION = "1";
const JSON_BODY_LIMIT = "1mb";
const RECORD_INSERT_BATCH_SIZE = 1000;

export function createApp({ pool, resolveIdentity, maxDatasetRecords = 10000 }) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("pool must provide query(sql, values)");
  if (typeof resolveIdentity !== "function") throw new TypeError("resolveIdentity must be a function");

  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    request.id = randomUUID();
    response.set("X-Request-Id", request.id);
    next();
  });
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));

  app.use("/api/v1", requireOwner(pool, resolveIdentity));

  app.post("/api/v1/datasets", route(async (request, response) => {
    const payload = validateDatasetPayload(request.body, maxDatasetRecords);
    const datasetId = randomUUID();
    const versionId = randomUUID();

    const version = await inTransaction(pool, async (client) => {
      await client.query(
        "INSERT INTO datasets (id, owner_id, name) VALUES ($1, $2, $3)",
        [datasetId, request.ownerId, payload.name],
      );
      return insertDatasetVersion(client, { datasetId, ownerId: request.ownerId, versionId, versionNumber: 1, payload });
    });

    response.status(201).json({
      id: datasetId,
      name: payload.name,
      latest_version: {
        id: versionId,
        version: version.versionNumber,
        format_version: version.formatVersion,
        record_count: version.recordCount,
        content_digest: version.contentDigest,
        metadata: payload.metadata,
      },
    });
  }));

  app.post("/api/v1/datasets/:datasetId/versions", route(async (request, response) => {
    const datasetId = requireUuid(request.params.datasetId);
    const payload = validateDatasetVersionPayload(request.body, maxDatasetRecords);
    const versionId = randomUUID();
    const version = await inTransaction(pool, async (client) => {
      const dataset = await client.query(
        "SELECT id FROM datasets WHERE id = $1 AND owner_id = $2 FOR UPDATE",
        [datasetId, request.ownerId],
      );
      if (dataset.rows.length === 0) throw notFound();
      const nextVersion = await client.query(
        "SELECT COALESCE(MAX(version), 0) + 1 AS version FROM dataset_versions WHERE dataset_id = $1",
        [datasetId],
      );
      return insertDatasetVersion(client, {
        datasetId,
        ownerId: request.ownerId,
        versionId,
        versionNumber: nextVersion.rows[0].version,
        payload,
      });
    });
    response.status(201).json({
      id: versionId,
      dataset_id: datasetId,
      version: version.versionNumber,
      format_version: version.formatVersion,
      record_count: version.recordCount,
      content_digest: version.contentDigest,
      metadata: payload.metadata,
    });
  }));

  app.get("/api/v1/datasets", route(async (request, response) => {
    const limit = parseLimit(request.query.limit);
    const cursor = decodeCursor(request.query.cursor, "dataset");
    const result = await pool.query(
      `SELECT d.id, d.name,
              to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor,
              v.id AS version_id, v.version,
              v.format_version, v.record_count, v.content_digest, v.metadata
       FROM datasets d
       LEFT JOIN dataset_versions v ON v.dataset_id = d.id AND v.id = d.latest_version_id
       WHERE d.owner_id = $1
         AND ($2::timestamptz IS NULL OR (d.created_at, d.id) < ($2::timestamptz, $3::uuid))
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT $4`,
      [request.ownerId, cursor?.created_at ?? null, cursor?.id ?? null, limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    response.json({
      items: rows.map(datasetSummary),
      next_cursor: hasMore ? encodeCursor({ created_at: rows.at(-1).created_at_cursor, id: rows.at(-1).id }) : null,
    });
  }));

  app.get("/api/v1/datasets/:datasetId", route(async (request, response) => {
    const datasetId = requireUuid(request.params.datasetId);
    const result = await pool.query(
      `SELECT d.id, d.name,
              to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor,
              v.id AS version_id, v.version,
              v.format_version, v.record_count, v.content_digest, v.metadata
       FROM datasets d
       LEFT JOIN dataset_versions v ON v.dataset_id = d.id AND v.id = d.latest_version_id
       WHERE d.id = $1 AND d.owner_id = $2`,
      [datasetId, request.ownerId],
    );
    if (result.rows.length === 0) throw notFound();
    response.json(datasetSummary(result.rows[0]));
  }));

  app.get("/api/v1/datasets/:datasetId/versions/:versionId/records", route(async (request, response) => {
    const datasetId = requireUuid(request.params.datasetId);
    const versionId = requireUuid(request.params.versionId);
    const limit = parseLimit(request.query.limit);
    const cursor = decodeCursor(request.query.cursor, "record");
    const result = await pool.query(
      `SELECT r.ordinal, r.example_id, r.input, r.reference, r.metadata
       FROM datasets d
       JOIN dataset_versions v ON v.dataset_id = d.id
       JOIN dataset_records r ON r.dataset_version_id = v.id
       WHERE d.id = $1 AND v.id = $2 AND d.owner_id = $3
         AND ($4::integer IS NULL OR r.ordinal > $4::integer)
       ORDER BY r.ordinal ASC
       LIMIT $5`,
      [datasetId, versionId, request.ownerId, cursor?.ordinal ?? null, limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    if (rows.length === 0) {
      const version = await pool.query(
        `SELECT 1 FROM datasets d JOIN dataset_versions v ON v.dataset_id = d.id
         WHERE d.id = $1 AND v.id = $2 AND d.owner_id = $3`,
        [datasetId, versionId, request.ownerId],
      );
      if (version.rows.length === 0) throw notFound();
    }
    response.json({
      items: rows.map((row) => ({
        ordinal: row.ordinal,
        id: row.example_id,
        input: row.input,
        reference: row.reference,
        metadata: row.metadata,
      })),
      next_cursor: hasMore ? encodeCursor({ ordinal: rows.at(-1).ordinal }) : null,
    });
  }));

  app.post("/api/v1/models", route(async (request, response) => {
    const model = validateModelPayload(request.body);
    const result = await pool.query(
      `INSERT INTO model_configurations
        (id, owner_id, name, adapter_type, provider_id, model_id, endpoint, settings, credential_profile)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       RETURNING id, name, adapter_type, provider_id, model_id, settings, created_at`,
      [randomUUID(), request.ownerId, model.name, model.adapterType, model.providerId, model.modelId,
        model.endpoint, JSON.stringify(model.settings), model.credentialProfile],
    );
    response.status(201).json(modelResponse(result.rows[0]));
  }));

  app.get("/api/v1/models", route(async (request, response) => {
    const limit = parseLimit(request.query.limit);
    const cursor = decodeCursor(request.query.cursor, "dataset");
    const result = await pool.query(
      `SELECT id, name, adapter_type, provider_id, model_id, settings, created_at,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor
       FROM model_configurations
       WHERE owner_id = $1
         AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
       ORDER BY created_at DESC, id DESC
       LIMIT $4`,
      [request.ownerId, cursor?.created_at ?? null, cursor?.id ?? null, limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    response.json({
      items: rows.map(modelResponse),
      next_cursor: hasMore ? encodeCursor({ created_at: rows.at(-1).created_at_cursor, id: rows.at(-1).id }) : null,
    });
  }));

  app.use((_request, _response, next) => next(new ApiError(404, "not_found", "The requested resource was not found.")));
  app.use(errorHandler);
  return app;
}

function requireOwner(pool, resolveIdentity) {
  return async (request, _response, next) => {
    let identity;
    try {
      identity = await resolveIdentity(request);
    } catch (error) {
      return next(error);
    }
    if (!isValidIdentity(identity)) {
      return next(new ApiError(401, "unauthenticated", "Authentication is required."));
    }
    try {
      const inserted = await pool.query(
        `INSERT INTO users (id, issuer, subject) VALUES ($1, $2, $3)
         ON CONFLICT (issuer, subject) DO NOTHING
         RETURNING id`,
        [randomUUID(), identity.issuer, identity.subject],
      );
      const result = inserted.rows.length > 0
        ? inserted
        : await pool.query("SELECT id FROM users WHERE issuer = $1 AND subject = $2", [identity.issuer, identity.subject]);
      if (result.rows.length === 0) throw new Error("Identity principal was not available after insert conflict.");
      request.ownerId = result.rows[0].id;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function route(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

async function insertDatasetVersion(client, { datasetId, ownerId, versionId, versionNumber, payload }) {
  const digest = contentDigest(payload.records);
  await client.query(
    `INSERT INTO dataset_versions
      (id, dataset_id, version, format_version, record_count, content_digest, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [versionId, datasetId, versionNumber, DATASET_FORMAT_VERSION, payload.records.length, digest, JSON.stringify(payload.metadata)],
  );

  for (let start = 0; start < payload.records.length; start += RECORD_INSERT_BATCH_SIZE) {
    const batch = payload.records.slice(start, start + RECORD_INSERT_BATCH_SIZE);
    const values = [];
    const tuples = batch.map((record, offset) => {
      const ordinal = start + offset;
      const first = values.length + 1;
      values.push(randomUUID(), versionId, ordinal, record.id, record.input, record.reference, JSON.stringify(record.metadata));
      return `($${first}, $${first + 1}, $${first + 2}, $${first + 3}, $${first + 4}, $${first + 5}, $${first + 6}::jsonb)`;
    });
    await client.query(
      `INSERT INTO dataset_records
        (id, dataset_version_id, ordinal, example_id, input, reference, metadata)
       VALUES ${tuples.join(", ")}`,
      values,
    );
  }
  await client.query(
    "UPDATE datasets SET latest_version_id = $1, updated_at = now() WHERE id = $2 AND owner_id = $3",
    [versionId, datasetId, ownerId],
  );
  return {
    versionNumber,
    formatVersion: DATASET_FORMAT_VERSION,
    recordCount: payload.records.length,
    contentDigest: digest,
  };
}

function requireUuid(value) {
  if (!isUuid(value)) throw notFound();
  return value;
}

function notFound() {
  return new ApiError(404, "not_found", "The requested resource was not found.");
}

function datasetSummary(row) {
  return {
    id: row.id,
    name: row.name,
    latest_version: row.version_id === null
      ? null
      : {
          id: row.version_id,
          version: row.version,
          format_version: row.format_version,
          record_count: row.record_count,
          content_digest: row.content_digest.trim(),
          metadata: row.metadata,
        },
  };
}

function modelResponse(row) {
  return {
    id: row.id,
    name: row.name,
    adapter_type: row.adapter_type,
    provider_id: row.provider_id,
    model_id: row.model_id,
    settings: row.settings,
    created_at: row.created_at,
  };
}
