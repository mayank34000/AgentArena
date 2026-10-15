from dataclasses import dataclass


@dataclass(frozen=True)
class ModelRequest:
    input: str


@dataclass(frozen=True)
class ModelResponse:
    output: str
    model_id: str


@dataclass(frozen=True)
class EvaluationResult:
    input: str
    reference: str
    actual_output: str | None
    passed: bool | None
    score: float | None
    duration_seconds: float
    error: str | None = None


@dataclass(frozen=True)
class DatasetItemResult:
    example_id: str
    result: EvaluationResult


@dataclass(frozen=True)
class DatasetEvaluationResult:
    items: tuple[DatasetItemResult, ...]
    dataset_format_version: str
    total_count: int
    scored_count: int
    pass_count: int
    fail_count: int
    error_count: int
    mean_score: float | None
    metric_name: str
    metric_version: str
