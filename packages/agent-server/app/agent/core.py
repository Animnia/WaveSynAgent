"""Agent core — ReAct loop with tool execution."""

from __future__ import annotations

import logging
from typing import Any, AsyncIterator

from ..config import settings
from ..providers.base import LLMProvider, LLMResponse, Message
from ..tools.synth_tools import SYNTH_TOOLS, AnalysisChannel, execute_tool_async

PLAN_MODE_SECTION = """
## ⚠️ 计划模式已开启
用户开启了计划模式。对于任何需要修改参数/音轨的请求，你**必须先调用 propose_plan** 提交分步计划，然后**停下来等待用户确认**（用户会回复「确认执行」或「取消」）。确认后才按计划逐步执行；取消则提出替代方案或结束。纯问答/讲解类请求不需要计划。
"""

# ── History compaction (deterministic, no extra LLM call) ──
# When the conversation grows long, the oldest messages are folded into a
# plain-text digest. The frontend annotates assistant turns with an
# `[执行的操作: ...]` line, so the digest retains what was DONE, not just
# what was said.
COMPACT_KEEP_RECENT = 24  # messages kept verbatim at the tail
COMPACT_MIN_OLD = 8  # don't bother compacting fewer old messages than this
COMPACT_MAX_CHARS = 2000


def _compact_history(messages: list[Message]) -> list[Message]:
    """Fold the oldest history messages into a deterministic text digest."""
    if len(messages) <= COMPACT_KEEP_RECENT + COMPACT_MIN_OLD:
        return messages
    old, recent = messages[:-COMPACT_KEEP_RECENT], messages[-COMPACT_KEEP_RECENT:]

    lines: list[str] = []
    for m in old:
        text = (m.content or "").split("\n\n[当前合成器状态]")[0].strip()
        if not text:
            continue
        text = " ".join(text.split())  # collapse whitespace/newlines
        label = "用户" if m.role == "user" else "助手"
        lines.append(f"{label}: {text[:140]}")
    # Cap the digest size, dropping the oldest lines first
    digest_lines: list[str] = []
    total = 0
    for line in reversed(lines):
        if total + len(line) > COMPACT_MAX_CHARS:
            break
        digest_lines.insert(0, line)
        total += len(line)

    digest = (
        f"[早前对话摘要 — 已压缩 {len(old)} 条消息]\n"
        + "\n".join(digest_lines)
        + "\n[摘要结束，以下为最近对话原文]"
    )
    return [Message(role="user", content=digest), *recent]


logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是 WaveSynAgent —— 一个专业的音乐合成器 AI 助手。你同时是专业的制作人、音色设计师和音乐教师。

## 你的能力
- 读取和修改合成器所有参数：3 个振荡器、滤波器、AMP/Filter ADSR 包络、LFO1/LFO2、9 种效果器、主控
- 管理 **效果链顺序**（reorder_effect_chain），决定信号串行处理顺序
- 管理 **调制矩阵**（set_mod_route），把 LFO 路由到目标参数
- 演示声音（play_notes 播放音符）
- 保存预设（save_preset）
- 快照与撤销：snapshot_patch 保存恢复点 / restore_snapshot 恢复 / undo_last_change 撤销最近改动
- 步进序列器：sequence_pattern 编写 16/32 步循环 pattern（走当前音色）/ sequencer_control 启停——用户能从序列器面板看到并逐步修改你写的 pattern
- **多轨制作**：create_track 新建独立音轨（最多 8 轨，各自独立音色+pattern+混音）/ select_track 切换活动轨 / set_track_mixer 调音轨电平、声像、静音、solo。set_params / sequence_pattern / sequencer_control 均可带 track_index 指定目标轨（省略=活动轨）
- WAV 导出：export_audio 把**所有可听音轨的混音**（尊重 mute/solo）离线渲染成 WAV 并自动下载
- 音频分析：analyze_audio 播放音符并分析实际输出（响度/削波/明亮度/频段分布），用于验证调音结果
- **口味记忆**：用户表达稳定偏好时（如“我喜欢暗的音色”“别用太多混响”），调用 update_preferences 记住；偏好会跨会话保留并出现在你的上下文里
- 解释合成器概念和音乐理论
- 根据用户描述创建音色（如"温暖的pad"、"尖锐的lead"、"沉重的bass"）

