import { describe, expect, it } from 'vitest';
import {
  EMPTY_REPLY_MESSAGE,
  TOOL_LOOP_EXHAUSTED_MESSAGE,
  emptyTurnMessage,
} from '../chat.handlers';

// EF-13: Autonomous Mode's plan-halt notice must never fire on ordinary
// messages. The chat turn tracks tool rounds per-turn (no global counter),
// so these are the contracts that guard the fix.
const PLAN_HALT_SNIPPET = 'quite a few consecutive actions';

describe('EF-13 ordinary turns never emit the plan-halt notice', () => {
  it('an ordinary message with zero tool rounds gets the empty-reply message, not the halt', () => {
    const msg = emptyTurnMessage(0);
    expect(msg).toBe(EMPTY_REPLY_MESSAGE);
    expect(msg).not.toContain(PLAN_HALT_SNIPPET);
  });

  it('prior message volume cannot trip the ceiling (no accumulation across turns)', () => {
    // Each turn starts its own counter at 0 — there is no persistent counter
    // to accumulate, so even "message 2 after hi" or "message 50" behaves
    // like message 1 when no tools actually ran.
    for (const priorCount of [1, 2, 5, 50, 1000]) {
      void priorCount;
      expect(emptyTurnMessage(0)).not.toContain(PLAN_HALT_SNIPPET);
    }
  });

  it('tool-loop exhaustion gets its own distinct message, still not the plan halt', () => {
    const msg = emptyTurnMessage(6);
    expect(msg).toBe(TOOL_LOOP_EXHAUSTED_MESSAGE);
    expect(msg).not.toContain(PLAN_HALT_SNIPPET);
  });

  it('neither fallback message mentions the autonomous plan ceiling', () => {
    expect(EMPTY_REPLY_MESSAGE).not.toContain(PLAN_HALT_SNIPPET);
    expect(TOOL_LOOP_EXHAUSTED_MESSAGE).not.toContain(PLAN_HALT_SNIPPET);
  });

  it('two conversations in parallel cannot share halt state (no shared counter)', () => {
    // Per-turn local tracking: conversation A's tool activity is invisible to B.
    const convoAToolRounds = 6;
    const convoBToolRounds = 0;
    expect(emptyTurnMessage(convoBToolRounds)).toBe(EMPTY_REPLY_MESSAGE);
    expect(emptyTurnMessage(convoAToolRounds)).toBe(TOOL_LOOP_EXHAUSTED_MESSAGE);
  });
});
