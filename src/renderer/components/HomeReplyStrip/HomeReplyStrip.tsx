import { useChatStore, type ChatMessage } from '../../state/chatStore';

interface HomeReplyStripProps {
  /** CB to open the full Conversation view via explicit navigation. */
  onOpenConversation: () => void;
}

/**
 * EF-01: compact inline response surface anchored above the home command bar.
 * Asking a question on the home screen keeps the ambient home screen mounted
 * and playing — the exchange collapses to this small strip instead of
 * navigating into the full Conversation view. Shows the latest user question
 * and assistant reply, with the per-message speaker/stop control, and an
 * explicit "Open conversation" link for when the user wants the full view.
 */
export function HomeReplyStrip({ onOpenConversation }: HomeReplyStripProps) {
  const messages = useChatStore(s => s.messages);
  const isSending = useChatStore(s => s.isSending);
  const streaming = useChatStore(s => s.streaming);
  const speakingMessageId = useChatStore(s => s.speakingMessageId);
  const stopPlayback = useChatStore(s => s.stopPlayback);

  // Nothing to show yet (or a reply is still streaming and there is no
  // user message to anchor to) — leave the command bar untouched.
  const lastUser: ChatMessage | undefined = [...messages].reverse().find(m => m.role === 'user');
  const lastReply: ChatMessage | undefined = [...messages].reverse().find(
    m => m.role === 'assistant' && (m.content ?? '') !== ''
  );
  const liveText = streaming && streaming.text.length > 0 ? streaming.text : null;

  if (!lastUser && !isSending) return null;
  if (!lastReply && !liveText && !isSending) return null;

  return (
    <div
      className="w-full max-w-[720px] mx-auto mb-1 px-1"
      role="status"
      aria-live="polite"
      aria-label="Home screen reply"
    >
      <div className="rounded-2xl bg-surface/40 backdrop-blur-[20px] border border-outline-variant/10 shadow-glass px-4 py-3 space-y-2">
        {lastReply ? (
          <>
            <p className="text-[13px] leading-6 text-on-surface whitespace-pre-wrap break-words">
              {lastReply.content}
            </p>

            <div className="flex items-center gap-2 pl-0.5 h-5">
              <button
                type="button"
                onClick={stopPlayback}
                disabled={speakingMessageId !== lastReply.id}
                title={
                  speakingMessageId === lastReply.id ? 'Stop voice playback' : 'Playback finished'
                }
                className={[
                  'flex items-center justify-center w-6 h-6 rounded-full transition-opacity cursor-pointer',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep',
                  speakingMessageId === lastReply.id
                    ? 'opacity-100 bg-blossom/20 text-blossom-deep hover:bg-blossom/30'
                    : 'opacity-40 text-bark hover:opacity-70',
                ].join(' ')}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M11 5L6 9H2v6h4l5 4V5z" />
                  {speakingMessageId === lastReply.id ? (
                    <>
                      <line x1="16" y1="9" x2="22" y2="15" />
                      <line x1="22" y1="9" x2="16" y2="15" />
                    </>
                  ) : (
                    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                  )}
                </svg>
              </button>
              <span className="text-[11px] text-on-surface-variant/70">
                {lastReply.created_at
                  ? new Date(lastReply.created_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : ''}
              </span>
              {lastReply.provider && lastReply.model && (
                <span
                  className="text-[10px] text-on-surface-variant/40"
                  title="Provider/model for this reply (multi-LLM routing)"
                >
                  via {lastReply.provider} · {lastReply.model}
                </span>
              )}
              <button
                type="button"
                onClick={onOpenConversation}
                className="ml-auto text-[11px] font-medium text-secondary hover:text-primary underline underline-offset-2 pl-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep rounded-sm"
              >
                Open conversation
              </button>
            </div>
          </>
        ) : liveText ? (
          <p
            className="text-[13px] leading-6 text-on-surface whitespace-pre-wrap break-words"
            role="status"
            aria-live="polite"
          >
            {liveText}
            <span className="inline-block w-[2px] h-[15px] ml-0.5 bg-primary align-text-bottom animate-pulse" />
          </p>
        ) : (
          <div className="flex items-center gap-2 text-sm text-on-surface-variant" role="status">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse-soft" />
            <span className="text-[13px] text-on-surface-variant/80">
              {lastUser?.content ? `“${lastUser.content}”` : 'Thinking…'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default HomeReplyStrip;
