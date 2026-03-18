"""
API Routes — all frontend-facing endpoints.
"""
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

from orchestrator.orchestrator import (
    create_and_queue_task, process_task_async,
    pause_task, supplement_task, revise_task,
)
import runtime_store.store as store
from model_gateway import get_provider, get_provider_for_task, provider_status

router = APIRouter()


# ─── Request Models ────────────────────────────────────────────────────────────

class CreateTaskRequest(BaseModel):
    goal: str
    mode: Optional[str] = None
    constraints: list[str] = []
    session_id: Optional[str] = None


class SupplementRequest(BaseModel):
    additional_goal: str


class ReviseRequest(BaseModel):
    new_goal: str


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


@router.patch("/api/tasks/{task_id}/pause")
async def pause_task_endpoint(task_id: str):
    """
    Signal a running task to pause after its current RouteGroup completes.
    The task status transitions to 'paused'.
    """
    try:
        result = pause_task(task_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"code": "cannot_pause", "message": str(e)})
    except Exception as e:
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": str(e)})


@router.post("/api/tasks/{task_id}/supplement")
async def supplement_task_endpoint(task_id: str, req: SupplementRequest, background_tasks: BackgroundTasks):
    """
    Append additional goal text to a paused task and resume execution.
    New WorkItems are created for the supplement and dispatched.
    """
    try:
        result = supplement_task(task_id, req.additional_goal, background_tasks=background_tasks)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"code": "cannot_supplement", "message": str(e)})
    except Exception as e:
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": str(e)})


@router.post("/api/tasks/{task_id}/revise")
async def revise_task_endpoint(task_id: str, req: ReviseRequest, background_tasks: BackgroundTasks):
    """
    Revise the goal of a paused/running task and restart.
    - Attempts git revert of any files edited during the original execution.
    - Creates a new replacement task with the revised goal.
    - Marks the original task as 'superseded'.
    Returns: {original_task_id, new_task_id, revert_result}
    """
    try:
        result = revise_task(task_id, req.new_goal, background_tasks=background_tasks)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"code": "cannot_revise", "message": str(e)})
    except Exception as e:
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": str(e)})


# ─── System Endpoints ─────────────────────────────────────────────────────────

@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/api/system/provider")
async def get_provider_info():
    """Return active agent provider info (safe — no key exposure)."""
    try:
        provider = get_provider_for_task("agent")
        return provider.health_check()
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.get("/api/system/providers")
async def get_all_providers():
    """Return availability status for all configured providers."""
    try:
        return provider_status()
    except Exception as e:
        return {"status": "error", "message": str(e)}
