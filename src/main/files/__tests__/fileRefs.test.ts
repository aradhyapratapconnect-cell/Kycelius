import { describe, expect, it } from 'vitest';
import { findFileRefs, stripFileRefs } from '../fileRefs';

describe('findFileRefs', () => {
  it('finds a Windows path mention', () => {
    const refs = findFileRefs('summarize @C:\\docs\\report.pdf');
    expect(refs).toHaveLength(1);
    expect(refs[0].path).toBe('C:\\docs\\report.pdf');
  });

  it('finds multiple mentions in one command', () => {
    const refs = findFileRefs('compare @a.pdf with @b.xlsx');
    expect(refs.map(r => r.path)).toEqual(['a.pdf', 'b.xlsx']);
  });

  it('finds a quoted mention with spaces', () => {
    const refs = findFileRefs('read @"C:\\my docs\\file one.pdf" please');
    expect(refs).toHaveLength(1);
    expect(refs[0].path).toBe('C:\\my docs\\file one.pdf');
  });

  it('finds a single-quoted mention', () => {
    expect(findFileRefs("read @'notes file.txt'")[0].path).toBe('notes file.txt');
  });

  it('stops a bare mention at punctuation', () => {
    const refs = findFileRefs('read @f.txt, ok?');
    expect(refs).toHaveLength(1);
    expect(refs[0].path).toBe('f.txt');
  });

  it('accepts a bare mention with a known extension', () => {
    expect(findFileRefs('read @report.pdf')[0].path).toBe('report.pdf');
  });

  it('does not treat an email address as a file', () => {
    expect(findFileRefs('email sam@example.com the notes')).toHaveLength(0);
  });

  it('does not treat a bare unknown word as a mention', () => {
    expect(findFileRefs('please read the report now')).toHaveLength(0);
  });

  it('returns no refs for empty or mention-less text', () => {
    expect(findFileRefs('')).toHaveLength(0);
    expect(findFileRefs('nothing here')).toHaveLength(0);
  });
});

describe('stripFileRefs', () => {
  it('removes the mention but keeps the instruction', () => {
    expect(stripFileRefs('summarize @C:\\docs\\report.pdf')).toBe('summarize');
  });

  it('keeps surrounding wording', () => {
    expect(stripFileRefs('please summarize @a.pdf for me')).toBe('please summarize for me');
  });

  it('strips quoted mentions too', () => {
    expect(stripFileRefs('read @"my file.pdf" now')).toBe('read now');
  });

  it('leaves email addresses untouched', () => {
    expect(stripFileRefs('email sam@example.com please')).toBe('email sam@example.com please');
  });

  it('collapses double spaces left by stripping', () => {
    expect(stripFileRefs('a @f.pdf b')).toBe('a b');
  });
});