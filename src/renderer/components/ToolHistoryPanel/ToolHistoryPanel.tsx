import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ToolExecution } from '@shared/types/ipc';

type ExecutionStatus = ToolExecution['status'];
type StatusFilter = 'all' | ExecutionStatus;

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'denied', label: 'Denied' },
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
];

const STATUS_STYLES: Record<ExecutionStatus, string> = {
  pending: 'bg-secondary/15 text-secondary border-secondary/40',
  confirmed: 'bg-sky-light/15 text-sky-light border-sky-light/40',
  denied: 'bg-tertiary/15 text-tertiary border-tertiary/40',
  success: 'bg-primary/15 text-primary border-primary/40',
  failed: 'bg-error/15 text-error border-error/40',
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

interface ToolHistoryViewProps {
  /** T-22: return to the immersive home screen (used by the header back control). */
  onGoHome: () => void;
}

/**
 * T-14/T-22 — Activity view (was the ToolHistoryPanel side panel). Every
 * recorded tool execution attempt (any outcome) newest-first, with
 * status/tool-name filters and expandable full parameter + result detail.
 * Updates in near-real-time from kyclius:tool-execution-update pushes.
 */
export function ToolHistoryView({ onGoHome }: ToolHistoryViewProps) {
  const [executions, setExecutions] = useState<ToolExecution[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [nameFilter, setNameFilter] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const refreshTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await window.kyclius.getToolHistory();
      setExecutions(Array.isArray(rows) ? rows : []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Trailing debounce so bursts of status changes during a run collapse into
  // one refetch instead of one per transition.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void load();
    }, 150);
  }, [load]);

  useEffect(() => {
    void load();
    const unsubscribe = window.kyclius.onToolExecutionUpdate(scheduleRefresh);
    return () => {
      unsubscribe();
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [load, scheduleRefresh]);

  const visible = useMemo(() => {
    const needle = nameFilter.trim().toLowerCase();
    return executions.filter(
      e =>
        (statusFilter === 'all' || e.status === statusFilter) &&
        (needle.length === 0 || e.tool_name.toLowerCase().includes(needle))
    );
  }, [executions, statusFilter, nameFilter]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return (
    <section
      aria-label="Tool activity history"
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
            <h2 className="font-heading text-lg text-primary leading-tight">Activity</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">What Kyclius has done recently — every entry here really happened.</p>
          </div>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/30 text-primary text-[11px] font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          Live log
        </span>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 space-y-2 border-b border-outline-variant/10 flex-none">
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            aria-label="Filter by status"
            className="flex-1 min-w-0 rounded-lg border border-outline-variant/40 bg-surface-container px-2 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-sky-deep cursor-pointer"
          >
            {STATUS_FILTERS.map(f => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={nameFilter}
            onChange={e => setNameFilter(e.target.value)}
            placeholder="Filter by tool…"
            aria-label="Filter by tool name"
            spellCheck={false}
            className="flex-1 min-w-0 rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-sky-deep"
          />
        </div>
        <p className="text-[11px] text-on-surface-variant px-0.5">
          Showing {visible.length} of {executions.length} recorded actions
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
              {executions.length === 0 ? 'No tool activity yet.' : 'Nothing matches those filters.'}
            </p>
            <p className="text-[11px] text-on-surface-variant/70 mt-1">
              Actions appear here the moment Kyclius runs a tool.
            </p>
          </div>
        )}

        {visible.map(exec => {
          const isExpanded = expandedIds.has(exec.id);
          const isErrorOutcome = exec.status === 'failed' || exec.status === 'denied';
          const isAwaitingApproval = exec.status === 'pending';
          return (
            <article
              key={exec.id}
              className={[
                'rounded-xl border border-outline-variant/10 bg-surface/50 backdrop-blur-[20px] overflow-hidden',
                'transition-colors shadow-glass-card hover:border-secondary/50',
                // T-22: awaiting-approval rows get the "Action Required" accent,
                // exactly like the mockup's pending row — driven by real status.
                isAwaitingApproval ? 'bg-secondary/5 border-l-2 border-l-secondary' : '',
              ].join(' ')}
            >
              <button
                type="button"
                onClick={() => toggleExpanded(exec.id)}
                aria-expanded={isExpanded}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-surface-highest/25 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-deep"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[13px] font-medium text-on-surface truncate">
                    {exec.tool_name}
                  </span>
                  <span className="block text-[10px] text-on-surface-variant mt-0.5">
                    {formatTimestamp(exec.created_at)}
                    {' · '}
                    {isAwaitingApproval ? (
                      <span className="text-secondary font-medium">Action Required</span>
                    ) : (
                      exec.permission_tier === 'auto' ? 'auto-approved' : 'needed approval'
                    )}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <span
                    className={[
                      'text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full border',
                      STATUS_STYLES[exec.status],
                    ].join(' ')}
                  >
                    {exec.status}
                  </span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className={['text-on-surface-variant transition-transform', isExpanded ? 'rotate-180' : ''].join(' ')}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-0.5 space-y-2 border-t border-outline-variant/10">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-on-surface-variant mb-1 mt-2">
                      Parameters
                    </p>
                    <pre className="rounded-lg bg-surface-container px-2.5 py-2 font-mono text-[11px] leading-relaxed text-on-surface overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                      {JSON.stringify(exec.parameters, null, 2)}
                    </pre>
                  </div>
                  {exec.result !== null && (
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-on-surface-variant mb-1">
                        {isErrorOutcome ? 'Why it stopped' : 'Result'}
                      </p>
                      <pre
                        className={[
                          'rounded-lg px-2.5 py-2 font-mono text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto',
                          isErrorOutcome ? 'bg-error/5 text-error' : 'bg-primary/5 text-primary',
                        ].join(' ')}
                      >
                        {exec.result}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default ToolHistoryView;