import json
from hashlib import sha256
from collections.abc import Mapping
from dataclasses import dataclass

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError

from .errors import SchemaValidationError
from .metrics import STRUCTURED_METRIC_NAME, STRUCTURED_METRIC_VERSION

JSON_SCHEMA_VERSION = "https://json-schema.org/draft/2020-12/schema"
_SCHEMA_MAP_KEYWORDS = (
    "$defs",
    "definitions",
    "properties",
    "patternProperties",
    "dependentSchemas",
)
_SCHEMA_SINGLE_KEYWORDS = (
    "additionalProperties",
    "unevaluatedProperties",
    "propertyNames",
    "items",
    "contains",
    "unevaluatedItems",
    "not",
    "if",
    "then",
    "else",
    "contentSchema",
)
_SCHEMA_LIST_KEYWORDS = ("allOf", "anyOf", "oneOf", "prefixItems")


@dataclass(frozen=True)
class StructuredOutputCheck:
    json_valid: bool
    schema_valid: bool | None
    failure_reason: str | None = None


class JsonSchemaEvaluator:
    """Check JSON text against an explicitly supplied Draft 2020-12 schema."""

    def __init__(self, schema: Mapping[str, object] | bool) -> None:
        if not isinstance(schema, (Mapping, bool)):
            raise SchemaValidationError("schema must be a JSON Schema object or boolean")
        if isinstance(schema, Mapping):
            declared_version = schema.get("$schema", JSON_SCHEMA_VERSION)
            if declared_version != JSON_SCHEMA_VERSION:
                raise SchemaValidationError("only JSON Schema Draft 2020-12 is supported")

        try:
            Draft202012Validator.check_schema(schema)
        except SchemaError as exc:
            raise SchemaValidationError(
                "schema is invalid for JSON Schema Draft 2020-12"
            ) from exc
        if self._has_references(schema):
            raise SchemaValidationError("schema references are not supported")

        try:
            canonical_schema = json.dumps(
                schema, sort_keys=True, separators=(",", ":"), ensure_ascii=False
            )
        except (TypeError, ValueError) as exc:
            raise SchemaValidationError("schema must contain only JSON values") from exc
        self.schema_digest = sha256(canonical_schema.encode("utf-8")).hexdigest()

        self._validator = Draft202012Validator(schema)

    def evaluate(self, output: str) -> StructuredOutputCheck:
        if not isinstance(output, str):
            raise TypeError("output must be a string")

        try:
            instance = json.loads(output, parse_constant=self._reject_non_json_constant)
        except (json.JSONDecodeError, ValueError):
            return StructuredOutputCheck(
                json_valid=False,
                schema_valid=None,
                failure_reason="malformed_json",
            )

        schema_valid = self._validator.is_valid(instance)
        return StructuredOutputCheck(
            json_valid=True,
            schema_valid=schema_valid,
            failure_reason=None if schema_valid else "schema_validation_failed",
        )

    @staticmethod
    def _reject_non_json_constant(value: str) -> None:
        raise ValueError(f"{value} is not a valid JSON constant")

    @classmethod
    def _has_references(cls, schema: Mapping[str, object] | bool) -> bool:
        pending: list[Mapping[str, object] | bool] = [schema]
        while pending:
            current = pending.pop()
            if not isinstance(current, Mapping):
                continue
            if "$ref" in current or "$dynamicRef" in current:
                return True

            for keyword in _SCHEMA_MAP_KEYWORDS:
                children = current.get(keyword)
                if isinstance(children, Mapping):
                    pending.extend(children.values())

            for keyword in _SCHEMA_SINGLE_KEYWORDS:
                child = current.get(keyword)
                if isinstance(child, (Mapping, bool)):
                    pending.append(child)

            for keyword in _SCHEMA_LIST_KEYWORDS:
                children = current.get(keyword)
                if isinstance(children, list):
                    pending.extend(children)

        return False
