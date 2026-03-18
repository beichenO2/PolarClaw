"""
Validator Engine (Router baseline v0.1)
Performs structural validation of task execution results and Router layer.

Baseline checks (V-001 to V-005): task execution validation.
Router checks (R-001 to R-005): Router layer structural validation.
"""
from datetime import datetime, timezone
import uuid


def validate(task_contract: dict, agent_result: dict) -> dict:
    """
    Run baseline validation on a completed task.

    Returns:
        dict: validation_report conforming to Sprompt/schemas/validation_report.json
    """
    violations = []
    criteria_results = []
    judgment = "PASS"

    # Check 1: task_contract has required fields
    required_contract_fields = ["task_id", "goal", "mode", "session_id"]
    for field in required_contract_fields:
        if not task_contract.get(field):
            violations.append({
                "violation_type": "missing_required_field",
                "description": f"task_contract missing required field: {field}",
                "evidence_ref": None,
            })
            judgment = "FAIL"

    criteria_results.append({
        "criterion_id": "V-001",
        "criterion_description": "task_contract has required fields",
        "result": "PASS" if not any(
            v["violation_type"] == "missing_required_field" for v in violations
        ) else "FAIL",
        "evidence_ref": None,
        "reason": "Checked task_id, goal, mode, session_id",
    })

    # Check 2: editable_scope present (may be empty for knowledge mode)
    if "editable_scope" not in task_contract:
        violations.append({
            "violation_type": "missing_whitelist",
            "description": "task_contract missing editable_scope field",
            "evidence_ref": None,
        })
        judgment = "FAIL"

    criteria_results.append({
        "criterion_id": "V-002",
        "criterion_description": "editable_scope field present",
        "result": "PASS" if "editable_scope" in task_contract else "FAIL",
        "evidence_ref": None,
        "reason": "editable_scope field existence check",
    })

    # Check 3: agent_result has model_response
    model_response = agent_result.get("model_response", "")
    if not model_response or len(model_response.strip()) < 5:
        violations.append({
            "violation_type": "empty_model_response",
            "description": "agent_result has empty or trivial model_response",
            "evidence_ref": None,
        })
        judgment = "FAIL"

    criteria_results.append({
        "criterion_id": "V-003",
        "criterion_description": "model produced a non-empty response",
        "result": "PASS" if model_response and len(model_response.strip()) >= 5 else "FAIL",
        "evidence_ref": None,
        "reason": f"Response length: {len(model_response)} chars",
    })

    # Check 4: fact_status present (Non-Fabrication compliance)
    fact_status = agent_result.get("fact_status", {})
    if not fact_status or not isinstance(fact_status, dict):
        # Soft check — NEED_HUMAN if missing but not hard FAIL for baseline
        criteria_results.append({
            "criterion_id": "V-004",
            "criterion_description": "fact_status present (Non-Fabrication compliance)",
            "result": "SKIP",
            "evidence_ref": None,
            "reason": "fact_status not present in agent_result — baseline validator skips this",
        })
    else:
        criteria_results.append({
            "criterion_id": "V-004",
            "criterion_description": "fact_status present (Non-Fabrication compliance)",
            "result": "PASS",
            "evidence_ref": None,
            "reason": "fact_status fields found in agent_result",
        })

    # Check 5: no hard errors in agent_result
    if agent_result.get("status") == "failed" and agent_result.get("error"):
        violations.append({
            "violation_type": "agent_execution_failed",
            "description": f"Agent execution failed: {agent_result.get('error')}",
            "evidence_ref": None,
        })
        judgment = "FAIL"

    criteria_results.append({
        "criterion_id": "V-005",
        "criterion_description": "agent execution completed without error",
        "result": "FAIL" if agent_result.get("status") == "failed" else "PASS",
        "evidence_ref": None,
        "reason": agent_result.get("error", "No error"),
    })

    # Finalize judgment
    if judgment == "PASS":
        failed_checks = [r for r in criteria_results if r["result"] == "FAIL"]
        if failed_checks:
            judgment = "FAIL"

    summary = (
        f"Baseline validation: {judgment}. "
        f"{len([r for r in criteria_results if r['result'] == 'PASS'])} checks passed, "
        f"{len([r for r in criteria_results if r['result'] == 'FAIL'])} failed, "
        f"{len([r for r in criteria_results if r['result'] == 'SKIP'])} skipped."
    )

    return {
        "report_id": str(uuid.uuid4()),
        "run_id": agent_result.get("run_id", ""),
        "evidence_pack_id": None,
        "judgment": judgment,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "criteria_results": criteria_results,
        "violations": violations,
        "blocked_reason": None,
        "need_human_reason": None,
        "summary": summary,
        "router_validation": None,  # populated separately by validate_router()
    }


def validate_router(router_decision: dict) -> dict:
    """
    Validate Router layer outputs: WorkItems and RouteGroups.

    Returns a router_validation sub-report to be merged into the main validation_report.
    """
    work_items = router_decision.get("work_items", [])
    route_groups = router_decision.get("route_groups", [])
    violations: list[str] = []

    # R-001: At least one WorkItem must exist
    work_items_valid = len(work_items) > 0
    if not work_items_valid:
        violations.append("R-001: No WorkItems produced by Router")

    # R-002: Every WorkItem must have non-empty goal
    for wi in work_items:
        if not wi.get("goal", "").strip():
            violations.append(f"R-002: WorkItem {wi.get('work_item_id', '?')[:8]} has empty goal")
            work_items_valid = False

    # R-003: At least one RouteGroup must exist
    route_groups_valid = len(route_groups) > 0
    if not route_groups_valid:
        violations.append("R-003: No RouteGroups produced by Router")

    # R-004: Every RouteGroup must reference at least one valid WorkItem
    work_item_ids = {wi.get("work_item_id") for wi in work_items}
    for rg in route_groups:
        rg_wi_ids = rg.get("work_item_ids", [])
        if not rg_wi_ids:
            violations.append(f"R-004: RouteGroup {rg.get('route_group_id', '?')[:8]} has no work_item_ids")
            route_groups_valid = False
        else:
            invalid = [wid for wid in rg_wi_ids if wid not in work_item_ids]
            if invalid:
                violations.append(
                    f"R-004: RouteGroup {rg.get('route_group_id', '?')[:8]} references "
                    f"unknown WorkItem IDs: {invalid}"
                )
                route_groups_valid = False

    # R-005: RouterDecision must have task_id and created_at for traceability
    decision_traceable = bool(router_decision.get("task_id")) and bool(router_decision.get("created_at"))
    if not decision_traceable:
        violations.append("R-005: RouterDecision missing task_id or created_at — not traceable")

    if violations:
        judgment = "FAIL"
    elif router_decision.get("warnings"):
        judgment = "PARTIAL"
    else:
        judgment = "PASS"

    return {
        "work_items_valid": work_items_valid,
        "route_groups_valid": route_groups_valid,
        "decision_traceable": decision_traceable,
        "violations": violations,
        "judgment": judgment,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
