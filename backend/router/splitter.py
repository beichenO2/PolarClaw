"""
Router Splitter — decomposes normalized task input into WorkItem[].

Strategy (conservative, rule-driven):
- Single paragraph, no clear delimiters → 1 WorkItem.
- Explicit numbered list / bullet list → split per item.
- Chinese/English ordinal words (第一/第二, first/second) → split.
- Section headers (## Heading or **Heading:**) → split.
- Double-newline separated paragraphs each starting with an action verb → split.
- Transition keywords mid-sentence → split.
- When uncertain → keep as 1 WorkItem and log a warning.
- Unknown editable_scope → write TBD, never fabricate.
"""
import re
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

from router.types import WorkItem

logger = logging.getLogger(__name__)

# ─── Keyword sets ─────────────────────────────────────────────────────────────

# Transition keywords that signal a new independent sub-goal (mid-sentence)
_SPLIT_KEYWORDS_ZH = [
    "另外", "此外", "还有", "还需要", "另一个",
    "同时", "顺便", "再来", "接下来", "然后", "最后",
    "第一步", "第二步", "第三步", "第四步", "第五步",
]
_SPLIT_KEYWORDS_EN = [
    "additionally", "furthermore", "besides", "moreover",
    "at the same time", "in addition", "on top of that",
    "next", "then", "finally", "after that", "following that",
]

# Chinese ordinal phrases that start a new item at beginning of segment
_ZH_ORDINALS = ["第一", "第二", "第三", "第四", "第五", "第六", "第七", "第八", "第九", "第十"]
_EN_ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"]

# Action verbs (first word of a paragraph) that signal a task segment
_ACTION_VERBS_ZH = [
    "实现", "构建", "创建", "修复", "调试", "重构", "添加", "更新", "修改",
    "安装", "部署", "测试", "编写", "删除", "移除", "优化", "集成", "配置",
    "完成", "处理", "解决", "升级", "生成", "分析",
]
_ACTION_VERBS_EN = [
    "implement", "build", "create", "fix", "debug", "refactor",
    "add", "update", "modify", "install", "deploy", "test", "write",
    "delete", "remove", "optimize", "integrate", "configure", "finish",
    "handle", "resolve", "upgrade", "generate", "analyze", "setup",
]

# Numbered list patterns: "1. ...", "1) ...", "(1) ..."
_NUMBERED_PATTERN = re.compile(r"^\s*(?:\d+[.)。]|\(\d+\))\s+", re.MULTILINE)

# Bullet patterns: "- ...", "• ...", "* ..."
_BULLET_PATTERN = re.compile(r"^\s*[-•*]\s+", re.MULTILINE)

# Section header patterns: "## Title" or "**Title:**" or "**Title**\n"
_HEADER_PATTERN = re.compile(r"^(?:#{1,3}\s+.+|[*_]{2}.+[*_]{2}:?)\s*$", re.MULTILINE)

