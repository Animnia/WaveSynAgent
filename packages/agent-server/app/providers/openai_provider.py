"""OpenAI-compatible provider (also works for DeepSeek and DashScope)."""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

from openai import AsyncOpenAI

from .base import LLMProvider, LLMResponse, Message, ToolCall


class OpenAIProvider(LLMProvider):
    """Provider for OpenAI API and compatible endpoints."""

    def __init__(self, api_key: str, model: str, base_url: str | None = None, provider_name: str = "openai"):
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        self._model = model
        self._provider_name = provider_name

    def name(self) -> str:
        return self._provider_name

    def _to_oai_messages(self, messages: list[Message]) -> list[dict[str, Any]]:
        oai_messages: list[dict[str, Any]] = []
        for msg in messages:
            m: dict[str, Any] = {"role": msg.role}
            if msg.content is not None:
                m["content"] = msg.content
            if msg.reasoning_content is not None:
                m["reasoning_content"] = msg.reasoning_content
            if msg.tool_calls:
                m["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.name,
                            "arguments": _safe_json(tc.arguments),
                        },
                    }
                    for tc in msg.tool_calls
                ]
            if msg.tool_call_id:
                m["tool_call_id"] = msg.tool_call_id
            if msg.name:
                m["name"] = msg.name
            oai_messages.append(m)
        return oai_messages

    async def chat(
        self,
        messages: list[Message],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.7,
    ) -> LLMResponse:
        kwargs: dict[str, Any] = {
            "model": self._model,
            "messages": self._to_oai_messages(messages),
            "temperature": temperature,
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"

        response = await self._client.chat.completions.create(**kwargs)
        choice = response.choices[0]

        tool_calls = []
        if choice.message.tool_calls:
            for tc in choice.message.tool_calls:
                try:
                    args = json.loads(tc.function.arguments)
                except (json.JSONDecodeError, TypeError):
                    args = {}
                tool_calls.append(
                    ToolCall(id=tc.id, name=tc.function.name, arguments=args)
                )

        return LLMResponse(
            content=choice.message.content,
            reasoning_content=getattr(choice.message, "reasoning_content", None),
            tool_calls=tool_calls,
            finish_reason=choice.finish_reason or "stop",
            usage={
                "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                "completion_tokens": response.usage.completion_tokens if response.usage else 0,
            },
        )

    async def chat_stream(
        self,
        messages: list[Message],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.7,
    ) -> AsyncIterator[dict[str, Any]]:
        kwargs: dict[str, Any] = {
            "model": self._model,
            "messages": self._to_oai_messages(messages),
            "temperature": temperature,
            "stream": True,
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"

        stream = await self._client.chat.completions.create(**kwargs)

        content_parts: list[str] = []
        reasoning_parts: list[str] = []
        # tool calls accumulator keyed by index
        tc_acc: dict[int, dict[str, str]] = {}
        finish_reason = "stop"

        async for chunk in stream:
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            delta = choice.delta

            if delta is not None:
                # Content delta
                if getattr(delta, "content", None):
                    content_parts.append(delta.content)
                    yield {"type": "text_delta", "delta": delta.content}

                # Reasoning content (DeepSeek)
                rc = getattr(delta, "reasoning_content", None)
                if rc:
                    reasoning_parts.append(rc)
                    yield {"type": "reasoning_delta", "delta": rc}

                # Tool call deltas
                if getattr(delta, "tool_calls", None):
                    for tcd in delta.tool_calls:
                        idx = tcd.index if tcd.index is not None else 0
                        slot = tc_acc.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                        if getattr(tcd, "id", None):
                            slot["id"] = tcd.id
                        fn = getattr(tcd, "function", None)
                        if fn is not None:
                            if getattr(fn, "name", None):
                                slot["name"] += fn.name
                            if getattr(fn, "arguments", None):
                                slot["arguments"] += fn.arguments

            if choice.finish_reason:
                finish_reason = choice.finish_reason

        # Build final tool calls
        tool_calls: list[ToolCall] = []
        for idx in sorted(tc_acc.keys()):
            slot = tc_acc[idx]
            if not slot["name"]:
                continue
            try:
                args = json.loads(slot["arguments"]) if slot["arguments"] else {}
            except (json.JSONDecodeError, TypeError):
                args = {}
            tool_calls.append(ToolCall(id=slot["id"] or f"call_{idx}", name=slot["name"], arguments=args))

        response = LLMResponse(
            content="".join(content_parts) or None,
            reasoning_content="".join(reasoning_parts) or None,
            tool_calls=tool_calls,
            finish_reason=finish_reason,
            usage={},
        )
        yield {"type": "done", "response": response}


def _safe_json(obj: Any) -> str:
    if isinstance(obj, str):
        return obj
    return json.dumps(obj)
