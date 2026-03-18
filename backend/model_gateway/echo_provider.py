"""
Echo Provider — stub for testing without a real model.
Returns a structured echo response.
"""
from .base import ModelProvider


class EchoProvider(ModelProvider):
    MODEL_NAME = "echo"

    def generate(self, messages: list[dict], params: dict | None = None) -> str:
        user_messages = [m["content"] for m in messages if m.get("role") == "user"]
        last = user_messages[-1] if user_messages else "(no input)"
        return f"[echo] {last}"
