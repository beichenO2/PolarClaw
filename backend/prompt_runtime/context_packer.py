"""
Context Packer
Controls token budget and selects relevant context for model consumption.

Key principle: Never dump the entire Sprompt/ into the model.
Select and summarize relevant pieces based on task type.
"""
from ssot_reader.reader import get_state_summary, get_interface_summary

# Approximate token budget for context (conservative estimate: 1 token ≈ 4 chars)
MAX_CONTEXT_CHARS = 6000


def _truncate(text: str, max_chars: int, label: str = "") -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + f"\n... [{label} truncated at {max_chars} chars]"


def pack(task_contract: dict, include_interfaces: bool = False) -> str:
    """
    Pack relevant context for a task into a context string.

    Args:
        task_contract: The task contract dict
        include_interfaces: Whether to include interface definitions (for project mode)

    Returns:
        str: Packed context string within token budget
    """
    mode = task_contract.get("mode", "knowledge_mode")
    goal = task_contract.get("goal", "")
    session_id = task_contract.get("session_id", "")
    task_id = task_contract.get("task_id", "")

    sections = []

    # Always include system state summary
    state = get_state_summary()
    sections.append(f"### System State\n{_truncate(state, 2000, 'state')}")

    # Include interface contract for project mode or when explicitly requested
    if mode == "project_mode" or include_interfaces:
        interfaces = get_interface_summary()
        sections.append(f"### Interface Contract\n{_truncate(interfaces, 1500, 'interfaces')}")

    # Include task metadata
    sections.append(f"""### Task Metadata
- Task ID: {task_id}
- Session ID: {session_id}
- Mode: {mode}
- Editable Scope: {task_contract.get('editable_scope', [])}
""")

    # Acceptance criteria if present
    criteria = task_contract.get("acceptance_criteria", [])
    if criteria:
        criteria_str = "\n".join(
            f"- [{c.get('criterion_id', '?')}] {c.get('description', '')}"
            for c in criteria
        )
        sections.append(f"### Acceptance Criteria\n{criteria_str}")

    combined = "\n\n".join(sections)
    return _truncate(combined, MAX_CONTEXT_CHARS, "context")
