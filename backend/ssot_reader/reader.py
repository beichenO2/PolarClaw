"""
SSOT Reader — reads SSOT/ documents for context injection.
Provides summaries and relevant excerpts for ContextPacker.
"""
from pathlib import Path
import re

_PROJECT_ROOT = Path(__file__).parent.parent.parent
SSOT_DIR = _PROJECT_ROOT / "SSOT"
SPROMPT_DIR = _PROJECT_ROOT / "Sprompt"


def read_file_safe(path: Path, max_chars: int = 8000) -> str:
    """Read a file, truncating if too large."""
    if not path.exists():
        return f"[File not found: {path}]"
    content = path.read_text(encoding="utf-8")
    if len(content) > max_chars:
        content = content[:max_chars] + "\n... [truncated]"
    return content


def get_state_summary() -> str:
    """Get a concise summary of current system state."""
    content = read_file_safe(SSOT_DIR / "state.md", max_chars=3000)
    return content


def get_interface_summary() -> str:
    """Get current interface contract summary."""
    content = read_file_safe(SSOT_DIR / "interfaces.md", max_chars=2000)
    return content


def get_role_prompt(role: str) -> str:
    """Load a role prompt from Sprompt/prompts/roles/."""
    path = SPROMPT_DIR / "prompts" / "roles" / f"{role}.md"
    return read_file_safe(path, max_chars=4000)


def get_constraint_summary() -> str:
    """Load hard constraints summary from constitutional/02_constraints.md."""
    path = SPROMPT_DIR / "constitutional" / "02_constraints.md"
    content = read_file_safe(path, max_chars=2000)
    # Extract just the hard constraints section
    lines = content.split("\n")
    constraint_lines = []
    in_section = False
    for line in lines:
        if "## Hard Constraints" in line:
            in_section = True
        if in_section:
            constraint_lines.append(line)
        if len(constraint_lines) > 50:
            break
    return "\n".join(constraint_lines) if constraint_lines else content[:1000]


def get_available_roles() -> list[str]:
    """List available role prompt files."""
    roles_dir = SPROMPT_DIR / "prompts" / "roles"
    if not roles_dir.exists():
        return []
    return [f.stem for f in roles_dir.glob("*.md")]
