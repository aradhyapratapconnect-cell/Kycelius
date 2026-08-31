import { useCallback, useEffect, useRef, useState } from 'react';
import { useConfirmationStore } from '../../state/confirmationStore';
import { useAssistantStore } from '../../state/assistantStore';
import type { ConfirmationAction } from '@shared/types/ipc';

const DANGER_TOOLS = new Set(['delete_file', 'run_shell_command']);

const EDITABLE_TOOLS: Record<string, string[]> = {
  send_email: ['to', 'subject', 'body'],
  create_file: ['filename', 'content', 'path'],
};

const TOOL_LABELS: Record<string, string> = {
  delete_file: 'Delete file',
  run_shell_command: 'Run shell command',
  send_email: 'Send email',
  create_file: 'Create file',
  open_application: 'Open application',
  github_read: 'GitHub (read)',
  github_write: 'GitHub (write)',
};

function isDangerous(toolName: string): boolean {
  return DANGER_TOOLS.has(toolName);
}

function getEditableFields(toolName: string): string[] | null {
  return EDITABLE_TOOLS[toolName] ?? null;
}

function toolDisplayName(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName.replace(/_/g, ' ');
}

function ParamsDisplay({
  parameters,
  editable,
  draft,
  onDraftChange,
}: {
  parameters: Record<string, unknown>;
  editable: string[] | null;
  draft: Record<string, unknown> | null;
  onDraftChange: (field: string, value: string) => void;
}) {
  if (!editable) {
    return (
      <pre className="font-mono text-sm leading-relaxed text-on-surface whitespace-pre-wrap break-all bg-surface-container rounded-lg p-4 border border-outline-variant/30">
        {JSON.stringify(parameters, null, 2)}
      </pre>
    );
  }

  const current = draft ?? parameters;
  return (
    <div className="space-y-3">
      {editable.map(field => {
        const raw = current[field];
        const value = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
        const isMultiline = field === 'body' || field === 'content';
        return (
          <label key={field} className="block">
            <span className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">
              {field}
            </span>
            {isMultiline ? (
              <textarea
                value={value}
                onChange={e => onDraftChange(field, e.target.value)}
                rows={4}
                className="mt-1 block w-full rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2 font-mono text-sm text-on-surface leading-relaxed focus:outline-none focus:ring-2 focus:ring-secondary/40 focus:border-secondary resize-y"
              />
            ) : (
              <input
                type="text"
                value={value}
                onChange={e => onDraftChange(field, e.target.value)}
                className="mt-1 block w-full rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2 font-mono text-sm text-on-surface leading-relaxed focus:outline-none focus:ring-2 focus:ring-secondary/40 focus:border-secondary"
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

export function ConfirmationDialog() {
  const pending = useConfirmationStore(s => s.pending);
  const voiceResolvedAction = useConfirmationStore(s => s.voiceResolvedAction);
  const editDraft = useConfirmationStore(s => s.editDraft);
  const open = useConfirmationStore(s => s.open);
  const close = useConfirmationStore(s => s.close);
  const clearFlash = useConfirmationStore(s => s.clearFlash);
  const setEditDraft = useConfirmationStore(s => s.setEditDraft);

  const setAssistantState = useAssistantStore(s => s.setAssistantState);

  const [flashingButton, setFlashingButton] = useState<ConfirmationAction | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!window.kyclius) return;
    const off = window.kyclius.onConfirmationRequired(confirmation => {
      open(confirmation);
    });
    return off;
  }, [open]);

  useEffect(() => {
    if (!pending) return;
    setAssistantState('awaiting_confirmation');
    window.kyclius?.stopSpeaking();
    // When voice confirmation is enabled, the main-process voice window reads
    // this prompt aloud (and gates the mic on it) — speaking here too would
    // duplicate the audio. In click-only mode, the dialog owns the read-out.
    if (pending.voiceConfirmationEnabled === false) {
      void window.kyclius?.speak(describeAction(pending));
    }
  }, [pending, setAssistantState]);

  useEffect(() => {
    if (!voiceResolvedAction) return;
    setFlashingButton(voiceResolvedAction);
    flashTimerRef.current = setTimeout(() => {
      setFlashingButton(null);
      clearFlash();
    }, 600);
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, [voiceResolvedAction, clearFlash]);

  const handleResolve = useCallback(
    (action: ConfirmationAction, editedParams?: Record<string, unknown>) => {
      if (!pending) return;
      window.kyclius?.respondToConfirmation({
        id: pending.id,
        action,
        editedParams,
        reason:
          action === 'deny'
            ? 'Denied by user.'
            : action === 'always_allow'
              ? 'Approved and always allowed by user.'
              : 'Approved by user.',
      });
      setAssistantState('thinking');
      close();
    },
    [pending, close, setAssistantState]
  );

  const handleDraftChange = useCallback(
    (field: string, value: string) => {
      const base = (editDraft ?? pending?.parameters) as Record<string, unknown> | undefined;
      setEditDraft({ ...(base ?? {}), [field]: value });
    },
    [editDraft, pending, setEditDraft]
  );

  if (!pending) return null;

  const danger = isDangerous(pending.toolName);
  const editableFields = getEditableFields(pending.toolName);
  const hasDraft = editDraft !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={`${toolDisplayName(pending.toolName)} confirmation`}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/60 backdrop-blur-md"
        onClick={() => handleResolve('deny')}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-[480px] mx-4 rounded-card bg-surface/80 backdrop-blur-[20px] border border-outline-variant/20 shadow-glass overflow-hidden animate-dialog-in">
        {/* Header */}
        <div
          className={`flex items-center gap-2.5 px-5 py-3.5 border-b ${
            danger ? 'border-error/20 bg-error/5' : 'border-outline-variant/10'
          }`}
        >
          {danger && (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-error shrink-0"
              aria-hidden
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          )}
          <h3
            className={`font-heading text-base font-semibold ${
              danger ? 'text-error' : 'text-on-surface'
            }`}
          >
            {danger ? '⚠ ' : ''}
            {toolDisplayName(pending.toolName)}
          </h3>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <p className="text-xs text-on-surface-variant mb-3">
            The following action will be performed:
          </p>
          <ParamsDisplay
            parameters={pending.parameters}
            editable={editableFields}
            draft={editDraft}
            onDraftChange={handleDraftChange}
          />
        </div>

        {/* Voice indicator */}
        <div className="px-5 pb-3 flex items-center gap-2 text-xs text-on-surface-variant/70">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-secondary" />
          </span>
          Say &quot;okay&quot; to allow once, &quot;always allow&quot; to never ask again, or &quot;cancel&quot; to stop
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3 border-t border-outline-variant/10 bg-surface-container/40">
          <button
            type="button"
            onClick={() => handleResolve('deny')}
            className={[
              'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150',
              'border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:border-outline-variant',
              flashingButton === 'deny'
                ? 'ring-2 ring-secondary/50 bg-secondary/10'
                : '',
            ].join(' ')}
          >
            Cancel
          </button>

          {editableFields && (
            <button
              type="button"
              onClick={() => setEditDraft(editDraft ? null : { ...pending.parameters })}
              className={[
                'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                'border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:border-outline-variant',
              ].join(' ')}
            >
              {hasDraft ? 'Discard edits' : 'Edit'}
            </button>
          )}

          <button
            type="button"
            onClick={() => handleResolve('always_allow')}
            className={[
              'px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-150',
              'text-on-surface-variant hover:text-primary hover:underline underline-offset-2',
              flashingButton === 'always_allow'
                ? 'ring-2 ring-secondary/50 bg-secondary/10'
                : '',
            ].join(' ')}
            title="Approve and never ask for this action again"
          >
            Always Allow
          </button>

          <button
            type="button"
            onClick={() => {
              const params = hasDraft ? editDraft! : undefined;
              handleResolve('approve', params);
            }}
            className={[
              'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150',
              danger
                ? 'bg-error text-on-error hover:brightness-110'
                : 'bg-primary text-on-primary hover:brightness-110',
              flashingButton === 'approve'
                ? 'ring-2 ring-secondary/50 scale-105'
                : '',
            ].join(' ')}
          >
            Allow Once
          </button>
        </div>
      </div>
    </div>
  );
}

function describeAction(confirmation: {
  toolName: string;
  parameters: Record<string, unknown>;
}): string {
  let paramsText: string;
  try {
    paramsText = JSON.stringify(confirmation.parameters);
  } catch {
    paramsText = '[unprintable parameters]';
  }
  return `Approval needed for ${confirmation.toolName} with parameters ${paramsText}. Say okay or yes to allow once, say always allow to never ask for this again, or cancel to stop.`;
}

export default ConfirmationDialog;
