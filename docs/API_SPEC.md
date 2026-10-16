# Proposed API Contract

**Status:** Milestone 6a dataset and model-configuration routes are implemented in JavaScript/Express under `/api/v1`; run routes remain proposed. The browser talks only to Node; Python is planned as an internal subprocess. IDs are opaque UUIDs. Request and response bodies are validated at the Node boundary.

## Common behavior

- JSON request/response; UTF-8. Paginated collection routes accept `limit` and opaque `cursor`; the server caps `limit`. Ordering is stable (`created_at, id` for resources and `ordinal` for records/results). Resource cursors retain the database timestamp in UTC with six fractional digits so PostgreSQL microseconds survive a page boundary.
- Every endpoint resolves a trusted owner principal from authentication middleware. A request cannot supply `owner_id`. Local development may configure one fixed principal.
- Until a trusted production identity provider is integrated, requests fail closed with `401`. The development identity header is accepted only when `NODE_ENV=development`, `DEV_AUTH_ENABLED=true`, and the subject appears in the server-side `DEV_AUTH_USERS` allowlist.
- Dataset inputs/records and model settings are checked against their versioned contracts before persistence. Evaluation dataset and schema semantics must remain consistent with Python validation; Python is still authoritative for metric behavior.
- Common error envelope: `{"error":{"code":"validation_error","message":"Request is invalid.","details":[],"request_id":"..."}}`. `details` contains safe field/path errors only. Never include stack traces, subprocess stderr, raw provider exceptions, environment variables, credential values, or raw secret-bearing endpoint data.
- Database/service availability failures use `503`; unexpected internal failures use a generic `500` response. Neither response exposes SQL, stack traces, credentials, or raw exception messages.
- Responses for missing and non-owned resources both use `404` to avoid resource enumeration.

## Datasets

### `POST /api/v1/datasets`

Create a logical dataset and immutable version 1. Node validates required fields/size and Python's dataset requirements (ordered records, unique non-empty string IDs, non-empty string inputs, string references; empty references are valid). Dataset names are unique per owner. JSON bodies are limited to 1 MiB and datasets default to at most 10,000 records; deployments may configure a lower/higher record cap.

Request:

```json
{
  "name": "arithmetic-v1",
  "metadata": {"source": "local fixture"},
  "records": [
    {"id": "sum-1", "input": "2 + 2?", "reference": "4", "metadata": {"tag": "math"}}
  ]
}
```

Response `201`:

```json
{"id":"uuid","name":"arithmetic-v1","latest_version":{"id":"uuid","version":1,"format_version":"1","record_count":1,"content_digest":"<sha256>","metadata":{"source":"local fixture"}}}
```

Errors: `400` malformed JSON; `401` unauthenticated; `409` duplicate name; `413` request/record limit exceeded; `422` invalid dataset; `503` database unavailable. Dataset and records are inserted atomically.

### `GET /api/v1/datasets`

List caller-owned datasets with `limit`/`cursor`. Response `200` includes each dataset's `id`, `name`, and `latest_version` summary (`id`, `version`, `format_version`, `record_count`, `content_digest`, and version metadata). Errors: `400`, `401`.

### `GET /api/v1/datasets/{datasetId}`

Return caller-owned dataset metadata and its latest version summary; records are read through the version records route below. Response `200`: same dataset shape as the create response. Errors: `401`, `404`.

### `POST /api/v1/datasets/{datasetId}/versions`

Create the next immutable version of an existing owned dataset using the same request shape as dataset creation minus `name`. Response `201`: `{"id":"uuid","dataset_id":"uuid","version":2,"format_version":"1","record_count":1,"content_digest":"...","metadata":{}}`. Errors: `400`, `401`, `404`, `413`, `422`, `503`. Records and version metadata commit atomically; only then does `latest_version` advance.

### `GET /api/v1/datasets/{datasetId}/versions/{versionId}/records`

Read immutable records in ordinal order with `limit`/`cursor`. Response `200`: `{"items":[{"ordinal":0,"id":"sum-1","input":"2 + 2?","reference":"4","metadata":{"tag":"math"}}],"next_cursor":null}`. Errors: `400`, `401`, `404` if the dataset/version is not owned or not related. A distinct record-import/upload transport is deferred; initial requests are bounded JSON bodies.

## Model configurations

### `POST /api/v1/models`

Register one immutable model configuration. Updating effective settings creates a new configuration ID. This milestone accepts only `{adapter_type:"mock",provider_id:"local",model_id:"deterministic-mock"}` with empty settings; no credentials or endpoint are accepted. Future `credential_profile` values must come from a server allowlist, and requests must never carry credential values.

Request:

```json
{"name":"local-mock","adapter_type":"mock","provider_id":"local","model_id":"deterministic-mock","settings":{},"credential_profile":null}
```

Response `201`:

```json
{"id":"uuid","name":"local-mock","adapter_type":"mock","provider_id":"local","model_id":"deterministic-mock","settings":{},"created_at":"..."}
```

