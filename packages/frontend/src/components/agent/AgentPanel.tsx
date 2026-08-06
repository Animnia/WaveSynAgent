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
import { useTracksStore } from '@/stores/tracksStore';
import { getAudioEngine } from '@/engine/registry';
import { captureAudioFeatures } from '@/engine/audioAnalysis';
import { exportCurrentPatch } from '@/utils/export';
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
  const cancelStream = useAgentStore((s) => s.cancelStream);
  const provider = useAgentStore((s) => s.provider);
  const setProvider = useAgentStore((s) => s.setProvider);
  const availableProviders = useAgentStore((s) => s.availableProviders);
  const fetchProviders = useAgentStore((s) => s.fetchProviders);
  const planMode = useAgentStore((s) => s.planMode);
  const togglePlanMode = useAgentStore((s) => s.togglePlanMode);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const synthState = useSynthStore((s) => s.state);
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

  // Registry-driven dispatch routed to the target track (default: active).
  const applyMutation = (mut: Mutation) => {
    const tracks = useTracksStore.getState();
    const activeIndex = tracks.tracks.findIndex((t) => t.id === tracks.activeTrackId);
    const trackIndex = mut.track ?? Math.max(0, activeIndex);
    tracks.applyMutationToTrack(trackIndex, mut.path, mut.value);
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
    await sendToAgent(msg);
  };

  /** Resolve a plan card: mark it and relay the decision to the agent. */
  const handlePlanResponse = async (
    messageId: string,
    plan: { title: string; steps: string[] },
    confirmed: boolean,
  ) => {
    useAgentStore.getState().setPlanStatus(messageId, confirmed ? 'confirmed' : 'cancelled');
    await sendToAgent(
      confirmed
        ? `Plan confirmed: "${plan.title}". Please execute it step by step.`
        : `Plan cancelled: "${plan.title}".`,
    );
  };

  const sendToAgent = async (msg: string) => {
    // Attach track context so the agent sees the full picture: the active
    // track's state in full, plus a summary of every track.
    const tracksStore = useTracksStore.getState();
    const activeTrack = tracksStore.tracks.find(
      (t) => t.id === tracksStore.activeTrackId,
    );
    const activeIndex = tracksStore.tracks.findIndex(
      (t) => t.id === tracksStore.activeTrackId,
    );
    const statePayload = Object.assign({}, synthState, {
      sequencer: activeTrack
        ? {
            playing: activeTrack.playing,
            steps: activeTrack.pattern.steps,
            notes: activeTrack.pattern.notes,
          }
        : undefined,
      tracks: tracksStore.tracks.map((t, i) => ({
        index: i,
        name: t.name,
        active: i === activeIndex,
        playing: t.playing,
        mute: t.mixer.mute,
        solo: t.mixer.solo,
        volume: t.mixer.volume,
        pan: t.mixer.pan,
        patternNotes: t.pattern.notes.length,
      })),
      activeTrack: Math.max(0, activeIndex),
      preferences: useAgentStore.getState().preferences,
    }) as typeof synthState;
    await streamMessage(msg, statePayload, {
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
      onUndo: () => useSynthStore.getState().undo(),
      onSnapshot: () => useSynthStore.getState().takeSnapshot(),
      onRestoreSnapshot: () => {
        const ok = useSynthStore.getState().restoreSnapshot();
        if (!ok) console.warn('restore_snapshot: no snapshot has been taken yet');
      },
      onAnalyze: async (req) => {
        // Be the agent's ears: ring the requested notes through the live
        // patch and capture what actually comes out of the engine.
        await getAudioEngine().start();
        const notes =
          Array.isArray(req.notes) && req.notes.length > 0 ? req.notes : [60, 64, 67];
        const duration = Math.min(3, Math.max(0.5, Number(req.duration) || 1.5));
        handlePlay({ notes, velocity: 100, duration, mode: 'chord' });
        return captureAudioFeatures(getAudioEngine(), duration * 1000);
      },
      onSequencerPattern: (payload) => {
        const tracks = useTracksStore.getState();
        const idx = tracks.tracks.findIndex((t) => t.id === tracks.activeTrackId);
        const track = tracks.tracks[payload.track ?? Math.max(0, idx)];
        if (!track) return;
        tracks.setSeqPattern(track.id, payload);
        tracks.setSequencerPanelOpen(true); // let the user see what the agent wrote
      },
      onSequencerControl: (action, trackIndex) => {
        const tracks = useTracksStore.getState();
        const idx = tracks.tracks.findIndex((t) => t.id === tracks.activeTrackId);
        const track = tracks.tracks[trackIndex ?? Math.max(0, idx)];
        if (!track) return;
        if (action === 'start') {
          tracks.setSequencerPanelOpen(true);
          void tracks.playTrack(track.id);
        } else {
          tracks.stopTrack(track.id);
        }
      },
      onExportAudio: (payload) => {
        void exportCurrentPatch(payload);
      },
      onCreateTrack: (name) => {
        useTracksStore.getState().createTrack(name);
      },
      onSelectTrack: (trackIndex) => {
        const tracks = useTracksStore.getState();
        const track = tracks.tracks[trackIndex];
        if (track) tracks.selectTrack(track.id);
      },
      onTrackMixer: (p) => {
        const tracks = useTracksStore.getState();
        const idx = tracks.tracks.findIndex((t) => t.id === tracks.activeTrackId);
        const track = tracks.tracks[p.track ?? Math.max(0, idx)];
        if (!track) return;
        const patch: Record<string, unknown> = {};
        if (p.volume !== undefined) patch.volume = Math.min(1, Math.max(0, p.volume));
        if (p.pan !== undefined) patch.pan = Math.min(1, Math.max(-1, p.pan));
        if (p.mute !== undefined) patch.mute = p.mute;
        if (p.solo !== undefined) patch.solo = p.solo;
        tracks.setMixerParams(track.id, patch);
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
            title="New conversation"
          >
            + NEW
          </button>
          <button
            onClick={toggleHistoryDrawer}
            className="text-[10px] px-2 py-1 text-text-muted hover:text-text-primary border border-border-default hover:border-border-active transition-colors"
            title="Conversation history"
          >
            ≡ HISTORY
          </button>
          <button
            onClick={togglePlanMode}
            className={`text-[10px] px-2 py-1 border transition-colors ${
              planMode
                ? 'text-accent-orange border-accent-orange/50 bg-accent-orange/10'
                : 'text-text-muted border-border-default hover:text-text-primary hover:border-border-active'
            }`}
            title={planMode ? 'Plan mode ON: the agent proposes a plan before making changes' : 'Enable plan mode: the agent must propose a plan before making changes'}
          >
            {planMode ? 'PLAN ON' : 'PLAN'}
          </button>
          <button
            onClick={clearActiveSession}
            className="text-[10px] px-2 py-1 text-text-muted hover:text-text-primary border border-border-default hover:border-border-active transition-colors"
            title="Clear current conversation"
          >
            CLEAR
          </button>
          <button
            onClick={togglePanel}
            className="text-text-muted hover:text-text-primary p-1 leading-none"
            aria-label="Close"
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
            <p className="mb-3 uppercase tracking-wider text-[10px]">Try asking</p>
            <QuickPrompt onClick={setInput}>Make me a warm pad sound</QuickPrompt>
            <QuickPrompt onClick={setInput}>The sound is too harsh — soften it</QuickPrompt>
            <QuickPrompt onClick={setInput}>Explain what an LFO does</QuickPrompt>
            <QuickPrompt onClick={setInput}>Create a bright lead and play a C major scale</QuickPrompt>          </div>
        )}

        {messages.map((msg) => (
          <MessageItem key={msg.id} message={msg} onPlanResponse={handlePlanResponse} />
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
            placeholder="Describe the sound you want, or ask anything..."
            rows={3}
            className="w-full bg-bg-tertiary border border-border-default rounded px-3 py-2 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-border-active resize-none font-sans"
          />
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-text-muted">Enter to send · Shift+Enter for newline</span>
            {isLoading ? (
              <button
                onClick={cancelStream}
                className="px-4 py-1.5 bg-accent-red/80 text-white text-xs font-medium hover:bg-accent-red transition-colors rounded"
                title="Abort the current generation"
              >
                ■ Stop
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="px-4 py-1.5 bg-text-primary text-bg-tertiary text-xs font-medium hover:bg-text-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded"
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>
      <AgentHistoryDrawer />
    </aside>
  );
}

function MessageItem({
  message,
  onPlanResponse,
}: {
  message: AgentMessage;
  onPlanResponse?: (
    messageId: string,
    plan: { title: string; steps: string[] },
    confirmed: boolean,
  ) => void;
}) {
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
  const parts = message.parts ?? [];
  const hasParts = parts.length > 0;

  return (
    <div className="fade-in">
      <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2">Agent</div>

      {hasParts ? (
        /* Chronological timeline: reasoning → text → tool → … in stream order */
        <div>
          {parts.map((part, i) => {
            const isLast = i === parts.length - 1;
            if (part.kind === 'reasoning') {
              return (
                <ReasoningBlock
                  key={i}
                  text={part.text}
                  streaming={!!message.streaming && isLast}
                />
              );
            }
            if (part.kind === 'tool') {
              return <ToolChip key={i} tool={part.tool} args={part.args} />;
            }
            return (
              <div key={i} className="md-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
                {message.streaming && isLast && <span className="streaming-caret" />}
              </div>
            );
          })}
        </div>
      ) : (
        /* Legacy messages (persisted before the timeline model) */
        <>
          {(hasThinking || hasMutations || hasPlays) && (
            <ToolCallSection
              thinking={message.thinking}
              mutations={message.mutations}
              playCommands={message.playCommands}
              streaming={message.streaming}
            />
          )}
          {hasContent && (
            <div className="md-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              {message.streaming && <span className="streaming-caret" />}
            </div>
          )}
        </>
      )}

      {/* Autonomous goal checklist (set_goals / update_goal) */}
      {message.goals && message.goals.length > 0 && (
        <GoalsCard goals={message.goals} />
      )}

      {/* Plan card (propose_plan tool) */}
      {message.plan && (
        <PlanCard
          plan={message.plan}
          status={message.planStatus ?? 'pending'}
          disabled={!!message.streaming}
          onRespond={(confirmed) => onPlanResponse?.(message.id, message.plan!, confirmed)}
        />
      )}

      {/* Cancelled marker + token usage */}
      {message.cancelled && (
        <div className="mt-1 text-[10px] text-text-muted">■ Stopped</div>
      )}
      {(message.usage || message.turnMs !== undefined) && (
        <div className="mt-1 text-[10px] text-text-muted">
          {!!message.usage && message.usage.prompt + message.usage.completion > 0 && (
            <span>
              tokens {message.usage.prompt + message.usage.completion}
              {' '}(in {message.usage.prompt} / out {message.usage.completion})
            </span>
          )}
          {message.turnMs !== undefined && <span> · {(message.turnMs / 1000).toFixed(1)}s</span>}
        </div>
      )}

      {/* Streaming placeholder when no content yet */}
      {!hasContent && message.streaming && !hasThinking && (
        <div className="text-text-muted text-xs flex items-center gap-2">
          <span className="streaming-caret" />
          <span>Thinking</span>
        </div>
      )}
    </div>
  );
}

function GoalsCard({
  goals,
}: {
  goals: { text: string; status: 'pending' | 'in_progress' | 'done' }[];
}) {
  const done = goals.filter((g) => g.status === 'done').length;
  return (
    <div className="mt-2 border border-border-default rounded px-3 py-2 bg-bg-tertiary">
      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
        Goals · {done}/{goals.length}
      </div>
      <ul className="space-y-1">
        {goals.map((g, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span
              className={`flex-shrink-0 mt-px ${
                g.status === 'done'
                  ? 'text-text-primary'
                  : g.status === 'in_progress'
                    ? 'text-text-secondary'
                    : 'text-text-muted/50'
              }`}
            >
              {g.status === 'done' ? '●' : g.status === 'in_progress' ? '◐' : '○'}
            </span>
            <span
              className={
                g.status === 'done'
                  ? 'text-text-muted line-through'
                  : g.status === 'in_progress'
                    ? 'text-text-primary'
                    : 'text-text-secondary'
              }
            >
              {g.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReasoningBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  // Collapsed by default; expanded view streams live and follows the tail.
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [text, expanded]);

  return (
    <div className="mb-2 border border-border-default rounded bg-bg-tertiary">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-muted hover:text-text-secondary transition-colors"
      >
        <span className="flex items-center gap-2">
          <span>{expanded ? '▾' : '▸'}</span>
          <span>Thinking</span>
          {!expanded && (
            <span className="normal-case tracking-normal truncate max-w-[220px] text-text-muted/70">
              {text.slice(-80)}
            </span>
          )}
        </span>
        {streaming && <span className="streaming-caret" />}
      </button>
      {expanded && (
        <div
          ref={bodyRef}
          className="max-h-48 overflow-y-auto border-t border-border-default px-3 py-2 text-[11px] leading-relaxed text-text-muted whitespace-pre-wrap"
        >
          {text}
          {streaming && <span className="streaming-caret" />}
        </div>
      )}
    </div>
  );
}

function ToolChip({ tool, args }: { tool: string; args: string }) {
  return (
    <div className="my-1.5 flex items-center gap-2 font-mono text-[11px] min-w-0">
      <span className="px-1.5 py-0.5 rounded border border-border-default bg-bg-tertiary text-text-primary flex-shrink-0">
        {tool}
      </span>
      <span className="text-text-muted truncate" title={args}>
        {args}
      </span>
    </div>
  );
}

function PlanCard({
  plan,
  status,
  disabled,
  onRespond,
}: {
  plan: { title: string; steps: string[] };
  status: 'pending' | 'confirmed' | 'cancelled';
  disabled?: boolean;
  onRespond: (confirmed: boolean) => void;
}) {
  return (
    <div
      className={`mt-2 border rounded px-3 py-2 ${
        status === 'confirmed'
          ? 'border-accent-cyan/40 bg-accent-cyan/5'
          : status === 'cancelled'
            ? 'border-border-default bg-bg-tertiary opacity-60'
            : 'border-accent-orange/40 bg-accent-orange/5'
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
        Plan · {plan.title}
      </div>
      <ol className="text-xs text-text-secondary space-y-0.5 mb-2 list-decimal list-inside">
        {plan.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      {status === 'pending' ? (
        <div className="flex gap-2">
          <button
            onClick={() => onRespond(true)}
            disabled={disabled}
            className="px-3 py-1 text-[11px] rounded border border-accent-cyan/50 bg-accent-cyan/15 text-accent-cyan hover:bg-accent-cyan/25 transition-colors disabled:opacity-40"
          >
            Confirm & run
          </button>
          <button
            onClick={() => onRespond(false)}
            disabled={disabled}
            className="px-3 py-1 text-[11px] rounded border border-border-default text-text-muted hover:text-text-secondary transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="text-[10px] text-text-muted">
          {status === 'confirmed' ? 'Confirmed — running' : 'Cancelled'}
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
  // Collapsed by default — the header streams a live one-line status while
  // the agent works; expand for the full chronological step list.
  const [expanded, setExpanded] = useState(false);
  const thinkingCount = thinking?.length ?? 0;
  const mutationCount = mutations?.length ?? 0;
  const playCount = playCommands?.length ?? 0;
  const lastTool = thinking && thinking.length > 0 ? thinking[thinking.length - 1].tool : null;

  return (
    <div className="mb-3 border border-border-default rounded bg-bg-tertiary">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-text-secondary hover:bg-bg-hover transition-colors rounded"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-text-muted flex-shrink-0">{expanded ? '▾' : '▸'}</span>
          <span className="flex-shrink-0">Activity</span>
          <span className="text-text-muted normal-case tracking-normal flex-shrink-0">
            {thinkingCount} {thinkingCount === 1 ? 'step' : 'steps'}
            {mutationCount > 0 && ` · ${mutationCount} edited`}
            {playCount > 0 && ` · ${playCount} played`}
          </span>
          {!expanded && streaming && lastTool && (
            <span className="text-text-muted normal-case tracking-normal truncate">
              — {lastTool}
            </span>
          )}
        </span>
        {streaming && <span className="streaming-caret flex-shrink-0" />}
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
