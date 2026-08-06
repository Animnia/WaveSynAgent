"""ReAct loop scenario tests — scripted LLM drives the full agent cycle.

These are the harness-level scenarios: they prove the loop streams the right
events in the right order, executes tools against state, respects turn caps,
and stays cancellable mid-flight.
"""

from __future__ import annotations

import asyncio

import pytest

from app.agent.core import AgentSession
from app.providers.base import LLMResponse
from tests.conftest import MockProvider, text_response, tool_response


async def collect(session: AgentSession, message: str, history=None):
    events = []
    async for evt in session.chat_stream(message, history=history):
        events.append(evt)
    return events


def by_type(events, t):
    return [e for e in events if e["type"] == t]


class TestStreamingLoop:
    @pytest.mark.asyncio
    async def test_plain_text_turn(self, synth_state):
        session = AgentSession(
            provider=MockProvider([text_response("你好，我是音色助手")]),
            synth_state=synth_state,
        )
        events = await collect(session, "你好", history=[])
        deltas = by_type(events, "text_delta")
        assert "".join(d["delta"] for d in deltas) == "你好，我是音色助手"
        assert events[-1]["type"] == "done"

    @pytest.mark.asyncio
    async def test_tool_call_then_answer(self, synth_state):
        """Scenario: 'make it darker' → set_params → final text."""
        provider = MockProvider(
            [
                tool_response(
                    "set_params",
                    {"params": [{"path": "filter.cutoff", "value": 800}]},
                ),
                text_response("已把滤波器降到 800Hz，音色更暗了。"),
            ]
        )
        session = AgentSession(provider=provider, synth_state=synth_state)
        events = await collect(session, "让音色暗一点", history=[])

        # thinking event → mutation event → text → done
        assert by_type(events, "thinking")[0]["tool"] == "set_params"
        muts = by_type(events, "mutation")
        assert muts == [{"type": "mutation", "path": "filter.cutoff", "value": 800}]
        assert "800Hz" in "".join(d["delta"] for d in by_type(events, "text_delta"))
        assert events[-1]["type"] == "done"

        # Server-side state copy tracks the mutation (for read_synth_state)
        assert session.synth_state["filter"]["cutoff"] == 800

    @pytest.mark.asyncio
    async def test_multi_turn_tool_sequence(self, synth_state):
        """Two LLM rounds: read state, then adjust, then answer."""
        provider = MockProvider(
            [
                tool_response("read_synth_state", {}, call_id="c1"),
                tool_response(
                    "set_params",
                    {"params": [{"path": "effects.reverb.mix", "value": 0.6}]},
                    call_id="c2",
                ),
                text_response("加了混响。"),
            ]
        )
        session = AgentSession(provider=provider, synth_state=synth_state)
        events = await collect(session, "来点空间感", history=[])

        tools = [e["tool"] for e in by_type(events, "thinking")]
        assert tools == ["read_synth_state", "set_params"]
        assert by_type(events, "mutation")[0]["path"] == "effects.reverb.mix"

        # The second LLM call must have received the first tool's result
        second_call_messages = provider.calls[1]
        tool_msgs = [m for m in second_call_messages if m.role == "tool"]
        assert any("Filter" in (m.content or "") or "OSC" in (m.content or "") for m in tool_msgs)

    @pytest.mark.asyncio
    async def test_turn_cap_terminates(self, synth_state):
        """A model that calls tools forever gets stopped by max_turns."""
        from app.config import settings

        provider = MockProvider(
            [tool_response("read_synth_state", {}) for _ in range(settings.max_turns + 5)]
        )
        session = AgentSession(provider=provider, synth_state=synth_state)
        events = await collect(session, "loop forever", history=[])
        assert events[-1]["type"] == "done"
        assert len(by_type(events, "thinking")) <= settings.max_turns

    @pytest.mark.asyncio
    async def test_analyze_roundtrip_through_loop(self, synth_state):
        """The analyze_audio tool suspends the loop until the channel answers."""

        class ScriptedChannel:
            def __init__(self):
                self.payloads = []

            async def request_analysis(self, payload):
                self.payloads.append(payload)
                await asyncio.sleep(0.01)
                return {
                    "rms_db": -18.0,
                    "peak_db": -5.0,
                    "clipping": False,
                    "spectral_centroid_hz": 700,
                    "band_db": {"sub": -22, "low_mid": -18, "presence": -26, "air": -38},
                    "silent": False,
                    "duration_ms": 1500,
                }

        channel = ScriptedChannel()
        provider = MockProvider(
            [
                tool_response("analyze_audio", {"notes": [60], "duration": 1.0}),
                text_response("分析完成：偏暗，符合温暖目标。"),
            ]
        )
        session = AgentSession(provider=provider, synth_state=synth_state, channel=channel)
        events = await collect(session, "听听现在的音色", history=[])

        assert channel.payloads == [{"notes": [60], "duration": 1.0}]
        # The LLM's second call saw the formatted analysis as a tool result
        second = provider.calls[1]
        tool_msgs = [m for m in second if m.role == "tool"]
        assert any("dark/warm" in (m.content or "") for m in tool_msgs)
        assert events[-1]["type"] == "done"

    @pytest.mark.asyncio
    async def test_cancellation_mid_stream(self, synth_state):
        """Cancelling the consumer task propagates into the LLM await."""
        provider = MockProvider([text_response("never")], delay=30)
        session = AgentSession(provider=provider, synth_state=synth_state)

        async def consume():
            async for _ in session.chat_stream("hello", history=[]):
                pass

        task = asyncio.create_task(consume())
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    @pytest.mark.asyncio
    async def test_usage_events_forwarded(self, synth_state):
        provider = MockProvider(
            [
                text_response("ok"),
            ]
        )
        # give the scripted response usage numbers
        provider.script[0].usage = {"prompt_tokens": 120, "completion_tokens": 5}
        session = AgentSession(provider=provider, synth_state=synth_state)
        events = await collect(session, "hi", history=[])
        usage = by_type(events, "usage")
        assert usage and usage[0]["prompt_tokens"] == 120


