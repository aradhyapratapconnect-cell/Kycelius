/**
 * Single source of truth for broadcasting the assistant's high-level state
 * (idle / listening / thinking / executing / ...) to the renderer, so the
 * blob and UI reflect what the main process is actually doing.
 *
 * The renderer may still set states locally for instant feedback; these
 * broadcasts are the authoritative main-process transitions that arrive via
 * 'kyclius:assistant-state-change'.
 */

import { BrowserWindow } from 'electron';
import { updateTrayAssistantActivity } from './tray';

export type AssistantStateValue =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'awaiting_confirmation'
  | 'executing'
  | 'speaking'
  | 'error';

export function broadcastAssistantState(state: AssistantStateValue): void {
  // T-18: while the assistant is doing anything (listening, thinking, awaiting
  // confirmation, executing, speaking) the tray shows "actively processing a
  // command"; idle and error return it to the wake-listening state.
  updateTrayAssistantActivity(
    state === 'listening' ||
      state === 'thinking' ||
      state === 'awaiting_confirmation' ||
      state === 'executing' ||
      state === 'speaking'
  );

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('kyclius:assistant-state-change', state);
    }
  }
}

/**
 * T-26: forward one reply token chunk to every window, tagged with the turn it
 * belongs to so the renderer can assemble/clear per-turn streaming bubbles.
 */
export function broadcastAssistantToken(turnId: string, delta: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('kyclius:assistant-token', { turnId, delta });
    }
  }
}
