"""Base interface and implementations for LLM providers."""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from typing import Any, AsyncIterator

from pydantic import BaseModel


class ToolCall(BaseModel):
    """A tool call requested by the LLM."""

    id: str
    name: str
    arguments: dict[str, Any]


class Message(BaseModel):
    """A conversation message."""

    role: str  # system | user | assistant | tool
    content: str | None = None
    reasoning_content: str | None = None  # DeepSeek thinking-mode chain-of-thought
    tool_calls: list[ToolCall] | None = None
    tool_call_id: str | None = None  # for tool result messages
    name: str | None = None  # tool name for tool result


class LLMResponse(BaseModel):
    """Response from an LLM provider."""

    content: str | None = None
    reasoning_content: str | None = None
    tool_calls: list[ToolCall] = []
    finish_reason: str = "stop"
    usage: dict[str, int] = {}


class LLMProvider(ABC):
    """Abstract base class for LLM providers."""

    @abstractmethod
    async def chat(
        self,
        messages: list[Message],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.7,
    ) -> LLMResponse:
        """Send a chat completion request."""
        ...

    async def chat_stream(
        self,
        messages: list[Message],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.7,
    ) -> AsyncIterator[dict[str, Any]]:
        """Send a streaming chat completion request.

        Yields events of the form:
            {"type": "text_delta", "delta": "..."}
            {"type": "reasoning_delta", "delta": "..."}
            {"type": "done", "response": LLMResponse}

        Default implementation falls back to non-streaming chat() and emits
        the full content as a single text_delta. Providers should override
        for true token streaming.
        """
        response = await self.chat(messages=messages, tools=tools, temperature=temperature)
        if response.content:
            yield {"type": "text_delta", "delta": response.content}
        yield {"type": "done", "response": response}

    @abstractmethod
    def name(self) -> str:
        """Provider name."""
        ...
