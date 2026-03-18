"""
MiniMaxProvider — MiniMax API (OpenAI-compatible).

Used for:
  1. Vision tasks (MiniMax-M2.7 supports image input)
  2. Multi-model debug: A模型写的 bug 让 B模型(MiniMax)来 debug，
     与 Qwen/CodingPlan 互补形成交叉验证

Per SSOT/decisions.md D036:
  - Key:      Minimax_Token_Plan_API_KEY
  - Endpoint: https://api.minimaxi.com/v1  (OpenAI-compatible)
  - Model:    MiniMax-M2.7
  - Scope:    vision tasks, secondary debug model

Reference: https://platform.minimaxi.com/docs/guides/text-ai-coding-tools
"""
import os
from .base import ModelProvider, ModelProviderError

MINIMAX_BASE_URL = "https://api.minimaxi.com/v1"
_ENV_VAR = "Minimax_Token_Plan_API_KEY"
DEFAULT_MODEL = "MiniMax-M2.7"


class MiniMaxProvider(ModelProvider):
    MODEL_NAME = DEFAULT_MODEL

    def __init__(self, model: str = DEFAULT_MODEL):
        self.MODEL_NAME = model

        api_key = os.environ.get(_ENV_VAR)
        if not api_key:
            raise ModelProviderError(f"{_ENV_VAR} is not set")
        self._key_len = len(api_key)

        try:
            from openai import OpenAI
            self._client = OpenAI(
                api_key=api_key,
                base_url=MINIMAX_BASE_URL,
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
                max_tokens=params.get("max_tokens", 8192),
            )
            return response.choices[0].message.content
        except Exception as e:
            raise ModelProviderError(f"MiniMax API error: {type(e).__name__}: {str(e)}")

    def health_check(self) -> dict:
        return {
            "status": "ok",
            "provider": "minimax",
            "model": self.MODEL_NAME,
            "endpoint": MINIMAX_BASE_URL,
            "key_configured": True,
            "key_len": self._key_len,
            "vision": True,
        }
