from time import perf_counter

from .contracts import ModelAdapter
from .errors import ModelAdapterError
from .models import EvaluationResult, ModelRequest, ModelResponse


class EvaluationRunner:
    """Score 1 for exact string equality; no formatting or semantic normalization is applied."""

    def __init__(self, adapter: ModelAdapter) -> None:
        if not callable(getattr(adapter, "generate", None)):
            raise TypeError("adapter must provide a callable generate(request) method")
        self._adapter = adapter

    def evaluate(self, input: str, reference: str) -> EvaluationResult:
        if not isinstance(input, str) or not input.strip():
            raise ValueError("input must be a non-empty string")
        if not isinstance(reference, str):
            raise TypeError("reference must be a string")

        started_at = perf_counter()
        try:
            response = self._adapter.generate(ModelRequest(input=input))
        except ModelAdapterError as exc:
            duration = perf_counter() - started_at
            return EvaluationResult(
                input=input,
                reference=reference,
                actual_output=None,
                passed=None,
                score=None,
                duration_seconds=duration,
                error=str(exc),
            )

        if (
            not isinstance(response, ModelResponse)
            or not isinstance(response.output, str)
            or not isinstance(response.model_id, str)
        ):
            raise TypeError("adapter generate() must return a normalized ModelResponse")

        passed = response.output == reference
        return EvaluationResult(
            input=input,
            reference=reference,
            actual_output=response.output,
            passed=passed,
            score=1.0 if passed else 0.0,
            duration_seconds=perf_counter() - started_at,
        )
