# Agent Arena

Agent Arena contains a Python evaluation engine and a small JavaScript/Express persistence API. The API supports datasets and immutable local-mock model configurations; it does not start evaluation runs or call external model providers.

## Python evaluation engine

```powershell
python -m pip install -r requirements.txt
python -m pytest -q
```

## Backend prerequisites

- Node.js 20 or newer and npm.
- A PostgreSQL database. Create an empty database and a database role with permission to create the schema objects in `backend/src/db/migrations/`.
- The backend reads connection values from `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and `PGSSLMODE`. `PGSSLMODE` defaults to `disable` outside production and must be `verify-full` in production. `PGPOOL_MAX` is optional.

From PowerShell, set local values for the current shell (replace the password with a local-only value):

```powershell
$env:PGHOST = "localhost"
$env:PGPORT = "5432"
$env:PGDATABASE = "agent_arena"
$env:PGUSER = "agent_arena"
$env:PGPASSWORD = "local-password"
$env:PGSSLMODE = "disable"
```

Then install dependencies and apply migrations:

```powershell
cd backend
npm ci
npm run migrate
```

The migration runner applies numbered SQL files under an advisory lock and checks stored SHA-256 checksums so an applied migration cannot be silently edited.

The migration role owns the schema. Production API processes should use a separate restricted runtime role: grant `USAGE` on the schema; `SELECT` and `INSERT` on the persistence tables; column-level `UPDATE` only on `datasets.latest_version_id` and `datasets.updated_at`; and `EXECUTE` on `reject_immutable_history_mutation()`. Do not grant the runtime role schema/trigger DDL, table ownership, `DELETE`, `TRUNCATE`, table-level `UPDATE` on `datasets`, or any update privilege on immutable tables. Run `npm run migrate` with the migration role, then set `PGUSER` and `PGPASSWORD` to the runtime role before starting the API. The migration triggers reject updates, deletes, and truncation of dataset versions, records, and model configurations.

## Local API development

There is no production authentication provider integrated yet. Without a trusted identity middleware, requests fail closed with `401`. The only development identity mode requires both an explicit development environment and an allowlisted identity:

```powershell
$env:NODE_ENV = "development"
$env:DEV_AUTH_ENABLED = "true"
$env:DEV_AUTH_USERS = "alice,bob"
npm start
```

Send `X-Dev-User: alice` or `X-Dev-User: bob` with API requests. This header mode is rejected unless `NODE_ENV=development`, and the identity must be in `DEV_AUTH_USERS`. Never enable it in production. Real authentication remains a required decision before deployment.

The current dataset API accepts at most 10,000 records by default and JSON bodies up to 1 MB. `MAX_DATASET_RECORDS` can lower or raise the record cap up to 100,000. `PORT` defaults to 3000.

## Backend tests

```powershell
cd backend
npm test
```

The default backend suite uses controlled database doubles and skips the PostgreSQL integration test. For a disposable PostgreSQL database whose name starts with `agent_arena_test_`, configure `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and `PGSSLMODE`; `PGUSER` must be allowed to create schemas and apply migrations. Then run:

```powershell
$env:AGENT_ARENA_PG_TEST = "1"
npm run test:postgres
```

The integration test creates uniquely named schemas inside that database, applies migrations concurrently, tests rollback, exercises owner-scoped API operations and microsecond pagination, checks immutability triggers, and drops its schemas. It does not create or drop the database itself. Keep this database disposable. The production API should use the separate restricted runtime role described in `docs/DATABASE.md`; this test uses the migration-capable role to build its temporary schemas.
