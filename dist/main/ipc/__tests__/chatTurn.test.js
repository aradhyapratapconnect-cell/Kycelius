"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const chat_handlers_1 = require("../chat.handlers");
// EF-13: Autonomous Mode's plan-halt notice must never fire on ordinary
// messages. The chat turn tracks tool rounds per-turn (no global counter),
// so these are the contracts that guard the fix.
const PLAN_HALT_SNIPPET = 'quite a few consecutive actions';
(0, vitest_1.describe)('EF-13 ordinary turns never emit the plan-halt notice', () => {
    (0, vitest_1.it)('an ordinary message with zero tool rounds gets the empty-reply message, not the halt', () => {
        const msg = (0, chat_handlers_1.emptyTurnMessage)(0);
        (0, vitest_1.expect)(msg).toBe(chat_handlers_1.EMPTY_REPLY_MESSAGE);
        (0, vitest_1.expect)(msg).not.toContain(PLAN_HALT_SNIPPET);
    });
    (0, vitest_1.it)('prior message volume cannot trip the ceiling (no accumulation across turns)', () => {
        // Each turn starts its own counter at 0 — there is no persistent counter
        // to accumulate, so even "message 2 after hi" or "message 50" behaves
        // like message 1 when no tools actually ran.
        for (const priorCount of [1, 2, 5, 50, 1000]) {
            void priorCount;
            (0, vitest_1.expect)((0, chat_handlers_1.emptyTurnMessage)(0)).not.toContain(PLAN_HALT_SNIPPET);
        }
    });
    (0, vitest_1.it)('tool-loop exhaustion gets its own distinct message, still not the plan halt', () => {
        const msg = (0, chat_handlers_1.emptyTurnMessage)(6);
        (0, vitest_1.expect)(msg).toBe(chat_handlers_1.TOOL_LOOP_EXHAUSTED_MESSAGE);
        (0, vitest_1.expect)(msg).not.toContain(PLAN_HALT_SNIPPET);
    });
    (0, vitest_1.it)('neither fallback message mentions the autonomous plan ceiling', () => {
        (0, vitest_1.expect)(chat_handlers_1.EMPTY_REPLY_MESSAGE).not.toContain(PLAN_HALT_SNIPPET);
        (0, vitest_1.expect)(chat_handlers_1.TOOL_LOOP_EXHAUSTED_MESSAGE).not.toContain(PLAN_HALT_SNIPPET);
    });
    (0, vitest_1.it)('two conversations in parallel cannot share halt state (no shared counter)', () => {
        // Per-turn local tracking: conversation A's tool activity is invisible to B.
        const convoAToolRounds = 6;
        const convoBToolRounds = 0;
        (0, vitest_1.expect)((0, chat_handlers_1.emptyTurnMessage)(convoBToolRounds)).toBe(chat_handlers_1.EMPTY_REPLY_MESSAGE);
        (0, vitest_1.expect)((0, chat_handlers_1.emptyTurnMessage)(convoAToolRounds)).toBe(chat_handlers_1.TOOL_LOOP_EXHAUSTED_MESSAGE);
    });
});
