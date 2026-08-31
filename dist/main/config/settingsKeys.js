"use strict";
/**
 * Shared user-facing setting keys and helpers that multiple IPC modules need
 * (voice handlers, tools handlers, settings handlers) without creating
 * import cycles between them.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VOICE_CONFIRMATION_ENABLED_KEY = void 0;
exports.isVoiceConfirmationEnabled = isVoiceConfirmationEnabled;
exports.setVoiceConfirmationEnabled = setVoiceConfirmationEnabled;
const db_1 = require("../db/db");
exports.VOICE_CONFIRMATION_ENABLED_KEY = 'voice_confirmation_enabled';
/**
 * Whether pending tool confirmations may be resolved by voice. Defaults to
 * true; when false, the confirmation dialog still opens (click-only mode)
 * and speaks the prompt itself, but no voice window is ever opened.
 */
function isVoiceConfirmationEnabled() {
    return db_1.userConfig.get(exports.VOICE_CONFIRMATION_ENABLED_KEY) !== 'false';
}
function setVoiceConfirmationEnabled(enabled) {
    db_1.userConfig.set(exports.VOICE_CONFIRMATION_ENABLED_KEY, enabled ? 'true' : 'false');
}
