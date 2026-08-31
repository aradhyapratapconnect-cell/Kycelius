"use strict";
/**
 * Minimal Server-Sent Events (SSE) parser for LLM streaming responses (T-26).
 * Yields each event as it arrives so tokens forward to the renderer as chunks
 * land, rather than buffering the whole response.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSseStream = parseSseStream;
exports.isDoneData = isDoneData;
async function* parseSseStream(response, signal) {
    if (!response.body) {
        throw new Error('response has no readable body');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            let boundary;
            while ((boundary = buffer.indexOf('\n\n')) !== -1) {
                const rawEvent = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                const parsed = parseEventBlock(rawEvent);
                if (parsed)
                    yield parsed;
            }
        }
        // Trailing block without a final blank line.
        if (buffer.trim().length > 0) {
            const parsed = parseEventBlock(buffer);
            if (parsed)
                yield parsed;
        }
    }
    catch (err) {
        if (signal?.aborted)
            return;
        throw err;
    }
    finally {
        reader.releaseLock();
    }
}
function parseEventBlock(raw) {
    let event = 'message';
    const dataLines = [];
    for (const rawLine of raw.split('\n')) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (line.startsWith('event:')) {
            event = line.slice(6).trim();
        }
        else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).replace(/^ /, ''));
        }
    }
    if (dataLines.length === 0)
        return null;
    return { event, data: dataLines.join('\n') };
}
/** Strips the `[DONE]` sentinel and no-op `keepalive` events. */
function isDoneData(data) {
    return data.trim() === '[DONE]';
}
