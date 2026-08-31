import { create } from 'zustand';

/**
 * T-20: whether Autonomous Mode's master toggle is currently on. Kept in a
 * store (instead of fetched ad hoc) so the persistent composer badge reflects
 * changes made anywhere — Settings panel, or main-process broadcasts.
 */
interface AutonomousModeStore {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export const useAutonomousModeStore = create<AutonomousModeStore>(set => ({
  enabled: false,
  setEnabled: enabled => set({ enabled }),
}));