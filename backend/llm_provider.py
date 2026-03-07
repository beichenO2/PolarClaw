class EchoProvider:
    """Stub LLM provider for S1. Echoes the message back.
    Replace with a real provider in S1+ once LLM runtime is chosen."""

    MODEL_NAME = "echo"

    def generate(self, message: str, params: dict) -> str:
        return f"[echo] {message}"
