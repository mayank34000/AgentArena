import { readConfig } from "./config.js";
import { createApp } from "./app.js";
import { createPool } from "./db/pool.js";
import { createIdentityResolver } from "./identity.js";
import { createShutdownHandler } from "./shutdown.js";

const config = readConfig();
const pool = createPool(config);
const app = createApp({
  pool,
  resolveIdentity: createIdentityResolver(process.env),
  maxDatasetRecords: config.maxDatasetRecords,
});

const server = app.listen(config.port, () => {
  process.stdout.write(`Agent Arena API listening on port ${config.port}\n`);
});

const shutdown = createShutdownHandler(server, pool);

function handleShutdownSignal() {
  void shutdown().then(
    () => process.exit(0),
    () => {
      process.stderr.write("Graceful shutdown did not complete; terminating the process.\n");
      process.exit(1);
    },
  );
}

process.once("SIGINT", handleShutdownSignal);
process.once("SIGTERM", handleShutdownSignal);
