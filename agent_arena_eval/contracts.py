from typing import Protocol

from .models import ModelRequest, ModelResponse


class ModelAdapter(Protocol):
    def generate(self, request: ModelRequest) -> ModelResponse:
        """Generate a normalized response and translate provider failures to ModelAdapterError."""
