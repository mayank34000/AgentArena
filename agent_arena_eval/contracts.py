from typing import Protocol

from .models import ModelRequest, ModelResponse


class ModelAdapter(Protocol):
    def generate(self, request: ModelRequest) -> ModelResponse:
        """Generate one normalized response for a request."""
