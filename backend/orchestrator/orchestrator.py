"""
Orchestrator — manages task lifecycle from task_contract to validation_report.

Flow (Router baseline v0.1):
  raw_input
    → normalize_task_input()    → task_contract (git_checkpoint stored)
    → run_router()              → RouterDecision + WorkItems + RouteGroups
    → build_route_group_runtime()
    → dispatch_route_groups()   → per-RouteGroup execution
      → PromptAssembler → ContextPacker → ModelGateway
      → agent_result → ValidatorEngine (base + router)
      → validation_report → RuntimeStore

Regret/Undo features (v0.2):
  - pause:      PATCH /api/tasks/{id}/pause  → sets status=paused
  - supplement: POST  /api/tasks/{id}/supplement {additional_goal}
                → appends context, creates new WorkItems, resumes
  - revise:     POST  /api/tasks/{id}/revise {new_goal}
                → git-revert editable files, create replacement task
"""
import subprocess
import uuid
import logging
from datetime import datetime, timezone

from model_gateway import get_provider_for_task, ModelProviderError
from prompt_runtime.assembler import assemble, MODE_EXECUTOR_MAP
from prompt_runtime.context_packer import pack
from validator.engine import validate, validate_router
from router.router import route as router_route
from router.types import RouteGroupResult
import runtime_store.store as store

logger = logging.getLogger(__name__)

# ─── Git helpers ──────────────────────────────────────────────────────────────