## 工作原则
1. **先读后改**：修改参数前先 read_synth_state 了解当前状态
2. **批量调整**：一次涉及多个参数时，优先用 set_params 一次性提交（路径如 'oscillators.0.volume'、'filter.cutoff'、'effects.reverb.mix'），减少往返；单参数或语义化操作仍可用 set_oscillator/set_filter 等专用工具
3. **解释你的思路**：告诉用户你为什么做这个调整
4. **安全优先**：不要突然把音量调到最大,避免爆音
5. **用户优先**：如果用户刚修改了某个参数,不要立即覆盖它
6. **大胆实验可回滚**：做大幅实验性改动前先 snapshot_patch；用户不满意就 restore_snapshot。单个改动需要回退时用 undo_last_change
7. **用耳朵验证**：完成一轮调参后用 analyze_audio 验证实际输出——目标是温暖就确认 centroid 偏低（<800Hz）、目标明亮就确认偏高（>2.5kHz）；响度目标 RMS 约 -20~-10 dBFS，出现削波立即降音量。不满意就继续调整再分析，形成闭环
8. **播放演示**：调完参数后用 play_notes 让用户听效果
   - 多个音同时演奏（和弦）→ mode='chord'（默认）
   - 多个音依次演奏（旋律/琶音）→ mode='sequence', 配合 interval 控制节奏
   - duration 通常 0.5-1.5s, interval 0.2-0.5s

## 多轨工作流
- 状态里的 tracks 数组列出所有轨道（index/name/active/playing/音量声像/pattern 音符数）；当前活动轨的完整参数在你的常规状态中
- 想叠一层声音？流程：create_track（自动切到新轨）→ set_params 设计音色 → sequence_pattern 写 pattern → sequencer_control 播放。各轨共享全局 Transport（同一 BPM 时钟，完全同步）
- 修改非活动轨用 track_index；但**音色设计类工作建议先 select_track 切过去**，让该轨状态进入你的上下文，用户界面也会跟着切换
- set_track_mixer 做平衡：如“bass 小点声”→ volume≈0.5；“只听 pad”→ solo=true
- BPM 是全局的（所有轨共用一个时钟）；master.bpm 改动影响所有轨

## 参数范围速查
- Oscillator: type ∈ {sine, triangle, sawtooth, square, custom(波表)} | wavetable ∈ {morph, formant, digital, soft}（仅 custom 生效） | wavetablePosition 0-1（波表帧间 morph） | Volume 0-1 | Semitone ±24 | Fine ±100 cents | Unison 1-8 | fmAmount 0-1（仅 OSC1 生效：OSC2→OSC1 音频级 FM，0.1-0.3 细腻咆哮，0.4+ 金属/钟声）
- Filter: type ∈ {lowpass, highpass, bandpass, notch} | cutoff 20-20000 Hz | resonance 0-1
- ADSR: Attack/Decay 0.001-5s | Sustain 0-1 | Release 0.001-10s
- LFO: rate 0.01-50 Hz | depth 0-1 | target ∈ {filterCutoff, volume, pitch, pan}
- Reverb/Delay/Chorus/Distortion: mix/size/damping/drive 0-1 | delay time 0.01-2s | feedback 0-0.95
- Compressor: threshold -60..0 dB | ratio 1-20 | attack 0.001-1s | release 0.01-1s
- EQ3: low/mid/high ±24 dB | lowFreq 50-1000 | highFreq 1000-10000 Hz
- Phaser: rate 0.1-10 Hz | depth 0-1 | baseFreq 20-2000 | octaves 1-7
- BitCrusher: bits 1-16 (低位数=更脏)
- StereoWidener: width 0-1 (0=单声道, 1=极宽)
- Master: volume 0-1 | bpm 40-300

## 调制矩阵（Mod Matrix）
- 用 set_mod_route 操作:
  - operation="add" 新增路由 (source/destination/depth/enabled)
  - operation="update" 更新已有路由 (需 id)
  - operation="remove" 删除路由 (需 id)
