import { randomUUID } from "node:crypto";

export class MemoryPool {
  constructor() {
    this.users = new Map();
    this.datasets = new Map();
    this.versions = new Map();
    this.records = [];
    this.models = new Map();
    this.calls = [];
    this.failWhen = null;
    this.failure = null;
  }

  async query(sql, values = []) {
    this.calls.push({ sql, values });
    if (this.failWhen?.(sql, values)) throw this.failure ?? new Error("password=private-db-secret");
    const text = sql.replace(/\s+/g, " ").trim();

    if (text.startsWith("INSERT INTO users")) {
      const [, issuer, subject] = values;
      const key = `${issuer}\0${subject}`;
      if (!this.users.has(key)) this.users.set(key, randomUUID());
      return { rows: [{ id: this.users.get(key) }] };
    }
    if (text.startsWith("INSERT INTO datasets")) {
      const [id, ownerId, name] = values;
      if ([...this.datasets.values()].some((item) => item.owner_id === ownerId && item.name === name)) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }
      this.datasets.set(id, { id, owner_id: ownerId, name, latest_version_id: null, created_at: cursorTimestamp(new Date()) });
      return { rows: [] };
    }
    if (text.startsWith("INSERT INTO dataset_versions")) {
      const [id, datasetId, version, format_version, record_count, content_digest, metadata] = values;
      this.versions.set(id, {
        id,
        dataset_id: datasetId,
        version,
        format_version,
        record_count,
        content_digest,
        metadata: JSON.parse(metadata),
      });
      return { rows: [] };
    }
    if (text.startsWith("INSERT INTO dataset_records")) {
      for (let index = 0; index < values.length; index += 7) {
        this.records.push({
          id: values[index],
          dataset_version_id: values[index + 1],
          ordinal: values[index + 2],
          example_id: values[index + 3],
          input: values[index + 4],
          reference: values[index + 5],
          metadata: JSON.parse(values[index + 6]),
        });
      }
      return { rows: [] };
    }
    if (text.startsWith("UPDATE datasets SET latest_version_id")) {
      const [versionId, datasetId, ownerId] = values;
      const dataset = this.datasets.get(datasetId);
      if (dataset?.owner_id === ownerId) dataset.latest_version_id = versionId;
      return { rows: [] };
    }
    if (text.startsWith("SELECT id FROM datasets WHERE id = $1 AND owner_id = $2 FOR UPDATE")) {
      const [datasetId, ownerId] = values;
      const dataset = this.datasets.get(datasetId);
      return { rows: dataset?.owner_id === ownerId ? [{ id: datasetId }] : [] };
    }
    if (text.startsWith("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM dataset_versions")) {
      const [datasetId] = values;
      const versions = [...this.versions.values()].filter((version) => version.dataset_id === datasetId);
      return { rows: [{ version: Math.max(0, ...versions.map((version) => version.version)) + 1 }] };
    }
    if (text.startsWith("SELECT d.id, d.name,") && text.includes("$2::timestamptz")) {
      const [ownerId, beforeDate, beforeId, limit] = values;
      const rows = [...this.datasets.values()]
        .filter((dataset) => dataset.owner_id === ownerId)
        .filter((dataset) => !beforeDate || dataset.created_at < beforeDate ||
          (dataset.created_at === beforeDate && dataset.id < beforeId))
        .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))
        .map((dataset) => this.datasetRow(dataset));
      return { rows: rows.slice(0, limit) };
    }
    if (text.startsWith("SELECT 1 FROM datasets d JOIN dataset_versions")) {
      const [datasetId, versionId, ownerId] = values;
      const dataset = this.datasets.get(datasetId);
      return { rows: dataset?.owner_id === ownerId && this.versions.get(versionId)?.dataset_id === datasetId ? [{ "?column?": 1 }] : [] };
    }
    if (text.startsWith("SELECT d.id, d.name,")) {
      const [datasetId, ownerId] = values;
      const dataset = this.datasets.get(datasetId);
      return { rows: dataset?.owner_id === ownerId ? [this.datasetRow(dataset)] : [] };
    }
    if (text.startsWith("SELECT r.ordinal, r.example_id")) {
      const [datasetId, versionId, ownerId, afterOrdinal, limit] = values;
      const dataset = this.datasets.get(datasetId);
      if (dataset?.owner_id !== ownerId || this.versions.get(versionId)?.dataset_id !== datasetId) return { rows: [] };
      const rows = this.records
        .filter((record) => record.dataset_version_id === versionId && (afterOrdinal === null || record.ordinal > afterOrdinal))
        .sort((left, right) => left.ordinal - right.ordinal)
        .map(({ ordinal, example_id, input, reference, metadata }) => ({ ordinal, example_id, input, reference, metadata }));
      return { rows: rows.slice(0, limit) };
    }
    if (text.startsWith("INSERT INTO model_configurations")) {
      const [id, owner_id, name, adapter_type, provider_id, model_id, endpoint, settings] = values;
      if ([...this.models.values()].some((item) => item.owner_id === owner_id && item.name === name)) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }
      const row = { id, owner_id, name, adapter_type, provider_id, model_id, endpoint, settings: JSON.parse(settings), created_at: new Date() };
      this.models.set(id, row);
      return { rows: [row] };
    }
    if (text.startsWith("SELECT id, name, adapter_type, provider_id, model_id, settings, created_at")) {
      const [ownerId, beforeDate, beforeId, limit] = values;
      const rows = [...this.models.values()]
        .filter((model) => model.owner_id === ownerId)
        .filter((model) => !beforeDate || cursorTimestamp(model.created_at) < beforeDate ||
          (cursorTimestamp(model.created_at) === beforeDate && model.id < beforeId))
        .sort((left, right) => cursorTimestamp(right.created_at).localeCompare(cursorTimestamp(left.created_at)) || right.id.localeCompare(left.id))
        .map((model) => ({ ...model, created_at_cursor: cursorTimestamp(model.created_at) }));
      return { rows: rows.slice(0, limit) };
    }
    throw new Error(`Unexpected query in test double: ${text}`);
  }

  async connect() {
    const snapshot = () => structuredClone({ datasets: this.datasets, versions: this.versions, records: this.records, models: this.models });
    let before = null;
    return {
      query: async (sql, values) => {
        const command = sql.trim().toUpperCase();
        if (command === "BEGIN") {
          before = snapshot();
          return { rows: [] };
        }
        if (command === "COMMIT") {
          before = null;
          return { rows: [] };
        }
        if (command === "ROLLBACK") {
          if (before) {
            this.datasets = before.datasets;
            this.versions = before.versions;
            this.records = before.records;
            this.models = before.models;
          }
          before = null;
          return { rows: [] };
        }
        return this.query(sql, values);
      },
      release() {},
    };
  }

  datasetRow(dataset) {
    const version = this.versions.get(dataset.latest_version_id);
    return {
      id: dataset.id,
      name: dataset.name,
      created_at_cursor: dataset.created_at,
      version_id: version?.id ?? null,
      version: version?.version ?? null,
      format_version: version?.format_version ?? null,
      record_count: version?.record_count ?? null,
      content_digest: version?.content_digest ?? null,
      metadata: version?.metadata ?? null,
    };
  }
}

function cursorTimestamp(value) {
  if (typeof value === "string") return value;
  return value.toISOString().replace(/\.(\d{3})Z$/, (_match, milliseconds) => `.${milliseconds}000Z`);
}

export function testIdentityResolver(request) {
  const subject = request.get("x-test-owner");
  if (!subject || !["alice", "bob"].includes(subject)) return null;
  return { issuer: "urn:agent-arena:test", subject };
}

export async function withServer(app, operation) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  try {
    await operation(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
