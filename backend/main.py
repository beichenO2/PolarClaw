import time
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from llm_provider import EchoProvider

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

provider = EchoProvider()


# ---------- request/response models ----------

class ChatParams(BaseModel):
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None


class ChatRequest(BaseModel):
    message: str
    params: Optional[ChatParams] = None


# ---------- endpoints ----------

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/chat")
def chat(req: ChatRequest):
    try:
        t0 = time.time()
        params = req.params.model_dump(exclude_none=True) if req.params else {}
        text = provider.generate(req.message, params)
        latency_ms = round((time.time() - t0) * 1000)
        return {
            "text": text,
            "meta": {
                "model": provider.MODEL_NAME,
                "latency_ms": latency_ms,
            },
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "internal_error", "message": str(e)}},
        )
