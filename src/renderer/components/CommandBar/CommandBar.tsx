import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistantState } from '@shared/types/ipc';
import { useAssistantStore } from '../../state/assistantStore';
import { useChatStore } from '../../state/chatStore';
import { useAutonomousModeStore } from '../../state/autonomousModeStore';
import { AttachmentChip } from '../AttachmentChip';

const PLACEHOLDER = 'Ask Kyclius to do something…';

/**
 * T-02: the assistant-state value drives the composer's border/glow and the
 * mic waveform instead of any character component (Frontend Spec §6).
 */
const STATE_RING: Record<AssistantState, string> = {
  idle: 'border-capsule',
  listening: 'border-secondary ring-2 ring-secondary/25',
  thinking: 'border-secondary ring-2 ring-secondary/20 animate-breathe',
  awaiting_confirmation: 'border-warning/60 ring-2 ring-warning/20',
  executing: 'border-secondary/60 ring-2 ring-secondary/15',
  speaking: 'border-primary/40 ring-2 ring-primary/15',
  error: 'border-danger/50 ring-2 ring-danger/20',
};

const STATE_HINT: Record<AssistantState, string | null> = {
  idle: null,
  listening: 'Say your request — it will send when you pause.',
  thinking: 'Thinking…',
  awaiting_confirmation: 'Waiting for your approval…',
  executing: 'Doing it now…',
  speaking: 'Speaking…',
  error: 'Something went wrong — see the message or try again.',
};

