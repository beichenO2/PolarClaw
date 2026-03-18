"""
Router Types — canonical data structures for Router baseline v0.1.

All field names are authoritative per SSOT/interfaces.md.
TBD values must be used when content cannot be safely determined.
"""
from dataclasses import dataclass, field
from typing import Optional


# ─── WorkItem ─────────────────────────────────────────────────────────────────

@dataclass
class WorkItem:
    work_item_id: str
    task_id: str
    title: str
    goal: str
    constraints: list
    context: dict
    editable_whitelist: list
    acceptance_criteria: list
    recommended_mode: str         # knowledge_mode | project_mode
    priority: str                 # high | medium | low
    status: str                   # pending | assigned | running | done | failed | blocked
    isolation_required: bool
    dependency_ids: list
    conflict_ids: list
    created_at: str

    def to_dict(self) -> dict:
        return {
            "work_item_id": self.work_item_id,
            "task_id": self.task_id,
            "title": self.title,
            "goal": self.goal,
            "constraints": self.constraints,
            "context": self.context,
            "editable_whitelist": self.editable_whitelist,
            "acceptance_criteria": self.acceptance_criteria,
            "recommended_mode": self.recommended_mode,
            "priority": self.priority,
            "status": self.status,
            "isolation_required": self.isolation_required,
            "dependency_ids": self.dependency_ids,
            "conflict_ids": self.conflict_ids,
            "created_at": self.created_at,
        }


# ─── RouteGroup ───────────────────────────────────────────────────────────────

@dataclass
class RouteGroup:
    route_group_id: str
    task_id: str
    work_item_ids: list
    mode: str                     # knowledge_mode | project_mode
    bot_name: Optional[str]
    fsm_name: Optional[str]
    priority: str
    status: str                   # pending | running | done | failed | blocked
    editable_whitelist: list
    blocking_reason: Optional[str]
    wait_gate_event: Optional[str]
    human_confirmation_required: bool
    created_at: str

    def to_dict(self) -> dict:
        return {
            "route_group_id": self.route_group_id,
            "task_id": self.task_id,
            "work_item_ids": self.work_item_ids,
            "mode": self.mode,
            "bot_name": self.bot_name,
            "fsm_name": self.fsm_name,
            "priority": self.priority,
            "status": self.status,
            "editable_whitelist": self.editable_whitelist,
            "blocking_reason": self.blocking_reason,
            "wait_gate_event": self.wait_gate_event,
            "human_confirmation_required": self.human_confirmation_required,
            "created_at": self.created_at,
        }


# ─── RouterDecision ───────────────────────────────────────────────────────────

@dataclass
class RouterDecision:
    task_id: str
    work_items: list          # list[WorkItem.to_dict()]
    route_groups: list        # list[RouteGroup.to_dict()]
    warnings: list
    required_confirmations: list
    dispatch_ready: bool
    blocked_task_state: Optional[str]
    interface_change_proposal: Optional[str]
    created_at: str

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "work_items": self.work_items,
            "route_groups": self.route_groups,
            "warnings": self.warnings,
            "required_confirmations": self.required_confirmations,
            "dispatch_ready": self.dispatch_ready,
            "blocked_task_state": self.blocked_task_state,
            "interface_change_proposal": self.interface_change_proposal,
            "created_at": self.created_at,
        }


# ─── RouterReviewResult ───────────────────────────────────────────────────────

@dataclass
class RouterReviewResult:
    task_id: str
    status: str               # accepted | accepted_with_warnings | rejected | needs_revision
    decomposition_summary: str
    conflict_summary: Optional[str]
    route_group_summary: str
    warnings: list
    created_at: str

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "status": self.status,
            "decomposition_summary": self.decomposition_summary,
            "conflict_summary": self.conflict_summary,
            "route_group_summary": self.route_group_summary,
            "warnings": self.warnings,
            "created_at": self.created_at,
        }


# ─── RouteGroupRuntime ────────────────────────────────────────────────────────

@dataclass
class RouteGroupRuntime:
    route_group_id: str
    task_id: str
    status: str               # pending | running | done | failed | blocked
    current_stage: str
    run_ids: list
    waiting_for: Optional[str]
    blocking_reason: Optional[str]
    wait_gate_event: Optional[str]
    human_confirmation_required: bool
    updated_at: str

    def to_dict(self) -> dict:
        return {
            "route_group_id": self.route_group_id,
            "task_id": self.task_id,
            "status": self.status,
            "current_stage": self.current_stage,
            "run_ids": self.run_ids,
            "waiting_for": self.waiting_for,
            "blocking_reason": self.blocking_reason,
            "wait_gate_event": self.wait_gate_event,
            "human_confirmation_required": self.human_confirmation_required,
            "updated_at": self.updated_at,
        }


# ─── RouteGroupResult ────────────────────────────────────────────────────────

@dataclass
class RouteGroupResult:
    route_group_id: str
    task_id: str
    status: str               # done | failed | partial | blocked
    summary: str
    result_ref: Optional[str]
    validation_report_refs: list
    warnings: list
    created_at: str

    def to_dict(self) -> dict:
        return {
            "route_group_id": self.route_group_id,
            "task_id": self.task_id,
            "status": self.status,
            "summary": self.summary,
            "result_ref": self.result_ref,
            "validation_report_refs": self.validation_report_refs,
            "warnings": self.warnings,
            "created_at": self.created_at,
        }
