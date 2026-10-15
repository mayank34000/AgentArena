# Evaluation Methodology

**Status: proposed.** Metric suitability depends on task, output contract, domain, and priorities; no metric is universal.

## Data and scoring

Dataset versions are immutable and include stable IDs, inputs, optional references/metadata, task/output format, digest, provenance/license, and validation report. Data, references, or preprocessing changes create a new version. Version suites/evaluators; document tuning exposure and protect evaluation-only data.

- **Exact match:** appropriate for canonical answers; disclose normalization rules.
- **Structured output:** report schema/parse validity and field checks; validity is not semantic correctness.
- **Reference-based:** choose task-appropriate references, possibly multiple; similarity can miss factuality/equivalence.
- **Rubric/open-ended:** define criteria and anchors in advance. Calibrate high-impact judgments with humans. LLM judges require versioned model/prompt, blinding where possible, human calibration, bias/disagreement inspection, and disclosure as estimates rather than ground truth.

The initial dataset format (version `1`) accepts ordered records with unique non-empty string IDs, non-empty string inputs, and string references. Empty references are permitted to preserve single-example runner behavior; empty datasets are rejected. Version-1 exact-match accuracy is the mean of per-example scores over responses that were scored. Adapter errors are excluded from that denominator and reported separately, so a mean is `None` when every example errors. Results include dataset format and metric versions plus total, scored, pass, fail, and error counts to make coverage visible. Exact comparison remains case- and whitespace-sensitive.

Structured-output evaluation uses an explicitly supplied JSON Schema Draft 2020-12 schema and reports `json_schema_validity` metric version `1` separately from exact match. Schemas are validated before model calls; an omitted `$schema` defaults to Draft 2020-12, while another declared draft is rejected. Standard Draft 2020-12 behavior applies, including the default that additional properties are allowed unless constrained. `format` annotations are not asserted, and boolean schemas are supported. Results distinguish malformed JSON (`json_valid: false`) from valid JSON that violates the schema (`schema_valid: false`); schema failures use fixed reason codes without output excerpts. Dataset evaluation applies one explicit schema to each ordered record and preserves each record's ID. Adapter errors are reported separately and excluded from the score denominator.

Do not combine unlike metrics without justified explicit weights. Report denominators, failures, uncertainty when estimable, and evaluator versions.

## Operational metrics and comparison

Record latency statistic and timeout treatment, provider-reported or transparently estimated tokens, and cost estimates tied to dated pricing/configuration. Report unavailable values instead of inventing them. Separate success, timeout, rate limit, parse/evaluator errors and model-quality failures.

Snapshot model/provider ID, adapter, prompt/settings, dataset/suite/evaluator/judge versions, runtime, timestamp and supported seed. Hosted models can change, so bitwise repeatability is not guaranteed. Compare same examples and compatible settings/resource limits. Choose sample size for expected effect, variance, and stakes; no universal number. Repeat stochastic runs as useful, report uncertainty, balance call order if drift/load can bias results.

## Robustness and regression

Define controlled perturbations and expected invariants; link transformed examples to source and transformation version. They may not represent real risks. Compare compatible versions on shared examples/metric definitions, set task-specific tolerances, and inspect per-example changes. Thresholds prompt review; they are not proof. Account for sample noise, provider drift, evaluator changes. Defer agent/tool failure injection until boundaries, side effects, and containment are specified.

Structured-output schema references using `$ref` or `$dynamicRef` are rejected in this milestone.
