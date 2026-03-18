"""
AliCompat Provider — skeleton only.
Ali_API_KEY is currently missing. This provider will raise on init.
Wired into the gateway so it can be activated when the key is available.
"""
import os
from .base import ModelProvider, ModelProviderError


class AliCompatProvider(ModelProvider):
    """Skeleton — not functional until Ali_API_KEY is set."""

    MODEL_NAME = "ali-compat-tbd"

    def __init__(self):
        api_key = os.environ.get("Ali_API_KEY")
        if not api_key:
            raise ModelProviderError(
                "Ali_API_KEY is not set. AliCompatProvider is a skeleton only."
            )
        # TBD: configure actual endpoint when key is available
        self._api_key = api_key

    def generate(self, messages: list[dict], params: dict | None = None) -> str:
        raise ModelProviderError(
            "AliCompatProvider is not yet implemented. "
            "Set Ali_API_KEY and implement the provider logic."
        )
