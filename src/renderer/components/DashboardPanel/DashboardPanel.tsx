import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DashboardEntry, DashboardStats } from '@shared/types/ipc';

type InputModeFilter = 'all' | 'voice' | 'text';

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "45m ago" / "02 Aug 14:32" style relative timestamps for stat cards. */
function formatRelative(iso: string | null): string {
  if (!iso) return 'No activity yet';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60_000));
  if (minutes < 60) return minutes === 0 ? 'Just now' : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface DashboardViewProps {
  /** T-22: return to the immersive home screen (used by the header back control). */
  onGoHome: () => void;
  /** T-22: nav straight from a tool summary into the Activity view. */
  onOpenActivity: () => void;
}

function StatCard({
  icon,
  iconTint,
  label,
  value,
  sub,
}: {
  icon: ReactNode;
  iconTint: string;
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="rounded-card border border-outline-variant/10 bg-surface/50 backdrop-blur-[20px] shadow-glass-card p-5 flex flex-col gap-3 transition-colors hover:border-secondary/50">
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-lg ${iconTint} flex items-center justify-center`}>
          {icon}
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-on-surface-variant mb-1">{label}</p>
        <p className="font-heading text-2xl text-on-surface leading-none">{value}</p>
        {sub && <p className="text-[11px] text-on-surface-variant/70 mt-1.5 truncate">{sub}</p>}
      </div>
    </div>
  );
}

/**
 * T-17/T-22 — Dashboard view (was the slide-in side panel). A bento grid of
 * REAL stat cards (counts from the local conversations / messages /
 * tool_executions tables — no fabricated numbers or trend badges) above the
 * reverse-chronological Q&A log with search + input-mode filters and on-demand
 * TTS playback.
 */
export function DashboardView({ onGoHome, onOpenActivity }: DashboardViewProps) {
  const [entries, setEntries] = useState<DashboardEntry[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [inputModeFilter, setInputModeFilter] = useState<InputModeFilter>('all');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [rows, statRows] = await Promise.all([
        window.kyclius.getDashboardEntries(100, 0),
        window.kyclius.getDashboardStats(),
      ]);
      setEntries(Array.isArray(rows) ? rows : []);
      setStats(statRows ?? null);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSearch = useCallback(async () => {
    const trimmed = searchQuery.trim();
    try {
      const rows = trimmed
        ? await window.kyclius.searchDashboardEntries(trimmed)
        : await window.kyclius.getDashboardEntries(100, 0);
      setEntries(Array.isArray(rows) ? rows : []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [searchQuery]);

  const visible = useMemo(() => {
    if (inputModeFilter === 'all') return entries;
    return entries.filter(e => e.input_mode === inputModeFilter);
  }, [entries, inputModeFilter]);

  const handleSpeak = useCallback(async (entry: DashboardEntry) => {
    if (speakingId === entry.conversation_id) {
      window.kyclius.stopSpeaking();
      setSpeakingId(null);
      return;
    }
    try {
      setSpeakingId(entry.conversation_id);
      await window.kyclius.speak(entry.answer);
    } catch {
      // TTS error is broadcast via kyclius:voice-error; nothing to do here.
    } finally {
      setSpeakingId(null);
    }
  }, [speakingId]);

  return (
    <section
      aria-label="Q&A Dashboard"
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
            <h2 className="font-heading text-lg text-on-surface leading-tight">Dashboard</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Every question asked and answer given</p>
          </div>
        </div>
      </div>

      {/* Real stat cards — no placeholder numbers */}
      <div className="px-6 pt-4 pb-2 flex-none">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Conversations"
            value={stats ? String(stats.conversations) : '–'}
            sub={stats ? `${stats.conversations} saved locally` : 'Loading…'}
            iconTint="bg-primary-container/20 text-primary"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            }
          />
          <StatCard
            label="Tool runs"
            value={stats ? String(stats.toolExecutions) : '–'}
            sub={stats ? 'actions attempted' : 'Loading…'}
            iconTint="bg-secondary-container/20 text-secondary"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
            }
          />
          <StatCard
            label="Successful actions"
            value={stats ? `${stats.toolSuccessRate}%` : '–'}
            sub={stats && stats.toolExecutions > 0 ? 'of all recorded runs' : 'No runs yet'}
            iconTint="bg-tertiary-container/20 text-tertiary"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            }
          />
          <StatCard
            label="Recent activity"
            value={stats ? formatRelative(stats.lastActivityAt) : '–'}
            sub={stats && stats.lastActivityAt ? 'last message or tool run' : 'Loading…'}
            iconTint="bg-surface-variant/50 text-on-surface"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            }
          />
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 space-y-2 border-b border-outline-variant/10 flex-none">
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-outline-variant/40 overflow-hidden bg-surface-container">
            {(['all', 'voice', 'text'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => setInputModeFilter(mode)}
                className={[
                  'px-2.5 py-1.5 text-[11px] font-medium transition-colors cursor-pointer',
                  inputModeFilter === mode
                    ? 'bg-secondary text-on-secondary'
                    : 'text-on-surface-variant hover:bg-surface-highest/40',
                ].join(' ')}
              >
                {mode === 'all' ? 'All' : mode === 'voice' ? 'Spoken' : 'Typed'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleSearch();
            }}
            placeholder="Search questions & answers…"
            aria-label="Search questions and answers"
            spellCheck={false}
            className="flex-1 min-w-0 rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-sky-deep"
          />
          <button
            type="button"
            onClick={() => void handleSearch()}
            className="px-3 py-1.5 rounded-lg bg-secondary text-on-secondary text-xs font-medium hover:brightness-110 transition-colors cursor-pointer shrink-0"
          >
            Search
          </button>
        </div>
        <p className="text-[11px] text-on-surface-variant px-0.5">
          Showing {visible.length} of {entries.length} exchanges
        </p>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {loadError && (
          <p className="text-xs text-error bg-error/5 border border-error/20 rounded-lg px-3 py-2" role="alert">
            {loadError}
          </p>
        )}

        {!loadError && visible.length === 0 && (
          <div className="pt-8 pb-4 text-center">
            <p className="text-sm text-on-surface-variant">
              {entries.length === 0 ? 'No conversations yet.' : 'Nothing matches those filters.'}
            </p>
            <p className="text-[11px] text-on-surface-variant/70 mt-1">
              {entries.length === 0
                ? 'Your Q&A history will appear here.'
                : 'Try adjusting your search or filter.'}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
          {visible.map(entry => {
            const isSpeaking = speakingId === entry.conversation_id;
            const hasTools = entry.tool_names && entry.tool_names.length > 0;
            return (
              <article
                key={entry.conversation_id}
                className="rounded-xl border border-outline-variant/10 bg-surface/50 backdrop-blur-[20px] shadow-glass-card overflow-hidden transition-colors hover:border-secondary/50"
              >
                <div className="px-3.5 py-3 space-y-2">
                  {/* Question row */}
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-medium text-on-surface leading-snug line-clamp-3 flex-1">
                      {entry.question}
                    </p>
                    <span className="shrink-0 inline-flex items-center gap-1 text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-outline-variant/40 text-on-surface-variant">
                      {entry.input_mode === 'voice' ? (
                        <>
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" y1="19" x2="12" y2="22" />
                          </svg>
                          Spoken
                        </>
                      ) : (
                        <>
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <polyline points="4 7 4 4 20 4 20 7" />
                            <line x1="9" y1="20" x2="15" y2="20" />
                            <line x1="12" y1="4" x2="12" y2="20" />
                          </svg>
                          Typed
                        </>
                      )}
                    </span>
                  </div>

                  {/* Answer */}
                  <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-4 whitespace-pre-wrap">
                    {entry.answer}
                  </p>

                  {/* Tool summary + meta row */}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {hasTools && (
                        <button
                          type="button"
                          onClick={onOpenActivity}
                          title="Open the full tool-run details in Activity"
                          className="inline-flex items-center gap-1 text-[10px] text-primary font-medium min-w-0 cursor-pointer hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep rounded-sm"
                        >
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                          </svg>
                          <span className="truncate">{entry.tool_names}</span>
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M5 12h14" />
                            <path d="M12 5l7 7-7 7" />
                          </svg>
                        </button>
                      )}
                      <span className="text-[10px] text-on-surface-variant/60">
                        {formatTimestamp(entry.last_message_at)}
                      </span>
                    </div>

                    {/* Listen button */}
                    <button
                      type="button"
                      onClick={() => void handleSpeak(entry)}
                      disabled={!entry.answer}
                      title={isSpeaking ? 'Stop speaking' : 'Listen to answer'}
                      className={[
                        'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors cursor-pointer shrink-0',
                        isSpeaking
                          ? 'bg-secondary/15 text-secondary border border-secondary/40'
                          : 'bg-surface-variant/50 text-on-surface-variant hover:bg-surface-variant hover:text-on-surface border border-outline-variant/10',
                      ].join(' ')}
                    >
                      {isSpeaking ? (
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                          <rect x="6" y="4" width="4" height="16" rx="1" />
                          <rect x="14" y="4" width="4" height="16" rx="1" />
                        </svg>
                      ) : (
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                      )}
                      {isSpeaking ? 'Stop' : 'Listen'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default DashboardView;