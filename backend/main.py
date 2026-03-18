"""
CLAW Backend — FastAPI entry point.
Baseline v0.1

Legacy /chat endpoint kept for backward compatibility.
New API under /api/ prefix.
"""
import time
import logging
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from api.routes import router
from model_gateway import get_provider

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(title="CLAW Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register all API routes
app.include_router(router)


# ─── Legacy /chat endpoint (S1 backward compat) ────────────────────────────

class ChatParams(BaseModel):
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None


class ChatRequest(BaseModel):
    message: str
    params: Optional[ChatParams] = None


@app.post("/chat")
def chat_legacy(req: ChatRequest):
    """Legacy single-turn chat endpoint (S1). Use /api/tasks for new features."""
    try:
        t0 = time.time()
        provider = get_provider()
        params = req.params.model_dump(exclude_none=True) if req.params else {}
        messages = [{"role": "user", "content": req.message}]
        text = provider.generate(messages, params)
        latency_ms = round((time.time() - t0) * 1000)
        return {
            "text": text,
            "meta": {"model": provider.MODEL_NAME, "latency_ms": latency_ms},
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "internal_error", "message": str(e)}},
        )