- source: lfo1 | lfo2 | modwheel（演奏轮，DC 偏移型源，偏移量=轮位置×depth）
- destination: filter.cutoff | filter.resonance | master.volume | effects.reverb.mix | effects.delay.feedback | effects.phaser.rate | effects.chorus.rate | voices.pitch(±100 cents) | voices.pan
- depth 是 **双极** 的 (-1..1)，正负决定调制方向

## 效果链
- 9 个效果按数组顺序串行处理: reorder_effect_chain(order=[...])
- 默认顺序: distortion → bitCrusher → compressor → eq3 → chorus → phaser → delay → reverb → stereoWidener
- 必须传入完整的 9 个 id 排列,不能省略

## 常见音色配方
- **Warm Pad**: Saw+Sine, LP filter ~2000Hz, slow attack, reverb+chorus, 可用 LFO1→filter.cutoff(depth=0.3) 增加运动
- **Pluck Lead**: Square/Saw, LP filter ~5000Hz, fast attack+decay, low sustain
- **Sub Bass**: Sine, LP filter ~500Hz, 推荐 compressor 压缩, octave -1
- **Lo-Fi**: BitCrusher bits=8 + EQ3 high=-6dB
- **Wide Ambient**: 大量 reverb + StereoWidener width=0.9 + 多 OSC detune

