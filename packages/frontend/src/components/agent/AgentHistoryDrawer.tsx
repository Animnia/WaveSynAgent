import { useState } from 'react';
import { useAgentStore, useOrderedSessions } from '@/stores/agentStore';
import type { ConversationSession } from '@/stores/agentStore';

const DRAWER_WIDTH = 320;

export default function AgentHistoryDrawer() {
  const open = useAgentStore((s) => s.historyDrawerOpen);
  const toggle = useAgentStore((s) => s.toggleHistoryDrawer);
  const sessions = useOrderedSessions();
  const activeId = useAgentStore((s) => s.activeSessionId);
  const switchSession = useAgentStore((s) => s.switchSession);
  const renameSession = useAgentStore((s) => s.renameSession);
  const deleteSession = useAgentStore((s) => s.deleteSession);
  const createSession = useAgentStore((s) => s.createSession);
  const clearAllSessions = useAgentStore((s) => s.clearAllSessions);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={toggle}
        aria-hidden
      />
      <aside
        className="fixed top-0 right-0 h-full bg-bg-secondary border-l border-border-default flex flex-col z-50 fade-in"
        style={{ width: DRAWER_WIDTH }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <span className="text-xs font-bold tracking-[0.2em] text-text-primary">HISTORY</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => createSession()}
              className="text-[10px] px-2 py-1 text-text-muted hover:text-text-primary border border-border-default hover:border-border-active transition-colors"
              title="New conversation"
            >
              + NEW
            </button>
            <button
              onClick={toggle}
              className="text-text-muted hover:text-text-primary p-1 leading-none"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {sessions.length === 0 && (
            <div className="text-text-muted text-xs px-2 py-4 text-center">No conversations</div>
          )}
          {sessions.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              isActive={s.id === activeId}
              onClick={() => {
                switchSession(s.id);
                toggle();
              }}
              onRename={(title) => renameSession(s.id, title)}
              onDelete={() => deleteSession(s.id)}
            />
          ))}
        </div>

        <div className="border-t border-border-default p-3">
          <button
            onClick={() => {
              if (confirm('Clear ALL conversation history?')) clearAllSessions();
            }}
            className="w-full text-[10px] px-2 py-2 text-accent-red hover:bg-accent-red/10 border border-border-default hover:border-accent-red/50 transition-colors rounded"
          >
            Clear all history
          </button>
        </div>
      </aside>
    </>
  );
}

function SessionCard({
  session,
  isActive,
  onClick,
  onRename,
  onDelete,
}: {
  session: ConversationSession;
  isActive: boolean;
  onClick: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);

  const commit = () => {
    const t = draft.trim();
    if (t && t !== session.title) onRename(t);
    setEditing(false);
  };

  return (
    <div
      className={`group border rounded p-2.5 transition-colors cursor-pointer ${
        isActive
          ? 'border-border-active bg-bg-tertiary'
          : 'border-border-default bg-bg-tertiary hover:border-border-active'
      }`}
      onClick={() => !editing && onClick()}
    >
      <div className="flex items-center justify-between gap-2">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(session.title);
                setEditing(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-bg-primary border border-border-active rounded px-1.5 py-0.5 text-xs text-text-primary outline-none"
          />
        ) : (
          <div className="flex-1 min-w-0">
            <div className="text-xs text-text-primary truncate font-medium">{session.title}</div>
            <div className="text-[10px] text-text-muted mt-0.5">
              {session.messages.length} msgs · {formatTime(session.updatedAt)}
            </div>
          </div>
        )}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDraft(session.title);
              setEditing(true);
            }}
            className="text-text-muted hover:text-text-primary p-1 text-[11px]"
            title="Rename"
          >
            Edit
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete conversation "${session.title}"?`)) onDelete();
            }}
            className="text-text-muted hover:text-accent-red p-1 text-[11px]"
            title="Delete"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString();
}
