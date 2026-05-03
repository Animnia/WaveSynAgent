import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  useAgentStore,
  useActiveMessages,
  useOrderedSessions,
} from '@/stores/agentStore';
import type { AgentMessage, Mutation, PlayCommand } from '@/stores/agentStore';
import { useSynthStore } from '@/stores/synthStore';
import { usePresetStore } from '@/stores/presetStore';
import { getAudioEngine } from '@/engine/AudioEngine';
import AgentHistoryDrawer from './AgentHistoryDrawer';

const PANEL_WIDTH = 420;

export default function AgentPanel() {
  const messages = useActiveMessages();
  const sessions = useOrderedSessions();
  const activeSessionId = useAgentStore((s) => s.activeSessionId);
  const switchSession = useAgentStore((s) => s.switchSession);
  const createSession = useAgentStore((s) => s.createSession);
  const toggleHistoryDrawer = useAgentStore((s) => s.toggleHistoryDrawer);
  const clearActiveSession = useAgentStore((s) => s.clearActiveSession);
  const isLoading = useAgentStore((s) => s.isLoading);
  const panelOpen = useAgentStore((s) => s.panelOpen);
  const togglePanel = useAgentStore((s) => s.togglePanel);
  const streamMessage = useAgentStore((s) => s.streamMessage);
  const provider = useAgentStore((s) => s.provider);
  const setProvider = useAgentStore((s) => s.setProvider);
  const availableProviders = useAgentStore((s) => s.availableProviders);
  const fetchProviders = useAgentStore((s) => s.fetchProviders);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const synthState = useSynthStore((s) => s.state);
  const updateOscillator = useSynthStore((s) => s.updateOscillator);
  const updateFilter = useSynthStore((s) => s.updateFilter);
  const updateAmpEnvelope = useSynthStore((s) => s.updateAmpEnvelope);
  const updateFilterEnvelope = useSynthStore((s) => s.updateFilterEnvelope);
  const updateLFO = useSynthStore((s) => s.updateLFO);
  const updateEffects = useSynthStore((s) => s.updateEffects);
  const updateMaster = useSynthStore((s) => s.updateMaster);
  const reorderEffectChain = useSynthStore((s) => s.reorderEffectChain);
  const addModRoute = useSynthStore((s) => s.addModRoute);
  const updateModRoute = useSynthStore((s) => s.updateModRoute);
  const removeModRoute = useSynthStore((s) => s.removeModRoute);
  const noteOn = useSynthStore((s) => s.noteOn);
  const noteOff = useSynthStore((s) => s.noteOff);

  const savePreset = usePresetStore((s) => s.savePreset);
  const findPresetByName = usePresetStore((s) => s.findByName);
  const overwritePreset = usePresetStore((s) => s.overwritePreset);

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (panelOpen) fetchProviders();
  }, [panelOpen, fetchProviders]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const applyMutation = (mut: Mutation) => {
    const parts = mut.path.split('.');
    try {
      if (parts[0] === 'oscillators' && parts.length >= 3) {
        updateOscillator(parseInt(parts[1]), { [parts[2]]: mut.value });
      } else if (parts[0] === 'filter') {
        updateFilter({ [parts[1]]: mut.value });
      } else if (parts[0] === 'ampEnvelope') {
        updateAmpEnvelope({ [parts[1]]: mut.value });
      } else if (parts[0] === 'filterEnvelope') {
        updateFilterEnvelope({ [parts[1]]: mut.value });
      } else if (parts[0] === 'lfo1' || parts[0] === 'lfo2') {
        updateLFO(parts[0] === 'lfo1' ? 1 : 2, { [parts[1]]: mut.value });
      } else if (parts[0] === 'effects' && parts.length >= 3) {
        updateEffects({ [parts[1]]: { [parts[2]]: mut.value } } as any);
      } else if (parts[0] === 'master') {
        updateMaster({ [parts[1]]: mut.value });
      } else if (parts[0] === 'effectChain') {
        reorderEffectChain(mut.value as any);
      } else if (parts[0] === 'modulation') {
        if (parts[1] === 'add') {
          addModRoute(mut.value as any);
        } else if (parts[1] === 'remove') {
          removeModRoute(mut.value as string);
        } else if (parts[1] === 'update' && parts[2]) {
          updateModRoute(parts[2], mut.value as any);
        }
      }
    } catch (e) {
      console.warn('applyMutation failed:', mut, e);
    }
  };

  const handlePlay = async (cmd: PlayCommand) => {
    // Ensure audio context is unlocked first; otherwise the first noteOn
    // would be dropped while Tone.start() resolves.
    await getAudioEngine().start();

    const duration = (cmd.duration && cmd.duration > 0) ? cmd.duration : 0.5;
    const velocity = cmd.velocity ?? 100;

    if (cmd.mode === 'sequence') {
      const interval = (cmd.interval && cmd.interval > 0) ? cmd.interval : duration;
      cmd.notes.forEach((note, i) => {
        const startMs = i * interval * 1000;
        setTimeout(() => noteOn(note, velocity), startMs);
        setTimeout(() => noteOff(note), startMs + duration * 1000);
      });
    } else {
      // chord (default) — fire all notes simultaneously
      for (const note of cmd.notes) {
        noteOn(note, velocity);
        setTimeout(() => noteOff(note), duration * 1000);
      }
    }
  };

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || isLoading) return;
    setInput('');
    await streamMessage(msg, synthState, {
      onMutation: applyMutation,
      onPlay: handlePlay,
      onSavePreset: ({ name, tags }) => {
        const existing = findPresetByName(name);
        // Snapshot the *current* state at save time
        const stateNow = useSynthStore.getState().state;
        if (existing) {
          overwritePreset(existing.id, stateNow);
        } else {
          savePreset(name, stateNow, tags);
        }
      },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!panelOpen) return null;

  return (
    <aside
      className="fixed top-0 right-0 h-full bg-bg-secondary border-l border-border-default flex flex-col z-30 fade-in"
      style={{ width: PANEL_WIDTH }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-text-primary" />
          <span className="text-xs font-bold tracking-[0.2em] text-text-primary">AI AGENT</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => createSession()}
            className="text-[10px] px-2 py-1 text-text-muted hover:text-text-primary border border-border-default hover:border-border-active transition-colors"
            title="新建对话"
          >
            + NEW
          </button>
          <button
            onClick={toggleHistoryDrawer}
            className="text-[10px] px-2 py-1 text-text-muted hover:text-text-primary border border-border-default hover:border-border-active transition-colors"
            title="对话历史"
          >
            ≡ HISTORY
          </button>
          <button
            onClick={clearActiveSession}
            className="text-[10px] px-2 py-1 text-text-muted hover:text-text-primary border border-border-default hover:border-border-active transition-colors"
            title="清空当前对话"
          >
            CLEAR
          </button>
          <button
            onClick={togglePanel}
            className="text-text-muted hover:text-text-primary p-1 leading-none"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Session selector */}
      {sessions.length > 0 && (
        <div className="px-4 py-2 border-b border-border-default">
          <select
            value={activeSessionId}
            onChange={(e) => switchSession(e.target.value)}
            className="w-full bg-bg-tertiary border border-border-default px-2 py-1.5 text-xs text-text-secondary outline-none focus:border-border-active rounded"
            title={activeSession?.title}
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}{s.messages.length ? ` · ${s.messages.length}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Provider selector */}
      {availableProviders.length > 0 && (
        <div className="px-4 py-2 border-b border-border-default">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full bg-bg-tertiary border border-border-default px-2 py-1.5 text-xs text-text-secondary outline-none focus:border-border-active rounded"
          >
            {availableProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.model}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-text-muted text-xs">
            <p className="mb-3 uppercase tracking-wider text-[10px]">建议</p>
            <QuickPrompt onClick={setInput}>帮我做一个温暖的 Pad 音色</QuickPrompt>
            <QuickPrompt onClick={setInput}>当前音色太尖了，调柔和一些</QuickPrompt>
            <QuickPrompt onClick={setInput}>解释一下什么是 LFO</QuickPrompt>
            <QuickPrompt onClick={setInput}>做一个明亮的 Lead 并演奏 C 大调音阶</QuickPrompt>          </div>
        )}

        {messages.map((msg) => (
          <MessageItem key={msg.id} message={msg} />
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border-default p-3">
        <div className="flex flex-col gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你想要的音色，或问我任何问题..."
            rows={3}
            className="w-full bg-bg-tertiary border border-border-default rounded px-3 py-2 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-border-active resize-none font-sans"
          />
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-text-muted">Enter 发送 · Shift+Enter 换行</span>
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="px-4 py-1.5 bg-text-primary text-bg-tertiary text-xs font-medium hover:bg-text-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded"
            >
              {isLoading ? '生成中...' : '发送'}
            </button>
          </div>
        </div>
      </div>
      <AgentHistoryDrawer />
    </aside>
  );
}

function MessageItem({ message }: { message: AgentMessage }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isUser) {
    return (
      <div className="fade-in">
        <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">You</div>
        <div className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  if (isSystem) {
    return (
      <div className="fade-in border border-accent-red/40 bg-accent-red/5 px-3 py-2 text-xs text-accent-red">
        {message.content}
      </div>
    );
  }

  const hasThinking = message.thinking && message.thinking.length > 0;
  const hasMutations = message.mutations && message.mutations.length > 0;
  const hasPlays = message.playCommands && message.playCommands.length > 0;
  const hasContent = message.content.length > 0;

  return (
    <div className="fade-in">
      <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2">Agent</div>

      {/* Thinking / tool calls */}
      {(hasThinking || hasMutations || hasPlays) && (
        <ToolCallSection
          thinking={message.thinking}
          mutations={message.mutations}
          playCommands={message.playCommands}
          streaming={message.streaming}
        />
      )}

      {/* Markdown text */}
      {hasContent && (
        <div className="md-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          {message.streaming && <span className="streaming-caret" />}
        </div>
      )}

      {/* Streaming placeholder when no content yet */}
      {!hasContent && message.streaming && !hasThinking && (
        <div className="text-text-muted text-xs flex items-center gap-2">
          <span className="streaming-caret" />
          <span>思考中</span>
        </div>
      )}
    </div>
  );
}

function ToolCallSection({
  thinking,
  mutations,
  playCommands,
  streaming,
}: {
  thinking?: { tool: string; args: string }[];
  mutations?: Mutation[];
  playCommands?: PlayCommand[];
  streaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const thinkingCount = thinking?.length ?? 0;
  const mutationCount = mutations?.length ?? 0;
  const playCount = playCommands?.length ?? 0;

  return (
    <div className="mb-3 border border-border-default rounded bg-bg-tertiary">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-[10px] uppercase tracking-wider text-text-secondary hover:bg-bg-hover transition-colors rounded-t"
      >
        <span className="flex items-center gap-3">
          <span className="text-text-muted">{expanded ? '▾' : '▸'}</span>
          <span>Tool Calls</span>
          <span className="text-text-muted normal-case tracking-normal">
            {thinkingCount} 步 · {mutationCount} 改 · {playCount} 弹
          </span>
        </span>
        {streaming && <span className="streaming-caret" />}
      </button>

      {expanded && (
        <div className="border-t border-border-default p-3 space-y-2 bg-bg-secondary rounded-b">
          {thinking?.map((step, i) => (
            <div key={`t-${i}`} className="font-mono text-[11px] text-text-secondary break-all">
              <span className="text-text-muted">{String(i + 1).padStart(2, '0')}</span>{' '}
              <span className="text-text-primary">{step.tool}</span>
              <span className="text-text-muted">(</span>
              <span className="text-text-secondary">{step.args}</span>
              <span className="text-text-muted">)</span>
            </div>
          ))}
          {mutations && mutations.length > 0 && (
            <details className="text-[11px] text-text-secondary">
              <summary className="cursor-pointer text-text-muted uppercase tracking-wider text-[10px]">
                Mutations ({mutations.length})
              </summary>
              <div className="mt-1 font-mono space-y-0.5">
                {mutations.map((m, i) => (
                  <div key={`m-${i}`} className="break-all">
                    <span className="text-text-primary">{m.path}</span>
                    <span className="text-text-muted"> = </span>
                    <span>{JSON.stringify(m.value)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
          {playCommands && playCommands.length > 0 && (
            <details className="text-[11px] text-text-secondary">
              <summary className="cursor-pointer text-text-muted uppercase tracking-wider text-[10px]">
                Play ({playCommands.length})
              </summary>
              <div className="mt-1 font-mono space-y-0.5">
                {playCommands.map((p, i) => (
                  <div key={`p-${i}`}>
                    notes=[{p.notes.join(', ')}] vel={p.velocity} dur={p.duration}s
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function QuickPrompt({
  children,
  onClick,
}: {
  children: string;
  onClick: (msg: string) => void;
}) {
  return (
    <button
      onClick={() => onClick(children)}
      className="block w-full text-left px-3 py-2 mb-1.5 text-xs bg-bg-tertiary text-text-secondary border border-border-default rounded hover:border-border-active hover:text-text-primary transition-colors"
    >
      {children}
    </button>
  );
}
