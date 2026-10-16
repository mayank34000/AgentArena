import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { readConfig } from "../config.js";
import { createPool } from "./pool.js";

const MIGRATION_LOCK_ID = "730194625017";
const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(new URL("./migrations/", import.meta.url));

export async function runMigrations(pool, migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY) {
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [MIGRATION_LOCK_ID]);
    lockAcquired = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const filenames = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const appliedRows = await client.query("SELECT name, checksum FROM schema_migrations");
    const applied = new Map(appliedRows.rows.map((row) => [row.name, row.checksum.trim()]));
    const knownFilenames = new Set(filenames);

    for (const appliedName of applied.keys()) {
      if (!knownFilenames.has(appliedName)) {
        throw new Error(`Applied migration is missing from disk: ${appliedName}`);
      }
    }

    const results = [];
    for (const name of filenames) {
      if (!/^\d{3,}_[a-z0-9_]+\.sql$/.test(name)) {
        throw new Error(`Invalid migration filename: ${name}`);
      }
      const sql = await readFile(path.join(migrationsDirectory, name), "utf8");
      const normalizedSql = sql.replace(/\r\n?/g, "\n");
      const checksum = createHash("sha256").update(normalizedSql, "utf8").digest("hex");
      const existingChecksum = applied.get(name);
      if (existingChecksum !== undefined) {
        if (existingChecksum !== checksum) {
          throw new Error(`Applied migration checksum changed: ${name}`);
        }
        results.push({ name, applied: false });
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
          [name, checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Keep the migration error for the caller.
        }
        throw error;
      }
      results.push({ name, applied: true });
    }
    return results;
  } finally {
    if (lockAcquired) {
      try {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [MIGRATION_LOCK_ID]);
      } catch {
        // Releasing the client also releases its session-level advisory lock.
      }
    }
    client.release();
  }
}

async function main() {
  const config = readConfig();
  const pool = createPool(config);
  try {
    const results = await runMigrations(pool);
    for (const result of results) {
      process.stdout.write(`${result.applied ? "applied" : "current"} ${result.name}\n`);
    }
    if (results.length === 0) process.stdout.write("No migrations found.\n");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write("Database migration failed. Check database availability and migration files.\n");
    process.exitCode = 1;
  });
}
