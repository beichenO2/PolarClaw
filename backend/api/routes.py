"""
API Routes — all frontend-facing endpoints.
"""
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

from orchestrator.orchestrator import create_and_queue_task, process_task_async
import runtime_store.store as store
from model_gateway import get_provider

router = APIRouter()


# ─── Request Models ────────────────────────────────────────────────────────────

class CreateTaskRequest(BaseModel):
    goal: str
    mode: Optional[str] = None
    constraints: list[str] = []
    session_id: Optional[str] = None


# ─── Task Endpoints ─────────────────────────────────────────────────────────

@router.post("/api/tasks")
async def create_task(req: CreateTaskRequest, background_tasks: BackgroundTasks):
    """Create a new task and start processing in background."""
    try:
        task_info = create_and_queue_task(req.model_dump())
        # Run actual processing in background
        task_contract = store.load_task(task_info["task_id"])
        if task_contract:
            background_tasks.add_task(process_task_async, task_contract)
        return task_info
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"code": "invalid_input", "message": str(e)})
    except Exception as e:
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": str(e)})


@router.get("/api/tasks/{task_id}")
async def get_task_status(task_id: str):
    """Get current task status."""
    status = store.load_task_status(task_id)
    if not status:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Task not found"})
    contract = store.load_task(task_id)
    return {
        **status,
        "goal": (contract or {}).get("goal", ""),
        "mode": (contract or {}).get("mode", ""),
    }


@router.get("/api/tasks/{task_id}/result")
async def get_task_result(task_id: str):
    """Get full task result including agent_result and validation_report."""
    result = store.get_full_task_result(task_id)
    if not result:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Task not found"})
    if result.get("status") in ("queued", "processing"):
        return JSONResponse(
            status_code=202,
            content={"code": "not_ready", "message": "Task is still processing", "status": result["status"]},
        )
    return result


@router.get("/api/tasks")
async def list_tasks():
    """List recent tasks."""
    return {"tasks": store.list_tasks()[:20]}


# ─── System Endpoints ─────────────────────────────────────────────────────────

@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/api/system/provider")
async def get_provider_info():
    """Return current active model provider info (safe — no key exposure)."""
    try:
        provider = get_provider()
        return provider.health_check()
    except Exception as e:
        return {"status": "error", "message": str(e)}
