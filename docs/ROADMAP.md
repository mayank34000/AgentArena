# Agent Arena Roadmap

**Status: proposed.** First implementation milestone after approval: Python adapter protocol, deterministic fake adapter, one evaluator, and focused tests; no provider, DB, API, or UI.

| Phase | Scope/dependencies | Deliverable | Acceptance |
|---|---|---|---|
| 1 Requirements/architecture | Planning only | Five planning documents | Review and record open decisions; no app code. |
| 2 Python engine/adapters | Phase 1 approval | Contract, errors, fake adapter, evaluator | Deterministic fixture; invalid input and timeout tested. |
| 3 Datasets/scoring | Phase 2 | Versioned format, validator, exact/structured evaluators | Valid fixtures load; malformed rows actionable; metric version recorded. |
| 4 Persistence/Node API | Approved schema/contracts | JS Express modules, validation, migrations, ownership, resource APIs | Tests cover validation, access, persistence, errors. |
| 5 Background runs | Phases 2–4 | Python worker, leases, states, result persistence | Terminal run; restart idempotency; cancellation/retries observable. |
| 6 React dashboard | Usable API | React/Vite configure, status, results, comparisons | User configures, starts, inspects a run. |
| 7 Robustness/regression | Stable versions/metrics | Perturbations, comparable checks, thresholds | Shared inputs align; signals explainable/configurable. |
| 8 Agents/tool failures | Execution/containment requirements | Traces, tool contracts, injected failures | Reproducible bounded calls/failures. |
| 9 Test/security/containers/CI/deploy | Decisions; tests throughout | Automated checks, threat review, Docker, CI, runbook | CI checks run, secrets externalized, clean setup works. |
| 10 Benchmark/docs/portfolio | Stable release | Reproducible examples, methodology, demo | Versions disclosed, no invented results, setup reproducible. |

Implement only phase 2 as the first small milestone; defer provider credentials, HTTP integrations, persistence, workers, and UI.
