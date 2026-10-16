import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runMigrations } from "../src/db/migrate.js";

class MigrationPool {
  constructor() {
    this.applied = new Map();
    this.executedSql = [];
    this.failOnMigration = false;
  }

  async connect() {
    const pool = this;
    return {
      async query(sql, values = []) {
        const trimmed = sql.trim();
        const command = trimmed.toUpperCase();
        if (command.startsWith("SELECT PG_ADVISORY_LOCK") || command.startsWith("SELECT PG_ADVISORY_UNLOCK")) {
          return { rows: [] };
        }
        if (command.startsWith("CREATE TABLE IF NOT EXISTS SCHEMA_MIGRATIONS")) return { rows: [] };
        if (command === "SELECT NAME, CHECKSUM FROM SCHEMA_MIGRATIONS") {
          return { rows: [...pool.applied].map(([name, checksum]) => ({ name, checksum })) };
        }
        if (command === "BEGIN" || command === "COMMIT" || command === "ROLLBACK") return { rows: [] };
        if (command.startsWith("INSERT INTO SCHEMA_MIGRATIONS")) {
          pool.applied.set(values[0], values[1]);
          return { rows: [] };
        }
        if (pool.failOnMigration) throw new Error("controlled SQL failure");
        pool.executedSql.push(trimmed);
        return { rows: [] };
      },
      release() {},
    };
  }
}

async function temporaryMigrations(files) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-arena-migrations-"));
  await mkdir(directory, { recursive: true });
  for (const [name, sql] of Object.entries(files)) await writeFile(path.join(directory, name), sql, "utf8");
  return directory;
}

test("migrations apply once and reject checksum changes", async (t) => {
  const directory = await temporaryMigrations({ "001_initial.sql": "CREATE TABLE first_table (id integer);" });
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pool = new MigrationPool();

  assert.deepEqual(await runMigrations(pool, directory), [{ name: "001_initial.sql", applied: true }]);
  assert.deepEqual(await runMigrations(pool, directory), [{ name: "001_initial.sql", applied: false }]);
  assert.equal(pool.executedSql.length, 1);

  const original = await readFile(path.join(directory, "001_initial.sql"), "utf8");
  await writeFile(path.join(directory, "001_initial.sql"), original.replace(/\n/g, "\r\n"), "utf8");
  assert.deepEqual(await runMigrations(pool, directory), [{ name: "001_initial.sql", applied: false }]);

  await writeFile(path.join(directory, "001_initial.sql"), "CREATE TABLE changed_table (id integer);", "utf8");
  await assert.rejects(runMigrations(pool, directory), /checksum changed/);
});

test("a failed migration is not recorded as applied", async (t) => {
  const directory = await temporaryMigrations({ "001_initial.sql": "CREATE TABLE first_table (id integer);" });
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pool = new MigrationPool();
  pool.failOnMigration = true;

  await assert.rejects(runMigrations(pool, directory), /controlled SQL failure/);
  assert.equal(pool.applied.size, 0);
});

test("the checked-in schema migration includes ownership and uniqueness constraints", async () => {
  const pathToMigration = new URL("../src/db/migrations/001_persistence_foundation.sql", import.meta.url);
  const sql = await readFile(pathToMigration, "utf8");
  assert.match(sql, /CREATE TABLE users/);
  assert.match(sql, /owner_id uuid NOT NULL REFERENCES users\(id\)/);
  assert.match(sql, /UNIQUE \(dataset_version_id, example_id\)/);
  assert.match(sql, /UNIQUE \(owner_id, name\)/);
  assert.match(sql, /datasets_latest_version_fk/);
});

test("the immutability migration blocks row changes and truncation for historical tables", async () => {
  const pathToMigration = new URL("../src/db/migrations/002_immutable_history.sql", import.meta.url);
  const sql = await readFile(pathToMigration, "utf8");
  for (const table of ["dataset_versions", "dataset_records", "model_configurations"]) {
    assert.match(sql, new RegExp(`BEFORE UPDATE OR DELETE ON ${table}`));
    assert.match(sql, new RegExp(`BEFORE TRUNCATE ON ${table}`));
  }
  assert.match(sql, /USING ERRCODE = '55000'/);
});
