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
