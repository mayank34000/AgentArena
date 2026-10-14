# Proposed API Boundaries

**Status: proposals only; nothing here is implemented.** Public JSON API belongs to JavaScript/Express at proposed `/api/v1`. Python is internal. React calls Node; Node owns PostgreSQL transactions/access checks; Node passes versioned run payloads to Python initially through PostgreSQL; Python adapters call providers. Browser never receives provider credentials.

| Candidate route | Purpose/request and response |
|---|---|
| POST `/models` | Register `{name,adapterType,endpoint?,modelId,settings,credential?}`; return safe metadata only. Credential write-only. |
| GET `/models` | Caller-owned safe model summaries. |
| POST `/datasets` | Validate/create immutable version; upload method undecided; return id/version/status/count/digest. |
| POST `/suites` | Create suite `{name,taskType,outputFormat,evaluators}`; allowlisted evaluator schemas. |
| POST `/experiments` | Reference owned compatible model/dataset/suite versions and settings; return ready experiment. |
| POST `/experiments/{id}/runs` | Enqueue snapshot; optional idempotency key; return `202` queued run/status URL. |
| GET `/runs/{id}` | Status, progress, attempts, timestamps, sanitized failure. |
| POST `/runs/{id}/cancel` | Cooperative cancellation; terminal run conflicts. |
| GET `/runs/{id}/results` | Cursor/limit paginated per-example results. |
| GET `/runs/{id}/metrics` | Metric value, definition version, sample size, metadata. |

Authentication, upload limits/storage, and connection verification are undecided. Validate runtime schemas, ownership, pagination and request size. Proposed errors `{error:{code,message,details?,requestId}}`; no secrets or stacks. Candidate statuses: 400/422 validation, 401 unauthenticated, 403/404 inaccessible (enumeration policy TBD), 409 conflict, 5xx unexpected.

Runs transition queued → running → succeeded, completed_with_errors, failed, or cancelled. Define transitions centrally. Lease expiry may requeue with attempt history. `202` means saved/queued, not started. Initially poll with backoff; push updates later. Separate run-level failure from item errors.
