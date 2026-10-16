const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10000;

export function createShutdownHandler(server, pool, { timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS } = {}) {
  if (!server || typeof server.close !== "function") throw new TypeError("server must provide close(callback)");
  if (!server || typeof server.closeAllConnections !== "function") {
    throw new TypeError("server must provide closeAllConnections()");
  }
  if (!pool || typeof pool.end !== "function") throw new TypeError("pool must provide end()");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("timeoutMs must be a positive integer");

  let shutdownPromise;
  return function shutdown() {
    if (!shutdownPromise) shutdownPromise = closeServerThenPool(server, pool, timeoutMs);
    return shutdownPromise;
  };
}

async function closeServerThenPool(server, pool, timeoutMs) {
  const httpClosed = new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  try {
    await withTimeout(httpClosed, timeoutMs, "HTTP server did not drain before the shutdown timeout.");
  } catch (error) {
    if (error.code !== "SHUTDOWN_TIMEOUT") throw error;
    server.closeAllConnections();
    await withTimeout(httpClosed, timeoutMs, "HTTP server did not close after connections were terminated.");
    // Forced socket closure may leave request handlers awaiting database work; let the process exit
    // instead of ending the pool underneath those handlers.
    const forcedShutdown = new Error("HTTP requests exceeded the graceful shutdown deadline.");
    forcedShutdown.code = "SHUTDOWN_FORCED";
    throw forcedShutdown;
  }

  await withTimeout(
    Promise.resolve().then(() => pool.end()),
    timeoutMs,
    "Database pool did not close before the shutdown timeout.",
  );
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error(message);
        error.code = "SHUTDOWN_TIMEOUT";
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}
