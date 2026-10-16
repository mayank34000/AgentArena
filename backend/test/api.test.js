import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.js";
import { createIdentityResolver, isValidIdentity } from "../src/identity.js";
import { contentDigest } from "../src/validation.js";
import { MemoryPool, testIdentityResolver, withServer } from "./helpers.js";

function makeApp(pool = new MemoryPool(), options = {}) {
  return {
    pool,
    app: createApp({
      pool,
      resolveIdentity: options.resolveIdentity ?? testIdentityResolver,
      maxDatasetRecords: options.maxDatasetRecords ?? 100,
    }),
  };
}

function requestOptions(method, owner, body) {
  const headers = {};
  if (owner) headers["x-test-owner"] = owner;
  if (body !== undefined) headers["content-type"] = "application/json";
  return { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}

const validDataset = {
  name: "math",
  metadata: { source: "test" },
  records: [
    { id: "sum-1", input: "2 + 2?", reference: "4", metadata: { tags: ["math"], source: { z: 1, a: 2 } } },
    { id: "sum-2", input: "3 + 3?", reference: "6" },
  ],
};

test("creates a valid dataset and persists ordered records under the trusted owner", async () => {
  const { pool, app } = makeApp();
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/datasets`, requestOptions("POST", "alice", validDataset));
    const result = await response.json();

    assert.equal(response.status, 201);
    assert.equal(result.name, "math");
    assert.equal(result.latest_version.record_count, 2);
    assert.match(result.latest_version.content_digest, /^[0-9a-f]{64}$/);
    assert.deepEqual(pool.records.map((record) => [record.ordinal, record.example_id]), [[0, "sum-1"], [1, "sum-2"]]);
    const alice = [...pool.users].find(([key]) => key.endsWith("\0alice"))[1];
    assert.equal([...pool.datasets.values()][0].owner_id, alice);
    assert.ok(pool.calls.some((call) => call.sql.includes("$1") && call.sql.includes("INSERT INTO datasets")));
  });
});

test("canonical dataset digest is stable across nested object key ordering", () => {
  const left = [{ id: "one", input: "x", reference: "y", metadata: { b: 2, a: { y: 1, x: 0 } } }];
  const right = [{ id: "one", input: "x", reference: "y", metadata: { a: { x: 0, y: 1 }, b: 2 } }];
  assert.equal(contentDigest(left), contentDigest(right));
  assert.notEqual(contentDigest(left), contentDigest([{ ...left[0], input: "changed" }]));
});

test("rejects malformed dataset payloads and records before writing", async (t) => {
  const invalid = [
    ["missing name", { records: validDataset.records }],
    ["empty records", { name: "empty", records: [] }],
    ["missing id", { name: "bad", records: [{ input: "x", reference: "y" }] }],
    ["blank id", { name: "bad", records: [{ id: "  ", input: "x", reference: "y" }] }],
    ["blank input", { name: "bad", records: [{ id: "x", input: "  ", reference: "y" }] }],
    ["non-string reference", { name: "bad", records: [{ id: "x", input: "x", reference: null }] }],
    ["duplicate IDs", { name: "bad", records: [{ id: "x", input: "x", reference: "y" }, { id: "x", input: "z", reference: "w" }] }],
    ["unknown record field", { name: "bad", records: [{ id: "x", input: "x", reference: "y", owner_id: "alice" }] }],
  ];
  for (const [label, payload] of invalid) {
    await t.test(label, async () => {
      const { pool, app } = makeApp();
      await withServer(app, async (base) => {
        const response = await fetch(`${base}/api/v1/datasets`, requestOptions("POST", "alice", payload));
        assert.equal(response.status, 422);
        assert.equal(pool.datasets.size, 0);
      });
    });
  }
});

test("lists datasets, retrieves metadata, and pages records in order with owner isolation", async () => {
  const { pool, app } = makeApp();
  await withServer(app, async (base) => {
    const createdResponse = await fetch(`${base}/api/v1/datasets`, requestOptions("POST", "alice", validDataset));
    const created = await createdResponse.json();

    const list = await fetch(`${base}/api/v1/datasets`, requestOptions("GET", "alice"));
    const listBody = await list.json();
    assert.equal(list.status, 200);
    assert.equal(listBody.items.length, 1);
    assert.equal(listBody.items[0].id, created.id);

    const detail = await fetch(`${base}/api/v1/datasets/${created.id}`, requestOptions("GET", "alice"));
    assert.equal(detail.status, 200);
    assert.deepEqual((await detail.json()).latest_version.metadata, { source: "test" });

    const firstPageResponse = await fetch(
      `${base}/api/v1/datasets/${created.id}/versions/${created.latest_version.id}/records?limit=1`,
      requestOptions("GET", "alice"),
    );
    const firstPage = await firstPageResponse.json();
    assert.equal(firstPage.items[0].ordinal, 0);
    assert.ok(firstPage.next_cursor);
    const secondPageResponse = await fetch(
      `${base}/api/v1/datasets/${created.id}/versions/${created.latest_version.id}/records?limit=1&cursor=${encodeURIComponent(firstPage.next_cursor)}`,
      requestOptions("GET", "alice"),
    );
    const secondPage = await secondPageResponse.json();
    assert.equal(secondPage.items[0].id, "sum-2");

    const bobList = await fetch(`${base}/api/v1/datasets`, requestOptions("GET", "bob"));
    assert.deepEqual((await bobList.json()).items, []);
    const bobDetail = await fetch(`${base}/api/v1/datasets/${created.id}`, requestOptions("GET", "bob"));
    assert.equal(bobDetail.status, 404);
    const bobRecords = await fetch(
      `${base}/api/v1/datasets/${created.id}/versions/${created.latest_version.id}/records`,
      requestOptions("GET", "bob"),
    );
    assert.equal(bobRecords.status, 404);
    const bobPagedRecords = await fetch(
      `${base}/api/v1/datasets/${created.id}/versions/${created.latest_version.id}/records?cursor=${encodeURIComponent(firstPage.next_cursor)}`,
      requestOptions("GET", "bob"),
    );
    assert.equal(bobPagedRecords.status, 404);
    assert.ok(pool.calls.filter((call) => call.sql.includes("FROM datasets d")).every((call) => call.sql.includes("owner_id = $")));
  });
});

test("dataset and model collection cursors preserve microseconds without page gaps or duplicates", async () => {
  const { pool, app } = makeApp();
  await withServer(app, async (base) => {
    for (let index = 1; index <= 3; index += 1) {
      const datasetResponse = await fetch(
        `${base}/api/v1/datasets`,
        requestOptions("POST", "alice", { ...validDataset, name: `math-${index}` }),
      );
      assert.equal(datasetResponse.status, 201);
      const modelResponse = await fetch(
        `${base}/api/v1/models`,
        requestOptions("POST", "alice", {
          name: `mock-${index}`,
          adapter_type: "mock",
          provider_id: "local",
          model_id: "deterministic-mock",
          settings: {},
        }),
      );
      assert.equal(modelResponse.status, 201);
    }

    const timestamps = [
      "2026-10-17T10:00:00.123900Z",
      "2026-10-17T10:00:00.123500Z",
      "2026-10-17T10:00:00.123100Z",
    ];
    const expectedDatasetIds = [...pool.datasets.values()].map((dataset, index) => {
      dataset.created_at = timestamps[index];
      return dataset.id;
    });
    const expectedModelIds = [...pool.models.values()].map((model, index) => {
      model.created_at = timestamps[index];
      return model.id;
    });

    async function collectPages(path, expectedCount) {
      const items = [];
      let cursor = null;
      do {
        const query = new URLSearchParams({ limit: "1" });
        if (cursor) query.set("cursor", cursor);
        const response = await fetch(`${base}${path}?${query}`, requestOptions("GET", "alice"));
        assert.equal(response.status, 200);
        const body = await response.json();
        items.push(...body.items);
        cursor = body.next_cursor;
        if (items.length > expectedCount) assert.fail("pagination returned a duplicate or unexpected row");
      } while (cursor);
      return items;
    }

    const datasets = await collectPages("/api/v1/datasets", 3);
    const models = await collectPages("/api/v1/models", 3);
    assert.deepEqual(datasets.map((item) => item.id), expectedDatasetIds);
    assert.deepEqual(models.map((item) => item.id), expectedModelIds);
    assert.equal(new Set(datasets.map((item) => item.id)).size, 3);
    assert.equal(new Set(models.map((item) => item.id)).size, 3);
  });
});

test("creates the next immutable dataset version and rejects cross-owner writes", async () => {
  const { app, pool } = makeApp();
  await withServer(app, async (base) => {
    const createdResponse = await fetch(`${base}/api/v1/datasets`, requestOptions("POST", "alice", validDataset));
    const created = await createdResponse.json();
    const nextPayload = { metadata: { source: "revised" }, records: [{ id: "sum-3", input: "5 + 5?", reference: "10" }] };

    const denied = await fetch(
      `${base}/api/v1/datasets/${created.id}/versions`,
      requestOptions("POST", "bob", nextPayload),
    );
    assert.equal(denied.status, 404);

    const addedResponse = await fetch(
      `${base}/api/v1/datasets/${created.id}/versions`,
      requestOptions("POST", "alice", nextPayload),
    );
    const added = await addedResponse.json();
    assert.equal(addedResponse.status, 201);
    assert.equal(added.version, 2);
    assert.equal(added.record_count, 1);

    const detailResponse = await fetch(`${base}/api/v1/datasets/${created.id}`, requestOptions("GET", "alice"));
    const detail = await detailResponse.json();
    assert.equal(detail.latest_version.id, added.id);
    assert.equal(detail.latest_version.version, 2);
    const recordsResponse = await fetch(
      `${base}/api/v1/datasets/${created.id}/versions/${added.id}/records`,
      requestOptions("GET", "alice"),
    );
    assert.deepEqual((await recordsResponse.json()).items.map((record) => record.id), ["sum-3"]);
    assert.equal(pool.versions.size, 2);
  });
});

test("creates and lists only supported immutable model configurations", async () => {
  const { pool, app } = makeApp();
  const model = {
    name: "local-mock",
    adapter_type: "mock",
    provider_id: "local",
    model_id: "deterministic-mock",
    settings: {},
    credential_profile: null,
  };
  await withServer(app, async (base) => {
    const createdResponse = await fetch(`${base}/api/v1/models`, requestOptions("POST", "alice", model));
    const created = await createdResponse.json();
    assert.equal(createdResponse.status, 201);
    assert.equal(created.adapter_type, "mock");
    assert.equal("credential_profile" in created, false);

    const aliceList = await fetch(`${base}/api/v1/models`, requestOptions("GET", "alice"));
    assert.equal((await aliceList.json()).items.length, 1);
    const bobList = await fetch(`${base}/api/v1/models`, requestOptions("GET", "bob"));
    assert.deepEqual((await bobList.json()).items, []);

    const unsupported = await fetch(`${base}/api/v1/models`, requestOptions("POST", "alice", {
      ...model,
      adapter_type: "hosted-provider",
    }));
    assert.equal(unsupported.status, 422);
    const rawCredential = await fetch(`${base}/api/v1/models`, requestOptions("POST", "alice", {
      ...model,
      credential_profile: "arbitrary-secret-reference",
    }));
    assert.equal(rawCredential.status, 422);
    assert.equal(pool.models.size, 1);
  });
});

test("missing and invalid identities fail closed", async () => {
  const { app } = makeApp();
  await withServer(app, async (base) => {
    const missing = await fetch(`${base}/api/v1/datasets`, requestOptions("GET"));
    assert.equal(missing.status, 401);
    const arbitrary = await fetch(`${base}/api/v1/datasets`, requestOptions("GET", "mallory"));
    assert.equal(arbitrary.status, 401);
  });

  const invalidApp = createApp({
    pool: new MemoryPool(),
    resolveIdentity: () => ({ issuer: " ", subject: "alice" }),
  });
  await withServer(invalidApp, async (base) => {
    const invalid = await fetch(`${base}/api/v1/models`, requestOptions("GET", "alice"));
    assert.equal(invalid.status, 401);
  });
});

test("development identity requires an explicit development-only allowlist", () => {
  assert.throws(
    () => createIdentityResolver({ NODE_ENV: "production", DEV_AUTH_ENABLED: "true", DEV_AUTH_USERS: "alice" }),
    /only when NODE_ENV=development/,
  );
  assert.throws(
    () => createIdentityResolver({ NODE_ENV: "development", DEV_AUTH_ENABLED: "true", DEV_AUTH_USERS: "" }),
    /DEV_AUTH_USERS/,
  );
  const resolve = createIdentityResolver({ NODE_ENV: "development", DEV_AUTH_ENABLED: "true", DEV_AUTH_USERS: "alice" });
  assert.deepEqual(resolve({ get: () => "alice" }), { issuer: "urn:agent-arena:development", subject: "alice" });
  assert.equal(resolve({ get: () => "bob" }), null);
  assert.equal(isValidIdentity({ issuer: "issuer", subject: "subject" }), true);
});

test("database errors return a generic safe response and roll back dataset writes", async () => {
  const pool = new MemoryPool();
  pool.failWhen = (sql) => sql.includes("INSERT INTO dataset_versions");
  pool.failure = new Error("Connection terminated unexpectedly", { cause: new Error("password=private-db-secret") });
  const { app } = makeApp(pool);
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/datasets`, requestOptions("POST", "alice", validDataset));
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "service_unavailable");
    assert.equal(JSON.stringify(body).includes("private-db-secret"), false);
    assert.equal(pool.datasets.size, 0);
    assert.equal(pool.versions.size, 0);
  });
});

