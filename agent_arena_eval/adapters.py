from collections.abc import Mapping

from .errors import ModelAdapterError
from .models import ModelRequest, ModelResponse


class MockModelAdapter:
    """Return configured outputs for exact inputs without calling a real model."""

    model_id = "deterministic-mock"

    def __init__(self, responses: Mapping[str, str]) -> None:
        if not isinstance(responses, Mapping):
            raise TypeError("responses must be a mapping of input strings to output strings")
        if any(not isinstance(key, str) or not isinstance(value, str) for key, value in responses.items()):
            raise TypeError("mock response keys and values must be strings")
        self._responses = dict(responses)

    def generate(self, request: ModelRequest) -> ModelResponse:
        try:
            output = self._responses[request.input]
        except KeyError as exc:
            raise ModelAdapterError("No mock response is configured for this input.") from exc
        return ModelResponse(output=output, model_id=self.model_id)