class TestPlanMode:
    @pytest.mark.asyncio
    async def test_plan_event_streams_through(self, synth_state):
        provider = MockProvider(
            [
                tool_response(
                    "propose_plan",
                    {"title": "做贝斯", "steps": ["create_track", "set_params"]},
                ),
                text_response("等待确认"),
            ]
        )
        session = AgentSession(provider=provider, synth_state=synth_state)
        events = await collect(session, "帮我做贝斯", history=[])
        plans = by_type(events, "plan")
        assert plans == [{"type": "plan", "title": "做贝斯", "steps": ["create_track", "set_params"]}]

    @pytest.mark.asyncio
    async def test_plan_mode_injects_prompt_section(self, synth_state):
        provider = MockProvider([text_response("ok")])
        session = AgentSession(provider=provider, synth_state=synth_state)
        async for _ in session.chat_stream("hi", history=[], plan_mode=True):
            pass
        system_msg = provider.calls[0][0]  # first call, first message
        assert system_msg.role == "system"
        assert "计划模式" in system_msg.content

    @pytest.mark.asyncio
    async def test_plan_mode_off_by_default(self, synth_state):
        provider = MockProvider([text_response("ok")])
        session = AgentSession(provider=provider, synth_state=synth_state)
        async for _ in session.chat_stream("hi", history=[]):
            pass
        system_msg = provider.calls[0][0]
        assert "计划模式" not in system_msg.content