test("unexpected internal errors return generic 500 without exposing exception details", async () => {
  const pool = new MemoryPool();
  pool.failWhen = (sql) => sql.includes("FROM model_configurations");
  pool.failure = new TypeError("SQL text contained password=private-db-secret");
  const { app } = makeApp(pool);
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/models`, requestOptions("GET", "alice"));
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.error.code, "internal_error");
    assert.equal(body.error.message, "An internal error occurred.");
    assert.equal(JSON.stringify(body).includes("private-db-secret"), false);
  });
});

test("invalid JSON and duplicate names use safe consistent errors", async () => {
  const { app } = makeApp();
  await withServer(app, async (base) => {
    const malformed = await fetch(`${base}/api/v1/datasets`, {
      method: "POST",
      headers: { "x-test-owner": "alice", "content-type": "application/json" },
      body: "{bad json",
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, "invalid_json");

    await fetch(`${base}/api/v1/datasets`, requestOptions("POST", "alice", validDataset));
    const duplicate = await fetch(`${base}/api/v1/datasets`, requestOptions("POST", "alice", validDataset));
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).error.code, "duplicate_resource");

    const badCursor = await fetch(`${base}/api/v1/datasets?cursor=not-a-cursor`, requestOptions("GET", "alice"));
    assert.equal(badCursor.status, 400);
    assert.equal((await badCursor.json()).error.code, "invalid_pagination");
  });
});
