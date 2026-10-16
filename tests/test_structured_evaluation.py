import json

import pytest

import agent_arena_eval
from agent_arena_eval import (
    EvaluationRunner,
    MockModelAdapter,
    ModelAdapterError,
    SchemaValidationError,
)


PERSON_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "integer"},
    },
    "required": ["name", "age"],
    "additionalProperties": False,
}


def test_structured_output_accepts_json_matching_schema():
    output = json.dumps({"name": "Ada", "age": 36})

    result = EvaluationRunner(MockModelAdapter({"describe Ada": output})).evaluate_structured(
        "describe Ada", PERSON_SCHEMA
    )

    assert result.json_valid is True
    assert result.schema_valid is True
    assert result.passed is True
    assert result.score == 1.0
    assert result.error is None
    assert result.schema_version == "https://json-schema.org/draft/2020-12/schema"
    assert result.metric_name == "json_schema_validity"
    assert result.metric_version == "1"
    assert len(result.schema_digest) == 64


def test_public_exports_are_unique_and_available():
    assert len(agent_arena_eval.__all__) == len(set(agent_arena_eval.__all__))
    assert all(hasattr(agent_arena_eval, name) for name in agent_arena_eval.__all__)


@pytest.mark.parametrize(
    "output",
    [
        '{"name":"Ada"}',
        '{"name":"Ada","age":"36"}',
        '{"name":"Ada","age":36,"extra":true}',
    ],
)
def test_valid_json_that_violates_schema_is_a_scored_failure(output):
    result = EvaluationRunner(MockModelAdapter({"describe Ada": output})).evaluate_structured(
        "describe Ada", PERSON_SCHEMA
    )

    assert result.json_valid is True
    assert result.schema_valid is False
    assert result.passed is False
    assert result.score == 0.0
    assert result.failure_reason == "schema_validation_failed"
    assert result.error is None


def test_malformed_json_is_distinct_from_schema_failure():
    result = EvaluationRunner(
        MockModelAdapter({"describe Ada": "{not json}"})
    ).evaluate_structured("describe Ada", PERSON_SCHEMA)

    assert result.json_valid is False
    assert result.schema_valid is None
    assert result.passed is False
    assert result.score == 0.0
    assert result.failure_reason == "malformed_json"
    assert result.error is None


@pytest.mark.parametrize("output", ["", "NaN"])
def test_empty_or_nonstandard_json_constant_is_malformed(output):
    result = EvaluationRunner(MockModelAdapter({"describe Ada": output})).evaluate_structured(
        "describe Ada", PERSON_SCHEMA
    )

    assert result.actual_output == output
    assert result.json_valid is False
    assert result.schema_valid is None
    assert result.score == 0.0
    assert result.failure_reason == "malformed_json"


@pytest.mark.parametrize(
    "schema",
    [
        {"type": "not-a-json-schema-type"},
        {"$schema": "http://json-schema.org/draft-07/schema#", "type": "string"},
        {
            "$defs": {"name": {"type": "string"}},
            "properties": {"name": {"$ref": "#/$defs/name"}},
        },
        {
            "allOf": [
                {
                    "properties": {
                        "items": {"items": {"$dynamicRef": "#/$defs/item"}}
                    }
                }
            ]
        },
        ["not", "a", "schema"],
    ],
)
def test_invalid_or_unsupported_schema_is_rejected_before_model_call(schema):
    class CountingAdapter:
        def __init__(self):
            self.call_count = 0

        def generate(self, request):
            self.call_count += 1
            raise ModelAdapterError("should not be called")

    adapter = CountingAdapter()
    runner = EvaluationRunner(adapter)

    with pytest.raises(SchemaValidationError):
        runner.evaluate_structured("describe Ada", schema)

    assert adapter.call_count == 0


def test_boolean_schema_is_supported():
    accepted = EvaluationRunner(MockModelAdapter({"input": "1"})).evaluate_structured(
        "input", True
    )
    rejected = EvaluationRunner(MockModelAdapter({"input": "1"})).evaluate_structured(
        "input", False
    )

    assert accepted.schema_valid is True
    assert accepted.score == 1.0
    assert rejected.json_valid is True
    assert rejected.schema_valid is False
    assert rejected.score == 0.0


