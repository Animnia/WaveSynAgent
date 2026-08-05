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
}

interface StreamCallbacks {
  onMutation?: (m: Mutation) => void;
  onPlay?: (p: PlayCommand) => void;
  onSavePreset?: (p: { name: string; tags: string[] }) => void;
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

  // settings / UI
  setProvider: (provider: string) => void;
  togglePanel: () => void;
  toggleHistoryDrawer: () => void;
  fetchProviders: () => Promise<void>;
}

const AGENT_BASE = '/agent-api';
const HISTORY_LIMIT = 50;

function buildWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${AGENT_BASE}/api/agent/ws`;
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

      togglePanel: () => set((s) => { s.panelOpen = !s.panelOpen; }),
      toggleHistoryDrawer: () => set((s) => { s.historyDrawerOpen = !s.historyDrawerOpen; }),
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
          .map((m) => ({ role: m.role, content: m.content }));

        const userId = crypto.randomUUID();
        const assistantId = crypto.randomUUID();

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
          let ws: WebSocket;
          try {
            ws = new WebSocket(buildWsUrl());
          } catch (err) {
            updateAssistant((m) => {
              m.role = 'system';
              m.content = `WebSocket 连接失败: ${err instanceof Error ? err.message : '未知错误'}`;
              m.streaming = false;
            });
            set((s) => { s.isLoading = false; });
            resolve();
            return;
          }

          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            updateAssistant((m) => { m.streaming = false; });
            set((s) => {
              s.isLoading = false;
              const sess = s.sessions[activeId];
              if (sess) sess.updatedAt = Date.now();
            });
            resolve();
          };

            ws.onopen = () => {
            ws.send(
              JSON.stringify({
                type: 'chat',
                message,
                history,
                synthState,
                // Omit provider when unset — the backend default applies.
                ...(get().provider ? { provider: get().provider } : {}),
              }),
            );
          };

          ws.onmessage = (ev) => {
            let evt: any;
            try {
              evt = JSON.parse(ev.data);
            } catch {
              return;
            }

            if (evt.type === 'thinking') {
              updateAssistant((m) => {
                m.thinking!.push({ tool: evt.tool, args: evt.args });
              });
            } else if (evt.type === 'mutation') {
              const mut: Mutation = { path: evt.path, value: evt.value };
              updateAssistant((m) => { m.mutations!.push(mut); });
              callbacks?.onMutation?.(mut);
            } else if (evt.type === 'play') {
              const play: PlayCommand = {
                notes: evt.notes,
                velocity: evt.velocity ?? 100,
                duration: evt.duration ?? 0.5,
                mode: evt.mode === 'sequence' ? 'sequence' : 'chord',
                interval: typeof evt.interval === 'number' ? evt.interval : undefined,
              };
              updateAssistant((m) => { m.playCommands!.push(play); });
              callbacks?.onPlay?.(play);
            } else if (evt.type === 'text_delta') {
              updateAssistant((m) => { m.content += evt.delta ?? ''; });
            } else if (evt.type === 'text') {
              updateAssistant((m) => { m.content = evt.content; });
            } else if (evt.type === 'save_preset') {
              callbacks?.onSavePreset?.({
                name: String(evt.name || 'Untitled'),
                tags: Array.isArray(evt.tags) ? evt.tags : [],
              });
            } else if (evt.type === 'done') {
              ws.close();
              finish();
            }
          };

          ws.onerror = () => {
            updateAssistant((m) => {
              if (!m.content) {
                m.role = 'system';
                m.content = '连接 Agent 服务失败，请确认 agent-server 已在 3002 端口运行。';
              }
            });
            finish();
          };

          ws.onclose = () => finish();
        });
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

