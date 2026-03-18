"""
Router Splitter — decomposes normalized task input into WorkItem[].

Strategy (Router baseline v0.1):
- Rule-driven, conservative decomposition.
- Single segment → 1 WorkItem by default.
- Explicit numbered list / bullet markers → split per item.
- Split keywords (另外/再/顺便/同时/additionally/also/furthermore) → split.
- When uncertain, keep conservative (1 WorkItem) and log a warning.
- Unknown editable_scope → write TBD, never fabricate.
"""
import re
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

from router.types import WorkItem

logger = logging.getLogger(__name__)

# Keywords that signal a new independent sub-goal
_SPLIT_KEYWORDS_ZH = ["另外", "再", "顺便", "同时", "此外", "还有", "另一个", "还需要"]
_SPLIT_KEYWORDS_EN = ["additionally", "also", "furthermore", "besides", "meanwhile",
                      "at the same time", "in addition", "another thing"]

# Numbered list patterns: "1. ...", "1) ...", "(1) ..."
_NUMBERED_PATTERN = re.compile(r"^\s*(?:\d+[.)。]|\(\d+\))\s+", re.MULTILINE)

# Bullet patterns
_BULLET_PATTERN = re.compile(r"^\s*[-•*]\s+", re.MULTILINE)


def _detect_mode(goal: str) -> str:
    project_keywords = [
        "implement", "build", "create", "fix", "debug", "refactor",
        "add", "update", "modify", "install", "deploy", "test",
        "实现", "构建", "创建", "修复", "调试", "重构", "添加", "更新",
    ]
    return "project_mode" if any(kw in goal.lower() for kw in project_keywords) else "knowledge_mode"


def _split_by_numbered_list(text: str) -> Optional[list[str]]:
    """Split text into segments if it contains a numbered list."""
    matches = list(_NUMBERED_PATTERN.finditer(text))
    if len(matches) < 2:
        return None
    segments = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        seg = text[start:end].strip()
        if seg:
            segments.append(seg)
    return segments if len(segments) >= 2 else None


def _split_by_bullets(text: str) -> Optional[list[str]]:
    """Split text into segments if it contains a bullet list."""
    matches = list(_BULLET_PATTERN.finditer(text))
    if len(matches) < 2:
        return None
    segments = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        seg = text[start:end].strip()
        if seg:
            segments.append(seg)
    return segments if len(segments) >= 2 else None


def _split_by_keywords(text: str) -> Optional[list[str]]:
    """Split text at split keywords (ZH and EN)."""
    all_keywords = _SPLIT_KEYWORDS_ZH + _SPLIT_KEYWORDS_EN
    # Build a regex that splits on sentence-boundary keyword occurrences
    # Only split if keyword appears mid-sentence (not at the very start)
    pattern = re.compile(
        r"(?<=[。！？.!?\n])\\s*(" + "|".join(re.escape(k) for k in all_keywords) + r")[,，]?\s*",
        re.IGNORECASE,
    )
    parts = pattern.split(text)
    # parts alternates: [pre, keyword, post, keyword, post, ...]
    # Reconstruct real segments (skip captured keyword groups)
    segments = []
    i = 0
    while i < len(parts):
        seg = parts[i].strip()
        if seg:
            segments.append(seg)
        i += 2  # skip the keyword capture group
    return segments if len(segments) >= 2 else None


def _make_work_item(task_id: str, seq: int, goal_text: str,
                    base_contract: dict, warnings: list) -> WorkItem:
    """Build a single WorkItem from a goal segment."""
    now = datetime.now(timezone.utc).isoformat()
    mode = _detect_mode(goal_text)

    # Inherit constraints from parent contract, then note TBD for item-specific ones
    constraints = list(base_contract.get("constraints", []))

    # editable_scope: if base contract has content, inherit; otherwise TBD
    raw_scope = base_contract.get("editable_scope", [])
    if raw_scope:
        editable_whitelist = list(raw_scope)
    else:
        editable_whitelist = ["TBD"]
        warnings.append(
            f"WorkItem {seq}: editable_whitelist unknown — set to TBD. "
            "Human review recommended before dispatch."
        )

    return WorkItem(
        work_item_id=str(uuid.uuid4()),
        task_id=task_id,
        title=goal_text[:80] if len(goal_text) > 80 else goal_text,
        goal=goal_text,
        constraints=constraints,
        context=dict(base_contract.get("context", {})),
        editable_whitelist=editable_whitelist,
        acceptance_criteria=[
            {
                "criterion_id": f"AC-WI-{seq:03d}-001",
                "description": "WorkItem produces a non-empty, relevant output",
                "evidence_type": "command_execution_record",
                "expected_values": {},
                "is_tbd": False,
            }
        ],
        recommended_mode=mode,
        priority="medium",
        status="pending",
        isolation_required=False,
        dependency_ids=[],
        conflict_ids=[],
        created_at=now,
    )


def split(task_contract: dict) -> tuple[list[WorkItem], list[str]]:
    """
    Decompose task_contract into WorkItem[].

    Returns:
        (work_items, warnings)
    """
    task_id = task_contract["task_id"]
    raw_input = task_contract.get("goal", "")
    warnings: list[str] = []

    # Attempt structured splits in priority order
    segments = (
        _split_by_numbered_list(raw_input)
        or _split_by_bullets(raw_input)
        or _split_by_keywords(raw_input)
    )

    if segments and len(segments) >= 2:
        logger.info(f"[Router/Splitter] Task {task_id[:8]}: split into {len(segments)} WorkItems")
        items = [
            _make_work_item(task_id, i + 1, seg, task_contract, warnings)
            for i, seg in enumerate(segments)
        ]
    else:
        # Conservative: treat entire input as single WorkItem
        logger.info(f"[Router/Splitter] Task {task_id[:8]}: single WorkItem (no split detected)")
        items = [_make_work_item(task_id, 1, raw_input, task_contract, warnings)]

    return items, warnings
