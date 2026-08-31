/**
 * Shared user-facing setting keys and helpers that multiple IPC modules need
 * (voice handlers, tools handlers, settings handlers) without creating
 * import cycles between them.
 */

import { userConfig } from '../db/db';

export const VOICE_CONFIRMATION_ENABLED_KEY = 'voice_confirmation_enabled';

/**
 * Whether pending tool confirmations may be resolved by voice. Defaults to
 * true; when false, the confirmation dialog still opens (click-only mode)
 * and speaks the prompt itself, but no voice window is ever opened.
 */
export function isVoiceConfirmationEnabled(): boolean {
  return userConfig.get(VOICE_CONFIRMATION_ENABLED_KEY) !== 'false';
}

export function setVoiceConfirmationEnabled(enabled: boolean): void {
  userConfig.set(VOICE_CONFIRMATION_ENABLED_KEY, enabled ? 'true' : 'false');
}
