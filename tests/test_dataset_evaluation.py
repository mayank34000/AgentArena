import pytest

from agent_arena_eval import (
    DatasetValidationError,
    EvaluationRunner,
    MockModelAdapter,
    validate_dataset,
)


def test_validate_dataset_preserves_order_and_allows_empty_reference():
    examples = validate_dataset(
        [
            {
                "id": "first",
                "input": "question one",
                "reference": "answer",
                "tag": "a",
            },
            {"id": "second", "input": "question two", "reference": ""},
        ]
    )

    assert [(item.example_id, item.input, item.reference) for item in examples] == [
        ("first", "question one", "answer"),
        ("second", "question two", ""),
    ]


@pytest.mark.parametrize(
    ("records", "message"),
    [
        (
            [{"id": "one", "reference": "answer"}],
            "example 1 is missing required field 'input'",
        ),
        (
            [{"id": "one", "input": "question"}],
            "example 1 is missing required field 'reference'",
        ),
        (
            [{"input": "question", "reference": "answer"}],
            "example 1 is missing required field 'id'",
        ),
        (
            [{"id": "  ", "input": "question", "reference": "answer"}],
            "example 1 field 'id' must be a non-empty string",
        ),
        (
            [{"id": 42, "input": "question", "reference": "answer"}],
            "example 1 field 'id' must be a non-empty string",
        ),
        (
            [{"id": "one", "input": "  ", "reference": "answer"}],
            "example 1 field 'input' must be a non-empty string",
        ),
        (
            [{"id": "one", "input": None, "reference": "answer"}],
            "example 1 field 'input' must be a non-empty string",
        ),
        (
            [{"id": "one", "input": "question", "reference": None}],
            "example 1 field 'reference' must be a string",
        ),
        (
            [
                {"id": "one", "input": "question", "reference": "a"},
                {"id": "one", "input": "other", "reference": "b"},
            ],
            "example 2 has a duplicate id",
        ),
        ([None], "example 1 must be a mapping"),
    ],
)
def test_invalid_dataset_records_have_deterministic_errors(records, message):
    with pytest.raises(DatasetValidationError, match=f"^{message}$"):
        validate_dataset(records)


def test_empty_dataset_is_rejected_explicitly():
    with pytest.raises(
        DatasetValidationError,
        match="^dataset must contain at least one example$",
    ):
        validate_dataset([])


def test_dataset_evaluation_aggregates_scores_and_adapter_errors():
    runner = EvaluationRunner(
        MockModelAdapter({"question one": "answer one", "question two": "wrong"})
    )
    records = [
        {"id": "pass", "input": "question one", "reference": "answer one"},
        {"id": "fail", "input": "question two", "reference": "answer two"},
        {"id": "error", "input": "question three", "reference": "answer three"},
    ]

    result = runner.evaluate_dataset(records)

    assert [item.example_id for item in result.items] == ["pass", "fail", "error"]
    assert [
        (item.example_id, item.result.passed) for item in result.items
    ] == [("pass", True), ("fail", False), ("error", None)]
    assert result.dataset_format_version == "1"
    assert result.total_count == 3
    assert result.scored_count == 2
    assert result.pass_count == 1
    assert result.fail_count == 1
    assert result.error_count == 1
    assert result.mean_score == 0.5
    assert result.metric_name == "exact_match_accuracy"
    assert result.metric_version == "1"
    assert all(
        (item.result.metric_name, item.result.metric_version)
        == (result.metric_name, result.metric_version)
        for item in result.items
    )
    assert result.items[2].result.passed is None
    assert result.items[2].result.error == "No mock response is configured for this input."


def test_dataset_scores_are_reproducible_with_the_same_mock_adapter():
    runner = EvaluationRunner(MockModelAdapter({"question": "answer"}))
    records = [{"id": "one", "input": "question", "reference": "answer"}]

    first = runner.evaluate_dataset(records)
    second = runner.evaluate_dataset(records)

    assert first.mean_score == second.mean_score == 1.0
    assert (first.total_count, first.pass_count, first.fail_count, first.error_count) == (
        second.total_count,
        second.pass_count,
        second.fail_count,
        second.error_count,
    )
    assert [item.result.actual_output for item in first.items] == [
        item.result.actual_output for item in second.items
    ]
    assert (first.metric_name, first.metric_version) == (
        second.metric_name,
        second.metric_version,
    )
    assert [
        (item.result.metric_name, item.result.metric_version, item.result.score)
        for item in first.items
    ] == [
        (item.result.metric_name, item.result.metric_version, item.result.score)
        for item in second.items
    ]


def test_dataset_with_only_adapter_errors_has_no_mean_score():
    result = EvaluationRunner(MockModelAdapter({})).evaluate_dataset(
        [{"id": "one", "input": "question", "reference": "answer"}]
    )

    assert result.total_count == 1
    assert result.scored_count == 0
    assert result.pass_count == 0
    assert result.fail_count == 0
    assert result.error_count == 1
    assert result.mean_score is None


def test_empty_reference_is_scored_normally():
    result = EvaluationRunner(MockModelAdapter({"question": ""})).evaluate_dataset(
        [{"id": "empty-answer", "input": "question", "reference": ""}]
    )

    assert result.pass_count == 1
    assert result.mean_score == 1.0
    assert result.items[0].result.actual_output == ""


def test_entire_dataset_is_validated_before_adapter_calls():
    class CountingAdapter:
        def __init__(self):
            self.call_count = 0

        def generate(self, request):
            self.call_count += 1
            raise AssertionError("adapter should not be called for an invalid dataset")

    adapter = CountingAdapter()
    runner = EvaluationRunner(adapter)

    with pytest.raises(DatasetValidationError, match="example 2 is missing"):
        runner.evaluate_dataset(
            [
                {"id": "one", "input": "question", "reference": "answer"},
                {"id": "two", "input": "another question"},
            ]
        )

    assert adapter.call_count == 0
