import pytest

from agent_arena_eval import (
    EvaluationRunner,
    MockModelAdapter,
    ModelAdapterError,
    ModelRequest,
    ModelResponse,
)


def test_mock_adapter_returns_configured_output():
    adapter = MockModelAdapter({"2 + 2?": "4"})

    response = adapter.generate(ModelRequest("2 + 2?"))

    assert response == ModelResponse(output="4", model_id="deterministic-mock")


def test_runner_scores_matching_output():
    result = EvaluationRunner(MockModelAdapter({"capital?": "Oslo"})).evaluate(
        "capital?", "Oslo"
    )

    assert result.input == "capital?"
    assert result.reference == "Oslo"
    assert result.actual_output == "Oslo"
    assert result.passed is True
    assert result.score == 1.0
    assert result.duration_seconds >= 0
    assert result.error is None
    assert (result.metric_name, result.metric_version) == ("exact_match_accuracy", "1")


def test_runner_scores_non_matching_output():
    result = EvaluationRunner(MockModelAdapter({"capital?": "Bergen"})).evaluate(
        "capital?", "Oslo"
    )

    assert result.actual_output == "Bergen"
    assert result.passed is False
    assert result.score == 0.0


def test_adapter_error_is_returned_as_failure_result():
    result = EvaluationRunner(MockModelAdapter({})).evaluate("unknown", "answer")

    assert result.actual_output is None
    assert result.passed is None
    assert result.score is None
    assert result.error == "No mock response is configured for this input."
    assert result.duration_seconds >= 0


def test_unexpected_adapter_exception_does_not_expose_exception_message():
    class UnexpectedFailureAdapter:
        def generate(self, request):
            raise RuntimeError("authorization token=secret-value")

    result = EvaluationRunner(UnexpectedFailureAdapter()).evaluate("question", "answer")

    assert result.actual_output is None
    assert result.passed is None
    assert result.score is None
    assert result.error == "Adapter failed with RuntimeError."
    assert "secret-value" not in result.error


class BrokenAdapter:
    def generate(self, request):
        raise ModelAdapterError("provider unavailable")


def test_adapter_contract_works_polymorphically():
    result = EvaluationRunner(BrokenAdapter()).evaluate("question", "answer")

    assert result.error == "provider unavailable"
    assert result.passed is None


@pytest.mark.parametrize(
    "response",
    [
        None,
        "answer",
        ModelResponse(output=None, model_id="mock"),
        ModelResponse(output="answer", model_id="  "),
        ModelResponse(output="answer", model_id=None),
    ],
)
def test_invalid_adapter_response_returns_consistent_failure_result(response):
    class MalformedAdapter:
        def generate(self, request):
            return response

    result = EvaluationRunner(MalformedAdapter()).evaluate("question", "answer")

    assert result.actual_output is None
    assert result.passed is None
    assert result.score is None
    assert result.error == "Adapter returned an invalid response."


def test_empty_model_output_is_a_valid_non_matching_response():
    result = EvaluationRunner(MockModelAdapter({"question": ""})).evaluate(
        "question", "answer"
    )

    assert result.actual_output == ""
    assert result.passed is False
    assert result.score == 0.0
    assert result.error is None


def test_invalid_adapter_configuration_is_rejected():
    with pytest.raises(TypeError, match="callable generate"):
        EvaluationRunner(object())

    with pytest.raises(TypeError, match="mapping"):
        MockModelAdapter([])

    with pytest.raises(ValueError, match="non-empty strings"):
        MockModelAdapter({"  ": "answer"})


@pytest.mark.parametrize(
    ("input_value", "reference"),
    [("", "answer"), ("  ", "answer"), (None, "answer"), ("question", None)],
)
def test_invalid_input_is_rejected(input_value, reference):
    runner = EvaluationRunner(MockModelAdapter({}))

    expected_error = TypeError if input_value is None or reference is None else ValueError
    with pytest.raises(expected_error):
        runner.evaluate(input_value, reference)


def test_evaluation_result_old_positional_constructor_remains_compatible():
    from agent_arena_eval import EvaluationResult

    result = EvaluationResult("q", "a", "a", True, 1.0, 0.0)

    assert (result.metric_name, result.metric_version) == ("exact_match_accuracy", "1")


def test_structured_result_old_positional_constructor_remains_compatible():
    from agent_arena_eval import (
        StructuredDatasetEvaluationResult,
        StructuredOutputResult,
    )

    result = StructuredOutputResult(
        "q", "{}", True, True, True, 1.0, 0.0, "draft", "metric", "1"
    )

    assert result.failure_reason is None
    assert result.error is None
    assert result.schema_digest == ""

    dataset_result = StructuredDatasetEvaluationResult(
        (), "1", "draft", 0, 0, 0, 0, 0, 0, 0, 0, 0, None, "metric", "1"
    )

    assert dataset_result.schema_digest == ""
