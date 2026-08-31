import { useCallback, useEffect, useRef, useState } from 'react';
import type { MemoryFact } from '@shared/types/ipc';

interface MemoryViewProps {
  /** T-22: return to the immersive home screen (used by the header back control). */
  onGoHome: () => void;
}

function SourceBadge({ source }: { source: MemoryFact['source'] }) {
  const isAuto = source === 'auto_learned';
  return (
    <span
      className={[
        'text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border',
        isAuto
          ? 'bg-secondary/15 text-secondary border-secondary/40'
          : 'bg-tertiary/15 text-tertiary border-tertiary/40',
      ].join(' ')}
    >
      {isAuto ? 'Auto-learned' : 'Added by you'}
    </span>
  );
}

/**
 * T-22 — Memory view (was the T-12 side panel). Full-height app-shell view
 * listing every memory_fact as an editable card, with inline value editing,
 * delete, and manual add — all through the bridge, refetching after each
 * mutation so the list always mirrors the DB.
 */
export function MemoryView({ onGoHome }: MemoryViewProps) {
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [busy, setBusy] = useState(false);

  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const editInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await window.kyclius?.getMemory();
      setFacts([...(rows ?? [])].sort((a, b) => a.key.localeCompare(b.key)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  const runMutation = useCallback(
    async (action: () => Promise<{ success: boolean; error?: string }>) => {
      setBusy(true);
      try {
        const result = await action();
        if (!result.success && result.error) {
          setError(result.error);
          return false;
        }
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const handleSaveEdit = useCallback(
    (fact: MemoryFact) => {
      const trimmed = draftValue.trim();
      if (!trimmed || trimmed === fact.value) {
        setEditingId(null);
        return;
      }
      void runMutation(() => window.kyclius.setMemoryFact(fact.key, trimmed)).then(ok => {
        if (ok) setEditingId(null);
      });
    },
    [draftValue, runMutation]
  );

  const handleDelete = useCallback(
    (fact: MemoryFact) => {
      void runMutation(() => window.kyclius.deleteMemoryFact(fact.id));
    },
    [runMutation]
  );

  const handleAdd = useCallback(() => {
    const key = newKey.trim();
    const value = newValue.trim();
    if (!key || !value) return;
    void runMutation(() => window.kyclius.setMemoryFact(key, value)).then(ok => {
      if (ok) {
        setNewKey('');
        setNewValue('');
        setShowAddForm(false);
      }
    });
  }, [newKey, newValue, runMutation]);

  return (
    <section
      aria-label="What Kyclius remembers"
      className="h-full flex flex-col bg-surface/60 backdrop-blur-[20px] border border-outline-variant/10 rounded-card shadow-glass"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10 flex-none">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onGoHome}
            aria-label="Back to home"
            title="Back to home"
            className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-on-surface-variant hover:text-primary hover:bg-surface-highest/30 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h2 className="font-heading text-lg text-on-surface leading-tight">Memory</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Everything is stored locally on this device.</p>
          </div>
        </div>
      </div>

      {/* Fact cards */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {error && (
          <p className="text-xs text-error bg-error/5 border border-error/20 rounded-lg px-3 py-2" role="alert">
            {error}
          </p>
        )}

        {!loadedOnce && !error && (
          <p className="text-sm text-on-surface-variant px-1" role="status">Loading…</p>
        )}

        {loadedOnce && facts.length === 0 && !error && (
          <p className="text-sm text-on-surface-variant px-1">
            Kyclius doesn't remember anything yet. Tell it something like
            "remember that my default editor is VS Code", or add a fact below.
          </p>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {facts.map(fact => (
            <article
              key={fact.id}
              className="rounded-xl border border-outline-variant/10 bg-surface/50 backdrop-blur-[20px] shadow-glass-card px-4 py-3 group transition-colors hover:border-secondary/50"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-on-surface-variant break-all">
                  {fact.key}
                </span>
                <SourceBadge source={fact.source} />
              </div>

              {editingId === fact.id ? (
                <div className="mt-1 flex flex-col gap-2">
                  <input
                    ref={editInputRef}
                    type="text"
                    value={draftValue}
                    disabled={busy}
                    onChange={e => setDraftValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveEdit(fact);
                    }}
                    aria-label={`Edit value for ${fact.key}`}
                    className="block w-full rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2 font-mono text-[13px] text-on-surface leading-relaxed focus:outline-none focus:ring-2 focus:ring-secondary/40 focus:border-secondary"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      disabled={busy}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:border-outline-variant transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(fact)}
                      disabled={busy || draftValue.trim().length === 0}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-on-primary-container bg-primary-container hover:brightness-110 transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-end justify-between gap-2">
                  <p className="font-mono text-[13px] text-on-surface leading-relaxed break-words min-w-0">
                    {fact.value}
                  </p>
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(fact.id);
                        setDraftValue(fact.value);
                        setError(null);
                      }}
                      aria-label={`Edit ${fact.key}`}
                      title="Edit"
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-highest/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(fact)}
                      disabled={busy}
                      aria-label={`Forget ${fact.key}`}
                      title="Delete"
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors cursor-pointer disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>

      {/* Add-new form */}
      <div className="border-t border-outline-variant/10 bg-surface-container/40 px-6 py-4 flex-none">
        {showAddForm ? (
          <div className="space-y-2">
            <input
              type="text"
              value={newKey}
              disabled={busy}
              onChange={e => setNewKey(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAdd();
              }}
              placeholder="Topic — e.g. default editor"
              aria-label="New fact topic"
              maxLength={80}
              className="block w-full rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2 text-[13px] text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary/40 focus:border-secondary"
            />
            <input
              type="text"
              value={newValue}
              disabled={busy}
              onChange={e => setNewValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAdd();
              }}
              placeholder="What Kyclius should remember"
              aria-label="New fact value"
              maxLength={250}
              className="block w-full rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2 font-mono text-[13px] text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary/40 focus:border-secondary"
            />
            <div className="flex items-center justify-end gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setNewKey('');
                  setNewValue('');
                }}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:border-outline-variant transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={busy || newKey.trim().length === 0 || newValue.trim().length === 0}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-on-primary-container bg-primary-container hover:brightness-110 transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
              >
                Add fact
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            disabled={busy}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-on-surface-variant hover:text-on-surface border border-dashed border-outline-variant/40 hover:border-outline-variant transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep w-full justify-center"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Remember something new
          </button>
        )}
      </div>
    </section>
  );
}

export default MemoryView;