import assert from "node:assert/strict";
import test from "node:test";

import { readConfig } from "../src/config.js";

const localEnvironment = {
  PGHOST: "127.0.0.1",
  PGPORT: "5432",
  PGDATABASE: "agent_arena",
  PGUSER: "agent_arena",
  PGPASSWORD: "test-only",
};

test("reads PostgreSQL pool settings from environment without a URL default", () => {
  const config = readConfig({ ...localEnvironment, PGPOOL_MAX: "4", MAX_DATASET_RECORDS: "500" });
  assert.equal(config.database.host, "127.0.0.1");
  assert.equal(config.database.port, 5432);
  assert.equal(config.database.max, 4);
  assert.equal(config.database.ssl, false);
  assert.equal(config.maxDatasetRecords, 500);
});

test("production requires verified TLS and validates exposed ports", () => {
  assert.throws(
    () => readConfig({ ...localEnvironment, NODE_ENV: "production", PGSSLMODE: "disable" }),
    /require PGSSLMODE=verify-full/,
  );
  const config = readConfig({ ...localEnvironment, NODE_ENV: "production", PGSSLMODE: "verify-full" });
  assert.deepEqual(config.database.ssl, { rejectUnauthorized: true });
  assert.throws(() => readConfig({ ...localEnvironment, PORT: "70000" }), /PORT must be/);
});
