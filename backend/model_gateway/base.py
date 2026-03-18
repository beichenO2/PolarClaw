"""
Model Gateway Base
Abstract base class for all model providers.
All business logic must go through this interface, never directly to a provider.
"""
from abc import ABC, abstractmethod


class ModelProvider(ABC):
    """Abstract model provider. All providers must implement this interface."""

    MODEL_NAME: str = "unknown"

    @abstractmethod
    def generate(self, messages: list[dict], params: dict | None = None) -> str:
        """
        Generate a response from the model.

        Args:
            messages: OpenAI-compatible message list:
                      [{"role": "system"|"user"|"assistant", "content": "..."}]
            params: Optional generation parameters (temperature, max_tokens, etc.)

        Returns:
            str: The assistant's text response.

        Raises:
            ModelProviderError: On any provider-level failure.
        """
        ...

    def health_check(self) -> dict:
        """Optional health check. Returns {"status": "ok"|"error", "provider": MODEL_NAME}"""
        return {"status": "ok", "provider": self.MODEL_NAME}


class ModelProviderError(Exception):
    """Raised when a model provider fails."""
    pass
