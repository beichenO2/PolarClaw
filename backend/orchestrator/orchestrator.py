"""
Orchestrator — manages task lifecycle from task_contract to validation_report.

Flow (Router baseline v0.1):
  raw_input
    → normalize_task_input()    → task_contract
    → run_router()              → RouterDecision + WorkItems + RouteGroups
    → build_route_group_runtime()
    → dispatch_route_groups()   → per-RouteGroup execution
      → PromptAssembler → ContextPacker → ModelGateway
      → agent_result → ValidatorEngine (base + router)
      → validation_report → RuntimeStore
"""
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
        "editable_scope": [],          # knowledge mode default; project mode fills via patterns
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


def dispatch_route_groups(task_contract: dict, router_decision: dict) -> tuple[str, dict, dict, dict]:
    """
    Dispatch RouteGroups for execution (serial baseline).

    Currently executes the first RouteGroup's first WorkItem through the
    existing task execution pipeline. Future: true parallel per-RouteGroup execution.

    Returns:
        (run_id, agent_result, evidence_pack, validation_report)
    """
    task_id = task_contract["task_id"]
    route_groups = router_decision.get("route_groups", [])
    work_items = {wi["work_item_id"]: wi for wi in router_decision.get("work_items", [])}

    if not route_groups:
        raise ValueError("No RouteGroups to dispatch")

    results_by_rg: dict[str, dict] = {}

    for rg in route_groups:
        rg_id = rg["route_group_id"]

        # Update runtime to running
        rg_runtime = store.load_route_group_runtime(task_id, rg_id) or {}
        rg_runtime.update({"status": "running", "current_stage": "executing",
                           "updated_at": datetime.now(timezone.utc).isoformat()})
        store.save_route_group_runtime(task_id, rg_id, rg_runtime)

        # Build a merged task_contract for this RouteGroup
        # Use first WorkItem as the representative goal
        wi_ids = rg.get("work_item_ids", [])
        primary_wi = work_items.get(wi_ids[0]) if wi_ids else None
        rg_contract = dict(task_contract)
        if primary_wi:
            rg_contract["goal"] = primary_wi.get("goal", task_contract["goal"])
            rg_contract["mode"] = primary_wi.get("recommended_mode", task_contract["mode"])
            rg_contract["editable_scope"] = primary_wi.get("editable_whitelist", [])

        run_id, agent_result, evidence_pack, validation_report = run_task(rg_contract)

        # Attach router validation to the report
        router_val = validate_router(router_decision)
        validation_report["router_validation"] = router_val

        # Update RouteGroupRuntime
        rg_runtime["status"] = "done" if validation_report["judgment"] != "FAIL" else "done_with_issues"
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

    # Return the last RouteGroup's result as primary (serial baseline)
    last = list(results_by_rg.values())[-1]
    return last["run_id"], last["agent_result"], last["evidence_pack"], last["validation_report"]


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

        # Stage 2: Dispatch RouteGroups
        run_id, agent_result, evidence_pack, validation_report = dispatch_route_groups(
            task_contract, router_decision
        )

        store.save_run_result(task_id, run_id, agent_result)
        store.save_evidence_pack(task_id, run_id, evidence_pack)
        store.save_validation_report(task_id, run_id, validation_report)

        final_status = "done" if validation_report["judgment"] == "PASS" else "done_with_issues"
        store.update_task_status(task_id, final_status, run_id=run_id)

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

            run_id, agent_result, evidence_pack, validation_report = dispatch_route_groups(
                task_contract, router_decision
            )
            agent_result["model_gateway_note"] = f"Fell back to EchoProvider: {str(e)}"
            store.save_run_result(task_id, run_id, agent_result)
            store.save_evidence_pack(task_id, run_id, evidence_pack)
            store.save_validation_report(task_id, run_id, validation_report)
            store.update_task_status(task_id, "done_echo_fallback", run_id=run_id)
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
