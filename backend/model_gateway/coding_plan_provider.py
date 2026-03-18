"""
CodingPlanProvider — Alibaba Cloud Coding Plan API.

Coding Plan is the primary LLM provider for all agent/conversation tasks in PolarClaw.
It is OpenAI-compatible but uses a dedicated endpoint and key format (sk-sp-xxx).

Per SSOT/decisions.md D035:
  - Key:      Coding_Plan_API_KEY  (format: sk-sp-xxxxx)
  - Endpoint: https://coding-intl.dashscope.aliyuncs.com/v1
  - Models:   qwen3.5-plus (default), qwen3-coder-plus, kimi-k2.5, and others
  - Scope:    All agent conversations, Router, Bot execution, CLAW console interactions

Reference: OpenClaw Coding Plan configuration
  baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1"
  apiKey:  sk-sp-xxxxx
"""
import os
from .base import ModelProvider, ModelProviderError

# China endpoint (default): coding.dashscope.aliyuncs.com
# International endpoint:   coding-intl.dashscope.aliyuncs.com
# Use CODING_PLAN_REGION env var to override: set to "intl" for international
_REGION = os.environ.get("CODING_PLAN_REGION", "cn")
CODING_PLAN_BASE_URL = (
    "https://coding-intl.dashscope.aliyuncs.com/v1"
    if _REGION == "intl"
    else "https://coding.dashscope.aliyuncs.com/v1"
)
_ENV_VAR = "Coding_Plan_API_KEY"

# Models available under Coding Plan subscription (per official docs, 2026-03)
# Source: https://www.alibabacloud.com/help/en/model-studio/coding-plan
SUPPORTED_MODELS: dict[str, dict] = {
    "qwen3.5-plus":         {"context_window": 1_000_000, "max_tokens": 65536,  "vision": True},
    "qwen3-max-2026-01-23": {"context_window": 262_144,   "max_tokens": 65536,  "vision": False},
    "qwen3-coder-next":     {"context_window": 262_144,   "max_tokens": 65536,  "vision": False},
    "qwen3-coder-plus":     {"context_window": 1_000_000, "max_tokens": 65536,  "vision": False},
    "kimi-k2.5":            {"context_window": 262_144,   "max_tokens": 32768,  "vision": True},
    "glm-5":                {"context_window": 202_752,   "max_tokens": 16384,  "vision": False},
    "glm-4.7":              {"context_window": 202_752,   "max_tokens": 16384,  "vision": False},
    "MiniMax-M2.5":         {"context_window": 196_608,   "max_tokens": 32768,  "vision": False},
}

# Benchmark results (2026-03-18, simple reasoning prompt):
#   qwen3-coder-plus  ~1.8s  → default: fastest + coding-focused
#   kimi-k2.5         ~2.4s  → agent/router: best structured JSON decomposition
#   qwen3.5-plus      ~13s   → demoted: too slow for interactive use
#   qwen3-coder-next  ~16s   → demoted: slower than qwen3-coder-plus
#   glm-5             ~33s   → not recommended
DEFAULT_MODEL = "qwen3-coder-plus"


class CodingPlanProvider(ModelProvider):
    MODEL_NAME = DEFAULT_MODEL

    def __init__(self, model: str = DEFAULT_MODEL):
        if model not in SUPPORTED_MODELS:
            raise ModelProviderError(
                f"Model '{model}' not in Coding Plan supported list: {list(SUPPORTED_MODELS)}"
            )
        self.MODEL_NAME = model
        self._model_meta = SUPPORTED_MODELS[model]

        api_key = os.environ.get(_ENV_VAR)
        if not api_key:
            raise ModelProviderError(f"{_ENV_VAR} is not set")
        if not api_key.startswith("sk-sp-"):
            raise ModelProviderError(
                f"{_ENV_VAR} has unexpected format (expected sk-sp-xxx). "
                "Make sure you are using the Coding Plan key, not a general DashScope key."
            )
        self._key_len = len(api_key)

        try:
            from openai import OpenAI
            self._client = OpenAI(
                api_key=api_key,
                base_url=CODING_PLAN_BASE_URL,
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
            raise ModelProviderError(f"Coding Plan API error: {type(e).__name__}: {str(e)}")

    def health_check(self) -> dict:
        return {
            "status": "ok",
            "provider": "coding_plan",
            "model": self.MODEL_NAME,
            "endpoint": CODING_PLAN_BASE_URL,
            "key_configured": True,
            "key_len": self._key_len,
            "vision": self._model_meta["vision"],
            "context_window": self._model_meta["context_window"],
        }
