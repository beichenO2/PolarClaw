"""
Qwen Provider — DashScope OpenAI-compatible API.
Uses Qwen_Pro_API_KEY environment variable.
Security: key is never logged or exposed.
"""
import os
from .base import ModelProvider, ModelProviderError

# DashScope OpenAI-compatible base URL
DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_MODEL = "qwen-plus"


class QwenProvider(ModelProvider):
    MODEL_NAME = DEFAULT_MODEL

    def __init__(self, model: str = DEFAULT_MODEL):
        self.MODEL_NAME = model
        api_key = os.environ.get("Qwen_Pro_API_KEY")
        if not api_key:
            raise ModelProviderError("Qwen_Pro_API_KEY is not set")
        # Validate key exists (never log the value)
        self._key_len = len(api_key)

        try:
            from openai import OpenAI
            self._client = OpenAI(
                api_key=api_key,
                base_url=DASHSCOPE_BASE_URL,
            )
        except ImportError:
            raise ModelProviderError("openai package not installed. Run: pip install openai")

    def generate(self, messages: list[dict], params: dict | None = None) -> str:
        params = params or {}
        try:
            response = self._client.chat.completions.create(
                model=self.MODEL_NAME,
                messages=messages,
                temperature=params.get("temperature", 0.7),
                max_tokens=params.get("max_tokens", 2048),
            )
            return response.choices[0].message.content
        except Exception as e:
            raise ModelProviderError(f"Qwen API error: {type(e).__name__}: {str(e)}")

    def health_check(self) -> dict:
        return {
            "status": "ok",
            "provider": self.MODEL_NAME,
            "key_configured": True,
            "key_len": self._key_len,
        }
