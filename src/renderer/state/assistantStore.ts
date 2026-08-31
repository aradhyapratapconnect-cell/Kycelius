import { create } from 'zustand';
import type { AssistantState } from '@shared/types/ipc';

interface AssistantStore {
  assistantState: AssistantState;
  setAssistantState: (state: AssistantState) => void;
}

export const useAssistantStore = create<AssistantStore>(set => ({
  assistantState: 'idle',
  setAssistantState: state => set({ assistantState: state }),
}));
