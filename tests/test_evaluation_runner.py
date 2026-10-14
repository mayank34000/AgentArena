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


class BrokenAdapter:
    def generate(self, request):
        raise ModelAdapterError("provider unavailable")


def test_adapter_contract_works_polymorphically():
    result = EvaluationRunner(BrokenAdapter()).evaluate("question", "answer")

    assert result.error == "provider unavailable"
    assert result.passed is None


@pytest.mark.parametrize(
    ("input_value", "reference"),
    [("", "answer"), ("  ", "answer"), (None, "answer"), ("question", None)],
)
def test_invalid_input_is_rejected(input_value, reference):
    runner = EvaluationRunner(MockModelAdapter({}))

    with pytest.raises((TypeError, ValueError)):
        runner.evaluate(input_value, reference)
