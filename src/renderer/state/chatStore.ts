import { create } from 'zustand';
import { useAssistantStore } from './assistantStore';

export type ChatRole = 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  input_mode?: 'voice' | 'text';
  /** N-04: provider/model that produced this reply (shown under the bubble). */
  provider?: string;
  model?: string;
  created_at: string;
}

/** T-26: in-flight reply text, before the full turn is persisted. */
export interface StreamingState {
  turnId: string;
  text: string;
}

interface ChatStore {
  messages: ChatMessage[];
  isWorkspaceOpen: boolean;
  isSending: boolean;
  /** T-26: partial assistant text streamed from the main process. */
  streaming: StreamingState | null;
  speakingMessageId: string | null;
  sendMessage: (text: string, inputMode?: 'voice' | 'text') => Promise<void>;
  cancelGeneration: () => void;
  stopPlayback: () => void;
  startNewConversation: () => void;
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const useChatStore = create<ChatStore>((set, get) => {
  // Set by cancelGeneration; the awaited send-command turn is discarded when
  // this is true so no "Stopped." message or speech leaks into the chat.
  let cancelPending = false;

  // T-26: id of the active turn. Streamed tokens tagged with any other id are
  // stale (left over from a cancelled/superseded turn) and ignored.
  let activeTurnId: string | null = null;

  const speakAssistantMessage = (messageId: string, text: string) => {
    const assistant = useAssistantStore.getState();
    assistant.setAssistantState('speaking');
    set({ speakingMessageId: messageId });

    void window.kyclius
      ?.speak(text)
      .catch(() => {
        // TTS failure should not break the chat flow; drop back to idle.
      })
      .finally(() => {
        if (get().speakingMessageId === messageId) {
          set({ speakingMessageId: null });
          useAssistantStore.getState().setAssistantState('idle');
        }
      });
  };

  // T-26: assemble live reply text for the active turn. Token chunks arrive
  // high-frequency; a single IPC subscription feeds all surfaces.
  window.kyclius?.onAssistantToken?.(payload => {
    const state = get();
    if (!state.isSending || activeTurnId === null || payload.turnId !== activeTurnId) return;
    if (payload.delta === '') {
      set({ streaming: null });
      return;
    }
    const current =
      state.streaming && state.streaming.turnId === payload.turnId ? state.streaming.text : '';
    set({ streaming: { turnId: payload.turnId, text: current + payload.delta } });
  });

  // Tool rounds / turn end / errors supersede any partially streamed text.
  useAssistantStore.subscribe((state, prev) => {
    if (state.assistantState === prev.assistantState) return;
    if (
      state.assistantState === 'executing' ||
      state.assistantState === 'idle' ||
      state.assistantState === 'error'
    ) {
      if (get().streaming) set({ streaming: null });
    }
  });

  return {
    messages: [],
    isWorkspaceOpen: false,
    isSending: false,
    streaming: null,
    speakingMessageId: null,

    sendMessage: async (text, inputMode = 'text') => {
      const trimmed = text.trim();
      if (!trimmed || get().isSending) return;

      // First command of a session opens the workspace.
      set({ isWorkspaceOpen: true, isSending: true, streaming: null });
      useAssistantStore.getState().setAssistantState('thinking');

      // Interrupt any in-flight speech before starting a new turn.
      if (get().speakingMessageId) {
        window.kyclius?.stopSpeaking();
        set({ speakingMessageId: null });
      }

      const userMessage: ChatMessage = {
        id: newId(),
        role: 'user',
        content: trimmed,
        input_mode: inputMode,
        created_at: new Date().toISOString(),
      };
      set({ messages: [...get().messages, userMessage] });

      const turnId = newId();
      activeTurnId = turnId;

      try {
        const result = await window.kyclius?.sendCommand(trimmed, inputMode, turnId);
        // A turn cancelled while in flight is dropped entirely — no ghost
        // reply in the chat or a spoken "Stopped.".
        if (cancelPending) {
          cancelPending = false;
          activeTurnId = null;
          set({ isSending: false, streaming: null });
          useAssistantStore.getState().setAssistantState('idle');
          return;
        }
        const reply =
          result?.message ??
          (result?.success ? '' : `Sorry — something went wrong${result?.error ? `: ${result.error}` : '.'}`);

        const assistantMessage: ChatMessage = {
          id: newId(),
          role: 'assistant',
          content: reply.trim() || '(no reply)',
          provider: result?.route?.provider,
          model: result?.route?.model,
          created_at: new Date().toISOString(),
        };
        set({ messages: [...get().messages, assistantMessage], streaming: null });
        activeTurnId = null;

        // Speak while the text renders; per-message control can interrupt.
        speakAssistantMessage(assistantMessage.id, assistantMessage.content);
      } catch (err) {
        if (cancelPending) {
          cancelPending = false;
          activeTurnId = null;
          set({ isSending: false, streaming: null });
          useAssistantStore.getState().setAssistantState('idle');
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        set({
          messages: [
            ...get().messages,
            {
              id: newId(),
              role: 'assistant',
              content: `Sorry — something went wrong: ${message}`,
              created_at: new Date().toISOString(),
            },
          ],
          streaming: null,
        });
        activeTurnId = null;
        useAssistantStore.getState().setAssistantState('error');
        setTimeout(() => {
          if (!get().speakingMessageId) {
            useAssistantStore.getState().setAssistantState('idle');
          }
        }, 4000);
      } finally {
        set({ isSending: false });
      }
    },

    stopPlayback: () => {
      window.kyclius?.stopSpeaking();
      set({ speakingMessageId: null });
      useAssistantStore.getState().setAssistantState('idle');
    },

    // T-02 "Stop generating": asks the main process to abort the in-flight
    // turn and drops this turn's pending UI state. Replies already delivered
    // to the chat list are untouched.
    cancelGeneration: () => {
      cancelPending = true;
      activeTurnId = null;
      window.kyclius?.cancelCurrentTurn?.();
      window.kyclius?.stopSpeaking();
      set({ isSending: false, speakingMessageId: null, streaming: null });
      useAssistantStore.getState().setAssistantState('idle');
    },

    startNewConversation: () => {
      activeTurnId = null;
      window.kyclius?.stopSpeaking();
      set({
        messages: [],
        isWorkspaceOpen: false,
        isSending: false,
        speakingMessageId: null,
        streaming: null,
      });
      useAssistantStore.getState().setAssistantState('idle');
    },
  };
});