class TestHistoryCompaction:
    def test_short_history_untouched(self):
        from app.agent.core import AgentSession
        from app.providers.base import Message

        hist = [{"role": "user", "content": f"消息 {i}"} for i in range(10)]
        msgs = AgentSession.build_messages(hist, "新消息")
        # system + 10 history + new user message
        assert len(msgs) == 12
        assert msgs[1].content == "消息 0"

    def test_long_history_compacted(self):
        from app.agent.core import AgentSession

        hist = [{"role": "user", "content": f"早期消息 {i}"} for i in range(30)]
        hist += [{"role": "assistant", "content": f"早期回复 {i}\n[执行的操作: set_params]"} for i in range(10)]
        hist += [{"role": "user", "content": f"最近消息 {i}"} for i in range(24)]
        msgs = AgentSession.build_messages(hist, "新消息")
        # system + digest + 24 recent + new message
        assert len(msgs) == 27
        digest = msgs[1]
        assert "早前对话摘要" in digest.content
        assert "早期消息 29" in digest.content  # newest old message survives
        assert "[执行的操作" in digest.content  # action annotations preserved
        # recent 24 verbatim
        assert msgs[2].content == "最近消息 0"
        assert msgs[25].content == "最近消息 23"
        # state context appended to the NEW message only
        assert "[当前合成器状态]" not in digest.content

    def test_digest_strips_injected_state(self):
        from app.agent.core import AgentSession

        hist = [
            {"role": "user", "content": "调暗一点\n\n[当前合成器状态]\nFilter: cutoff=800"}
        ] * 40
        msgs = AgentSession.build_messages(hist, "新消息")
        digest = msgs[1]
        assert "早前对话摘要" in digest.content
        assert "cutoff=800" not in digest.content  # state injection stripped
        assert "调暗一点" in digest.content


class TestPreferences:
    def test_update_preferences_tool(self, synth_state):
        from app.tools.synth_tools import execute_tool

        result = execute_tool(
            "update_preferences",
            {"preferences": {"brightness": "偏暗", "reverb_usage": "少量"}},
            synth_state,
        )
        assert result["preferences"] == {"brightness": "偏暗", "reverb_usage": "少量"}

    def test_update_preferences_sanitizes(self, synth_state):
        from app.tools.synth_tools import execute_tool

        result = execute_tool("update_preferences", {"preferences": {}}, synth_state)
        assert "preferences" not in result
        long_key = "k" * 100
        result = execute_tool(
            "update_preferences", {"preferences": {long_key: "v" * 200}}, synth_state
        )
        key = next(iter(result["preferences"]))
        assert len(key) == 40
        assert len(result["preferences"][key]) == 120

    def test_preferences_rendered_in_state(self, synth_state):
        from app.tools.synth_tools import _format_state

        state = {**synth_state, "preferences": {"brightness": "偏暗"}}
        assert "用户偏好: brightness=偏暗" in _format_state(state)

    @pytest.mark.asyncio
    async def test_preferences_event_streams(self, synth_state):
        provider = MockProvider(
            [
                tool_response("update_preferences", {"preferences": {"bpm": "90 左右"}}),
                text_response("记住了"),
            ]
        )
        session = AgentSession(provider=provider, synth_state=synth_state)
        events = await collect(session, "以后 BPM 都 90 左右", history=[])
        prefs = by_type(events, "preferences")
        assert prefs == [{"type": "preferences", "preferences": {"bpm": "90 左右"}}]


class TestReasoningStream:
    @pytest.mark.asyncio
    async def test_reasoning_delta_forwarded(self, synth_state):
        """Reasoning models' chain-of-thought streams through to the client."""
        provider = MockProvider(
            [LLMResponse(content="答案是 42", reasoning_content="让我想想……", finish_reason="stop")]
        )
        session = AgentSession(provider=provider, synth_state=synth_state)
        events = await collect(session, "思考", history=[])
        reasoning = by_type(events, "reasoning_delta")
        assert reasoning == [{"type": "reasoning_delta", "delta": "让我想想……"}]
        # ordering: reasoning before text
        types = [e["type"] for e in events]
        assert types.index("reasoning_delta") < types.index("text_delta")

    @pytest.mark.asyncio
    async def test_no_reasoning_no_event(self, synth_state):
        provider = MockProvider([text_response("普通回复")])
        session = AgentSession(provider=provider, synth_state=synth_state)
        events = await collect(session, "hi", history=[])
        assert by_type(events, "reasoning_delta") == []
