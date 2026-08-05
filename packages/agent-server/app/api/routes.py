"""Agent API routes — REST + WebSocket."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from ..agent.core import AgentSession
from ..providers.registry import get_provider

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/agent", tags=["agent"])

# In-memory session store (keyed by session_id)
_sessions: dict[str, AgentSession] = {}


class ChatRequest(BaseModel):
    """Chat request body."""

    session_id: str = "default"
    message: str
    provider: str | None = None
    synth_state: dict[str, Any] | None = None


class ChatResponse(BaseModel):
    """Chat response body."""

    text: str
    mutations: list[dict[str, Any]]
    play_commands: list[dict[str, Any]] = []
    thinking: list[dict[str, str]] = []


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    """Handle a chat message from the user. Returns agent response with mutations."""
    session = _get_or_create_session(req.session_id, req.provider, req.synth_state)

    # Update synth state if provided
    if req.synth_state:
        session.update_synth_state(req.synth_state)

    response = await session.chat(req.message)
    return ChatResponse(**response.to_dict())


@router.post("/reset")
async def reset_session(session_id: str = "default") -> dict:
    """Reset an agent session."""
    if session_id in _sessions:
        del _sessions[session_id]
    return {"status": "ok", "message": f"Session {session_id} reset"}


@router.get("/providers")
async def list_providers() -> dict:
    """List available LLM providers."""
    from ..config import settings
    providers = []
    if settings.openai_api_key:
        providers.append({"id": "openai", "name": "OpenAI", "model": settings.openai_model})
    if settings.anthropic_api_key:
        providers.append({"id": "anthropic", "name": "Anthropic Claude", "model": settings.anthropic_model})
    if settings.deepseek_api_key:
        providers.append({"id": "deepseek", "name": "DeepSeek", "model": settings.deepseek_model})
    if settings.dashscope_api_key:
        providers.append({"id": "dashscope", "name": "阿里百炼", "model": settings.dashscope_model})
    return {"providers": providers, "default": settings.default_provider}


# ─── WebSocket endpoint for real-time agent interaction ───

@router.websocket("/ws")
async def agent_websocket(ws: WebSocket):
    """Persistent WebSocket endpoint for streaming agent interaction.

    The frontend manages all conversation history and sends the full history
    plus the new user message on every chat turn. The backend stores no
    per-connection session state beyond a transient AgentSession used to
    execute tools for the current turn. One connection serves many turns;
    at most one turn runs at a time per connection.

    Client → Server:
    - {"type": "chat", "message": ..., "history": [...], "synthState": {...}, "provider":? }
    - {"type": "cancel"}                    — abort the running turn
    - {"type": "ping"}

    Server → Client:
    - {"type": "text_delta", "delta": ...}
    - {"type": "thinking", "tool": ..., "args": ...}
    - {"type": "mutation", "path": ..., "value": ...}
    - {"type": "play", "notes": [...], ...}
    - {"type": "save_preset" | "undo" | "snapshot" | "restore_snapshot", ...}
    - {"type": "usage", "prompt_tokens": n, "completion_tokens": n}
    - {"type": "error", "message": ...}     — fatal for the current turn
    - {"type": "cancelled"}                  — confirms a cancel request
    - {"type": "done"}
    """
    await ws.accept()

    current_task: asyncio.Task | None = None

    async def run_turn(msg: dict[str, Any]) -> None:
        try:
            provider = get_provider(msg.get("provider"))
        except Exception as e:
            await ws.send_json({"type": "error", "message": f"Provider error: {e}"})
            return

        session = AgentSession(
            provider=provider,
            synth_state=msg.get("synthState", {}),
        )
        try:
            async for event in session.chat_stream(msg["message"], history=msg.get("history", [])):
                await ws.send_json(event)
        except asyncio.CancelledError:
            # Client aborted the turn — confirm so it can settle its UI.
            try:
                await ws.send_json({"type": "cancelled"})
            except Exception:
                pass
            raise
        except Exception as e:
            logger.exception("Agent turn failed")
            try:
                await ws.send_json({"type": "error", "message": f"{type(e).__name__}: {e}"[:500]})
            except Exception:
                pass

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "message": "Invalid JSON"})
                continue

            mtype = msg.get("type")
            if mtype == "chat":
                if current_task and not current_task.done():
                    await ws.send_json({
                        "type": "error",
                        "code": "busy",
                        "message": "Agent is busy — cancel the current turn or wait for it to finish.",
                    })
                    continue
                current_task = asyncio.create_task(run_turn(msg))

            elif mtype == "cancel":
                if current_task and not current_task.done():
                    current_task.cancel()

            elif mtype == "ping":
                await ws.send_json({"type": "pong"})

    except WebSocketDisconnect:
        logger.info("Agent WS disconnected")
    except Exception as e:
        logger.error(f"Agent WS error: {e}")
    finally:
        if current_task and not current_task.done():
            current_task.cancel()


def _get_or_create_session(
    session_id: str,
    provider_name: str | None = None,
    synth_state: dict[str, Any] | None = None,
) -> AgentSession:
    """Get existing session or create a new one."""
    if session_id not in _sessions:
        provider = get_provider(provider_name)
        _sessions[session_id] = AgentSession(provider=provider, synth_state=synth_state)
    return _sessions[session_id]
