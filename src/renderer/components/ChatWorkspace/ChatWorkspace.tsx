import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../../state/chatStore';
import { useChatStore } from '../../state/chatStore';
import { CommandBar } from '../CommandBar';

function MessageBubble({ message }: { message: ChatMessage }) {
  const speakingMessageId = useChatStore(s => s.speakingMessageId);
  const stopPlayback = useChatStore(s => s.stopPlayback);

  if (message.role === 'user') {
    const viaVoice = message.input_mode === 'voice';
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-md bg-primary text-on-primary shadow-sm">
          <p className="text-[15px] leading-6 whitespace-pre-wrap break-words">{message.content}</p>
          <div className="flex items-center justify-end gap-1 mt-1 opacity-70">
            {viaVoice && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-label="spoken">
                <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm7-3a7 7 0 0 1-14 0h2a5 5 0 0 0 10 0h2z" />
              </svg>
            )}
            <span className="text-[11px]">
              {new Date(message.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Assistant + tool-result messages share the left-aligned card style,
  // with distinct visual treatment per role.
  const isTool = message.role === 'tool';
  return (
    <div className="flex flex-col items-start gap-1 group">
      <div
        className={[
          'max-w-[85%] px-4 py-2.5 rounded-2xl rounded-bl-md border shadow-sm',
          isTool
            ? 'bg-surface-variant/40 border-outline-variant/40 font-mono text-[13px] leading-5 text-on-surface-variant'
            : 'bg-surface-high/70 border-outline-variant/40 text-on-surface',
        ].join(' ')}
      >
        <p className={['whitespace-pre-wrap break-words', isTool ? '' : 'text-[15px] leading-6'].join(' ')}>
          {message.content}
        </p>
      </div>

      <div className="flex items-center gap-2 pl-1 h-5">
        {!isTool && (
          <button
            type="button"
            onClick={stopPlayback}
            disabled={speakingMessageId !== message.id}
            title={
              speakingMessageId === message.id ? 'Stop voice playback' : 'Playback finished'
            }
            className={[
              'flex items-center justify-center w-6 h-6 rounded-full transition-opacity',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep cursor-pointer',
              speakingMessageId === message.id
                ? 'opacity-100 bg-blossom/20 text-blossom-deep hover:bg-blossom/30'
                : 'opacity-0 group-hover:opacity-40 text-bark cursor-default',
            ].join(' ')}
          >
            {/* Speaker-off icon — interrupts playback without affecting the written text */}
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
              {speakingMessageId === message.id ? (
                <>
                  <line x1="16" y1="9" x2="22" y2="15" />
                  <line x1="22" y1="9" x2="16" y2="15" />
                </>
              ) : (
                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              )}
            </svg>
          </button>
        )}
        <span className="text-[11px] text-on-surface-variant/60">
          {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        {!isTool && message.provider && message.model && (
          <span className="text-[10px] text-on-surface-variant/40" title="Provider/model for this reply (multi-LLM routing)">
            via {message.provider} · {message.model}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * T-26: live reply bubble. While the main process streams tokens the partial
 * text renders in an assistant-style card with a caret; the three-dot pulse
 * only shows before the first token lands.
 */
function LiveReply() {
  const streaming = useChatStore(s => s.streaming);
  const isSending = useChatStore(s => s.isSending);

  if (streaming && streaming.text.length > 0) {
    return (
      <div
        className="flex flex-col items-start gap-1"
        role="status"
        aria-live="polite"
        aria-label="Assistant is replying"
      >
        <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-bl-md border bg-surface-high/70 border-outline-variant/40 text-on-surface shadow-sm">
          <p className="text-[15px] leading-6 whitespace-pre-wrap break-words">
            {streaming.text}
            <span className="inline-block w-[2px] h-[18px] ml-0.5 bg-primary align-text-bottom animate-pulse" />
          </p>
        </div>
      </div>
    );
  }

  if (!isSending) return null;
  return (
    <div className="flex items-center gap-2 pl-1" role="status" aria-label="Assistant is thinking">
      <span className="w-2 h-2 rounded-full bg-on-surface/50 animate-pulse-soft" />
      <span className="w-2 h-2 rounded-full bg-on-surface/50 animate-pulse-soft [animation-delay:150ms]" />
      <span className="w-2 h-2 rounded-full bg-on-surface/50 animate-pulse-soft [animation-delay:300ms]" />
    </div>
  );
}

interface ChatWorkspaceProps {
  /**
   * Hybrid layout (spec §5): when `false` this is the landing composer state —
   * hidden until the first command, sliding in over the ambient home screen.
   */
  open?: boolean;
  /**
   * T-22: when embedded in the app-shell, render as a plain full-height view
   * inside the shell content surface instead of the floating slide-over.
   */
  embedded?: boolean;
  /** T-22: shell header back control — return to the immersive home screen. */
  onGoHome?: () => void;
}

/**
 * Hybrid-layout chat view (spec §5): fades/slides in over the left side of the
 * ambient home screen; the scenery stays visible behind it. Max content
 * width 720px for readability. In the T-22 app-shell the same conversation
 * renders `embedded` — full-height, no slide chrome.
 */
export function ChatWorkspace({ open = false, embedded = false, onGoHome }: ChatWorkspaceProps) {
  const messages = useChatStore(s => s.messages);
  const isSending = useChatStore(s => s.isSending);
  const streaming = useChatStore(s => s.streaming);
  const startNewConversation = useChatStore(s => s.startNewConversation);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isSending, streaming?.text]);

  if (embedded) {
    return (
      <section
        aria-label="Conversation"
        className="h-full flex flex-col bg-surface/60 backdrop-blur-[20px] border border-outline-variant/10 rounded-card shadow-glass overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-outline-variant/10 bg-transparent flex-none">
          <div className="flex items-center gap-3 min-w-0">
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
            <h2 className="font-heading text-lg text-on-surface leading-tight truncate">Conversation</h2>
          </div>
          <button
            type="button"
            onClick={startNewConversation}
            className="text-xs px-3 py-1.5 rounded-full border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:border-outline-variant cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep shrink-0"
          >
            New conversation
          </button>
        </div>

        {/* Scrollable message list */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-4 min-h-0">
          {messages.map(message => (
            <MessageBubble key={message.id} message={message} />
          ))}
          <LiveReply />
        </div>

        {/* Command bar — persistently docked at bottom per Frontend Spec §5 */}
        <div className="flex-none border-t border-outline-variant/10 bg-surface/50 backdrop-blur-[20px] px-6 py-4">
          <CommandBar />
        </div>
      </section>
    );
  }

  return (
    <div
      className={[
        'absolute top-0 bottom-[104px] left-0 w-full max-w-[720px] flex flex-col',
        'transition-all duration-300 ease-out will-change-transform',
        open
          ? 'opacity-100 translate-x-0 pointer-events-auto'
          : 'opacity-0 -translate-x-6 pointer-events-none',
      ].join(' ')}
      aria-hidden={!open}
    >
      {/* Panel surface */}
      <div className="flex-1 flex flex-col mx-4 mt-4 rounded-2xl bg-surface/40 backdrop-blur-[20px] border border-outline-variant/10 shadow-glass overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant/10 bg-transparent">
          <h2 className="font-heading text-on-surface">Conversation</h2>
          <button
            type="button"
            onClick={startNewConversation}
            className="text-xs px-3 py-1.5 rounded-full border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:border-outline-variant cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
          >
            New conversation
          </button>
        </div>

        {/* Scrollable message list */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.map(message => (
            <MessageBubble key={message.id} message={message} />
          ))}
          <LiveReply />
        </div>
      </div>
    </div>
  );
}

export default ChatWorkspace;
