"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const voiceConfirmationListener_1 = require("../voiceConfirmationListener");
function makeConfirmation(id = 'conf-1') {
    return {
        id,
        toolName: 'run_shell_command',
        parameters: { command: 'rm -rf build/' },
        enqueuedAt: Date.now(),
    };
}
function makeDeps(options) {
    const queueListeners = new Set();
    const transcriptListeners = new Set();
    let pending = [];
    const responded = [];
    const harness = {
        deps: {
            subscribeQueue: listener => {
                queueListeners.add(listener);
                return () => queueListeners.delete(listener);
            },
            subscribeTranscripts: listener => {
                transcriptListeners.add(listener);
                return () => transcriptListeners.delete(listener);
            },
            respond: vitest_1.vi.fn((id, response) => {
                if (!pending.some(entry => entry.id === id))
                    return false;
                responded.push({ id, response });
                pending = pending.filter(entry => entry.id !== id);
                harness.emitQueue(pending);
                return true;
            }),
            speak: vitest_1.vi.fn(async (_text) => { }),
            startCapture: vitest_1.vi.fn(),
            stopCapture: vitest_1.vi.fn(),
            isCapturing: vitest_1.vi.fn(() => options?.capturing ?? false),
            timeoutMs: 60,
        },
        emitQueue: next => {
            pending = next;
            for (const listener of queueListeners)
                listener(next);
        },
        emitTranscript: (text, isFinal = true) => {
            for (const listener of transcriptListeners)
                listener(text, isFinal);
        },
        responded,
    };
    return harness;
}
async function flush(ms = 20) {
    await new Promise(resolve => setTimeout(resolve, ms));
}
(0, vitest_1.describe)('classifySpeech', () => {
    (0, vitest_1.it)('approves short affirmative utterances', () => {
        (0, vitest_1.expect)((0, voiceConfirmationListener_1.classifySpeech)('Okay.')).toBe('approve');
        (0, vitest_1.expect)((0, voiceConfirmationListener_1.classifySpeech)('yes please')).toBe('approve');
        (0, vitest_1.expect)((0, voiceConfirmationListener_1.classifySpeech)('send it')).toBe('approve');
        (0, vitest_1.expect)((0, voiceConfirmationListener_1.classifySpeech)('Confirm')).toBe('approve');
    });
    (0, vitest_1.it)('denies negative words anywhere in the utterance', () => {
        (0, vitest_1.expect)((0, voiceConfirmationListener_1.classifySpeech)('cancel')).toBe('deny');
        (0, vitest_1.expect)((0, voiceConfirmationListener_1.classifySpeech)('no!')).toBe('deny');
        (0, vitest_1.expect)((0, voiceConfirmationListener_1.classifySpeech)('stop, wait')).toBe('deny');
        (0, vitest_1.expect)((0, voiceConfirmationListener_1.classifySpeech)('actually no way')).toBe('deny');
    });
    (0, vitest_1.it)('classifies "always allow" phrases as always_allow, not approve', () => {
        (0, vitest_1.expect)((0, voiceConfirmationListener_1.classifySpeech)('always allow')).toBe('always_allow');
        (0, vitest_1.expect)((0, voiceConfirmationListener_1.classifySpeech)('allow always')).toBe('always_allow');
        (0, vitest_1.expect)((0, voiceConfirmationListener_1.classifySpeech)('always allow the delete')).toBe('always_allow');
        (0, vitest_1.expect)((0, voiceConfirmationListener_1.classifySpeech)('please always allow')).toBe('always_allow');
    });
    (0, vitest_1.it)('never approves long sentences even if they contain an affirmative word', () => {
        (0, vitest_1.expect)((0, voiceConfirmationListener_1.classifySpeech)('no wait actually I meant continue with that other thing')).toBe('deny');
        (0, vitest_1.expect)((0, voiceConfirmationListener_1.classifySpeech)('hey so I was thinking maybe you could okay just look at this')).toBe('ignore');
    });
    (0, vitest_1.it)('ignores unrelated speech and emptiness', () => {
        (0, vitest_1.expect)((0, voiceConfirmationListener_1.classifySpeech)("what's the weather like tomorrow?")).toBe('ignore');
        (0, vitest_1.expect)((0, voiceConfirmationListener_1.classifySpeech)('   ')).toBe('ignore');
        (0, vitest_1.expect)((0, voiceConfirmationListener_1.classifySpeech)('delete the file now')).toBe('ignore');
    });
});
(0, vitest_1.describe)('describePendingAction', () => {
    (0, vitest_1.it)('reads the exact tool name and parameters aloud', () => {
        const spoken = (0, voiceConfirmationListener_1.describePendingAction)({
            toolName: 'delete_file',
            parameters: { path: 'C:/temp/notes.txt' },
        });
        (0, vitest_1.expect)(spoken).toContain('delete_file');
        (0, vitest_1.expect)(spoken).toContain('C:/temp/notes.txt');
        (0, vitest_1.expect)(spoken).toMatch(/cancel/i);
    });
});
(0, vitest_1.describe)('voiceConfirmationListener windows', () => {
    let harness;
    (0, vitest_1.beforeEach)(() => {
        harness = makeDeps();
        voiceConfirmationListener_1.voiceConfirmationListener.install(harness.deps);
    });
    (0, vitest_1.afterEach)(() => {
        voiceConfirmationListener_1.voiceConfirmationListener.uninstall();
    });
    (0, vitest_1.it)('resolves approve through the same handler clicks use when an affirmative phrase arrives', async () => {
        harness.emitQueue([makeConfirmation()]);
        await flush();
        harness.emitTranscript('Okay.');
        await flush();
        (0, vitest_1.expect)(harness.responded).toEqual([
            { id: 'conf-1', response: { action: 'approve', reason: 'Approved by voice.' } },
        ]);
        (0, vitest_1.expect)(voiceConfirmationListener_1.voiceConfirmationListener.getWindowConfirmationId()).toBeNull();
    });
    (0, vitest_1.it)('resolves "always allow" into the always_allow action the panel store understands', async () => {
        harness.emitQueue([makeConfirmation()]);
        await flush();
        harness.emitTranscript('always allow');
        await flush();
        (0, vitest_1.expect)(harness.responded).toEqual([
            {
                id: 'conf-1',
                response: {
                    action: 'always_allow',
                    reason: 'Approved and always allowed by voice.',
                },
            },
        ]);
        (0, vitest_1.expect)(voiceConfirmationListener_1.voiceConfirmationListener.getWindowConfirmationId()).toBeNull();
    });
    (0, vitest_1.it)('reads the pending action aloud when the window opens', async () => {
        harness.emitQueue([makeConfirmation()]);
        await flush();
        (0, vitest_1.expect)(harness.deps.speak).toHaveBeenCalledTimes(1);
        const spoken = harness.deps.speak.mock.calls[0][0];
        (0, vitest_1.expect)(spoken).toContain('run_shell_command');
        (0, vitest_1.expect)(spoken).toContain('rm -rf build/');
    });
    (0, vitest_1.it)('starts its own capture when idle and stops it on resolution', async () => {
        harness.emitQueue([makeConfirmation()]);
        await flush();
        (0, vitest_1.expect)(harness.deps.startCapture).toHaveBeenCalledTimes(1);
        harness.emitTranscript('yes');
        await flush();
        (0, vitest_1.expect)(harness.deps.stopCapture).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('does not steal capture control when a session is already active', async () => {
        voiceConfirmationListener_1.voiceConfirmationListener.uninstall();
        harness = makeDeps({ capturing: true });
        voiceConfirmationListener_1.voiceConfirmationListener.install(harness.deps);
        harness.emitQueue([makeConfirmation()]);
        await flush();
        harness.emitTranscript('confirm');
        await flush();
        (0, vitest_1.expect)(harness.deps.startCapture).not.toHaveBeenCalled();
        (0, vitest_1.expect)(harness.deps.stopCapture).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('resolves deny for a negative phrase', async () => {
        harness.emitQueue([makeConfirmation()]);
        await flush();
        harness.emitTranscript('cancel that');
        await flush();
        (0, vitest_1.expect)(harness.responded).toEqual([
            { id: 'conf-1', response: { action: 'deny', reason: 'Denied by voice.' } },
        ]);
    });
    (0, vitest_1.it)('fails closed: unrecognized speech plus timeout denies without executing', async () => {
        harness.emitQueue([makeConfirmation()]);
        await flush();
        harness.emitTranscript('what time is it in Tokyo');
        await new Promise(resolve => setTimeout(resolve, 120));
        (0, vitest_1.expect)(harness.responded).toEqual([
            {
                id: 'conf-1',
                response: { action: 'deny', reason: 'Voice confirmation window timed out.' },
            },
        ]);
        (0, vitest_1.expect)(harness.responded[0].response.action).not.toBe('approve');
    });
    (0, vitest_1.it)('closes the window immediately when a click resolves the confirmation first', async () => {
        harness.emitQueue([makeConfirmation()]);
        await flush();
        harness.emitQueue([]);
        await flush(5);
        harness.emitTranscript('okay yes absolutely confirm');
        await new Promise(resolve => setTimeout(resolve, 120));
        (0, vitest_1.expect)(harness.responded).toHaveLength(0);
        (0, vitest_1.expect)(voiceConfirmationListener_1.voiceConfirmationListener.getWindowConfirmationId()).toBeNull();
    });
    (0, vitest_1.it)('ignores speech during TTS playback, then listens after the spoken prompt ends', async () => {
        voiceConfirmationListener_1.voiceConfirmationListener.uninstall();
        let releaseSpeak;
        harness = makeDeps();
        harness.deps.speak.mockImplementation(() => new Promise(resolve => {
            releaseSpeak = resolve;
        }));
        harness.deps.timeoutMs = 5000;
        voiceConfirmationListener_1.voiceConfirmationListener.install(harness.deps);
        harness.emitQueue([makeConfirmation()]);
        await flush();
        harness.emitTranscript('okay');
        await flush();
        (0, vitest_1.expect)(harness.responded).toHaveLength(0);
        releaseSpeak();
        await flush();
        harness.emitTranscript('okay');
        await flush();
        (0, vitest_1.expect)(harness.responded).toEqual([
            { id: 'conf-1', response: { action: 'approve', reason: 'Approved by voice.' } },
        ]);
    });
    (0, vitest_1.it)('gives each sequential confirmation its own isolated window', async () => {
        harness.emitQueue([makeConfirmation('conf-1')]);
        await flush();
        harness.emitTranscript('yes');
        await flush();
        (0, vitest_1.expect)(harness.responded.map(r => r.response.action)).toEqual(['approve']);
        harness.emitQueue([
            makeConfirmation('conf-2'),
        ]);
        await flush();
        (0, vitest_1.expect)(voiceConfirmationListener_1.voiceConfirmationListener.getWindowConfirmationId()).toBe('conf-2');
        harness.emitTranscript('cancel');
        await flush();
        (0, vitest_1.expect)(harness.responded).toEqual([
            { id: 'conf-1', response: { action: 'approve', reason: 'Approved by voice.' } },
            { id: 'conf-2', response: { action: 'deny', reason: 'Denied by voice.' } },
        ]);
    });
    (0, vitest_1.it)('stops listening entirely after uninstall', async () => {
        harness.emitQueue([makeConfirmation()]);
        await flush();
        voiceConfirmationListener_1.voiceConfirmationListener.uninstall();
        harness.emitTranscript('okay');
        await new Promise(resolve => setTimeout(resolve, 120));
        (0, vitest_1.expect)(harness.responded).toHaveLength(0);
        (0, vitest_1.expect)(harness.deps.stopCapture).toHaveBeenCalledTimes(1);
    });
});