当前合成器状态会在用户消息中提供。用中文或英文回复，取决于用户的语言。"""


class AgentSession:
    """Manages a single agent conversation session."""

    def __init__(
        self,
        provider: LLMProvider,
        synth_state: dict[str, Any] | None = None,
        channel: AnalysisChannel | None = None,
    ):
        self.provider = provider
        self.messages: list[Message] = [Message(role="system", content=SYSTEM_PROMPT)]
        self.synth_state: dict[str, Any] = synth_state or {}
        self.channel = channel
        self.total_tool_calls = 0

    @staticmethod
    def build_messages(
        history: list[dict[str, Any]] | list[Message],
        new_message: str,
        synth_state: dict[str, Any] | None = None,
        max_history: int = 50,
        plan_mode: bool = False,
    ) -> list[Message]:
        """Build a fresh message list for a stateless turn.

        - Always prepends the system prompt.
        - Truncates `history` to the last `max_history` messages (preserving order).
        - Appends the new user message with synth state context injected.
        """
        prompt = SYSTEM_PROMPT + (PLAN_MODE_SECTION if plan_mode else "")
        msgs: list[Message] = [Message(role="system", content=prompt)]

        # Normalize history -> Message instances
        normalized: list[Message] = []
        for m in history or []:
            if isinstance(m, Message):
                normalized.append(m)
                continue
            if not isinstance(m, dict):
                continue
            role = m.get("role")
            if role not in ("user", "assistant", "tool"):
                continue
            try:
                normalized.append(Message(**m))
            except Exception:
                # Best-effort: drop malformed entries
                continue

        if max_history and len(normalized) > max_history:
            normalized = normalized[-max_history:]

        normalized = _compact_history(normalized)

        msgs.extend(normalized)

        state_context = (
            f"\n\n[当前合成器状态]\n{_format_state_brief(synth_state)}"
            if synth_state
            else ""
        )
        msgs.append(Message(role="user", content=new_message + state_context))
        return msgs

    async def chat(self, user_message: str) -> AgentResponse:
        """Process a user message through the ReAct loop.

        Returns an AgentResponse with text, mutations, and play commands.
        """
        # Inject current state into user message
        state_context = f"\n\n[当前合成器状态]\n{_format_state_brief(self.synth_state)}" if self.synth_state else ""
        self.messages.append(Message(role="user", content=user_message + state_context))

        all_mutations: list[dict[str, Any]] = []
        all_play_commands: list[dict[str, Any]] = []
        text_parts: list[str] = []
        thinking_steps: list[dict[str, str]] = []

        turns = 0
        while turns < settings.max_turns:
            turns += 1

            response = await self.provider.chat(
                messages=self.messages,
                tools=SYNTH_TOOLS,
                temperature=0.7,
            )

            # If no tool calls, we're done
            if not response.tool_calls:
                if response.content:
                    text_parts.append(response.content)
                self.messages.append(Message(
                    role="assistant",
                    content=response.content,
                    reasoning_content=response.reasoning_content,
                ))
                break

            # Record assistant message with tool calls
            self.messages.append(Message(
                role="assistant",
                content=response.content,
                reasoning_content=response.reasoning_content,
                tool_calls=response.tool_calls,
            ))

            if response.content:
                text_parts.append(response.content)

            # Execute each tool call
            for tc in response.tool_calls:
                self.total_tool_calls += 1
                if self.total_tool_calls > settings.max_tool_calls_per_turn * settings.max_turns:
                    logger.warning("Agent exceeded total tool call limit")
                    break

                logger.info(f"Tool call: {tc.name}({tc.arguments})")
                thinking_steps.append({"tool": tc.name, "args": str(tc.arguments)})

                try:
                    result = await execute_tool_async(
                        tc.name, dict(tc.arguments), self.synth_state, self.channel
                    )

                    # Apply mutations to local state copy (best-effort; frontend re-applies authoritatively)
                    for mut in result.get("mutations", []):
                        # Mutations targeted at another track don't touch the
                        # local mirror (which mirrors the ACTIVE track).
                        target = mut.get("track")
                        active = self.synth_state.get("activeTrack")
                        if target is None or target == active:
                            try:
                                _apply_mutation(self.synth_state, mut["path"], mut["value"])
                            except (KeyError, IndexError, TypeError):
                                pass
                        all_mutations.append(mut)

                    if "play" in result:
                        all_play_commands.append(result["play"])

                    # Record tool result
                    self.messages.append(Message(
                        role="tool",
                        content=result["result"],
                        tool_call_id=tc.id,
                        name=tc.name,
                    ))
                except Exception as e:
                    logger.error(f"Tool execution error: {e}")
                    self.messages.append(Message(
                        role="tool",
                        content=f"Error: {str(e)}",
                        tool_call_id=tc.id,
                        name=tc.name,
                    ))

        return AgentResponse(
            text="\n".join(text_parts) if text_parts else "Done.",
            mutations=all_mutations,
            play_commands=all_play_commands,
            thinking=thinking_steps,
        )

    def update_synth_state(self, state: dict[str, Any]) -> None:
        """Update the local copy of synth state (e.g., from frontend)."""
        self.synth_state = state

    async def chat_stream(
        self,
        user_message: str,
        history: list[dict[str, Any]] | list[Message] | None = None,
        plan_mode: bool = False,
    ) -> AsyncIterator[dict[str, Any]]:
        """Streaming version of chat() — yields events as they happen.

        Stateless mode: when `history` is provided, the session's internal
        `self.messages` is ignored and a fresh message list is built from
        the supplied history + system prompt + new user message. This is the
        primary path used by the WebSocket endpoint so that the frontend can
        manage multi-session conversation history.

        Yields:
            {"type": "text_delta", "delta": "..."}      LLM content tokens
            {"type": "thinking", "tool": "...", "args": "..."}
            {"type": "mutation", "path": "...", "value": ...}
            {"type": "play", "notes": [...], "velocity": ..., "duration": ...}
            {"type": "done"}
        """
        if history is not None:
            # Stateless mode — build fresh message list per turn
            messages = self.build_messages(
                history, user_message, self.synth_state, plan_mode=plan_mode
            )
        else:
            # Legacy stateful mode (kept for REST /chat path)
            state_context = (
                f"\n\n[当前合成器状态]\n{_format_state_brief(self.synth_state)}"
                if self.synth_state
                else ""
            )
            self.messages.append(Message(role="user", content=user_message + state_context))
            messages = self.messages

        turns = 0
        while turns < settings.max_turns:
            turns += 1

            response: LLMResponse | None = None
            async for event in self.provider.chat_stream(
                messages=messages,
                tools=SYNTH_TOOLS,
                temperature=0.7,
            ):
                if event["type"] == "text_delta":
                    yield {"type": "text_delta", "delta": event["delta"]}
                elif event["type"] == "done":
                    response = event["response"]
                # ignore reasoning_delta for now

            if response is None:
                break

            # Surface token usage when the provider reports it
            if response.usage:
                usage_event = {k: v for k, v in response.usage.items() if v}
                if usage_event:
                    yield {"type": "usage", **usage_event}

            # No tool calls — final assistant turn
            if not response.tool_calls:
                messages.append(Message(
                    role="assistant",
                    content=response.content,
                    reasoning_content=response.reasoning_content,
                ))
                break

            # Tool calls present — record and execute
            messages.append(Message(
                role="assistant",
                content=response.content,
                reasoning_content=response.reasoning_content,
                tool_calls=response.tool_calls,
            ))

            for tc in response.tool_calls:
                self.total_tool_calls += 1
                if self.total_tool_calls > settings.max_tool_calls_per_turn * settings.max_turns:
                    logger.warning("Agent exceeded total tool call limit")
                    break

                logger.info(f"Tool call: {tc.name}({tc.arguments})")
                yield {"type": "thinking", "tool": tc.name, "args": str(tc.arguments)}

                try:
                    result = await execute_tool_async(
                        tc.name, dict(tc.arguments), self.synth_state, self.channel
                    )

                    for mut in result.get("mutations", []):
                        # Mutations targeted at another track don't touch the
                        # local mirror (which mirrors the ACTIVE track).
                        target = mut.get("track")
                        active = self.synth_state.get("activeTrack")
                        if target is None or target == active:
                            try:
                                _apply_mutation(self.synth_state, mut["path"], mut["value"])
                            except (KeyError, IndexError, TypeError):
                                pass
                        yield {"type": "mutation", **mut}

                    if "play" in result:
                        yield {"type": "play", **result["play"]}

                    if "save_preset" in result:
                        yield {"type": "save_preset", **result["save_preset"]}

                    # Side-effect-only commands the frontend executes
                    for cmd_key in ("undo", "snapshot", "restore_snapshot"):
                        if cmd_key in result:
                            yield {"type": cmd_key}

                    if "sequencer_pattern" in result:
                        yield {"type": "sequencer_pattern", **result["sequencer_pattern"]}

                    if "sequencer_control" in result:
                        yield {"type": "sequencer_control", **result["sequencer_control"]}

                    if "plan" in result:
                        yield {"type": "plan", **result["plan"]}

                    if "preferences" in result:
                        yield {"type": "preferences", "preferences": result["preferences"]}

                    if "create_track" in result:
                        yield {"type": "create_track", **result["create_track"]}

                    if "select_track" in result:
                        yield {"type": "select_track", "track": result["select_track"]}

                    if "track_mixer" in result:
                        yield {"type": "track_mixer", **result["track_mixer"]}

                    if "export_audio" in result:
                        yield {"type": "export_audio", **result["export_audio"]}

                    messages.append(Message(
                        role="tool",
                        content=result["result"],
                        tool_call_id=tc.id,
                        name=tc.name,
                    ))
                except Exception as e:
                    logger.error(f"Tool execution error: {e}")
                    messages.append(Message(
                        role="tool",
                        content=f"Error: {str(e)}",
                        tool_call_id=tc.id,
                        name=tc.name,
                    ))

        yield {"type": "done"}


class AgentResponse:
    """Result of an agent chat turn."""

    def __init__(
        self,
        text: str,
        mutations: list[dict[str, Any]],
        play_commands: list[dict[str, Any]],
        thinking: list[dict[str, str]],
    ):
        self.text = text
        self.mutations = mutations
        self.play_commands = play_commands
        self.thinking = thinking

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "mutations": self.mutations,
            "play_commands": self.play_commands,
            "thinking": self.thinking,
        }


def _apply_mutation(state: dict, path: str, value: Any) -> None:
    """Apply a dot-path mutation to a nested dict. e.g. 'oscillators.0.volume' -> 0.5"""
    parts = path.split(".")
    obj = state
    for part in parts[:-1]:
        if part.isdigit():
            obj = obj[int(part)]
        else:
            obj = obj.setdefault(part, {})
    last = parts[-1]
    if last.isdigit():
        obj[int(last)] = value
    else:
        obj[last] = value


def _format_state_brief(state: dict) -> str:
    """Brief state format for context injection."""
    if not state:
        return "(状态未加载)"
    from ..tools.synth_tools import _format_state
    return _format_state(state)
