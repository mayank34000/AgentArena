# Proposed Database Model

**Status: provisional.** Validate against authentication, tenancy, data size, retention, and execution requirements before migrations. PostgreSQL is proposed system of record.

- **users:** identity, auth-provider reference or password hash (never plaintext), status, timestamps.
- **model_configurations:** owner, adapter kind, endpoint/model IDs, safe settings, encrypted credential reference, version. Never expose secrets.
- **dataset_versions:** owner, immutable version, format/schema, content location, digest, row count, validation state.
- **evaluation_suites:** owner, task/output type, evaluator definitions/version; separate suite-version table remains an option.
- **experiments:** owner, model, dataset/suite versions, generation/execution settings; edits do not rewrite run history.
- **runs:** experiment, immutable snapshot, state, attempts, lease/heartbeat, timestamps, cancellation and sanitized failure details.
- **per_example_results:** run, stable item ID, status, output/reference, evaluator details, latency, token use, cost estimate, error category.
- **trace_events:** run/optional item, order/time, event type, sanitized payload; likely deferred until traces are needed.
- **metric_results:** run, metric key/definition version, value, denominator/sample, aggregation metadata.

Users own configurations, versions, suites, experiments, and runs. Experiments reference owned immutable versions; runs snapshot inputs. Results/metrics belong to runs. Use foreign keys, ownership-aware constraints, unique dataset version/item IDs/(run,item), legal-state and nonnegative-value checks. Claim work atomically; idempotency prevents duplicate results. Index owner/recent, queue state/order, and paginated results. Define deletion/retention before implementation. Normalized snapshots versus validated schema-versioned JSONB, large dataset storage, tenant isolation, and at-rest encryption remain open.