def test_schema_defaults_allow_additional_properties_and_treat_format_as_annotation():
    output = '{"value":"not-an-email","extra":true}'
    schema = {
        "type": "object",
        "properties": {"value": {"type": "string", "format": "email"}},
        "required": ["value"],
    }

    result = EvaluationRunner(MockModelAdapter({"input": output})).evaluate_structured(
        "input", schema
    )

    assert result.json_valid is True
    assert result.schema_valid is True
    assert result.score == 1.0


def test_structured_score_is_separate_from_exact_match_score():
    output = '{"age":36,"name":"Ada"}'
    runner = EvaluationRunner(MockModelAdapter({"describe Ada": output}))

    exact = runner.evaluate("describe Ada", '{"name":"Ada","age":36}')
    structured = runner.evaluate_structured("describe Ada", PERSON_SCHEMA)

    assert exact.score == 0.0
    assert structured.score == 1.0


def test_structured_adapter_failure_is_not_scored():
    result = EvaluationRunner(MockModelAdapter({})).evaluate_structured(
        "unknown", PERSON_SCHEMA
    )

    assert result.actual_output is None
    assert result.json_valid is None
    assert result.schema_valid is None
    assert result.passed is None
    assert result.score is None
    assert result.error == "No mock response is configured for this input."


def test_structured_dataset_preserves_order_and_id_association():
    records = [
        {"id": "valid", "input": "valid", "reference": "unused"},
        {"id": "malformed", "input": "malformed", "reference": "unused"},
        {"id": "adapter-error", "input": "missing", "reference": "unused"},
    ]
    adapter = MockModelAdapter(
        {"valid": '{"name":"Ada","age":36}', "malformed": "nope"}
    )

    result = EvaluationRunner(adapter).evaluate_structured_dataset(records, PERSON_SCHEMA)

    assert [
        (item.example_id, item.result.json_valid, item.result.schema_valid)
        for item in result.items
    ] == [
        ("valid", True, True),
        ("malformed", False, None),
        ("adapter-error", None, None),
    ]
    assert result.total_count == 3
    assert result.pass_count == 1
    assert result.fail_count == 1
    assert result.error_count == 1
    assert result.json_invalid_count == 1
    assert result.schema_invalid_count == 0
    assert result.mean_score == 0.5
    assert result.schema_digest == result.items[0].result.schema_digest
    assert all(
        (item.result.metric_name, item.result.metric_version)
        == (result.metric_name, result.metric_version)
        for item in result.items
    )


def test_schema_digest_is_canonical_stable_and_distinguishes_schema_contents():
    adapter = MockModelAdapter({"input": "{}", "unrelated input": "{}"})
    runner = EvaluationRunner(adapter)
    first = runner.evaluate_structured("input", {"type": "object", "maxProperties": 2})
    same_schema = runner.evaluate_structured("input", {"maxProperties": 2, "type": "object"})
    changed_schema = runner.evaluate_structured("input", {"type": "object", "maxProperties": 3})
    unrelated_input = runner.evaluate_structured(
        "unrelated input", {"maxProperties": 2, "type": "object"}
    )

    assert first.schema_digest == same_schema.schema_digest
    assert first.schema_digest == unrelated_input.schema_digest
    assert first.schema_digest != changed_schema.schema_digest
    assert (first.metric_name, first.metric_version, first.score) == (
        same_schema.metric_name,
        same_schema.metric_version,
        same_schema.score,
    )


def test_schema_validation_failure_does_not_include_model_output():
    private_output = '{"name":"private","age":"secret-value"}'
    result = EvaluationRunner(
        MockModelAdapter({"input": private_output})
    ).evaluate_structured("input", PERSON_SCHEMA)

    assert result.actual_output == private_output
    assert result.failure_reason == "schema_validation_failed"
    assert result.error is None
    assert "secret-value" not in (result.error or "")
