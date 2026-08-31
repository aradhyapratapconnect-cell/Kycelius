import type { ConfirmationResponse, QueuedConfirmation } from '../permissions/confirmationQueue';

export type SpeechDecision = 'approve' | 'deny' | 'always_allow' | 'ignore';

const AFFIRMATIVE_WORDS = ['okay', 'yes', 'confirm', 'continue', 'send', 'send it'];
const NEGATIVE_WORDS = ['cancel', 'stop', 'no'];
const ALWAYS_ALLOW_PHRASES = ['always allow', 'allow always'];

export const DEFAULT_CONFIRMATION_WINDOW_MS = 15000;

function normalize(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifySpeech(raw: string): SpeechDecision {
  const text = normalize(raw);
  if (!text) return 'ignore';

  const words = text.split(' ');
  const wordSet = new Set(words);

  for (const negative of NEGATIVE_WORDS) {
    if (wordSet.has(negative)) return 'deny';
  }

  // T-21/T-04: "always allow" opts the action into the same store the Permissions
  // panel writes. Checked as a full phrase — never a single-word match — so
  // "always allow the delete" still qualifies while "allow" alone stays ignored.
  for (const phrase of ALWAYS_ALLOW_PHRASES) {
    if (text.includes(phrase)) return 'always_allow';
  }

  if (words.length > 3) return 'ignore';

  // Multi-word affirmative phrases must be checked against the full text,
  // not individual words. Single-word affirmatives use the word set.
  const PHRASE_AFFIRMATIVES = ['send it'];
  for (const phrase of PHRASE_AFFIRMATIVES) {
    if (text.includes(phrase)) return 'approve';
  }

  for (const affirmative of AFFIRMATIVE_WORDS) {
    if (wordSet.has(affirmative)) return 'approve';
  }

  return 'ignore';
}

export function describePendingAction(confirmation: {
  toolName: string;
  parameters: Record<string, unknown>;
}): string {
  let paramsText: string;
  try {
    paramsText = JSON.stringify(confirmation.parameters);
  } catch {
    paramsText = '[unprintable parameters]';
  }
  return `Approval needed for ${confirmation.toolName} with parameters ${paramsText}. Say okay, yes, or send it to confirm — say always allow to never ask for this again — or cancel to stop.`;
}

interface WindowState {
  id: string;
  timer: ReturnType<typeof setTimeout>;
  startedOwnCapture: boolean;
  gateOpen: boolean;
  settled: boolean;
  unsubscribeTranscripts: () => void;
}

export interface VoiceConfirmationDeps {
  subscribeQueue(listener: (pending: readonly QueuedConfirmation[]) => void): () => void;
  subscribeTranscripts(listener: (text: string, isFinal: boolean) => void): () => void;
  respond(id: string, response: ConfirmationResponse): boolean;
  speak(text: string): Promise<void>;
  startCapture(): void;
  stopCapture(): void;
  isCapturing(): boolean;
  /**
   * Click-only confirmation mode (Security doc §3): when this returns false,
   * no voice window is opened and confirmations wait for a click. Optional
   * so existing installs/tests default to voice-enabled behavior.
   */
  isEnabled?(): boolean;
  timeoutMs?: number;
}

class VoiceConfirmationListener {
  private deps: VoiceConfirmationDeps | null = null;
  private unsubscribeQueue: (() => void) | null = null;
  private windowState: WindowState | null = null;

  install(deps: VoiceConfirmationDeps): void {
    this.uninstall();
    this.deps = deps;
    this.unsubscribeQueue = deps.subscribeQueue(pending => this.handleQueueChange(pending));
  }

  uninstall(): void {
    this.closeWindow();
    if (this.unsubscribeQueue) {
      this.unsubscribeQueue();
      this.unsubscribeQueue = null;
    }
    this.deps = null;
  }

  getWindowConfirmationId(): string | null {
    return this.windowState?.id ?? null;
  }

  private handleQueueChange(pending: readonly QueuedConfirmation[]): void {
    const trackedId = this.windowState?.id;
    if (trackedId && !pending.some(entry => entry.id === trackedId)) {
      this.closeWindow();
    }
    if (!this.windowState && pending.length > 0) {
      this.openWindow(pending[0]);
    }
  }

  private openWindow(confirmation: QueuedConfirmation): void {
    const deps = this.deps;
    if (!deps || this.windowState) return;
    if (deps.isEnabled && !deps.isEnabled()) return;

    const timeoutMs = deps.timeoutMs ?? DEFAULT_CONFIRMATION_WINDOW_MS;
    const startedOwnCapture = !deps.isCapturing();

    const state: WindowState = {
      id: confirmation.id,
      timer: setTimeout(() => {
        if (this.windowState !== state || state.settled) return;
        state.settled = true;
        deps.respond(state.id, {
          action: 'deny',
          reason: 'Voice confirmation window timed out.',
        });
      }, timeoutMs),
      startedOwnCapture,
      gateOpen: false,
      settled: false,
      unsubscribeTranscripts: () => {},
    };
    this.windowState = state;

    state.unsubscribeTranscripts = deps.subscribeTranscripts((text: string, isFinal?: boolean) => {
      // Security doc §3: only a short utterance whose primary content is the
      // phrase may resolve a confirmation. Streaming interim transcripts are
      // fragments of ongoing speech, so they never qualify.
      if (isFinal === false) return;
      if (this.windowState !== state || !state.gateOpen || state.settled) return;
      const decision = classifySpeech(text);
      if (decision === 'ignore') return;
      state.settled = true;
      const response: ConfirmationResponse =
        decision === 'approve'
          ? { action: 'approve', reason: 'Approved by voice.' }
          : decision === 'always_allow'
            ? { action: 'always_allow', reason: 'Approved and always allowed by voice.' }
            : { action: 'deny', reason: 'Denied by voice.' };
      deps.respond(state.id, response);
    });

    if (startedOwnCapture) deps.startCapture();

    void Promise.resolve(deps.speak(describePendingAction(confirmation)))
      .catch(() => {})
      .then(() => {
        if (this.windowState === state) {
          state.gateOpen = true;
        }
      });
  }

  private closeWindow(): void {
    const state = this.windowState;
    if (!state) return;
    this.windowState = null;
    clearTimeout(state.timer);
    state.unsubscribeTranscripts();
    if (state.startedOwnCapture) {
      this.deps?.stopCapture();
    }
  }
}

export const voiceConfirmationListener = new VoiceConfirmationListener();
