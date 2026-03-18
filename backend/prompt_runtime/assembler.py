"""
Prompt Assembler
Builds compiled prompt packs from Sprompt/ role definitions + task context.

Key principle: Sprompt/ is the "source code" of prompts.
The compiled prompt pack (message list) is what actually gets sent to the model.
"""
import json
from ssot_reader.reader import get_role_prompt, get_constraint_summary


# Role → primary prompt file mapping
ROLE_PROMPT_MAP = {
    "CLAW": "CLAW",
    "project_executor": "project_executor",
    "knowledge_executor": "knowledge_executor",
    "generic_agent": "generic_agent",
    "evidence_collector": "evidence_collector",
    "deterministic_validator": "deterministic_validator",
}

# Mode → executor role mapping
MODE_EXECUTOR_MAP = {
    "knowledge_mode": "knowledge_executor",
    "project_mode": "project_executor",
}


def _build_system_prompt(role: str, mode: str, constraints_summary: str) -> str:
    """
    Build the system message for a given role and mode.
    Injects key constraints inline.
    """
    role_prompt = get_role_prompt(ROLE_PROMPT_MAP.get(role, "generic_agent"))

    system = f"""You are operating as part of the CLAW system (Contextual Layered Agent Workbench).

## Your Role
{role_prompt}

## Active Mode
{mode}

## Critical Constraints (Non-negotiable)
- Non-Fabrication: distinguish confirmed facts / inferred hypotheses / unknowns. Write TBD for unknowns.
- Do not fabricate information. Base all outputs on the provided context.
- Be concise and structured in your response.
- If asked about code or files, only reference what is in the task context.
"""
    return system


def _build_task_message(task_contract: dict, packed_context: str) -> str:
    """Build the user message containing the task and context."""
    goal = task_contract.get("goal", "(no goal specified)")
    constraints = task_contract.get("constraints", [])
    mode = task_contract.get("mode", "knowledge_mode")

    constraints_str = "\n".join(f"- {c}" for c in constraints) if constraints else "- None specified"

    return f"""## Task

**Goal:** {goal}

**Mode:** {mode}

**Constraints:**
{constraints_str}

## Context
{packed_context}

## Instructions
Please analyze the task and provide a structured response.
Your response should include:
1. **Understanding**: What you understand the task to be
2. **Analysis**: Key observations or steps
3. **Output**: The actual result/answer
4. **Fact Status**:
   - confirmed_facts: what you know for certain
   - inferred_hypotheses: what you're inferring
   - unknowns: what remains TBD
"""


def assemble(role: str, mode: str, task_contract: dict, packed_context: str) -> list[dict]:
    """
    Assemble a compiled prompt pack (message list) for model consumption.

    Args:
        role: The agent role (e.g., "CLAW", "project_executor")
        mode: The task mode (e.g., "knowledge_mode", "project_mode")
        task_contract: The structured task contract dict
        packed_context: Pre-packed context string from ContextPacker

    Returns:
        list[dict]: OpenAI-compatible message list
    """
    constraints_summary = get_constraint_summary()
    system_msg = _build_system_prompt(role, mode, constraints_summary)
    user_msg = _build_task_message(task_contract, packed_context)

    return [
        {"role": "system", "content": system_msg},
        {"role": "user", "content": user_msg},
    ]
