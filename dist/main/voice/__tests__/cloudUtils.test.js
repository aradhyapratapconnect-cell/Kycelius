"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const cloudUtils_1 = require("../engines/cloudUtils");
(0, vitest_1.describe)('appendV1Url', () => {
    (0, vitest_1.it)('appends the /v1 segment when the base lacks it', () => {
        (0, vitest_1.expect)((0, cloudUtils_1.appendV1Url)('https://a.example.com', '/audio/speech')).toBe('https://a.example.com/v1/audio/speech');
    });
    (0, vitest_1.it)('does not duplicate /v1 when the base already has it', () => {
        (0, vitest_1.expect)((0, cloudUtils_1.appendV1Url)('https://a.example.com/v1', '/audio/speech')).toBe('https://a.example.com/v1/audio/speech');
    });
    (0, vitest_1.it)('handles trailing slashes', () => {
        (0, vitest_1.expect)((0, cloudUtils_1.appendV1Url)('https://a.example.com/v1/', '/audio/transcriptions')).toBe('https://a.example.com/v1/audio/transcriptions');
        (0, vitest_1.expect)((0, cloudUtils_1.appendV1Url)('https://a.example.com/', '/audio/transcriptions')).toBe('https://a.example.com/v1/audio/transcriptions');
    });
});
(0, vitest_1.describe)('describeHttpError', () => {
    (0, vitest_1.it)('explains key rejection for 401/403', async () => {
        const msg = await (0, cloudUtils_1.describeHttpError)(new Response('no', { status: 401 }), 'My STT');
        (0, vitest_1.expect)(msg).toContain('rejected the API key');
    });
    (0, vitest_1.it)('points at the base URL for 404/405', async () => {
        const msg = await (0, cloudUtils_1.describeHttpError)(new Response('no', { status: 404 }), 'My TTS');
        (0, vitest_1.expect)(msg).toMatch(/base URL/i);
    });
    (0, vitest_1.it)('mentions rate limiting for 429', async () => {
        const msg = await (0, cloudUtils_1.describeHttpError)(new Response('slow down', { status: 429 }), 'My STT');
        (0, vitest_1.expect)(msg).toMatch(/rate-limited/i);
    });
    (0, vitest_1.it)('attributes 5xx to the provider side', async () => {
        const msg = await (0, cloudUtils_1.describeHttpError)(new Response('boom', { status: 503 }), 'My TTS');
        (0, vitest_1.expect)(msg).toMatch(/on their side/i);
    });
});
(0, vitest_1.describe)('readJson', () => {
    (0, vitest_1.it)('parses a valid JSON body', async () => {
        await (0, vitest_1.expect)((0, cloudUtils_1.readJson)(new Response('{"ok":true}', { status: 200 }), 'X')).resolves.toEqual({
            ok: true,
        });
    });
    (0, vitest_1.it)('throws a clean error on an unparseable body', async () => {
        await (0, vitest_1.expect)((0, cloudUtils_1.readJson)(new Response('<html>oops</html>', { status: 200 }), 'X')).rejects.toThrow(/unparseable response/);
    });
});
