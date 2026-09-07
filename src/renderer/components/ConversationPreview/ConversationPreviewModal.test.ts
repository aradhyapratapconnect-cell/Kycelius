import { describe, expect, it } from 'vitest';
import { transcriptToPlainText } from './ConversationPreviewModal';

// T-27 acceptance: copy controls produce correct plain-text output.
describe('T-27 transcriptToPlainText', () => {
  it('renders question/answer pairs in order as plain text', () => {
    const text = transcriptToPlainText({
      conversation: { id: 'c1', title: 'T', created_at: '2026-01-01', updated_at: '2026-01-01' },
      messages: [
        { id: 'm1', role: 'user', content: 'hi', created_at: '2026-01-01' },
        { id: 'm2', role: 'assistant', content: 'Hello!', created_at: '2026-01-01' },
        { id: 'm3', role: 'user', content: 'summarize it', created_at: '2026-01-01' },
        { id: 'm4', role: 'assistant', content: 'It is about weather.', created_at: '2026-01-01' },
      ],
    });
    expect(text).toBe('You: hi\n\nKyclius: Hello!\n\nYou: summarize it\n\nKyclius: It is about weather.');
  });

  it('uses real message content verbatim (no fabrication)', () => {
    const raw = 'C:\\Users\\aradh\\Downloads\\random_sample.pdf <weird> "chars"';
    const text = transcriptToPlainText({
      conversation: { id: 'c1', title: 'T', created_at: '2026-01-01', updated_at: '2026-01-01' },
      messages: [{ id: 'm1', role: 'assistant', content: raw, created_at: '2026-01-01' }],
    });
    expect(text).toBe(`Kyclius: ${raw}`);
  });

  it('empty scrollback yields an empty transcript', () => {
    const text = transcriptToPlainText({
      conversation: { id: 'c1', title: 'T', created_at: '2026-01-01', updated_at: '2026-01-01' },
      messages: [],
    });
    expect(text).toBe('');
  });
});
