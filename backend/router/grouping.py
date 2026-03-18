"""
Router Grouping — assembles WorkItem[] into RouteGroup[].

Strategy (Router baseline v0.1):
- Default: 1 WorkItem → 1 RouteGroup (conservative isolation).
- Merge only when all of the following are true:
  1. recommended_mode is identical
  2. editable_whitelist does not contain conflicting paths
  3. Neither WorkItem has isolation_required=True
  4. No dependency_ids or conflict_ids between them
- Bot assignment is heuristic: project_mode → ProjectMakerBot, else KnowleverBot.
- FSM is TBD for this baseline — left as null.
"""
import uuid
import logging
from datetime import datetime, timezone

from router.types import WorkItem, RouteGroup

logger = logging.getLogger(__name__)

_MODE_BOT_MAP = {
    "project_mode": "ProjectMakerBot",
    "knowledge_mode": "KnowleverBot",
}


def _whitelists_conflict(wl_a: list, wl_b: list) -> bool:
    """Return True if two editable_whitelists have overlapping non-TBD paths."""
    real_a = {p for p in wl_a if p != "TBD"}
    real_b = {p for p in wl_b if p != "TBD"}
    return bool(real_a & real_b)


def _can_merge(a: WorkItem, b: WorkItem) -> bool:
    """Return True if two WorkItems are safe to put in the same RouteGroup."""
    if a.recommended_mode != b.recommended_mode:
        return False
    if a.isolation_required or b.isolation_required:
        return False
    if b.work_item_id in a.dependency_ids or a.work_item_id in b.dependency_ids:
        return False
    if b.work_item_id in a.conflict_ids or a.work_item_id in b.conflict_ids:
        return False
    if _whitelists_conflict(a.editable_whitelist, b.editable_whitelist):
        return False
    return True


def group(work_items: list[WorkItem], task_id: str) -> list[RouteGroup]:
    """
    Assemble WorkItem[] into RouteGroup[].

    Conservative baseline: tries to merge compatible items; falls back to
    one RouteGroup per WorkItem otherwise.
    """
    now = datetime.now(timezone.utc).isoformat()
    assigned: set[str] = set()
    groups: list[RouteGroup] = []

    for i, wi in enumerate(work_items):
        if wi.work_item_id in assigned:
            continue

        # Attempt to collect compatible items into one group
        group_items = [wi]
        assigned.add(wi.work_item_id)

        for other in work_items[i + 1:]:
            if other.work_item_id in assigned:
                continue
            # Only merge if every item in the current group is compatible with other
            if all(_can_merge(existing, other) for existing in group_items):
                group_items.append(other)
                assigned.add(other.work_item_id)

        merged_whitelist: list[str] = []
        for gi in group_items:
            for p in gi.editable_whitelist:
                if p not in merged_whitelist:
                    merged_whitelist.append(p)

        mode = group_items[0].recommended_mode
        bot_name = _MODE_BOT_MAP.get(mode, "KnowleverBot")

        rg = RouteGroup(
            route_group_id=str(uuid.uuid4()),
            task_id=task_id,
            work_item_ids=[gi.work_item_id for gi in group_items],
            mode=mode,
            bot_name=bot_name,
            fsm_name=None,
            priority=group_items[0].priority,
            status="pending",
            editable_whitelist=merged_whitelist,
            blocking_reason=None,
            wait_gate_event=None,
            human_confirmation_required=False,
            created_at=now,
        )
        groups.append(rg)

    logger.info(
        f"[Router/Grouping] Task {task_id[:8]}: "
        f"{len(work_items)} WorkItems → {len(groups)} RouteGroups"
    )
    return groups
