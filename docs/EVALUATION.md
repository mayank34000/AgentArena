# Evaluation Methodology

**Status: proposed.** Metric suitability depends on task, output contract, domain, and priorities; no metric is universal.

## Data and scoring

Dataset versions are immutable and include stable IDs, inputs, optional references/metadata, task/output format, digest, provenance/license, and validation report. Data, references, or preprocessing changes create a new version. Version suites/evaluators; document tuning exposure and protect evaluation-only data.

- **Exact match:** appropriate for canonical answers; disclose normalization rules.
- **Structured output:** report schema/parse validity and field checks; validity is not semantic correctness.
- **Reference-based:** choose task-appropriate references, possibly multiple; similarity can miss factuality/equivalence.
- **Rubric/open-ended:** define criteria and anchors in advance. Calibrate high-impact judgments with humans. LLM judges require versioned model/prompt, blinding where possible, human calibration, bias/disagreement inspection, and disclosure as estimates rather than ground truth.

Do not combine unlike metrics without justified explicit weights. Report denominators, failures, uncertainty when estimable, and evaluator versions.

## Operational metrics and comparison

Record latency statistic and timeout treatment, provider-reported or transparently estimated tokens, and cost estimates tied to dated pricing/configuration. Report unavailable values instead of inventing them. Separate success, timeout, rate limit, parse/evaluator errors and model-quality failures.

Snapshot model/provider ID, adapter, prompt/settings, dataset/suite/evaluator/judge versions, runtime, timestamp and supported seed. Hosted models can change, so bitwise repeatability is not guaranteed. Compare same examples and compatible settings/resource limits. Choose sample size for expected effect, variance, and stakes; no universal number. Repeat stochastic runs as useful, report uncertainty, balance call order if drift/load can bias results.

## Robustness and regression

Define controlled perturbations and expected invariants; link transformed examples to source and transformation version. They may not represent real risks. Compare compatible versions on shared examples/metric definitions, set task-specific tolerances, and inspect per-example changes. Thresholds prompt review; they are not proof. Account for sample noise, provider drift, evaluator changes. Defer agent/tool failure injection until boundaries, side effects, and containment are specified.
