"""
Router — entry point for the Router layer.

Responsibility:
  Given a normalized task_contract, produce:
    - WorkItem[]
    - RouteGroup[]
    - RouterDecision
    - RouterReviewResult

This is Router baseline v0.1: rule-driven, conservative, no LLM calls.
"""
import logging
from datetime import datetime, timezone

from router.types import RouterDecision, RouterReviewResult, RouteGroupRuntime
from router.splitter import split
from router.grouping import group

logger = logging.getLogger(__name__)


def route(task_contract: dict) -> tuple[RouterDecision, RouterReviewResult, list[RouteGroupRuntime]]:
    """
    Full Router pipeline.

    Returns:
        (router_decision, router_review_result, route_group_runtimes)
    """
    task_id = task_contract["task_id"]
    now = datetime.now(timezone.utc).isoformat()

    # Stage 1: Decompose into WorkItems
    work_items, split_warnings = split(task_contract)

    # Stage 2: Group WorkItems into RouteGroups
    route_groups = group(work_items, task_id)

    # Stage 3: Build RouterDecision
    all_warnings = list(split_warnings)
    required_confirmations: list[str] = []

    # Flag if any WorkItem has TBD in editable_whitelist
    tbd_items = [wi.work_item_id[:8] for wi in work_items if "TBD" in wi.editable_whitelist]
    if tbd_items:
        all_warnings.append(
            f"WorkItems {tbd_items} have TBD editable_whitelist — "
            "human review required before high-risk execution."
        )
        required_confirmations.append("editable_whitelist_review")

    dispatch_ready = len(required_confirmations) == 0

    decision = RouterDecision(
        task_id=task_id,
        work_items=[wi.to_dict() for wi in work_items],
        route_groups=[rg.to_dict() for rg in route_groups],
        warnings=all_warnings,
        required_confirmations=required_confirmations,
        dispatch_ready=dispatch_ready,
        blocked_task_state=None,
        interface_change_proposal=None,
        created_at=now,
    )

    # Stage 4: RouterReviewResult
    decomp_summary = (
        f"Input decomposed into {len(work_items)} WorkItem(s) across "
        f"{len(route_groups)} RouteGroup(s)."
    )
    rg_summary = "; ".join(
        f"RG[{rg.route_group_id[:8]}] mode={rg.mode} bot={rg.bot_name} "
        f"items={len(rg.work_item_ids)}"
        for rg in route_groups
    )

    review_status = "accepted" if not all_warnings else "accepted_with_warnings"

    review = RouterReviewResult(
        task_id=task_id,
        status=review_status,
        decomposition_summary=decomp_summary,
        conflict_summary=None,
        route_group_summary=rg_summary,
        warnings=all_warnings,
        created_at=now,
    )

    # Stage 5: Build RouteGroupRuntime for each RouteGroup
    rg_runtimes = [
        RouteGroupRuntime(
            route_group_id=rg.route_group_id,
            task_id=task_id,
            status="pending",
            current_stage="init",
            run_ids=[],
            waiting_for=None,
            blocking_reason=None,
            wait_gate_event=None,
            human_confirmation_required=rg.human_confirmation_required,
            updated_at=now,
        )
        for rg in route_groups
    ]

    logger.info(
        f"[Router] Task {task_id[:8]}: decision={review_status}, "
        f"dispatch_ready={dispatch_ready}, warnings={len(all_warnings)}"
    )

    return decision, review, rg_runtimes
