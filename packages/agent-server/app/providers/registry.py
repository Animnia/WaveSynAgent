"""Provider registry — create providers by name."""

from __future__ import annotations

from ..config import settings
from .base import LLMProvider
from .openai_provider import OpenAIProvider
from .anthropic_provider import AnthropicProvider


def get_provider(name: str | None = None) -> LLMProvider:
    """Get an LLM provider instance by name."""
    provider_name = name or settings.default_provider

    match provider_name:
        case "openai":
            return OpenAIProvider(
                api_key=settings.openai_api_key,
                model=settings.openai_model,
                base_url=settings.openai_base_url if settings.openai_base_url != "https://api.openai.com/v1" else None,
            )
        case "anthropic":
            return AnthropicProvider(
                api_key=settings.anthropic_api_key,
                model=settings.anthropic_model,
            )
        case "deepseek":
            return OpenAIProvider(
                api_key=settings.deepseek_api_key,
                model=settings.deepseek_model,
                base_url=settings.deepseek_base_url,
                provider_name="deepseek",
            )
        case "dashscope":
            return OpenAIProvider(
                api_key=settings.dashscope_api_key,
                model=settings.dashscope_model,
                base_url=settings.dashscope_base_url,
                provider_name="dashscope",
            )
        case _:
            raise ValueError(f"Unknown provider: {provider_name}")
