"""
Model Gateway — provider factory for PolarClaw.

Providers
─────────
  CodingPlanProvider  (Alibaba Cloud Coding Plan, sk-sp-xxx key)
    endpoint: https://coding.dashscope.aliyuncs.com/v1
    models:   qwen3-coder-plus (default), kimi-k2.5, qwen3.5-plus, …

  MiniMaxProvider     (MiniMax API, vision + multi-model debug)
    endpoint: https://api.minimaxi.com/v1
    model:    MiniMax-M2.7

  QwenProvider        (DashScope general, fast fallback)
    endpoint: https://dashscope.aliyuncs.com/compatible-mode/v1
    model:    qwen-plus

  EchoProvider        (stub, no-key fallback)

Task-type → model assignment (benchmarked 2026-03-18)
──────────────────────────────────────────────────────
  task_type   primary model             latency  rationale
  ─────────   ─────────────────────     ───────  ──────────────────────────────────
  "coding"    CP / qwen3-coder-plus     ~1.8s    fastest, tuned for code edits
  "router"    CP / kimi-k2.5           ~2.4s    best concise JSON decomposition
  "agent"     CP / kimi-k2.5           ~2.4s    general reasoning + instructions
  "vision"    MM / MiniMax-M2.7        ~5.6s    multimodal, CoT reasoning
  "debug"     MM / MiniMax-M2.7        ~5.6s    cross-provider B-model review
  "general"   DS / qwen-plus           ~2.9s    fast clean fallback

NanoClaw design principle: env-var driven, no config sprawl, minimal branching.
"""
import os
import logging
from functools import partial
from typing import Literal

from .base import ModelProvider, ModelProviderError
from .echo_provider import EchoProvider
from .qwen_provider import QwenProvider
from .coding_plan_provider import CodingPlanProvider
from .minimax_provider import MiniMaxProvider
from .ali_provider import AliCompatProvider

logger = logging.getLogger(__name__)

TaskType = Literal["coding", "router", "agent", "vision", "debug", "general"]

# Per-task-type singleton cache
_provider_cache: dict[str, ModelProvider] = {}


def _try_build(factory, label: str) -> ModelProvider | None:
    """Try to call a provider factory (class or partial); return None on failure."""
    try:
        p = factory()
        logger.info(f"ModelGateway: {label} ready ({p.MODEL_NAME})")
        return p
    except ModelProviderError as e:
        logger.debug(f"ModelGateway: {label} unavailable — {e}")
        return None
    except Exception as e:
        logger.warning(f"ModelGateway: {label} unexpected init error — {e}")
        return None


def _resolve(candidates: list[tuple[str, object]]) -> ModelProvider:
    """
    Walk the candidate list and return the first factory that initialises.
    Falls back to EchoProvider if none succeed.
    """
    for label, factory in candidates:
        p = _try_build(factory, label)
        if p is not None:
            return p
    logger.warning("ModelGateway: all providers unavailable, using EchoProvider")
    return EchoProvider()


# ─── Priority chains per task type ────────────────────────────────────────────
# Each entry is (human_label, callable_factory).
# partial(CodingPlanProvider, "model-name") binds the model at build time.

_cp_coder   = partial(CodingPlanProvider, "qwen3-coder-plus")   # 1.8s, coding
_cp_kimi    = partial(CodingPlanProvider, "kimi-k2.5")          # 2.4s, agent/router

_CHAINS: dict[str, list[tuple[str, object]]] = {
    # Source code editing, bug fixes, code generation
    "coding": [
        ("CP/qwen3-coder-plus", _cp_coder),
        ("DS/qwen-plus",        QwenProvider),
    ],
    # CLAW Router: decompose user input into WorkItems/RouteGroups
    "router": [
        ("CP/kimi-k2.5",        _cp_kimi),
        ("CP/qwen3-coder-plus", _cp_coder),
        ("DS/qwen-plus",        QwenProvider),
    ],
    # General agent turns, bot execution
    "agent": [
        ("CP/kimi-k2.5",        _cp_kimi),
        ("CP/qwen3-coder-plus", _cp_coder),
        ("DS/qwen-plus",        QwenProvider),
    ],
    # Vision / image-in tasks
    "vision": [
        ("MM/MiniMax-M2.7",     MiniMaxProvider),
        ("DS/qwen-plus",        QwenProvider),
    ],
    # Multi-model debug: deliberately use a DIFFERENT provider than the coding model
    # so A-model bugs are caught by B-model's independent reasoning
    "debug": [
        ("MM/MiniMax-M2.7",     MiniMaxProvider),
        ("CP/kimi-k2.5",        _cp_kimi),
        ("DS/qwen-plus",        QwenProvider),
    ],
    # Fast general / report generation / summarisation
    "general": [
        ("DS/qwen-plus",        QwenProvider),
        ("CP/qwen3-coder-plus", _cp_coder),
    ],
}


def get_provider_for_task(task_type: TaskType = "agent") -> ModelProvider:
    """
    Return the appropriate provider for a given task type.
    Results are cached per task_type for the process lifetime.
    Call reset_providers() to force re-initialisation (e.g., after env change).
    """
    if task_type not in _provider_cache:
        chain = _CHAINS.get(task_type, _CHAINS["agent"])
        _provider_cache[task_type] = _resolve(chain)
    return _provider_cache[task_type]


def get_provider(force_echo: bool = False) -> ModelProvider:
    """
    Backward-compatible default provider getter.
    Returns the 'agent' task provider.
    """
    if force_echo:
        return EchoProvider()
    return get_provider_for_task("agent")


def reset_providers() -> None:
    """Force re-initialisation of all cached providers on next call."""
    global _provider_cache
    _provider_cache = {}


reset_provider = reset_providers  # legacy alias


def provider_status() -> dict:
    """
    Return availability and model assignment for all configured providers.
    Safe to expose via API — never reveals key values.
    """
    checks = {
        "coding_plan":    (CodingPlanProvider,  "Coding_Plan_API_KEY"),
        "minimax":        (MiniMaxProvider,      "Minimax_Token_Plan_API_KEY"),
        "qwen_dashscope": (QwenProvider,         "PolarClaw_DASHSCOPE_API_KEY"),
    }
    result: dict = {}
    for name, (cls, env_var) in checks.items():
        key_present = bool(os.environ.get(env_var))
        p = _try_build(cls, name) if key_present else None
        result[name] = {
            "available": p is not None,
            "key_present": key_present,
            "model": p.MODEL_NAME if p else None,
        }
    result["echo"] = {"available": True, "key_present": True, "model": "echo"}

    # Resolved assignments per task type
    task_assignments = {}
    for tt in ("coding", "router", "agent", "vision", "debug", "general"):
        p = get_provider_for_task(tt)  # type: ignore[arg-type]
        task_assignments[tt] = p.MODEL_NAME
    result["task_assignments"] = task_assignments
    result["active_agent_provider"] = get_provider_for_task("agent").MODEL_NAME
    return result


__all__ = [
    "get_provider",
    "get_provider_for_task",
    "reset_providers",
    "reset_provider",
    "provider_status",
    "TaskType",
    "ModelProvider",
    "ModelProviderError",
    "CodingPlanProvider",
    "MiniMaxProvider",
    "QwenProvider",
    "EchoProvider",
]