Secrets are never stored or returned. Errors: `400`, `401`, `409` duplicate name, `422` unsupported adapter/settings/profile, `503` database unavailable. The deterministic mock is the only registered adapter today.

### `GET /api/v1/models`

List caller-owned configurations with `limit`/`cursor`; response `200` is `{"items":[safe model response],"next_cursor":null}`. Errors: `400`, `401`.

## Evaluation runs

### `POST /api/v1/runs`

Start one bounded synchronous evaluation using immutable dataset/model resources. Require an `Idempotency-Key` header (opaque, bounded string). Repeating the same owner/key and request body returns the existing run with `200`; using the key with a different request body returns `409`.

Request:

```json
{
  "dataset_version_id": "uuid",
  "model_configuration_id": "uuid",
  "evaluator": {"type": "exact_match"},
  "generation_settings": {}
}
```

For structured output, use `{"type":"json_schema","schema":{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"]}}`. The caller does not choose a metric version. Python returns the supported metric name/version; Node persists those values. Generation settings are allowlisted by the selected adapter.

Response `201` once a run resource is persisted and synchronous execution ends (including a safely represented execution failure):

```json
{
  "id":"uuid","state":"succeeded","dataset_version_id":"uuid","model_configuration_id":"uuid",
  "created_at":"...","started_at":"...","finished_at":"...",
  "metrics":[{"metric_name":"exact_match_accuracy","metric_version":"1","value":1.0,"denominator":1,"metadata":{"total_count":1,"scored_count":1,"pass_count":1,"fail_count":0,"error_count":0},"schema_version":null,"schema_digest":null}],
  "error":null
}
```

For structured output, aggregate metric is `json_schema_validity`; it remains separate from exact match and includes the JSON Schema dialect and schema digest. Adapter item failures produce `completed_with_errors` when some items score, or `completed_with_errors` with a null metric value when none score, matching current dataset semantics. Process/protocol/whole-run failures produce `failed` with an allowlisted code and generic message. A failed run is still a successfully created run resource and therefore remains retrievable. Invalid requests fail before a run is created.

Errors: `400` malformed body/header; `401`; `404` inaccessible resources; `409` idempotency mismatch or incompatible resource state; `413` input/record limits; `422` invalid evaluator/schema/settings or dataset/model mismatch; `500` database failure before run creation. Run-level process failure is represented in the `201` run body, not as a provider-specific response. A deployment-level inability to create the run may return `503`.

This endpoint is synchronous: `201` does not mean queued, and the response usually contains a terminal state. Keep hard run/request limits below the configured HTTP and proxy timeout. When that cannot be guaranteed, replace this execution behavior with the roadmap's database-backed worker and return `202` with a run `Location`; do not quietly imply background execution.

### `GET /api/v1/runs`

List caller-owned prior runs with `limit`/`cursor`; optional filters `dataset_version_id`, `model_configuration_id`, `state`. Response `200`: `{"items":[run summaries],"next_cursor":null}`. Errors: `400`, `401`, `404` for inaccessible filter resources.

### `GET /api/v1/runs/{runId}`

Read run state, safe error, snapshots' non-secret summary, timestamps, and aggregate metrics. Response `200` uses the run shape above. Errors: `401`, `404`.

### `GET /api/v1/runs/{runId}/results`

List run outcomes in dataset order with `limit`/`cursor`. Response `200`:

```json
{"items":[{"ordinal":0,"example_id":"sum-1","outcome":"scored","metric_name":"exact_match_accuracy","metric_version":"1","score":1.0,"passed":true,"actual_output":"4","duration_seconds":0.001,"schema_version":null,"schema_digest":null,"failure_reason":null,"error_code":null,"safe_error_message":null,"details":{}}],"next_cursor":null}
```

For structured evaluations, `details` can include `json_valid` and `schema_valid`; malformed JSON is a scored failure with the engine's fixed `failure_reason`, while adapter errors have null score/pass and an allowlisted error code. Errors: `400`, `401`, `404`.

## Python protocol and validation

The internal subprocess protocol is versioned JSON over stdin/stdout, not an HTTP route. Request fields include `protocol_version`, run ID, ordered dataset format/records, evaluator (including schema where applicable), safe adapter configuration, and allowed generation settings. Python validates all fields before adapter calls. Response fields include protocol version, ordered item IDs, outcomes, score/pass, metric identity/version, schema version/digest where relevant, duration, safe error category, aggregate value, and denominator/count metadata. Node rejects unknown protocol versions, duplicate/missing/unexpected IDs, invalid types, count inconsistencies, and output beyond limits; it marks the run failed and returns no subprocess details. Python remains the sole source of scores.

API schema validation can reject malformed shapes before saving a run. JSON Schema dialect/contents and dataset rules are validated again by Python before any model call. Errors are mapped to stable HTTP codes; provider messages, stack traces, stderr, and secrets are never copied into the public `message` or `details` fields.