# Ordinal pattern at start of a segment (ZH and EN)
_ZH_ORDINAL_PATTERN = re.compile(
    r"(?:^|\n)\s*(" + "|".join(re.escape(o) for o in _ZH_ORDINALS) + r")[、，,：:。\s]",
    re.IGNORECASE,
)
_EN_ORDINAL_PATTERN = re.compile(
    r"(?:^|\n)\s*(" + "|".join(re.escape(o) for o in _EN_ORDINALS) + r")[,，:：\s]",
    re.IGNORECASE,
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _detect_mode(goal: str) -> str:
    project_keywords = _ACTION_VERBS_ZH + _ACTION_VERBS_EN
    return "project_mode" if any(kw in goal.lower() for kw in project_keywords) else "knowledge_mode"


def _clean_segments(raw: list[str]) -> list[str]:
    """Strip whitespace, drop empties and single-word noise."""
    return [s.strip() for s in raw if s.strip() and len(s.strip()) > 3]


def _split_by_numbered_list(text: str) -> Optional[list[str]]:
    matches = list(_NUMBERED_PATTERN.finditer(text))
    if len(matches) < 2:
        return None
    segments = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        segments.append(text[start:end])
    return _clean_segments(segments) or None


def _split_by_bullets(text: str) -> Optional[list[str]]:
    matches = list(_BULLET_PATTERN.finditer(text))
    if len(matches) < 2:
        return None
    segments = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        segments.append(text[start:end])
    return _clean_segments(segments) or None


def _split_by_headers(text: str) -> Optional[list[str]]:
    """Split at Markdown / bold headers when ≥2 present."""
    matches = list(_HEADER_PATTERN.finditer(text))
    if len(matches) < 2:
        return None
    segments = []
    for i, m in enumerate(matches):
        # Segment = header line + following body text
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        segments.append(text[start:end])
    return _clean_segments(segments) or None


def _split_by_ordinals(text: str) -> Optional[list[str]]:
    """Split at Chinese or English ordinals (第一/Second etc.) starting a segment."""
    for pattern in (_ZH_ORDINAL_PATTERN, _EN_ORDINAL_PATTERN):
        matches = list(pattern.finditer(text))
        if len(matches) >= 2:
            segments = []
            for i, m in enumerate(matches):
                start = m.start()
                end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
                segments.append(text[start:end])
            result = _clean_segments(segments)
            if result and len(result) >= 2:
                return result
    return None


def _split_by_paragraphs(text: str) -> Optional[list[str]]:
    """
    Split at double-newline paragraph breaks when each paragraph
    begins with an action verb (Chinese or English).
    """
    paragraphs = re.split(r"\n\s*\n", text)
    paragraphs = _clean_segments(paragraphs)
    if len(paragraphs) < 2:
        return None
    all_verbs = _ACTION_VERBS_ZH + _ACTION_VERBS_EN
    action_paras = [
        p for p in paragraphs
        if any(p.lower().startswith(v) or p.lower().startswith(v + " ") for v in all_verbs)
    ]
    # Only split if majority of paragraphs look like action items
    if len(action_paras) >= max(2, len(paragraphs) * 0.6):
        return paragraphs
    return None


def _split_by_keywords(text: str) -> Optional[list[str]]:
    """Split at transition keywords that follow sentence punctuation."""
    all_keywords = _SPLIT_KEYWORDS_ZH + _SPLIT_KEYWORDS_EN
    pattern = re.compile(
        r"(?<=[。！？.!?\n])\s*(?:" + "|".join(re.escape(k) for k in all_keywords) + r")[,，]?\s*",
        re.IGNORECASE,
    )
    parts = pattern.split(text)
    segments = _clean_segments(parts)
    return segments if len(segments) >= 2 else None


# ─── WorkItem factory ─────────────────────────────────────────────────────────

def _make_work_item(task_id: str, seq: int, goal_text: str,
                    base_contract: dict, warnings: list) -> WorkItem:
    now = datetime.now(timezone.utc).isoformat()
    mode = _detect_mode(goal_text)

    constraints = list(base_contract.get("constraints", []))
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
        acceptance_criteria=[{
            "criterion_id": f"AC-WI-{seq:03d}-001",
            "description": "WorkItem produces a non-empty, relevant output",
            "evidence_type": "command_execution_record",
            "expected_values": {},
            "is_tbd": False,
        }],
        recommended_mode=mode,
        priority="medium",
        status="pending",
        isolation_required=False,
        dependency_ids=[],
        conflict_ids=[],
        created_at=now,
    )


# ─── Main entry point ─────────────────────────────────────────────────────────

def split(task_contract: dict) -> tuple[list[WorkItem], list[str]]:
    """
    Decompose task_contract into WorkItem[].

    Attempts structured splits in priority order:
      1. Numbered list (1. / 1) / (1))
      2. Bullet list (- / • / *)
      3. Ordinal words (第一/第二, first/second)
      4. Section headers (## / **bold:**)
      5. Action-verb paragraphs (double-newline separated)
      6. Transition keywords (另外/then/furthermore etc.)
      7. Conservative fallback: single WorkItem + warning

    Returns:
        (work_items, warnings)
    """
    task_id = task_contract["task_id"]
    raw_input = task_contract.get("goal", "")
    warnings: list[str] = []

    segments = (
        _split_by_numbered_list(raw_input)
        or _split_by_bullets(raw_input)
        or _split_by_ordinals(raw_input)
        or _split_by_headers(raw_input)
        or _split_by_paragraphs(raw_input)
        or _split_by_keywords(raw_input)
    )

    if segments and len(segments) >= 2:
        logger.info(f"[Router/Splitter] Task {task_id[:8]}: split into {len(segments)} WorkItems")
        items = [
            _make_work_item(task_id, i + 1, seg, task_contract, warnings)
            for i, seg in enumerate(segments)
        ]
    else:
        logger.info(f"[Router/Splitter] Task {task_id[:8]}: single WorkItem (no split detected)")
        warnings.append("No explicit split signals detected — conservative single WorkItem. Review if multi-goal.")
        items = [_make_work_item(task_id, 1, raw_input, task_contract, warnings)]

    return items, warnings
