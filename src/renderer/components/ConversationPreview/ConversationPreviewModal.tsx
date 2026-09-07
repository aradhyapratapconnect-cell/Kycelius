import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConversationDetail } from '@shared/types/ipc';

interface ConversationPreviewModalProps {
  conversationId: string;
  onClose: () => void;
  /** Navigate into the real Conversation view continued from this history. */
  onOpenFullConversation: (conversationId: string) => void;
}

/** Plain-text transcript (question/answer pairs, in order) for copy-all. */
export function transcriptToPlainText(detail: ConversationDetail): string {
  return detail.messages.map(m => (m.role === 'user' ? `You: ${m.content}` : `Kyclius: ${m.content}`)).join('\n\n');
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API unavailable (permissions) — fall back to a selection hack.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * T-27: conversation history preview — an in-app modal overlay matching the
 * existing Settings modal pattern (floating glass panel, centered over
 * whatever is behind it). No new Electron window, no command bar: read-only
 * scrollback with per-message + copy-all controls and an "Open full
 * conversation" link. Opening/closing never changes the app's navigation
 * state; opening a second preview replaces this one's content.
 */
export function ConversationPreviewModal({
  conversationId,
  onClose,
  onOpenFullConversation,
}: ConversationPreviewModalProps) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setLoadError(null);
    setCopiedAll(false);
    // A new id while open replaces the content (no stacking).
    void window.kyclius
      ?.getConversationMessages(conversationId)
      .then(d => {
        if (!cancelled) setDetail(d);
      })
      .catch(err => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleCopyOne = useCallback(async (id: string, text: string) => {
    if (await copyText(text)) {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(current => (current === id ? null : current)), 1500);
    }
  }, []);

  const plainTranscript = useMemo(() => (detail ? transcriptToPlainText(detail) : ''), [detail]);

  const handleCopyAll = useCallback(async () => {
    if (!plainTranscript) return;
    if (await copyText(plainTranscript)) {
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 1500);
    }
  }, [plainTranscript]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Conversation preview"
    >
      {/* Backdrop — click to close */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden />

      <div className="relative z-10 w-full max-w-[560px] h-[70vh] rounded-card bg-surface/80 backdrop-blur-[20px] border border-outline-variant/20 shadow-glass flex flex-col overflow-hidden mx-4">
        {/* Header: title + creation date, close, copy-all, open-full */}
        <header className="flex-none px-5 py-4 border-b border-outline-variant/10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-heading text-base text-on-surface leading-tight truncate">
                {detail ? detail.conversation.title : 'Loading…'}
              </h2>
              <p className="text-[11px] text-on-surface-variant/70 mt-0.5">
                {detail ? formatDate(detail.conversation.created_at) : ' '}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="p-2 -m-1 rounded-full hover:bg-surface-highest/40 transition-colors text-on-surface-variant hover:text-on-surface cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-soft/70"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={() => void handleCopyAll()}
              disabled={!detail || detail.messages.length === 0}
              className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:border-outline-variant transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-soft/70"
            >
              {copiedAll ? 'Copied!' : 'Copy all'}
            </button>
            <button
              type="button"
              onClick={() => onOpenFullConversation(conversationId)}
              disabled={!detail}
              className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg text-secondary hover:underline underline-offset-2 cursor-pointer disabled:opacity-40 disabled:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-soft/70"
            >
              Open full conversation
            </button>
          </div>
        </header>

        {/* Body: full read-only scrollback, same bubble styling as live view */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
          {loadError && (
            <p className="text-xs text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2" role="alert">
              {loadError}
            </p>
          )}
          {!loadError && !detail && (
            <div className="flex items-center gap-2 pl-1" role="status" aria-label="Loading preview">
              <span className="w-2 h-2 rounded-full bg-on-surface/50 animate-pulse-soft" />
              <span className="w-2 h-2 rounded-full bg-on-surface/50 animate-pulse-soft [animation-delay:150ms]" />
              <span className="w-2 h-2 rounded-full bg-on-surface/50 animate-pulse-soft [animation-delay:300ms]" />
            </div>
          )}
          {detail && detail.messages.length === 0 && (
            <p className="text-sm text-on-surface-variant text-center pt-6">No messages in this conversation yet.</p>
          )}
          {detail?.messages.map(m =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md bg-primary text-on-primary shadow-sm">
                  <p className="text-[14px] leading-6 whitespace-pre-wrap break-words">{m.content}</p>
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex flex-col items-start gap-1 group">
                <div className="max-w-[90%] px-4 py-2.5 rounded-2xl rounded-bl-md border shadow-sm bg-surface-high/70 border-outline-variant/40 text-on-surface">
                  <p className="text-[14px] leading-6 whitespace-pre-wrap break-words">{m.content}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopyOne(m.id, m.content)}
                  aria-label={copiedId === m.id ? 'Copied' : 'Copy message'}
                  title={copiedId === m.id ? 'Copied' : 'Copy message'}
                  className="flex items-center gap-1 pl-1 h-5 text-[10px] text-on-surface-variant/60 hover:text-on-surface transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-soft/70 rounded"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  {copiedId === m.id ? 'Copied' : 'Copy'}
                </button>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default ConversationPreviewModal;
