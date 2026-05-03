"""Anthropic Claude provider."""

from __future__ import annotations

import json
from typing import Any

from anthropic import AsyncAnthropic

from .base import LLMProvider, LLMResponse, Message, ToolCall


class AnthropicProvider(LLMProvider):
    """Provider for Anthropic Claude API."""

    def __init__(self, api_key: str, model: str):
        self._client = AsyncAnthropic(api_key=api_key)
        self._model = model

    def name(self) -> str:
        return "anthropic"

    async def chat(
        self,
        messages: list[Message],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.7,
    ) -> LLMResponse:
        # Separate system message from conversation
        system_text = ""
        conversation = []

        for msg in messages:
            if msg.role == "system":
                system_text += (msg.content or "") + "\n"
            elif msg.role == "user":
                conversation.append({"role": "user", "content": msg.content or ""})
            elif msg.role == "assistant":
                content_blocks: list[dict[str, Any]] = []
                if msg.content:
                    content_blocks.append({"type": "text", "text": msg.content})
                if msg.tool_calls:
                    for tc in msg.tool_calls:
                        content_blocks.append({
                            "type": "tool_use",
                            "id": tc.id,
                            "name": tc.name,
                            "input": tc.arguments,
                        })
                conversation.append({"role": "assistant", "content": content_blocks or msg.content or ""})
            elif msg.role == "tool":
                conversation.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": msg.tool_call_id or "",
                        "content": msg.content or "",
                    }],
                })

        # Convert OpenAI tool format to Anthropic
        anthropic_tools = None
        if tools:
            anthropic_tools = []
            for t in tools:
                func = t.get("function", {})
                anthropic_tools.append({
                    "name": func.get("name", ""),
                    "description": func.get("description", ""),
                    "input_schema": func.get("parameters", {"type": "object", "properties": {}}),
                })

        kwargs: dict[str, Any] = {
            "model": self._model,
            "messages": conversation,
            "max_tokens": 4096,
            "temperature": temperature,
        }
        if system_text.strip():
            kwargs["system"] = system_text.strip()
        if anthropic_tools:
            kwargs["tools"] = anthropic_tools

        response = await self._client.messages.create(**kwargs)

        content_text = ""
        tool_calls = []

        for block in response.content:
            if block.type == "text":
                content_text += block.text
            elif block.type == "tool_use":
                tool_calls.append(
                    ToolCall(id=block.id, name=block.name, arguments=block.input if isinstance(block.input, dict) else {})
                )

        return LLMResponse(
            content=content_text or None,
            tool_calls=tool_calls,
            finish_reason="tool_use" if tool_calls else "stop",
            usage={
                "prompt_tokens": response.usage.input_tokens,
                "completion_tokens": response.usage.output_tokens,
            },
        )
