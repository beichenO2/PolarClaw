"""
Model Gateway — unified model provider factory.
Usage:
    from model_gateway import get_provider
    provider = get_provider()
    response = provider.generate(messages, params)
"""
import os
import logging

from .base import ModelProvider, ModelProviderError
from .echo_provider import EchoProvider
from .qwen_provider import QwenProvider
from .ali_provider import AliCompatProvider

logger = logging.getLogger(__name__)

_provider_instance: ModelProvider | None = None


def get_provider(force_echo: bool = False) -> ModelProvider:
    """
    Returns the active model provider.
    Selection priority:
      1. EchoProvider if force_echo=True
      2. QwenProvider if Qwen_Pro_API_KEY is set
      3. EchoProvider as fallback
    """
    global _provider_instance

    if _provider_instance is not None and not force_echo:
        return _provider_instance

    if force_echo:
        _provider_instance = EchoProvider()
        return _provider_instance

    if os.environ.get("Qwen_Pro_API_KEY"):
        try:
            _provider_instance = QwenProvider()
            # Quick connectivity test skipped at init time — errors surface at generate() time
            logger.info("ModelGateway: using QwenProvider (key configured)")
            return _provider_instance
        except ModelProviderError as e:
            logger.warning(f"QwenProvider init failed: {e}, falling back to EchoProvider")
        except Exception as e:
            logger.warning(f"QwenProvider unexpected init error: {e}, falling back to EchoProvider")

    _provider_instance = EchoProvider()
    logger.info("ModelGateway: using EchoProvider (fallback)")
    return _provider_instance


def reset_provider():
    """Force re-initialization on next get_provider() call."""
    global _provider_instance
    _provider_instance = None


__all__ = ["get_provider", "reset_provider", "ModelProvider", "ModelProviderError"]