def _get_git_head() -> str | None:
    """Return current git HEAD hash for use as a revert checkpoint."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True, text=True, cwd=str(store.RUNTIME_BASE.parent.parent),
            timeout=5,
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except Exception:
        return None


def _git_revert_files(files: list[str], checkpoint: str | None) -> dict:
    """
    Attempt to revert a list of files to the given git checkpoint.
    Returns {reverted: [...], failed: [...], skipped: [...]}
    """
    if not checkpoint or not files:
        return {"reverted": [], "failed": [], "skipped": files or []}

    repo_root = str(store.RUNTIME_BASE.parent.parent)
    reverted, failed, skipped = [], [], []

    for f in files:
        if f in ("TBD", "") or not f:
            skipped.append(f)
            continue
        try:
            r = subprocess.run(
                ["git", "checkout", checkpoint, "--", f],
                capture_output=True, text=True, cwd=repo_root, timeout=10,
            )
            if r.returncode == 0:
                reverted.append(f)
                logger.info(f"[Revert] Reverted {f} to {checkpoint[:8]}")
            else:
                failed.append({"file": f, "error": r.stderr.strip()})
                logger.warning(f"[Revert] Failed {f}: {r.stderr.strip()}")
        except Exception as e:
            failed.append({"file": f, "error": str(e)})
    return {"reverted": reverted, "failed": failed, "skipped": skipped}


def _is_paused(task_id: str) -> bool:
    """Check if a task has been externally paused (live check against store)."""
    status = store.load_task_status(task_id)
    return (status or {}).get("status") == "paused"


# ─── Regret / Undo operations ─────────────────────────────────────────────────

def pause_task(task_id: str) -> dict:
    """
    Signal a running task to pause after its current RouteGroup completes.
    Returns the updated status dict.
    """
    status = store.load_task_status(task_id)
    if not status:
        raise ValueError(f"Task {task_id} not found")
    current = status.get("status")
    if current not in ("processing", "queued"):
        raise ValueError(f"Cannot pause task with status '{current}'. Only processing/queued tasks can be paused.")
    store.update_task_status(task_id, "paused", extra={"paused_at": datetime.now(timezone.utc).isoformat()})
    logger.info(f"[Task {task_id[:8]}] Paused (will take effect between RouteGroups)")
    return store.load_task_status(task_id)


def supplement_task(task_id: str, additional_goal: str, background_tasks=None) -> dict:
    """
    Append additional context to a paused task and resume execution.
    The supplement is added as new WorkItems via Router re-run on the delta.
    """
    additional_goal = additional_goal.strip()
    if not additional_goal:
        raise ValueError("additional_goal cannot be empty")

    status = store.load_task_status(task_id)
    if not status or status.get("status") != "paused":
        raise ValueError(f"Task must be paused to supplement. Current status: {(status or {}).get('status')}")

    # Load original contract and append supplement
    contract = store.load_task(task_id)
    if not contract:
        raise ValueError(f"Task contract not found for {task_id}")

    # Store supplement history
    history = status.get("supplement_history", [])
    history.append({
        "text": additional_goal,
        "added_at": datetime.now(timezone.utc).isoformat(),
    })
    # Enrich goal with supplement
    enriched_goal = contract["goal"] + f"\n\n[SUPPLEMENT {len(history)}]: {additional_goal}"
    contract["goal"] = enriched_goal
    contract["normalized_input"] = enriched_goal
    store.save_task(task_id, contract)
    store.update_task_status(task_id, "processing", extra={"supplement_history": history})

    logger.info(f"[Task {task_id[:8]}] Supplemented, resuming execution")

    # Re-run router on supplement delta, then dispatch new RouteGroups
    if background_tasks is not None:
        background_tasks.add_task(_resume_with_supplement, contract, additional_goal)
    else:
        import threading
        threading.Thread(
            target=_resume_with_supplement, args=(contract, additional_goal), daemon=True
        ).start()

    return {"task_id": task_id, "status": "processing", "enriched_goal": enriched_goal}


def _resume_with_supplement(task_contract: dict, additional_goal: str) -> None:
    """Background: run router only on the supplement text, dispatch new RouteGroups."""
    task_id = task_contract["task_id"]
    try:
        supplement_contract = dict(task_contract)
        supplement_contract["goal"] = additional_goal
        supplement_contract["task_id"] = task_id  # share the same task

        router_decision, router_review, _ = run_router(supplement_contract)
        build_route_group_runtime(task_contract, router_decision)

        # Merge new WorkItems / RouteGroups into existing
        existing_wis = store.load_work_items(task_id)
        existing_rgs = store.load_route_groups(task_id)
        new_wis = existing_wis + router_decision["work_items"]
        new_rgs = existing_rgs + router_decision["route_groups"]
        store.save_work_items(task_id, new_wis)
        store.save_route_groups(task_id, new_rgs)

        results_by_rg = dispatch_route_groups(task_contract, router_decision)
        all_judgments = [r["validation_report"]["judgment"] for r in results_by_rg.values()]
        all_run_ids = [r["run_id"] for r in results_by_rg.values()]
        final_status = "done" if all(j == "PASS" for j in all_judgments) else "done_with_issues"
        store.update_task_status(task_id, final_status, run_id=all_run_ids[-1])
    except Exception as e:
        logger.error(f"[Task {task_id[:8]}] Supplement execution failed: {e}", exc_info=True)
        store.update_task_status(task_id, "failed", error=f"Supplement failed: {str(e)}")


def revise_task(task_id: str, new_goal: str, background_tasks=None) -> dict:
    """
    Revise a paused task's goal.
    - Marks the original task as 'superseded'
    - Attempts git revert of files from the original execution
    - Creates and queues a new replacement task
    Returns {new_task_id, revert_result, original_task_id}
    """
    new_goal = new_goal.strip()
    if not new_goal:
        raise ValueError("new_goal cannot be empty")

    status = store.load_task_status(task_id)
    if not status or status.get("status") not in ("paused", "processing", "done", "done_with_issues"):
        raise ValueError(f"Cannot revise task with status: {(status or {}).get('status')}")

    contract = store.load_task(task_id)
    if not contract:
        raise ValueError(f"Task contract not found for {task_id}")

    # Collect files that were edited during original execution
    editable_files = _collect_editable_files(task_id, contract)
    git_checkpoint = contract.get("git_checkpoint")

    # Attempt git revert
    revert_result = _git_revert_files(editable_files, git_checkpoint)
    logger.info(f"[Task {task_id[:8]}] Revert result: {revert_result}")

    # Mark original task as superseded
    store.update_task_status(task_id, "superseded", extra={
        "superseded_at": datetime.now(timezone.utc).isoformat(),
        "revert_result": revert_result,
    })

    # Create replacement task inheriting session_id
    new_raw = {
        "goal": new_goal,
        "mode": contract.get("mode"),
        "constraints": contract.get("constraints", []),
        "session_id": contract.get("session_id"),
    }
    new_contract = normalize_task_input(new_raw)
    new_contract["revised_from_task_id"] = task_id
    new_contract["git_checkpoint"] = git_checkpoint  # same checkpoint for the new task
    store.save_task(new_contract["task_id"], new_contract)
    store.update_task_status(new_contract["task_id"], "processing")

    # Queue new task
    if background_tasks is not None:
        background_tasks.add_task(process_task_async, new_contract)
    else:
        import threading
        threading.Thread(target=process_task_async, args=(new_contract,), daemon=True).start()

    logger.info(f"[Task {task_id[:8]}] Superseded → new task {new_contract['task_id'][:8]}")
    return {
        "original_task_id": task_id,
        "new_task_id": new_contract["task_id"],
        "new_goal": new_goal,
        "revert_result": revert_result,
        "status": "processing",
    }


def _collect_editable_files(task_id: str, contract: dict) -> list[str]:
    """Gather all non-TBD editable files from WorkItems and evidence packs."""
    files: set[str] = set()

    # From WorkItems
    for wi in store.load_work_items(task_id):
        for f in wi.get("editable_whitelist", []):
            if f and f != "TBD":
                files.add(f)

    # From evidence packs (if they recorded actual file writes)
    status = store.load_task_status(task_id) or {}
    run_id = status.get("run_id")
    if run_id:
        pack = store.load_evidence_pack(task_id, run_id)
        if pack:
            for action in pack.get("actions", []):
                if action.get("type") in ("file_write", "file_modify"):
                    path = action.get("path", "")
                    if path and path != "TBD":
                        files.add(path)

    return list(files)


def _detect_mode(goal: str) -> str:
    """Simple heuristic for mode detection. Will be replaced by proper CLAW analysis."""
    project_keywords = [
        "implement", "build", "create", "fix", "debug", "refactor",
        "add", "update", "modify", "install", "deploy", "test",
        "实现", "构建", "创建", "修复", "调试", "重构", "添加", "更新",
    ]
    goal_lower = goal.lower()
    if any(kw in goal_lower for kw in project_keywords):
        return "project_mode"
    return "knowledge_mode"


def normalize_task_input(raw_input: dict) -> dict:
    """
    Normalize raw user input into a task_contract.
    Router baseline v0.1: includes raw_input and normalized_input fields.
    """
    goal = raw_input.get("goal", "").strip()
    if not goal:
        raise ValueError("goal is required and cannot be empty")

    mode = raw_input.get("mode") or _detect_mode(goal)
    session_id = raw_input.get("session_id") or f"sess_{uuid.uuid4().hex[:8]}"
    constraints = raw_input.get("constraints", [])

    task_id = str(uuid.uuid4())

    # Git checkpoint — enables revert-on-revise
    git_checkpoint = _get_git_head()

    return {
        "task_id": task_id,
        "session_id": session_id,
        "raw_input": goal,
        "normalized_input": goal,      # baseline: same as raw; future: LLM-normalized
        "goal": goal,
        "mode": mode,
        "constraints": constraints,
        "context": {
            "project_name": "CLAW",
            "current_milestone": "Router baseline v0.1",
        },
        "editable_scope": [],
        "acceptance_criteria": [
            {
                "criterion_id": "AC-001",
                "description": "Model produces a non-empty, relevant response",
                "evidence_type": "command_execution_record",
                "expected_values": {},
                "is_tbd": False,
            }
        ],
        "requires_interface_proposal": False,
        "git_checkpoint": git_checkpoint,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": "CLAW_router_baseline_v0.1",
    }


# Keep legacy alias for backward compat
_normalize_task = normalize_task_input


def build_task_contract(raw_input: dict) -> dict:
    """Alias for normalize_task_input — explicit contract-building step."""
    return normalize_task_input(raw_input)


def run_router(task_contract: dict) -> tuple[dict, dict, list[dict]]:
    """
    Run Router pipeline on task_contract.

    Returns:
        (router_decision_dict, router_review_result_dict, rg_runtime_dicts)
    """
    decision, review, rg_runtimes = router_route(task_contract)
    return decision.to_dict(), review.to_dict(), [r.to_dict() for r in rg_runtimes]


def build_route_group_runtime(task_contract: dict, router_decision: dict) -> list[dict]:
    """
    Build and save RouteGroupRuntime objects for each RouteGroup.
    Returns list of runtime dicts.
    """
    task_id = task_contract["task_id"]
    runtimes = []
    for rg in router_decision.get("route_groups", []):
        rg_id = rg["route_group_id"]
        existing = store.load_route_group_runtime(task_id, rg_id)
        if not existing:
            store.save_route_group_runtime(task_id, rg_id, {
                "route_group_id": rg_id,
                "task_id": task_id,
                "status": "pending",
                "current_stage": "init",
                "run_ids": [],
                "waiting_for": None,
                "blocking_reason": None,
                "wait_gate_event": None,
                "human_confirmation_required": rg.get("human_confirmation_required", False),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
        runtimes.append(store.load_route_group_runtime(task_id, rg_id))
    return runtimes


def dispatch_route_groups(task_contract: dict, router_decision: dict) -> dict[str, dict]:
    """
    Dispatch RouteGroups for execution (serial baseline, independent run_id per RG).

    Each RouteGroup:
      - Gets its own task_contract derived from its primary WorkItem
      - Runs independently via run_task() → unique run_id
      - Persists its run_id in RouteGroupRuntime.run_ids[]
      - Saves its own RouteGroupResult

    Returns:
        dict mapping route_group_id → {run_id, agent_result, evidence_pack, validation_report}
    """
    task_id = task_contract["task_id"]
    route_groups = router_decision.get("route_groups", [])
    work_items = {wi["work_item_id"]: wi for wi in router_decision.get("work_items", [])}

    if not route_groups:
        raise ValueError("No RouteGroups to dispatch")

    # Pre-compute router validation once (same decision object for all RGs)
    router_val = validate_router(router_decision)

    results_by_rg: dict[str, dict] = {}

    for rg in route_groups:
        rg_id = rg["route_group_id"]

        # Check pause flag before starting each RouteGroup
        if _is_paused(task_id):
            logger.info(f"[Task {task_id[:8]}] Paused — halting before RG {rg_id[:8]}")
            break

        # Mark runtime as running
        rg_runtime = store.load_route_group_runtime(task_id, rg_id) or {}
        rg_runtime.update({
            "status": "running",
            "current_stage": "executing",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        store.save_route_group_runtime(task_id, rg_id, rg_runtime)

        # Build per-RouteGroup task_contract from primary WorkItem
        wi_ids = rg.get("work_item_ids", [])
        primary_wi = work_items.get(wi_ids[0]) if wi_ids else None
        rg_contract = dict(task_contract)
        if primary_wi:
            rg_contract["goal"] = primary_wi.get("goal", task_contract["goal"])
            rg_contract["mode"] = primary_wi.get("recommended_mode", task_contract["mode"])
            rg_contract["editable_scope"] = primary_wi.get("editable_whitelist", [])
        # Tag which work_items belong to this RG (for context packer / traceability)
        rg_contract["route_group_id"] = rg_id
        rg_contract["work_item_ids"] = wi_ids

        # Independent execution → unique run_id
        run_id, agent_result, evidence_pack, validation_report = run_task(rg_contract)

        # Attach router validation to this RG's report
        validation_report["router_validation"] = router_val

        # Persist run data under the task's runs/ directory
        store.save_run_result(task_id, run_id, agent_result)
        store.save_evidence_pack(task_id, run_id, evidence_pack)
        store.save_validation_report(task_id, run_id, validation_report)

        # Update RouteGroupRuntime — append this run_id to the list
        rg_status = "done" if validation_report["judgment"] != "FAIL" else "done_with_issues"
        rg_runtime["status"] = rg_status
        rg_runtime["current_stage"] = "completed"
        rg_runtime["run_ids"] = rg_runtime.get("run_ids", []) + [run_id]
        rg_runtime["updated_at"] = datetime.now(timezone.utc).isoformat()
        store.save_route_group_runtime(task_id, rg_id, rg_runtime)

        # Save RouteGroupResult
        rg_result = RouteGroupResult(
            route_group_id=rg_id,
            task_id=task_id,
            status="done" if validation_report["judgment"] != "FAIL" else "failed",
            summary=validation_report.get("summary", ""),
            result_ref=run_id,
            validation_report_refs=[run_id],
            warnings=router_decision.get("warnings", []),
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        store.save_route_group_result(task_id, rg_id, rg_result.to_dict())

        results_by_rg[rg_id] = {
            "run_id": run_id,
            "agent_result": agent_result,
            "evidence_pack": evidence_pack,
            "validation_report": validation_report,
        }

        logger.info(
            f"[Task {task_id[:8]}] RG {rg_id[:8]} done: "
            f"run_id={run_id[:8]}, judgment={validation_report['judgment']}"
        )

    return results_by_rg


def _parse_agent_result(model_response: str, task_contract: dict, run_id: str) -> dict:
    """
    Parse model response into a structured agent_result.
    Baseline: parse simple fact_status markers from the response.
    """
    # Simple heuristic parsing of fact_status from model output
    confirmed_facts = []
    inferred = []
    unknowns = []

    # Look for structured sections in the response
    lines = model_response.split("\n")
    section = None
    for line in lines:
        line_lower = line.lower().strip()
        if "confirmed" in line_lower and "fact" in line_lower:
            section = "confirmed"
        elif "inferred" in line_lower or "hypothesis" in line_lower:
            section = "inferred"
        elif "unknown" in line_lower or "tbd" in line_lower:
            section = "unknown"
        elif line.strip().startswith("- ") and section:
            item = line.strip()[2:].strip()
            if section == "confirmed":
                confirmed_facts.append(item)
            elif section == "inferred":
                inferred.append(item)
            elif section == "unknown":
                unknowns.append(item)

    return {
        "result_id": str(uuid.uuid4()),
        "agent_task_id": task_contract["task_id"],
        "agent_id": "generic_agent_baseline",
        "run_id": run_id,
        "status": "completed",
        "model_response": model_response,
        "outputs": [
            {
                "output_type": "analysis_produced",
                "description": "Model analysis response",
                "is_in_whitelist": True,
            }
        ],
        "fact_status": {
            "confirmed_facts": confirmed_facts or ["Model response received"],
            "inferred_hypotheses": inferred,
            "unknowns": unknowns,
        },
        "evidence_refs": [],
        "violations": [],
        "escalation_needed": False,
        "escalation_reason": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _build_evidence_pack(task_contract: dict, run_id: str, agent_result: dict) -> dict:
    """Build a basic evidence pack for baseline validation."""
    return {
        "evidence_pack_id": str(uuid.uuid4()),
        "run_id": run_id,
        "agent_id": agent_result.get("agent_id", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "evidence_items": [
            {
                "item_id": str(uuid.uuid4()),
                "type": "command_execution_record",
                "data": {
                    "type": "command_execution_record",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "command": "model.generate(messages)",
                    "working_directory": "model_gateway",
                    "exit_code": 0,
                    "stdout": agent_result.get("model_response", "")[:200],
                    "stderr": "",
                    "duration_ms": 0,
                    "status": "success",
                }
            }
        ],
        "completeness_check": {
            "required_types": ["command_execution_record"],
            "present_types": ["command_execution_record"],
            "missing_types": [],
            "is_complete": True,
        }
    }


def run_task(task_contract: dict) -> tuple[str, dict, dict, dict]:
    """
    Execute a task through the full pipeline.

    Returns:
        (run_id, agent_result, evidence_pack, validation_report)
    """
    task_id = task_contract["task_id"]
    run_id = str(uuid.uuid4())
    mode = task_contract.get("mode", "knowledge_mode")

    # Select executor role based on mode
    role = MODE_EXECUTOR_MAP.get(mode, "generic_agent")

    logger.info(f"[Task {task_id[:8]}] Starting run {run_id[:8]}, mode={mode}, role={role}")

    # Pack context
    include_interfaces = (mode == "project_mode")
    packed_context = pack(task_contract, include_interfaces=include_interfaces)

    # Assemble prompt
    messages = assemble(role, mode, task_contract, packed_context)

    # Infer task_type from mode for model routing
    _MODE_TO_TASK_TYPE = {
        "project_mode":   "coding",   # CP/qwen3-coder-plus ~1.8s
        "knowledge_mode": "agent",    # CP/kimi-k2.5        ~2.4s
        "debug_mode":     "debug",    # MM/MiniMax-M2.7     ~5.6s (cross-provider)
        "vision_mode":    "vision",   # MM/MiniMax-M2.7     ~5.6s
    }
    task_type = _MODE_TO_TASK_TYPE.get(mode, "agent")
    provider = get_provider_for_task(task_type)
    logger.info(f"[Task {task_id[:8]}] Calling {provider.MODEL_NAME} (task_type={task_type})")
    model_response = provider.generate(messages)

    # Parse result
    agent_result = _parse_agent_result(model_response, task_contract, run_id)

    # Build evidence pack
    evidence_pack = _build_evidence_pack(task_contract, run_id, agent_result)

    # Validate
    validation_report = validate(task_contract, agent_result)
    validation_report["run_id"] = run_id

    logger.info(
        f"[Task {task_id[:8]}] Done. Validation: {validation_report['judgment']}"
    )
    return run_id, agent_result, evidence_pack, validation_report


def process_task_async(task_contract: dict) -> None:
    """
    Full task processing pipeline (Router baseline v0.1).
    Pipeline: task_contract → Router → RouteGroups → execute → validate → store.
    """
    task_id = task_contract["task_id"]
    try:
        store.update_task_status(task_id, "processing")

        # Stage 1: Router
        router_decision, router_review, rg_runtime_dicts = run_router(task_contract)
        store.save_router_decision(task_id, router_decision)
        store.save_router_review_result(task_id, router_review)
        store.save_work_items(task_id, router_decision["work_items"])
        store.save_route_groups(task_id, router_decision["route_groups"])
        build_route_group_runtime(task_contract, router_decision)

        logger.info(
            f"[Task {task_id[:8]}] Router: {len(router_decision['work_items'])} WorkItems, "
            f"{len(router_decision['route_groups'])} RouteGroups, "
            f"dispatch_ready={router_decision['dispatch_ready']}"
        )

        # Stage 2: Dispatch RouteGroups — each gets its own run_id
        results_by_rg = dispatch_route_groups(task_contract, router_decision)

        # Aggregate across all RouteGroups
        all_judgments = [r["validation_report"]["judgment"] for r in results_by_rg.values()]
        all_run_ids = [r["run_id"] for r in results_by_rg.values()]

        # Overall status: PASS only if all RGs pass; any FAIL → done_with_issues
        if all(j == "PASS" for j in all_judgments):
            final_status = "done"
        elif any(j == "FAIL" for j in all_judgments):
            final_status = "done_with_issues"
        else:
            final_status = "done"  # PARTIAL / BLOCKED treated as done for now

        # Use last run_id as the primary for backward-compat status.json field
        primary_run_id = all_run_ids[-1]
        store.update_task_status(task_id, final_status, run_id=primary_run_id)
        logger.info(
            f"[Task {task_id[:8]}] All {len(results_by_rg)} RouteGroup(s) done. "
            f"judgments={all_judgments}, status={final_status}"
        )

    except ModelProviderError as e:
        logger.warning(f"[Task {task_id[:8]}] ModelProviderError: {e}, retrying with EchoProvider")
        try:
            from model_gateway import reset_providers, EchoProvider
            import model_gateway as _mg
            reset_providers()
            echo = EchoProvider()
            for _tt in ("agent", "coding", "router", "debug", "vision", "general"):
                _mg._provider_cache[_tt] = echo

            router_decision = store.load_router_decision(task_id) or {}
            if not router_decision:
                router_decision, router_review, _ = run_router(task_contract)
                router_decision = router_decision if isinstance(router_decision, dict) else router_decision.to_dict()

            results_by_rg = dispatch_route_groups(task_contract, router_decision)
            all_run_ids = [r["run_id"] for r in results_by_rg.values()]
            # Annotate fallback on all agent results
            for r in results_by_rg.values():
                r["agent_result"]["model_gateway_note"] = f"Fell back to EchoProvider: {str(e)}"
            primary_run_id = all_run_ids[-1]
            store.update_task_status(task_id, "done_echo_fallback", run_id=primary_run_id)
        except Exception as e2:
            logger.error(f"[Task {task_id[:8]}] Fallback also failed: {e2}")
            store.update_task_status(task_id, "failed", error=f"Primary: {str(e)} | Fallback: {str(e2)}")
    except Exception as e:
        logger.error(f"[Task {task_id[:8]}] Unexpected error: {e}", exc_info=True)
        store.update_task_status(task_id, "failed", error=f"{type(e).__name__}: {str(e)}")


def create_and_queue_task(raw_input: dict) -> dict:
    """
    Normalize input, save task_contract, return initial response.
    Actual processing (including Router) happens in background.
    """
    task_contract = normalize_task_input(raw_input)
    task_id = task_contract["task_id"]

    store.save_task(task_id, task_contract)
    store.update_task_status(task_id, "queued")

    return {
        "task_id": task_id,
        "session_id": task_contract["session_id"],
        "status": "processing",
        "mode": task_contract["mode"],
        "goal": task_contract["goal"],
        "created_at": task_contract["created_at"],
    }
