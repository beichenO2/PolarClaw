# Interfaces (Contract)

Rule:
- Treat this file as the API contract.
- Do NOT change request/response shapes in code unless you first propose a change here.

## HTTP API

### GET /health
Response 200 JSON:
{
  "status": "ok"
}

### POST /chat
Purpose: single-turn chat (S1). No session context yet.

Request JSON:
{
  "message": "string",
  "params": {
    "temperature": "number (optional)",
    "max_tokens": "number (optional)"
  }
}

Response 200 JSON:
{
  "text": "string",
  "meta": {
    "model": "string (optional)",
    "latency_ms": "number (optional)"
  }
}

Error response (>=400) JSON:
{
  "error": {
    "code": "string",
    "message": "string"
  }
}

## Internal Interfaces (Backend)

### LLMProvider
- generate(message: str, params: dict) -> str
Notes:
- For S1, provider may be a stub/echo or a simple local runtime integration.
- Must not leak provider-specific exceptions; backend should normalize errors.

(Reserved for future)
### MemoryStore (S3+)
- write(item) -> id
- search(query, k) -> chunks

### ToolRegistry (S4+)
- execute(tool_name: str, args: dict) -> result