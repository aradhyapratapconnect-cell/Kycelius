"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishTranscript = publishTranscript;
exports.subscribeToTranscripts = subscribeToTranscripts;
exports.resetTranscriptBus = resetTranscriptBus;
const listeners = new Set();
function publishTranscript(text, isFinal) {
    if (typeof text !== 'string' || text.trim().length === 0)
        return;
    for (const listener of listeners)
        listener(text, isFinal);
}
function subscribeToTranscripts(listener) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
function resetTranscriptBus() {
    listeners.clear();
}
