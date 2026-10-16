import assert from "node:assert/strict";
import test from "node:test";

import { createShutdownHandler } from "../src/shutdown.js";

function makeShutdown({ timeoutMs = 100, closeAllConnections } = {}) {
  const calls = [];
  let finishClose;
  const server = {
    close(callback) {
      calls.push("server.close");
      finishClose = () => {
        calls.push("server.closed");
        callback();
      };
    },
    closeAllConnections() {
      calls.push("server.closeAllConnections");
      closeAllConnections?.(finishClose);
    },
  };
  const pool = {
    async end() {
      calls.push("pool.end");
    },
  };
  return {
    calls,
    finishClose: () => finishClose(),
    shutdown: createShutdownHandler(server, pool, { timeoutMs }),
  };
}

test("waits for HTTP requests to drain before ending the database pool", async () => {
  const fixture = makeShutdown();
  const promise = fixture.shutdown();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(fixture.calls, ["server.close"]);
  fixture.finishClose();
  await promise;
  assert.deepEqual(fixture.calls, ["server.close", "server.closed", "pool.end"]);
});

test("force-closes lingering HTTP connections and leaves the pool open after the drain timeout", async () => {
  const fixture = makeShutdown({
    timeoutMs: 10,
    closeAllConnections: (finishClose) => finishClose(),
  });

  await assert.rejects(fixture.shutdown(), { code: "SHUTDOWN_FORCED" });
  assert.deepEqual(fixture.calls, [
    "server.close",
    "server.closeAllConnections",
    "server.closed",
  ]);
});

test("repeated shutdown signals share one idempotent shutdown operation", async () => {
  const fixture = makeShutdown();
  const first = fixture.shutdown();
  const second = fixture.shutdown();
  assert.equal(second, first);
  fixture.finishClose();
  await Promise.all([first, second]);
  assert.deepEqual(fixture.calls, ["server.close", "server.closed", "pool.end"]);
});
