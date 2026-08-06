import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/react/shallow';
import type { SynthState } from '@/engine/types';

export interface ThinkingStep {
  tool: string;
  args: string;
}

export interface Mutation {
  path: string;
  value: unknown;
  /** Target track index (0-based); undefined = active track. */
  track?: number;
}

export interface PlayCommand {
  notes: number[];
  velocity: number;
  duration: number;
  mode?: 'chord' | 'sequence';
  interval?: number;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: ThinkingStep[];
  mutations?: Mutation[];
  playCommands?: PlayCommand[];
  streaming?: boolean;
  /** Set when the user aborted this turn mid-generation. */
  cancelled?: boolean;
  /** Accumulated token usage reported by the provider. */
  usage?: { prompt: number; completion: number };
  /** Plan card proposed by the agent (propose_plan tool). */
  plan?: { title: string; steps: string[] };
  planStatus?: 'pending' | 'confirmed' | 'cancelled';
  /** Wall-clock duration of this turn (ms), set on completion. */
  turnMs?: number;
  timestamp: number;
}

export interface ConversationSession {
  id: string;
  title: string;
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
}

interface AgentState {
  sessions: Record<string, ConversationSession>;
  sessionOrder: string[]; // newest first
  activeSessionId: string;
  isLoading: boolean;
  provider: string;
  availableProviders: { id: string; name: string; model: string }[];
  panelOpen: boolean;
  historyDrawerOpen: boolean;
  /** Plan mode: the agent must propose a plan and wait for confirmation. */
  planMode: boolean;
  /** Durable user taste memory (update_preferences tool), persisted. */
  preferences: Record<string, string>;
}

export interface AnalyzeRequest {
  request_id: string;
  notes?: number[];
  duration?: number;
}

export interface SequencerPatternPayload {
  steps: number;
  notes: { note: number; start: number; duration: number; velocity: number }[];
  name?: string;
  /** Target track index (0-based); undefined = active track. */
  track?: number;
}

export interface ExportAudioPayload {
  bars?: number;
  duration?: number;
  notes?: number[];
}

export interface TrackMixerPayload {
  track?: number;
  volume?: number;
  pan?: number;
  mute?: boolean;
  solo?: boolean;
}

interface StreamCallbacks {
  onMutation?: (m: Mutation) => void;
  onPlay?: (p: PlayCommand) => void;
  onSavePreset?: (p: { name: string; tags: string[] }) => void;
  onUndo?: () => void;
  onSnapshot?: () => void;
  onRestoreSnapshot?: () => void;
  /** Play + analyze audio, returning features to relay to the agent. */
  onAnalyze?: (req: AnalyzeRequest) => Promise<unknown>;
  onSequencerPattern?: (p: SequencerPatternPayload) => void;
  onSequencerControl?: (action: 'start' | 'stop', track?: number) => void;
  onExportAudio?: (p: ExportAudioPayload) => void;
  onCreateTrack?: (name?: string) => void;
  onSelectTrack?: (track: number) => void;
  onTrackMixer?: (p: TrackMixerPayload) => void;
}

interface AgentActions {
  // session management
  createSession: (title?: string) => string;
  switchSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  deleteSession: (id: string) => void;
  clearAllSessions: () => void;
  clearActiveSession: () => void;

  // streaming
  streamMessage: (
    message: string,
    synthState: SynthState,
    callbacks?: StreamCallbacks,
  ) => Promise<void>;
  /** Abort the currently streaming turn (protocol v2). */
  cancelStream: () => void;

  // settings / UI
  setProvider: (provider: string) => void;
  togglePanel: () => void;
  toggleHistoryDrawer: () => void;
  togglePlanMode: () => void;
  /** Resolve a plan card (confirm/cancel) on a given assistant message. */
  setPlanStatus: (messageId: string, status: 'confirmed' | 'cancelled') => void;
  fetchProviders: () => Promise<void>;
}

const AGENT_BASE = '/agent-api';
const HISTORY_LIMIT = 50;

function buildWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${AGENT_BASE}/api/agent/ws`;
}

// ── Persistent WebSocket layer ──────────────────────────────────────────
// One long-lived connection per tab (protocol v2). At most one turn is
// active at a time; its events are dispatched to `activeTurn`. The socket
// reconnects with capped backoff and pings to survive proxy idle timeouts.

const PING_INTERVAL_MS = 25_000;
const TURN_WATCHDOG_MS = 120_000;
const MAX_RECONNECT_DELAY_MS = 10_000;

interface ActiveTurn {
  onEvent: (evt: Record<string, unknown>) => void;
  onDisconnect: () => void;
}

let socket: WebSocket | null = null;
let activeTurn: ActiveTurn | null = null;
let sendQueue: string[] = [];
let pingTimer: number | undefined;
let reconnectTimer: number | undefined;
let reconnectDelay = 1000;

function scheduleReconnect(): void {
  if (reconnectTimer !== undefined) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    ensureSocket();
  }, reconnectDelay);
}

function ensureSocket(): void {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  try {
    socket = new WebSocket(buildWsUrl());
  } catch {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    reconnectDelay = 1000;
    const queued = sendQueue;
    sendQueue = [];
    for (const payload of queued) socket?.send(payload);
    pingTimer = window.setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, PING_INTERVAL_MS);
  };

  socket.onmessage = (ev) => {
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    activeTurn?.onEvent(evt);
  };

  socket.onclose = () => {
    if (pingTimer !== undefined) {
      window.clearInterval(pingTimer);
      pingTimer = undefined;
    }
    socket = null;
    // A dead socket kills any in-flight turn server-side; drop queued
    // payloads so a stale chat doesn't replay after reconnect.
    sendQueue = [];
    activeTurn?.onDisconnect();
    scheduleReconnect();
  };

  socket.onerror = () => {
    // Browsers fire onclose right after — teardown happens there.
  };
}

function sendPayload(payload: Record<string, unknown>): void {
  const data = JSON.stringify(payload);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(data);
  } else if (sendQueue.length < 10) {
    sendQueue.push(data);
  }
}

function newSession(title = 'New Chat'): ConversationSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function ensureBootstrap(state: AgentState): AgentState {
  if (Object.keys(state.sessions).length > 0 && state.sessions[state.activeSessionId]) {
    return state;
  }
  const s = newSession();
  return {
    ...state,
    sessions: { [s.id]: s },
    sessionOrder: [s.id],
    activeSessionId: s.id,
  };
}

const initialBootstrap = (() => {
  const s = newSession();
  return {
    sessions: { [s.id]: s } as Record<string, ConversationSession>,
    sessionOrder: [s.id],
    activeSessionId: s.id,
  };
})();

export const useAgentStore = create<AgentState & AgentActions>()(
  persist(
    immer((set, get) => ({
      sessions: initialBootstrap.sessions,
      sessionOrder: initialBootstrap.sessionOrder,
      activeSessionId: initialBootstrap.activeSessionId,
      isLoading: false,
      // Empty until fetchProviders() resolves; the server default wins so
      // frontend/backend never disagree about which LLM to use.
      provider: '',
      availableProviders: [],
      panelOpen: false,
      historyDrawerOpen: false,
      planMode: false,
      preferences: {},

      togglePanel: () => set((s) => { s.panelOpen = !s.panelOpen; }),
      toggleHistoryDrawer: () => set((s) => { s.historyDrawerOpen = !s.historyDrawerOpen; }),

      togglePlanMode: () => set((s) => { s.planMode = !s.planMode; }),

      setPlanStatus: (messageId, status) => {
        set((s) => {
          const sess = s.sessions[s.activeSessionId];
          const msg = sess?.messages.find((m) => m.id === messageId);
          if (msg && msg.planStatus === 'pending') msg.planStatus = status;
        });
      },
      setProvider: (provider) => set((s) => { s.provider = provider; }),

      createSession: (title) => {
        const session = newSession(title ?? 'New Chat');
        set((s) => {
          s.sessions[session.id] = session;
          s.sessionOrder.unshift(session.id);
          s.activeSessionId = session.id;
        });
        return session.id;
      },

      switchSession: (id) => {
        set((s) => {
          if (s.sessions[id]) s.activeSessionId = id;
        });
      },

      renameSession: (id, title) => {
        set((s) => {
          const sess = s.sessions[id];
          if (sess) {
            sess.title = title || 'Untitled';
            sess.updatedAt = Date.now();
          }
        });
      },

      deleteSession: (id) => {
        set((s) => {
          if (!s.sessions[id]) return;
          delete s.sessions[id];
          s.sessionOrder = s.sessionOrder.filter((x) => x !== id);
          if (s.activeSessionId === id) {
            if (s.sessionOrder.length === 0) {
              const ns = newSession();
              s.sessions[ns.id] = ns;
              s.sessionOrder.push(ns.id);
              s.activeSessionId = ns.id;
            } else {
              s.activeSessionId = s.sessionOrder[0];
            }
          }
        });
      },

      clearAllSessions: () => {
        set((s) => {
          const ns = newSession();
          s.sessions = { [ns.id]: ns };
          s.sessionOrder = [ns.id];
          s.activeSessionId = ns.id;
        });
      },

      clearActiveSession: () => {
        set((s) => {
          const sess = s.sessions[s.activeSessionId];
          if (sess) {
            sess.messages = [];
            sess.updatedAt = Date.now();
          }
        });
      },

      fetchProviders: async () => {
        try {
          const res = await fetch(`${AGENT_BASE}/api/agent/providers`);
          if (res.ok) {
            const data = await res.json();
            set((s) => {
              s.availableProviders = data.providers;
              // Adopt the server default when unset, or when the persisted
              // provider no longer exists server-side (stale localStorage).
              const stillValid = data.providers.some(
                (p: { id: string }) => p.id === s.provider,
              );
              if (!stillValid) {
                s.provider = data.default ?? data.providers[0]?.id ?? '';
              }
            });
          }
        } catch {
          // Agent server not running
        }
      },

      streamMessage: async (message, synthState, callbacks) => {
        // Snapshot history BEFORE pushing the new user message
        const stateNow = get();
        const activeId = stateNow.activeSessionId;
        const activeSess = stateNow.sessions[activeId];
        if (!activeSess) return;

        const history = activeSess.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .filter((m) => m.content && m.content.length > 0)
          .slice(-HISTORY_LIMIT)
          .map((m) => {
            // Annotate assistant turns with the actions taken — gives the
            // model (and the server-side history compactor) visibility into
            // what was DONE, not just what was said.
            if (m.role === 'assistant' && m.mutations?.length) {
              const paths = m.mutations.map((mut) => mut.path);
              const brief = paths.slice(0, 8).join(', ') + (paths.length > 8 ? ' …' : '');
              return { role: m.role, content: `${m.content}\n[Actions: ${brief}]` };
            }
            return { role: m.role, content: m.content };
          });

        const userId = crypto.randomUUID();
        const assistantId = crypto.randomUUID();
        const turnStart = Date.now();

        set((s) => {
          const sess = s.sessions[activeId];
          if (!sess) return;
          sess.messages.push({
            id: userId,
            role: 'user',
            content: message,
            timestamp: Date.now(),
          });
          sess.messages.push({
            id: assistantId,
            role: 'assistant',
            content: '',
            thinking: [],
            mutations: [],
            playCommands: [],
            streaming: true,
            timestamp: Date.now(),
          });
          sess.updatedAt = Date.now();
          // Auto-title from first user message
          if (sess.title === 'New Chat' || sess.title === 'Untitled') {
            sess.title = message.slice(0, 30) + (message.length > 30 ? '…' : '');
          }
          s.isLoading = true;
        });

        const updateAssistant = (fn: (m: AgentMessage) => void) => {
          set((s) => {
            const sess = s.sessions[activeId];
            if (!sess) return;
            const m = sess.messages.find((x) => x.id === assistantId);
            if (m) fn(m);
          });
        };

        return new Promise<void>((resolve) => {
          let settled = false;
          let lastEventAt = Date.now();

          const finish = () => {
            if (settled) return;
            settled = true;
            window.clearInterval(watchdog);
            activeTurn = null;
            updateAssistant((m) => { m.streaming = false; });
            set((s) => {
              s.isLoading = false;
              const sess = s.sessions[activeId];
              if (sess) sess.updatedAt = Date.now();
            });
            resolve();
          };

          // If nothing arrives for too long (hung LLM call, dead proxy),
          // settle the turn so the UI never gets stuck in "生成中...".
          const watchdog = window.setInterval(() => {
            if (Date.now() - lastEventAt > TURN_WATCHDOG_MS) {
              updateAssistant((m) => {
                m.role = 'system';
                m.content = (m.content ? m.content + '\n\n' : '') + 'Agent response timed out. Please try again.';
              });
              finish();
            }
          }, 5_000);

          activeTurn = {
            onEvent: (evt) => {
              if (settled) return;
              lastEventAt = Date.now();

              switch (evt.type) {
                case 'thinking':
                  updateAssistant((m) => {
                    m.thinking!.push({ tool: String(evt.tool), args: String(evt.args) });
                  });
                  break;
                case 'mutation': {
                  const mut: Mutation = {
                    path: String(evt.path),
                    value: evt.value,
                    track: typeof evt.track === 'number' ? evt.track : undefined,
                  };
                  updateAssistant((m) => { m.mutations!.push(mut); });
                  callbacks?.onMutation?.(mut);
                  break;
                }
                case 'play': {
                  const play: PlayCommand = {
                    notes: evt.notes as number[],
                    velocity: (evt.velocity as number) ?? 100,
                    duration: (evt.duration as number) ?? 0.5,
                    mode: evt.mode === 'sequence' ? 'sequence' : 'chord',
                    interval: typeof evt.interval === 'number' ? evt.interval : undefined,
                  };
                  updateAssistant((m) => { m.playCommands!.push(play); });
                  callbacks?.onPlay?.(play);
                  break;
                }
                case 'text_delta':
                  updateAssistant((m) => { m.content += String(evt.delta ?? ''); });
                  break;
                case 'text':
                  updateAssistant((m) => { m.content = String(evt.content ?? ''); });
                  break;
                case 'usage':
                  updateAssistant((m) => {
                    const p = Number(evt.prompt_tokens) || 0;
                    const c = Number(evt.completion_tokens) || 0;
                    m.usage = {
                      prompt: (m.usage?.prompt ?? 0) + p,
                      completion: (m.usage?.completion ?? 0) + c,
                    };
                  });
                  break;
                case 'save_preset':
                  callbacks?.onSavePreset?.({
                    name: String(evt.name || 'Untitled'),
                    tags: Array.isArray(evt.tags) ? (evt.tags as string[]) : [],
                  });
                  break;
                case 'undo':
                  callbacks?.onUndo?.();
                  break;
                case 'snapshot':
                  callbacks?.onSnapshot?.();
                  break;
                case 'restore_snapshot':
                  callbacks?.onRestoreSnapshot?.();
                  break;
                case 'sequencer_pattern':
                  callbacks?.onSequencerPattern?.({
                    steps: evt.steps === 32 ? 32 : 16,
                    notes: Array.isArray(evt.notes)
                      ? (evt.notes as SequencerPatternPayload['notes'])
                      : [],
                    name: typeof evt.name === 'string' ? evt.name : undefined,
                    track: typeof evt.track === 'number' ? evt.track : undefined,
                  });
                  break;
                case 'sequencer_control':
                  callbacks?.onSequencerControl?.(
                    evt.action === 'stop' ? 'stop' : 'start',
                    typeof evt.track === 'number' ? evt.track : undefined,
                  );
                  break;
                case 'create_track':
                  callbacks?.onCreateTrack?.(
                    typeof evt.name === 'string' ? evt.name : undefined,
                  );
                  break;
                case 'select_track':
                  if (typeof evt.track === 'number') callbacks?.onSelectTrack?.(evt.track);
                  break;
                case 'track_mixer':
                  callbacks?.onTrackMixer?.({
                    track: typeof evt.track === 'number' ? evt.track : undefined,
                    volume: typeof evt.volume === 'number' ? evt.volume : undefined,
                    pan: typeof evt.pan === 'number' ? evt.pan : undefined,
                    mute: typeof evt.mute === 'boolean' ? evt.mute : undefined,
                    solo: typeof evt.solo === 'boolean' ? evt.solo : undefined,
                  });
                  break;
                case 'export_audio':
                  callbacks?.onExportAudio?.({
                    bars: typeof evt.bars === 'number' ? evt.bars : undefined,
                    duration: typeof evt.duration === 'number' ? evt.duration : undefined,
                    notes: Array.isArray(evt.notes) ? (evt.notes as number[]) : undefined,
                  });
                  break;
                case 'plan':
                  updateAssistant((m) => {
                    m.plan = {
                      title: typeof evt.title === 'string' ? evt.title : 'Plan',
                      steps: Array.isArray(evt.steps)
                        ? (evt.steps as unknown[]).map(String).slice(0, 12)
                        : [],
                    };
                    m.planStatus = 'pending';
                  });
                  break;
                case 'preferences':
                  set((s) => {
                    const patch = evt.preferences;
                    if (!patch || typeof patch !== 'object') return;
                    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
                      const key = String(k).slice(0, 40);
                      const val = String(v).slice(0, 120);
                      if (val) s.preferences[key] = val;
                      else delete s.preferences[key]; // empty value = forget
                    }
                  });
                  break;
                case 'analyze_request': {
                  // The agent asked us to be its ears: play notes, analyze,
                  // and relay the features back over the same socket.
                  const req = evt as unknown as AnalyzeRequest;
                  void (async () => {
                    try {
                      const features = (await callbacks?.onAnalyze?.(req)) ?? null;
                      sendPayload({
                        type: 'analyze_result',
                        request_id: req.request_id,
                        features,
                      });
                    } catch {
                      sendPayload({
                        type: 'analyze_result',
                        request_id: req.request_id,
                        features: null,
                      });
                    }
                  })();
                  break;
                }
                case 'error': {
                  const msg = String(evt.message || 'Unknown error');
                  updateAssistant((m) => {
                    if (!m.content) {
                      m.role = 'system';
                      m.content = `Agent error: ${msg}`;
                    } else {
                      m.content += `\n\n${msg}`;
                    }
                  });
                  finish();
                  break;
                }
                case 'cancelled':
                  updateAssistant((m) => { m.cancelled = true; });
                  finish();
                  break;
                case 'done':
                  updateAssistant((m) => { m.turnMs = Date.now() - turnStart; });
                  finish();
                  break;
                // 'pong' and unknown types are ignored
              }
            },
            onDisconnect: () => {
              if (settled) return;
              updateAssistant((m) => {
                m.role = 'system';
                m.content =
                  (m.content ? m.content + '\n\n' : '') +
                  'Connection to the agent service was lost. Please try again.';
              });
              finish();
            },
          };

          ensureSocket();
          sendPayload({
            type: 'chat',
            message,
            history,
            synthState,
            planMode: get().planMode,
            // Omit provider when unset — the backend default applies.
            ...(get().provider ? { provider: get().provider } : {}),
          });
        });
      },

      cancelStream: () => {
        if (socket && socket.readyState === WebSocket.OPEN && activeTurn) {
          socket.send(JSON.stringify({ type: 'cancel' }));
        }
      },
    })),
    {
      name: 'agent-sessions',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({
        sessions: s.sessions,
        sessionOrder: s.sessionOrder,
        activeSessionId: s.activeSessionId,
        provider: s.provider,
        planMode: s.planMode,
        preferences: s.preferences,
      }),
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as object) } as AgentState & AgentActions;
        return ensureBootstrap(merged) as AgentState & AgentActions;
      },
    },
  ),
);

// ── Selector helpers ──────────────────────────────────────────────────────

const EMPTY_MESSAGES: AgentMessage[] = [];

export const useActiveSession = (): ConversationSession | undefined =>
  useAgentStore((s) => s.sessions[s.activeSessionId]);

export const useActiveMessages = (): AgentMessage[] =>
  useAgentStore((s) => s.sessions[s.activeSessionId]?.messages ?? EMPTY_MESSAGES);

export const useOrderedSessions = (): ConversationSession[] =>
  useAgentStore(
    useShallow(
      (s) =>
        s.sessionOrder
          .map((id) => s.sessions[id])
          .filter(Boolean) as ConversationSession[],
    ),
  );

