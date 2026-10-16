# Agent Arena Roadmap

**Status:** Python evaluation engine milestones 1–5 and the Milestone 6a implementation are present. Milestone 6a includes owner-scoped dataset/version and mock-model configuration APIs plus a PostgreSQL migration runner. The API uses controlled database doubles in tests; execution of the migration against a PostgreSQL server remains unverified in this environment. The Python test suite has 56 passing tests.

| Milestone | Scope/dependencies | Deliverable | Acceptance |
|---|---|---|---|
| 1–5 Python evaluation engine | Complete | Adapter contract and mock, single/dataset exact match, explicit JSON Schema evaluation, metric/version metadata, schema digest | Existing scoring/denominators preserved; deterministic tests; current suite passes |
| 6a Persistence foundation | Implemented; PostgreSQL execution verification pending | Ordered SQL migrations for principals, datasets/versions/records, append-only history triggers, and immutable model configs; Node validation and owner-scoped resource APIs | Node tests pass for migration bookkeeping, ordering, IDs, digest, ownership and validation; run SQL against PostgreSQL before production |
| 6b Synchronous run API | 6a; PostgreSQL migration verified; Python subprocess protocol and adapter registry | Node creates run snapshots, invokes bounded Python subprocess, persists results/metrics and sanitized failure state | Deterministic mock end-to-end; idempotency; malformed protocol, timeout, provider failure and ownership tests |
| 7 Background runs | 6b; execution exceeds HTTP limits or durable async execution is required | Database-backed worker with leases, attempts, terminal states, cancellation policy and idempotent persistence | Restart recovery and duplicate-claim tests; status/results observable |
| 8 React dashboard | Usable API | JavaScript React/Vite configure, start, status, results, comparison views | User configures a dataset/model and inspects a run |
| 9 Robustness/regression | Stable versions and metrics | Controlled perturbations, comparable checks, thresholds | Shared inputs align; signals explainable/configurable |
| 10 Agents/tool failures | Execution and containment requirements | Traces, tool contracts, injected failures | Reproducible bounded calls/failures |
| 11 Test/security/containers/CI/deploy | Decisions; tests throughout | Automated checks, threat review, container setup, CI, runbook | Clean setup works; secrets externalized; CI checks run |
| 12 Benchmark/docs/portfolio | Stable release | Reproducible examples, methodology, demo | Versions disclosed, no invented results, setup reproducible |

## Architecture decisions for the next implementation

- Node.js/Express owns HTTP validation, caller ownership, PostgreSQL transactions, and orchestration. Python owns adapters, execution, scoring, metric identities, and result production.
- PostgreSQL is the sole system of record. Python receives a bounded versioned JSON request from Node and returns a bounded JSON response; it does not connect to the database.
- Use one Python subprocess per synchronous run initially. No microservices, Redis, queue, or frontend implementation in Milestones 6a/6b.
- Keep Milestone 6b synchronous and strictly bounded for the first small end-to-end slice. Add the database-backed worker in Milestone 7 before workloads can exceed API/proxy limits or need to survive API restarts.
- Dataset versions, model configurations, run snapshots, result metric names/versions, and structured schema digests must be retained. Metric definitions remain owned by Python; no registry table is planned yet.
- Use JavaScript for all Node and future frontend code. Do not migrate/rewrite the Python engine as part of the API work.

## Open decisions before production

Select an authentication provider and principal mapping, PostgreSQL version, secret manager and credential-profile policy, retention/deletion and backup policy, whether model outputs are persisted by default, custom endpoint/SSRF controls, provider adapters beyond the local mock, and production run limits. Resolve these incrementally at the milestone that needs them.
