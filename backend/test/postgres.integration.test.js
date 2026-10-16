import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrate.js";
import { testIdentityResolver, withServer } from "./helpers.js";

const enabled = process.env.AGENT_ARENA_PG_TEST === "1";

test("PostgreSQL migration and API integration", { skip: !enabled }, async () => {
  const config = readConfig();
  if (!config.database.database.startsWith("agent_arena_test_")) {
    throw new Error("PGDATABASE must start with agent_arena_test_ for disposable integration checks");
  }

  const schema = `aa_test_${randomUUID().replaceAll("-", "")}`;
  const failureSchema = `${schema}_failure`;
  const bootstrapPool = createPool(config);
  let testPool;
  let failurePool;
  let schemaCreated = false;
  let failureSchemaCreated = false;
  try {
    await bootstrapPool.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await bootstrapPool.query(`CREATE SCHEMA "${failureSchema}"`);
    failureSchemaCreated = true;

    testPool = createPool({ ...config, database: { ...config.database, options: `-c search_path=${schema}` } });
    failurePool = createPool({ ...config, database: { ...config.database, options: `-c search_path=${failureSchema}` } });

    const concurrentResults = await Promise.all([runMigrations(testPool), runMigrations(testPool)]);
    assert.equal(concurrentResults.flat().filter((result) => result.applied).length, 2);
    assert.ok((await runMigrations(testPool)).every((result) => !result.applied));

    await verifyFailedMigrationRollsBack(failurePool);
    await verifyApiAndImmutability(testPool);
  } finally {
    await testPool?.end();
    await failurePool?.end();
    if (failureSchemaCreated) await bootstrapPool.query(`DROP SCHEMA IF EXISTS "${failureSchema}" CASCADE`);
    if (schemaCreated) await bootstrapPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await bootstrapPool.end();
  }
});

async function verifyFailedMigrationRollsBack(pool) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-arena-pg-failing-migration-"));
  try {
    await writeFile(
      path.join(directory, "001_failing.sql"),
      "CREATE TABLE should_rollback (id integer); SELECT 1 / 0;",
      "utf8",
    );
    await assert.rejects(runMigrations(pool, directory));
    const table = await pool.query("SELECT to_regclass('should_rollback') AS table_name");
    assert.equal(table.rows[0].table_name, null);
    const recorded = await pool.query("SELECT 1 FROM schema_migrations WHERE name = '001_failing.sql'");
    assert.equal(recorded.rows.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function verifyApiAndImmutability(pool) {
  const app = createApp({ pool, resolveIdentity: testIdentityResolver, maxDatasetRecords: 100 });
  await withServer(app, async (base) => {
    const datasetIds = [];
    const versionIds = [];
    for (let index = 1; index <= 3; index += 1) {
      const response = await fetch(`${base}/api/v1/datasets`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-owner": "alice" },
        body: JSON.stringify({
          name: `dataset-${index}`,
          records: [{ id: `record-${index}`, input: "input", reference: "reference" }],
        }),
      });
      assert.equal(response.status, 201);
      const body = await response.json();
      datasetIds.push(body.id);
      versionIds.push(body.latest_version.id);
    }

    const modelIds = [];
    for (let index = 1; index <= 3; index += 1) {
      const response = await fetch(`${base}/api/v1/models`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-owner": "alice" },
        body: JSON.stringify({
          name: `model-${index}`,
          adapter_type: "mock",
          provider_id: "local",
          model_id: "deterministic-mock",
          settings: {},
        }),
      });
      assert.equal(response.status, 201);
      modelIds.push((await response.json()).id);
    }

    const timestamps = [
      "2026-10-17T10:00:00.123900Z",
      "2026-10-17T10:00:00.123500Z",
      "2026-10-17T10:00:00.123100Z",
    ];
    for (let index = 0; index < timestamps.length; index += 1) {
      await pool.query("UPDATE datasets SET created_at = $1::timestamptz WHERE id = $2", [timestamps[index], datasetIds[index]]);
      await pool.query("UPDATE model_configurations SET created_at = $1::timestamptz WHERE id = $2", [timestamps[index], modelIds[index]]);
    }

    assert.deepEqual(await collectIds(base, "/api/v1/datasets"), datasetIds);
    assert.deepEqual(await collectIds(base, "/api/v1/models"), modelIds);

    const otherOwner = await fetch(`${base}/api/v1/datasets/${datasetIds[0]}`, { headers: { "x-test-owner": "bob" } });
    assert.equal(otherOwner.status, 404);
    const bobModels = await fetch(`${base}/api/v1/models`, { headers: { "x-test-owner": "bob" } });
    assert.deepEqual((await bobModels.json()).items, []);

    for (const versionId of versionIds) {
      await assertImmutability(pool, `UPDATE dataset_versions SET metadata = '{}'::jsonb WHERE id = $1`, [versionId]);
      await assertImmutability(pool, `DELETE FROM dataset_versions WHERE id = $1`, [versionId]);
    }
    await assertImmutability(pool, `UPDATE dataset_records SET reference = 'changed' WHERE dataset_version_id = $1`, [versionIds[0]]);
    await assertImmutability(pool, `DELETE FROM dataset_records WHERE dataset_version_id = $1`, [versionIds[0]]);
    await assertImmutability(pool, "TRUNCATE TABLE dataset_versions");
    await assertImmutability(pool, "TRUNCATE TABLE dataset_records");
    await assertImmutability(pool, "TRUNCATE TABLE model_configurations");
    await assertImmutability(pool, "UPDATE model_configurations SET model_id = 'changed' WHERE id = $1", [modelIds[0]]);
    await assertImmutability(pool, "DELETE FROM model_configurations WHERE id = $1", [modelIds[0]]);
  });
}

async function collectIds(base, route) {
  const ids = [];
  let cursor = null;
  do {
    const query = new URLSearchParams({ limit: "1" });
    if (cursor) query.set("cursor", cursor);
    const response = await fetch(`${base}${route}?${query}`, { headers: { "x-test-owner": "alice" } });
    assert.equal(response.status, 200);
    const body = await response.json();
    ids.push(...body.items.map((item) => item.id));
    cursor = body.next_cursor;
    assert.ok(ids.length <= 3, "a pagination page repeated a resource");
  } while (cursor);
  return ids;
}

async function assertImmutability(pool, sql, values = []) {
  await assert.rejects(pool.query(sql, values), (error) => error.code === "55000");
}
