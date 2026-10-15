from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from .errors import DatasetValidationError

DATASET_FORMAT_VERSION = "1"


@dataclass(frozen=True)
class EvaluationExample:
    example_id: str
    input: str
    reference: str


def validate_dataset(
    records: Iterable[Mapping[str, object]],
) -> tuple[EvaluationExample, ...]:
    """Validate ordered records with unique IDs, inputs, and reference answers."""
    if isinstance(records, (str, bytes, Mapping)):
        raise TypeError("dataset must be an iterable of example mappings")

    try:
        iterator = iter(records)
    except TypeError as exc:
        raise TypeError("dataset must be an iterable of example mappings") from exc

    examples: list[EvaluationExample] = []
    seen_ids: set[str] = set()
    for index, record in enumerate(iterator, start=1):
        if not isinstance(record, Mapping):
            raise DatasetValidationError(f"example {index} must be a mapping")

        for field in ("id", "input", "reference"):
            if field not in record:
                raise DatasetValidationError(
                    f"example {index} is missing required field '{field}'"
                )

        example_id = record["id"]
        if not isinstance(example_id, str) or not example_id.strip():
            raise DatasetValidationError(
                f"example {index} field 'id' must be a non-empty string"
            )
        if example_id in seen_ids:
            raise DatasetValidationError(f"example {index} has a duplicate id")

        example_input = record["input"]
        if not isinstance(example_input, str) or not example_input.strip():
            raise DatasetValidationError(
                f"example {index} field 'input' must be a non-empty string"
            )

        reference = record["reference"]
        if not isinstance(reference, str):
            raise DatasetValidationError(
                f"example {index} field 'reference' must be a string"
            )

        seen_ids.add(example_id)
        examples.append(
            EvaluationExample(
                example_id=example_id,
                input=example_input,
                reference=reference,
            )
        )

    if not examples:
        raise DatasetValidationError("dataset must contain at least one example")

    return tuple(examples)
