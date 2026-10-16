export function readConfig(env = process.env) {
  const required = ["PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Missing required database environment variables: ${missing.join(", ")}`);
  }

  const port = Number(env.PGPORT ?? "5432");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PGPORT must be an integer from 1 to 65535");
  }

  const poolMax = Number(env.PGPOOL_MAX ?? "10");
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 100) {
    throw new Error("PGPOOL_MAX must be an integer from 1 to 100");
  }

  const sslMode = env.PGSSLMODE ?? (env.NODE_ENV === "production" ? "verify-full" : "disable");
  if (!["disable", "verify-full"].includes(sslMode)) {
    throw new Error("PGSSLMODE must be 'disable' or 'verify-full'");
  }
  if (env.NODE_ENV === "production" && sslMode !== "verify-full") {
    throw new Error("Production database connections require PGSSLMODE=verify-full");
  }

  const maxDatasetRecords = Number(env.MAX_DATASET_RECORDS ?? "10000");
  if (!Number.isInteger(maxDatasetRecords) || maxDatasetRecords < 1 || maxDatasetRecords > 100000) {
    throw new Error("MAX_DATASET_RECORDS must be an integer from 1 to 100000");
  }

  const apiPort = Number(env.PORT ?? "3000");
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }

  return {
    database: {
      host: env.PGHOST,
      port,
      database: env.PGDATABASE,
      user: env.PGUSER,
      password: env.PGPASSWORD,
      ssl: sslMode === "verify-full" ? { rejectUnauthorized: true } : false,
      max: poolMax,
      application_name: "agent-arena-api",
    },
    maxDatasetRecords,
    nodeEnv: env.NODE_ENV ?? "development",
    port: apiPort,
  };
}
