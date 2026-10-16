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
    StructuredDatasetEvaluationResult,
    StructuredDatasetItemResult,
    StructuredOutputResult,
)
from .metrics import EXACT_MATCH_METRIC_NAME, EXACT_MATCH_METRIC_VERSION
from .structured import (
    JSON_SCHEMA_VERSION,
    STRUCTURED_METRIC_NAME,
    STRUCTURED_METRIC_VERSION,
    JsonSchemaEvaluator,
)


class EvaluationRunner:
    """Score 1 for exact string equality; no formatting or semantic normalization is applied."""

    def __init__(self, adapter: ModelAdapter) -> None:
        if not callable(getattr(adapter, "generate", None)):
            raise TypeError("adapter must provide a callable generate(request) method")
        self._adapter = adapter

    def evaluate(self, input: str, reference: str) -> EvaluationResult:
        self._validate_input(input)
        if not isinstance(reference, str):
            raise TypeError("reference must be a string")

        response, duration, error = self._generate(input)
        if error is not None:
            return EvaluationResult(
                input=input,
                reference=reference,
                actual_output=None,
                passed=None,
                score=None,
                duration_seconds=duration,
                error=error,
                metric_name=EXACT_MATCH_METRIC_NAME,
                metric_version=EXACT_MATCH_METRIC_VERSION,
            )

        passed = response.output == reference
        return EvaluationResult(
            input=input,
            reference=reference,
            actual_output=response.output,
            passed=passed,
            score=1.0 if passed else 0.0,
            duration_seconds=duration,
            metric_name=EXACT_MATCH_METRIC_NAME,
            metric_version=EXACT_MATCH_METRIC_VERSION,
        )

    def evaluate_structured(
        self,
        input: str,
        schema: Mapping[str, object] | bool,
    ) -> StructuredOutputResult:
        self._validate_input(input)
        evaluator = JsonSchemaEvaluator(schema)
        return self._evaluate_structured(input, evaluator)

    def evaluate_structured_dataset(
        self,
        records: Iterable[Mapping[str, object]],
        schema: Mapping[str, object] | bool,
    ) -> StructuredDatasetEvaluationResult:
        examples = validate_dataset(records)
        evaluator = JsonSchemaEvaluator(schema)
        items = tuple(
            StructuredDatasetItemResult(
                example_id=example.example_id,
                result=self._evaluate_structured(example.input, evaluator),
            )
            for example in examples
        )
        pass_count = sum(item.result.passed is True for item in items)
        fail_count = sum(item.result.passed is False for item in items)
        error_count = sum(item.result.passed is None for item in items)
        scored_count = pass_count + fail_count

        return StructuredDatasetEvaluationResult(
            items=items,
            dataset_format_version=DATASET_FORMAT_VERSION,
            schema_version=JSON_SCHEMA_VERSION,
            total_count=len(items),
            scored_count=scored_count,
            pass_count=pass_count,
            fail_count=fail_count,
            error_count=error_count,
            json_valid_count=sum(item.result.json_valid is True for item in items),
            schema_valid_count=sum(item.result.schema_valid is True for item in items),
            json_invalid_count=sum(item.result.json_valid is False for item in items),
            schema_invalid_count=sum(item.result.schema_valid is False for item in items),
            mean_score=pass_count / scored_count if scored_count else None,
            metric_name=STRUCTURED_METRIC_NAME,
            metric_version=STRUCTURED_METRIC_VERSION,
            schema_digest=evaluator.schema_digest,
        )

    def _evaluate_structured(
        self,
        input: str,
        evaluator: JsonSchemaEvaluator,
    ) -> StructuredOutputResult:
        response, duration, error = self._generate(input)
        if error is not None:
            return StructuredOutputResult(
                input=input,
                actual_output=None,
                json_valid=None,
                schema_valid=None,
                passed=None,
                score=None,
                duration_seconds=duration,
                schema_version=JSON_SCHEMA_VERSION,
                metric_name=STRUCTURED_METRIC_NAME,
                metric_version=STRUCTURED_METRIC_VERSION,
                error=error,
                schema_digest=evaluator.schema_digest,
            )

        check = evaluator.evaluate(response.output)
        passed = check.schema_valid is True
        return StructuredOutputResult(
            input=input,
            actual_output=response.output,
            json_valid=check.json_valid,
            schema_valid=check.schema_valid,
            passed=passed,
            score=1.0 if passed else 0.0,
            duration_seconds=duration,
            schema_version=JSON_SCHEMA_VERSION,
            metric_name=STRUCTURED_METRIC_NAME,
            metric_version=STRUCTURED_METRIC_VERSION,
            failure_reason=check.failure_reason,
            schema_digest=evaluator.schema_digest,
        )

    def _generate(self, input: str) -> tuple[ModelResponse | None, float, str | None]:
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
            return None, perf_counter() - started_at, error
        return response, perf_counter() - started_at, None

    @staticmethod
    def _validate_input(input: str) -> None:
        if not isinstance(input, str):
            raise TypeError("input must be a string")
        if not input.strip():
            raise ValueError("input must be a non-empty string")

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
            metric_name=EXACT_MATCH_METRIC_NAME,
            metric_version=EXACT_MATCH_METRIC_VERSION,
        )
