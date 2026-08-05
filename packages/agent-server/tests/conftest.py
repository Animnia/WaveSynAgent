"""Shared test fixtures — a scripted mock LLM provider.

The mock implements the real LLMProvider interface so the entire ReAct loop
(message building, tool execution, event streaming, cancellation) is tested
without network access or API keys.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.providers.base import LLMProvider, LLMResponse, Message, ToolCall


class MockProvider(LLMProvider):
    """Returns scripted responses in order; records every call."""

    def __init__(self, script: list[LLMResponse] | None = None, delay: float = 0):
        self.script = list(script or [])
        self.delay = delay
        self.calls: list[list[Message]] = []

    def name(self) -> str:
        return "mock"

    async def chat(
        self,
        messages: list[Message],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.7,
    ) -> LLMResponse:
        self.calls.append(messages)
        if self.delay:
            await asyncio.sleep(self.delay)
        if not self.script:
            return LLMResponse(content="(mock default)")
        return self.script.pop(0)


def tool_response(name: str, arguments: dict[str, Any], call_id: str = "call_1") -> LLMResponse:
    """An LLMResponse carrying a single tool call."""
    return LLMResponse(
        content=None,
        tool_calls=[ToolCall(id=call_id, name=name, arguments=arguments)],
        finish_reason="tool_calls",
    )


def text_response(content: str) -> LLMResponse:
    return LLMResponse(content=content, finish_reason="stop")


@pytest.fixture
def mock_provider() -> MockProvider:
    return MockProvider()


@pytest.fixture
def synth_state() -> dict[str, Any]:
    """A minimal but realistic synth state for tool execution."""
    return {
        "oscillators": [
            {
                "enabled": True,
                "type": "sawtooth",
                "volume": 0.8,
                "semitone": 0,
                "fine": 0,
                "pan": 0,
                "unison": 1,
                "unisonSpread": 10,
            }
        ],
        "filter": {"enabled": True, "type": "lowpass", "cutoff": 5000, "resonance": 0.2},
        "ampEnvelope": {"attack": 0.01, "decay": 0.3, "sustain": 0.7, "release": 0.3},
        "master": {"volume": 0.75, "bpm": 120},
        "effects": {},
        "modulation": [],
    }
