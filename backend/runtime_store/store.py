"""
Runtime Store — JSON file-based storage for task runtime objects.

Structure:
  runtime/tasks/{task_id}/
    task_contract.json
    status.json
    work_items.json
    route_groups.json
    router_decision.json
    router_review_result.json
    route_group_runtime/{route_group_id}.json
    route_group_result/{route_group_id}.json
    runs/{run_id}/
      agent_result.json
      evidence_pack.json
      validation_report.json
"""
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Runtime base dir (relative to project root, 2 levels up from backend/)
_BACKEND_DIR = Path(__file__).parent.parent
_PROJECT_ROOT = _BACKEND_DIR.parent
RUNTIME_BASE = _PROJECT_ROOT / "runtime" / "tasks"


def _ensure(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _read(path: Path) -> dict | None:
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ─── Task Operations ─────────────────────────────────────────────────────────

def save_task(task_id: str, task_contract: dict) -> None:
    path = RUNTIME_BASE / task_id / "task_contract.json"
    _write(path, task_contract)


def load_task(task_id: str) -> dict | None:
    return _read(RUNTIME_BASE / task_id / "task_contract.json")


def update_task_status(
    task_id: str,
    status: str,
    run_id: str | None = None,
    error: str | None = None,
) -> None:
    path = RUNTIME_BASE / task_id / "status.json"
    existing = _read(path) or {}
    existing.update({
        "task_id": task_id,
        "status": status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    if run_id is not None:
        existing["run_id"] = run_id
    if error is not None:
        existing["error"] = error
    _write(path, existing)


def load_task_status(task_id: str) -> dict | None:
    return _read(RUNTIME_BASE / task_id / "status.json")


def list_tasks() -> list[dict]:
    if not RUNTIME_BASE.exists():
        return []
    results = []
    for task_dir in sorted(RUNTIME_BASE.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if task_dir.is_dir():
            status = _read(task_dir / "status.json")
            contract = _read(task_dir / "task_contract.json")
            if status:
                results.append({**status, "goal": (contract or {}).get("goal", "")})
    return results


# ─── Run Operations ───────────────────────────────────────────────────────────

def save_run_result(task_id: str, run_id: str, result: dict) -> None:
    path = RUNTIME_BASE / task_id / "runs" / run_id / "agent_result.json"
    _write(path, result)


def load_run_result(task_id: str, run_id: str) -> dict | None:
    return _read(RUNTIME_BASE / task_id / "runs" / run_id / "agent_result.json")


def save_evidence_pack(task_id: str, run_id: str, evidence: dict) -> None:
    path = RUNTIME_BASE / task_id / "runs" / run_id / "evidence_pack.json"
    _write(path, evidence)


def load_evidence_pack(task_id: str, run_id: str) -> dict | None:
    return _read(RUNTIME_BASE / task_id / "runs" / run_id / "evidence_pack.json")


def save_validation_report(task_id: str, run_id: str, report: dict) -> None:
    path = RUNTIME_BASE / task_id / "runs" / run_id / "validation_report.json"
    _write(path, report)


def load_validation_report(task_id: str, run_id: str) -> dict | None:
    return _read(RUNTIME_BASE / task_id / "runs" / run_id / "validation_report.json")


def get_full_task_result(task_id: str) -> dict | None:
    """Load complete task result including Router objects and agent_result/validation_report."""
    status = load_task_status(task_id)
    if not status:
        return None
    run_id = status.get("run_id")

    agent_result = load_run_result(task_id, run_id) if run_id else None
    validation_report = load_validation_report(task_id, run_id) if run_id else None
    evidence_pack = load_evidence_pack(task_id, run_id) if run_id else None

    return {
        "task_id": task_id,
        "run_id": run_id,
        "status": status.get("status"),
        "router_decision": load_router_decision(task_id),
        "router_review_result": load_router_review_result(task_id),
        "work_items": load_work_items(task_id),
        "route_groups": load_route_groups(task_id),
        "agent_result": agent_result,
        "validation_report": validation_report,
        "evidence_pack": evidence_pack,
        "error": status.get("error"),
    }


# ─── Router Operations ────────────────────────────────────────────────────────

def save_router_decision(task_id: str, decision: dict) -> None:
    _write(RUNTIME_BASE / task_id / "router_decision.json", decision)


def load_router_decision(task_id: str) -> dict | None:
    return _read(RUNTIME_BASE / task_id / "router_decision.json")


def save_router_review_result(task_id: str, review: dict) -> None:
    _write(RUNTIME_BASE / task_id / "router_review_result.json", review)


def load_router_review_result(task_id: str) -> dict | None:
    return _read(RUNTIME_BASE / task_id / "router_review_result.json")


def save_work_items(task_id: str, items: list[dict]) -> None:
    _write(RUNTIME_BASE / task_id / "work_items.json", {"work_items": items})


def load_work_items(task_id: str) -> list[dict]:
    data = _read(RUNTIME_BASE / task_id / "work_items.json")
    return (data or {}).get("work_items", [])


def save_route_groups(task_id: str, groups: list[dict]) -> None:
    _write(RUNTIME_BASE / task_id / "route_groups.json", {"route_groups": groups})


def load_route_groups(task_id: str) -> list[dict]:
    data = _read(RUNTIME_BASE / task_id / "route_groups.json")
    return (data or {}).get("route_groups", [])


def save_route_group_runtime(task_id: str, rg_id: str, runtime: dict) -> None:
    path = RUNTIME_BASE / task_id / "route_group_runtime" / f"{rg_id}.json"
    _write(path, runtime)


def load_route_group_runtime(task_id: str, rg_id: str) -> dict | None:
    return _read(RUNTIME_BASE / task_id / "route_group_runtime" / f"{rg_id}.json")


def save_route_group_result(task_id: str, rg_id: str, result: dict) -> None:
    path = RUNTIME_BASE / task_id / "route_group_result" / f"{rg_id}.json"
    _write(path, result)


def load_route_group_result(task_id: str, rg_id: str) -> dict | None:
    return _read(RUNTIME_BASE / task_id / "route_group_result" / f"{rg_id}.json")