export function CommandBar() {
  const inputRef = useRef<HTMLInputElement>(null);
  const isListeningRef = useRef(false);

  const [value, setValue] = useState('');
  const [isListening, setIsListening] = useState(false);
  // EF-04: transient voice feedback (no-speech, engine fallback, mic errors)
  // surfaced to the user instead of being silently swallowed.
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  // Attachment state
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; kind: 'file' | 'folder'; size?: number; path: string }>>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  // EF-10 / Frontend Spec §5: distinct "taking longer than expected" state so a
  // slow call is never visually indistinguishable from a hung app.
  const [isSlow, setIsSlow] = useState(false);

  const showFeedback = useCallback((message: string, durationMs = 6000) => {
    setVoiceFeedback(message);
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setVoiceFeedback(null), durationMs);
  }, []);
  const isSending = useChatStore(s => s.isSending);
  const sendMessage = useChatStore(s => s.sendMessage);
  const cancelGeneration = useChatStore(s => s.cancelGeneration);
  const assistantState = useAssistantStore(s => s.assistantState);
  const autonomousEnabled = useAutonomousModeStore(s => s.enabled);
  const isSendingRef = useRef(isSending);

  // keep refs in sync for handlers that close over state
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);
  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);

  // EF-10: arm the "taking longer than expected" transition well before
  // anything could read as frozen (~9s, above normal time-to-first-token).
  useEffect(() => {
    if (!isSending) {
      setIsSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setIsSlow(true), 9000);
    return () => window.clearTimeout(timer);
  }, [isSending]);

  // EF-04: clear the transient voice-feedback timer on unmount.
  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  const stopListening = useCallback(async () => {
    try {
      await window.kyclius?.stopListening();
    } catch {
      // ignore — state reset below still applies
    }
    setIsListening(false);
    isListeningRef.current = false;
  }, []);

  // EF-11: both the "+" picker and drag-and-drop funnel through the same
  // main-process `kyclius:attach-file` handler (which normalizes Windows
  // paths). Every attempt ends in a visible chip or a specific error — never
  // total silence. Legacy fallback (no IPC, e.g. web dev) keeps a local chip.
  const attachOnePath = useCallback(async (rawPath: string, fallbackName?: string) => {
    const fallback = fallbackName ?? rawPath.split(/[/\\]/).pop() ?? rawPath;
    if (!window.kyclius?.attachFile) {
      setAttachments(prev => [
        ...prev,
        { id: crypto.randomUUID(), name: fallback, kind: 'file' as const, path: rawPath },
      ]);
      return;
    }
    try {
      const result = await window.kyclius.attachFile(rawPath);
      if (result.ok) {
        setAttachments(prev => [
          ...prev,
          {
            id: result.attachment.id,
            name: result.attachment.name,
            kind: result.attachment.kind,
            size: result.attachment.size,
            path: result.attachment.path,
          },
        ]);
      } else {
        const err = (result as { ok: false; error: string }).error;
        showFeedback(`Couldn't attach ${fallback}: ${err}`);
      }
    } catch (err) {
      showFeedback(`Couldn't attach ${fallback}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [showFeedback]);

  // Attach file/folder via native dialog or drag-and-drop
  const handleAttachFiles = useCallback(async (files: FileList) => {
    if (!window.kyclius) return;
    if (!files || files.length === 0) {
      showFeedback('Drop didn\'t include any files — try the + button instead.');
      return;
    }
    for (const file of Array.from(files)) {
      let filePath = '';
      try {
        filePath = window.kyclius.getPathForFile(file);
      } catch (err) {
        showFeedback(`Failed to attach ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      // EF-11: an unresolvable drop path must still acknowledge visibly.
      if (!filePath || filePath.trim().length === 0) {
        showFeedback(`Couldn't attach ${file.name}: the drop didn't include a file path — try the + button instead.`);
        continue;
      }
      await attachOnePath(filePath, file.name);
    }
  }, [showFeedback, attachOnePath]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleAttachFiles(e.dataTransfer.files);
    }
  }, [handleAttachFiles]);

  const handleAttachClick = useCallback(async () => {
    if (!window.kyclius) return;
    try {
      const paths = await window.kyclius.showOpenDialog();
      if (!paths || paths.length === 0) return;
      for (const p of paths) {
        await attachOnePath(p);
      }
    } catch (err) {
      showFeedback(`Failed to open file picker: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [showFeedback, attachOnePath]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  // Voice + typed input converge on the same chatStore.sendMessage path.
  // EF-11: attachments are already ingested in main at attach time (same
  // handler for picker + drag-drop) and ride along via attachment context —
  // no prompt injection asking the LLM to call attach_file.
  const submit = useCallback(
    (text: string, inputMode: 'voice' | 'text') => {
      const finalMessage = text.trim();

      if (!finalMessage) return;
      if (isSendingRef.current) return;

      setValue('');
      // Chips stay visible until send; main already holds the ingested rows.
      setAttachments([]);
      void sendMessage(finalMessage, inputMode);

      if (isListeningRef.current) {
        void stopListening();
      }
    },
    [sendMessage, stopListening]
  );

  // Voice transcript → live input + auto-submit on final
  useEffect(() => {
    if (!window.kyclius) return;
    const off = window.kyclius.onTranscript((text, isFinal) => {
      if (!isFinal) {
        if (isListeningRef.current) setValue(text);
        return;
      }
      const trimmed = text.trim();
      if (trimmed.length === 0) return; // empty/silent finals are ignored
      setValue(trimmed);
      submit(trimmed, 'voice');
    });
    return off;
  }, [submit]);

  // Keep listening state in sync with main-process broadcasts (wake word path)
  useEffect(() => {
    if (!window.kyclius) return;
    const offStart = window.kyclius.onVoiceStartCapture(() => setIsListening(true));
    const offStop = window.kyclius.onVoiceStopCapture(() => setIsListening(false));
    const offError = window.kyclius.onVoiceError(error => {
      setIsListening(false);
      // Surface actionable voice errors (no-speech, mic issues, engine gaps,
      // speaker rejection) instead of silently dropping the session.
      if (error.message) showFeedback(error.message);
    });
    const offNotice = window.kyclius.onVoiceEngineNotice?.(notice =>
      showFeedback(notice.message, 8000)
    );
    return () => {
      offStart();
      offStop();
      offError();
      offNotice?.();
    };
  }, [showFeedback]);

  // Global shortcut Cmd/Ctrl+K + "/" fallback
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isModK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      const isSlash =
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA';
      if (isModK || isSlash) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape' && isListeningRef.current) {
        void window.kyclius?.stopListening();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleMicClick = useCallback(async () => {
    if (isSending) return;
    if (isListening) {
      await stopListening();
      return;
    }
    setIsListening(true);
    isListeningRef.current = true;
    try {
      const res = await window.kyclius?.startListening();
      if (!res?.started) {
        setIsListening(false);
        isListeningRef.current = false;
      } else {
        inputRef.current?.focus();
      }
    } catch {
      setIsListening(false);
      isListeningRef.current = false;
    }
  }, [isListening, isSending, stopListening]);

  const canSend = value.trim().length > 0 && !isSending;
  const baseHint = isListening ? STATE_HINT.listening : STATE_HINT[assistantState];
  // EF-10: slow calls get a distinct, calm-but-clear message with a cancel
  // affordance — never identical to the hung-app look.
  const hint = isSlow && isSending ? 'Still working — taking longer than expected.' : baseHint;
  const isThinking = assistantState === 'thinking';
  const showStop = isSending && (isThinking || isSlow || assistantState === 'executing');

  return (
    <div className="w-full max-w-[720px] mx-auto" role="search" aria-label="Kyclius command bar">
      {/* T-20: persistent badge while Autonomous Mode is on — full-width row so
          it stays attached to the composer when the workspace shifts. */}
      {autonomousEnabled && (
        <div className="mb-1.5 px-1">
          <span
            className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/40"
            title="Autonomous Mode is on — actions set to Always Allow run without asking"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse-soft" />
            Autonomous
          </span>
        </div>
      )}

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="mb-1.5 px-1 flex flex-wrap gap-1.5">
          {attachments.map(att => (
            <AttachmentChip
              key={att.id}
              name={att.name}
              kind={att.kind}
              size={att.size}
              onRemove={() => handleRemoveAttachment(att.id)}
            />
          ))}
        </div>
      )}

      <div
        className={[
          'flex items-center gap-3 w-full bg-surface/30 backdrop-blur-[20px] border px-4 py-2',
          'rounded-[24px] shadow-glass transition-all duration-150',
          STATE_RING[assistantState],
          // EF-06: focus glow is the soft leaf-soft wash from the Frontend Spec,
          // not the hard blue (sky-deep/secondary) rectangular outline.
          isListening ? '' : 'focus-within:border-leaf-soft/60 focus-within:shadow-[0_0_20px_rgba(136,249,181,0.22)]',
          isSending ? 'opacity-70' : '',
          isDragOver ? 'border-secondary/50 bg-secondary/5' : '',
        ].join(' ')}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Mic — primary affordance, pulsing when listening */}
        <button
          type="button"
          aria-label={isListening ? 'Stop listening' : 'Start voice input'}
          aria-pressed={isListening}
          disabled={isSending}
          onClick={() => void handleMicClick()}
          className={[
            'relative shrink-0 w-10 h-10 rounded-full flex items-center justify-center',
            'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-soft/70',
            isSending ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
            isListening
              ? 'bg-secondary text-on-secondary animate-pulse-soft'
              : 'bg-surface-container/50 text-secondary hover:bg-surface-variant',
          ].join(' ')}
          title={isListening ? 'Listening — click to stop (Esc)' : 'Start voice — Cmd+K'}
        >
          {isListening ? (
            // Audio-reactive waveform inside the mic button (spec §6)
            <span className="flex items-end justify-center gap-[2px] h-4" aria-hidden>
              {[0, 1, 2, 3].map(i => (
                <span
                  key={i}
                  className="w-[3px] rounded-full bg-on-secondary animate-soundbar"
                  style={{ animationDelay: `${i * 170}ms` }}
                />
              ))}
            </span>
          ) : (
            <svg
              aria-hidden
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
              <path d="M19 10a7 7 0 0 1-14 0" />
              <path d="M12 19v4" />
              <path d="M8 23h8" />
            </svg>
          )}
          {isListening && (
            <span className="absolute inset-0 rounded-full border-2 border-secondary animate-ping opacity-30 pointer-events-none" />
          )}
        </button>

        {/* Attach button — "+" icon */}
        <button
          type="button"
          aria-label="Attach file or folder"
          disabled={isSending}
          onClick={handleAttachClick}
          className={[
            'relative shrink-0 w-10 h-10 rounded-full flex items-center justify-center',
            'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-soft/70',
            isSending ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
            'bg-surface-container/50 text-secondary hover:bg-surface-variant',
          ].join(' ')}
          title="Attach file or folder"
        >
          <svg
            aria-hidden
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        {/* Text fallback */}
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(value, 'text');
            }
          }}
          placeholder={isListening ? 'Listening…' : PLACEHOLDER}
          disabled={isSending}
          aria-label="Command input"
          aria-disabled={isSending}
          className={[
            'flex-1 min-w-0 bg-transparent outline-none text-[16px] leading-6',
            'placeholder:text-on-surface-variant/60 text-on-surface',
            isSending ? 'cursor-not-allowed' : '',
          ].join(' ')}
        />

        {isSending && (
          <span
            className="shrink-0 w-5 h-5 border-2 border-outline/40 border-t-primary rounded-full animate-spin"
            aria-label="Sending"
            role="status"
          />
        )}

        {/* T-02 / spec §6: "Stop generating" while a turn is in flight.
            EF-10: stays visible (with slow styling) once the turn exceeds the
            "taking longer than expected" threshold, in any active phase. */}
        {showStop && (
          <button
            type="button"
            onClick={() => cancelGeneration()}
            className={[
              'shrink-0 px-2.5 h-8 rounded-lg text-xs font-medium border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-soft/70',
              isSlow
                ? 'border-warning/60 text-warning hover:border-warning animate-pulse-soft'
                : 'border-outline-variant/40 text-on-surface-variant hover:text-danger hover:border-danger/40',
            ].join(' ')}
            title={isSlow ? 'Still working — tap to cancel' : 'Stop generating'}
          >
            {isSlow ? 'Still working — stop' : 'Stop'}
          </button>
        )}

        {/* Manual send */}
        <button
          type="button"
          aria-label="Send command"
          disabled={!canSend}
          onClick={() => submit(value, 'text')}
          className={[
            'shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-soft/70',
            canSend
              ? 'bg-primary-container text-on-primary-container hover:brightness-110 active:scale-95 shadow-lg cursor-pointer'
              : 'bg-surface-variant text-on-surface-variant/40 cursor-not-allowed',
          ].join(' ')}
          title={canSend ? 'Send (Enter)' : 'Type or speak a command first'}
        >
          <svg
            aria-hidden
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 2L11 13" />
            <path d="M22 2L15 22L11 13L2 9L22 2Z" />
          </svg>
        </button>
      </div>

      <div className="flex items-center justify-between mt-2 px-1 min-h-[18px]">
        <span
          className={[
            'text-xs',
            voiceFeedback
              ? 'text-danger'
              : assistantState === 'error'
                ? 'text-danger'
                : 'text-on-surface-variant/70',
          ].join(' ')}
        >
          {voiceFeedback ?? hint ?? 'Press Enter to send · Cmd K to focus'}
        </span>
        {isListening && (
          <span className="text-xs font-medium text-secondary flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-secondary animate-pulse-soft" />
            Listening
          </span>
        )}
        {assistantState === 'executing' && (
          <span className="text-xs font-medium text-secondary flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-secondary animate-pulse-soft" />
            Running action
          </span>
        )}
      </div>
    </div>
  );
}

export default CommandBar;