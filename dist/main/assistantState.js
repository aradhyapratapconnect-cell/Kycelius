"use strict";
/**
 * Single source of truth for broadcasting the assistant's high-level state
 * (idle / listening / thinking / executing / ...) to the renderer, so the
 * blob and UI reflect what the main process is actually doing.
 *
 * The renderer may still set states locally for instant feedback; these
 * broadcasts are the authoritative main-process transitions that arrive via
 * 'kyclius:assistant-state-change'.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastAssistantState = broadcastAssistantState;
exports.broadcastAssistantToken = broadcastAssistantToken;
const electron_1 = require("electron");
const tray_1 = require("./tray");
function broadcastAssistantState(state) {
    // T-18: while the assistant is doing anything (listening, thinking, awaiting
    // confirmation, executing, speaking) the tray shows "actively processing a
    // command"; idle and error return it to the wake-listening state.
    (0, tray_1.updateTrayAssistantActivity)(state === 'listening' ||
        state === 'thinking' ||
        state === 'awaiting_confirmation' ||
        state === 'executing' ||
        state === 'speaking');
    for (const win of electron_1.BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            win.webContents.send('kyclius:assistant-state-change', state);
        }
    }
}
/**
 * T-26: forward one reply token chunk to every window, tagged with the turn it
 * belongs to so the renderer can assemble/clear per-turn streaming bubbles.
 */
function broadcastAssistantToken(turnId, delta) {
    for (const win of electron_1.BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
            win.webContents.send('kyclius:assistant-token', { turnId, delta });
        }
    }
}
