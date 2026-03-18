"""
Orchestrator — manages task lifecycle from task_contract to validation_report.

Flow:
  task_contract → PromptAssembler → ContextPacker → ModelGateway
      → agent_result → ValidatorEngine → validation_report → RuntimeStore
"""
import uuid
import logging
from datetime import datetime, timezone

from model_gateway import get_provider, ModelProviderError
from prompt_runtime.assembler import assemble, MODE_EXECUTOR_MAP
from prompt_runtime.context_packer import pack
from validator.engine import validate
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


def _normalize_task(raw_input: dict) -> dict:
    """
    Normalize raw user input into a task_contract.
    This is the CLAW intake layer for baseline v0.1.
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
        "goal": goal,
        "mode": mode,
        "constraints": constraints,
        "context": {
            "project_name": "CLAW",
            "current_milestone": "Baseline v0.1",
        },
        "editable_scope": [],  # knowledge mode default
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
        "created_by": "CLAW_baseline_v0.1",
    }


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

    # Call model
    provider = get_provider()
    logger.info(f"[Task {task_id[:8]}] Calling {provider.MODEL_NAME}")
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
    Full task processing pipeline called from background.
    Saves all results to runtime store.
    """
    task_id = task_contract["task_id"]
    try:
        store.update_task_status(task_id, "processing")

        run_id, agent_result, evidence_pack, validation_report = run_task(task_contract)

        store.save_run_result(task_id, run_id, agent_result)
        store.save_evidence_pack(task_id, run_id, evidence_pack)
        store.save_validation_report(task_id, run_id, validation_report)

        final_status = "done" if validation_report["judgment"] == "PASS" else "done_with_issues"
        store.update_task_status(task_id, final_status, run_id=run_id)

    except ModelProviderError as e:
        logger.warning(f"[Task {task_id[:8]}] ModelProviderError: {e}, retrying with EchoProvider")
        # Fallback: retry with echo provider
        try:
            from model_gateway import reset_provider, EchoProvider
            reset_provider()
            # Temporarily force echo
            from model_gateway import _provider_instance
            import model_gateway as _mg
            _mg._provider_instance = EchoProvider()
            run_id, agent_result, evidence_pack, validation_report = run_task(task_contract)
            # Re-add model error info to result
            agent_result["model_gateway_note"] = f"Fell back to EchoProvider: {str(e)}"
            store.save_run_result(task_id, run_id, agent_result)
            store.save_evidence_pack(task_id, run_id, evidence_pack)
            store.save_validation_report(task_id, run_id, validation_report)
            final_status = "done_echo_fallback"
            store.update_task_status(task_id, final_status, run_id=run_id)
        except Exception as e2:
            logger.error(f"[Task {task_id[:8]}] Fallback also failed: {e2}")
            store.update_task_status(task_id, "failed", error=f"Primary: {str(e)} | Fallback: {str(e2)}")
    except Exception as e:
        logger.error(f"[Task {task_id[:8]}] Unexpected error: {e}", exc_info=True)
        store.update_task_status(task_id, "failed", error=f"{type(e).__name__}: {str(e)}")


def create_and_queue_task(raw_input: dict) -> dict:
    """
    Normalize input, save task, return initial response.
    Actual processing happens in background.
    """
    task_contract = _normalize_task(raw_input)
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
