import { create } from 'zustand';
import type { PendingConfirmation, ConfirmationAction } from '@shared/types/ipc';

interface ConfirmationStore {
  pending: PendingConfirmation | null;
  voiceResolvedAction: ConfirmationAction | null;
  editDraft: Record<string, unknown> | null;
  open: (confirmation: PendingConfirmation) => void;
  close: () => void;
  startFlash: (action: ConfirmationAction) => void;
  clearFlash: () => void;
  setEditDraft: (draft: Record<string, unknown> | null) => void;
}

export const useConfirmationStore = create<ConfirmationStore>((set, _get) => ({
  pending: null,
  voiceResolvedAction: null,
  editDraft: null,

  open: confirmation => {
    set({ pending: confirmation, voiceResolvedAction: null, editDraft: null });
  },

  close: () => {
    set({ pending: null, voiceResolvedAction: null, editDraft: null });
  },

  startFlash: action => {
    set({ voiceResolvedAction: action });
  },

  clearFlash: () => {
    set({ voiceResolvedAction: null });
  },

  setEditDraft: draft => {
    set({ editDraft: draft });
  },
}));
