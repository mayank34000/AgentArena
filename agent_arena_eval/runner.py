from collections.abc import Iterable, Mapping
from time import perf_counter

from .contracts import ModelAdapter
from .datasets import DATASET_FORMAT_VERSION, validate_dataset
from .errors import ModelAdapterError
from .models import (
    DatasetEvaluationResult,
    DatasetItemResult,
    EvaluationResult,
    ModelRequest,
    ModelResponse,
)


class EvaluationRunner:
    """Score 1 for exact string equality; no formatting or semantic normalization is applied."""

    def __init__(self, adapter: ModelAdapter) -> None:
        if not callable(getattr(adapter, "generate", None)):
            raise TypeError("adapter must provide a callable generate(request) method")
        self._adapter = adapter

    def evaluate(self, input: str, reference: str) -> EvaluationResult:
        if not isinstance(input, str):
            raise TypeError("input must be a string")
        if not input.strip():
            raise ValueError("input must be a non-empty string")
        if not isinstance(reference, str):
            raise TypeError("reference must be a string")

        started_at = perf_counter()
        try:
            response = self._adapter.generate(ModelRequest(input=input))
        except ModelAdapterError as exc:
            error = str(exc) or "Adapter request failed."
        except Exception as exc:
            error = f"Adapter failed with {type(exc).__name__}."
        else:
            if (
                not isinstance(response, ModelResponse)
                or not isinstance(response.output, str)
                or not isinstance(response.model_id, str)
                or not response.model_id.strip()
            ):
                error = "Adapter returned an invalid response."
            else:
                error = None

        if error is not None:
            return EvaluationResult(
                input=input,
                reference=reference,
                actual_output=None,
                passed=None,
                score=None,
                duration_seconds=perf_counter() - started_at,
                error=error,
            )

        passed = response.output == reference
        return EvaluationResult(
            input=input,
            reference=reference,
            actual_output=response.output,
            passed=passed,
            score=1.0 if passed else 0.0,
            duration_seconds=perf_counter() - started_at,
        )

    def evaluate_dataset(
        self,
        records: Iterable[Mapping[str, object]],
    ) -> DatasetEvaluationResult:
        examples = validate_dataset(records)
        items = tuple(
            DatasetItemResult(
                example_id=example.example_id,
                result=self.evaluate(example.input, example.reference),
            )
            for example in examples
        )
        pass_count = sum(item.result.passed is True for item in items)
        fail_count = sum(item.result.passed is False for item in items)
        error_count = sum(item.result.passed is None for item in items)
        scored_count = pass_count + fail_count

        return DatasetEvaluationResult(
            items=items,
            dataset_format_version=DATASET_FORMAT_VERSION,
            total_count=len(items),
            scored_count=scored_count,
            pass_count=pass_count,
            fail_count=fail_count,
            error_count=error_count,
            mean_score=pass_count / scored_count if scored_count else None,
            metric_name="exact_match_accuracy",
            metric_version="1",
        )
