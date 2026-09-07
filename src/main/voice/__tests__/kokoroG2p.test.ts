import { existsSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
  arpabetToIpa,
  expandNumbers,
  loadLexicon,
  parseCmuDict,
  phonemize,
  resetLexiconCacheForTests,
  type Lexicon,
} from '../engines/kokoroG2p';

/** Tiny lexicon covering exactly the words these tests exercise. */
function testLexicon(): Lexicon {
  return parseCmuDict(
    [
      ';;; comment lines are skipped',
      'HELLO  HH AH0 L OW1',
      'WORLD  W ER1 L D',
      'WATER  W AO1 T ER0',
      'ATTACK  AH0 T AE1 K',
      'CITY  S IH1 T IY0',
      'JOHN  JH AA1 N',
      'TEST  T EH1 S T',
      'STATE  S T EY1 T',
      'OF  AH1 V',
      'THE  DH AH0',
      'ART  AA1 R T',
      'HELLO(2)  HH EH1 L OW1',
    ].join('\n')
  );
}

describe('parseCmuDict', () => {
  it('skips comments, uppercases keys, and keeps the first pronunciation', () => {
    const lex = testLexicon();
    expect(lex.get('HELLO')).toBe('HH AH0 L OW1');
    expect(lex.get('hello')).toBeUndefined(); // keys are upper-cased
    expect(lex.size).toBe(11);
  });
});

describe('arpabetToIpa', () => {
  it('maps hello to espeak-style phonemes with stress', () => {
    // HH AH0 L OW1 -> h + ə + l + ˈoʊ (NOT the char ids for h,e,l,l,o).
    expect(arpabetToIpa('HH AH0 L OW1')).toBe('həlˈoʊ');
  });

  it('marks secondary stress with ˌ and maps the full vowel inventory', () => {
    expect(arpabetToIpa('AE1')).toBe('ˈæ');
    expect(arpabetToIpa('AE2')).toBe('ˌæ');
    expect(arpabetToIpa('AA1 AO1 AW1 AY1 EH1 EY1 IH1 IY1 OW1 OY1 UH1 UW1')).toBe(
      'ˈɑˈɔˈaʊˈaɪˈɛˈeɪˈɪˈiˈoʊˈɔɪˈʊˈu'
    );
    expect(arpabetToIpa('ER0')).toBe('ɚ');
    expect(arpabetToIpa('ER1')).toBe('ˈɝ');
  });

  it('uses ɡ (U+0261) for G and ɹ for R, matching the vocab', () => {
    expect(arpabetToIpa('G R')).toBe('ɡɹ');
    expect(arpabetToIpa('CH JH SH TH NG ZH DH')).toBe('tʃdʒʃθŋʒð');
  });

  it('flaps intervocalic t/d after a stressed vowel (water, city)', () => {
    expect(arpabetToIpa('W AO1 T ER0')).toBe('wˈɔɾɚ');
    expect(arpabetToIpa('S IH1 T IY0')).toBe('sˈɪɾi');
  });

  it('does not flap before a stressed vowel (attack)', () => {
    expect(arpabetToIpa('AH0 T AE1 K')).toBe('ətˈæk');
  });

  it('drops unknown phones instead of inventing IDs', () => {
    expect(arpabetToIpa('HH QX1 L')).toBe('hl');
  });
});

describe('expandNumbers', () => {
  it('expands cardinals, decimals, currency, percent, and ordinals', () => {
    expect(expandNumbers('3')).toBe('three');
    expect(expandNumbers('3.14')).toBe('three point one four');
    expect(expandNumbers('$5')).toBe('five dollars');
    expect(expandNumbers('50%')).toBe('fifty percent');
    expect(expandNumbers('1st')).toBe('first');
    expect(expandNumbers('21st')).toBe('twenty-first');
    expect(expandNumbers('I have 2 apples')).toBe('I have two apples');
  });
});

describe('phonemize', () => {
  it('converts words to IPA via the lexicon (the tokenizer-bug fix)', () => {
    expect(phonemize('hello world', testLexicon())).toBe('həlˈoʊ wˈɝld');
  });

  it('keeps sentence punctuation for pauses and drops the rest', () => {
    expect(phonemize('hello, "world"!', testLexicon())).toBe('həlˈoʊ , wˈɝld !');
  });

  it('splits hyphen compounds and voices possessives', () => {
    expect(phonemize("state-of-the-art john's test", testLexicon())).toBe(
      'stˈeɪt əv ðə ˈɑɹt dʒˈɑnz tˈɛst'
    );
  });

  it('de-stresses function words the way running speech does', () => {
    // OF is AH1 V in citation form but surfaces unstressed between content words.
    expect(phonemize('of', testLexicon())).toBe('əv');
  });

  it('falls back to plain letters for out-of-vocabulary words', () => {
    expect(phonemize('hello xyzqw', testLexicon())).toBe('həlˈoʊ xyzqw');
  });

  it('returns normalized text unchanged when the lexicon is missing (legacy path)', () => {
    expect(phonemize("Hello, can't stop!", null)).toBe('hello, cannot stop!');
  });

  it('never returns empty for non-empty input', () => {
    expect(phonemize('###', testLexicon())).toBe('###');
  });

  // Guards the real-data path: the shipped cmudict.dict must resolve the same
  // words the same way. Skips on machines without the model files installed.
  const REAL_LEXICON = 'C:\\Users\\aradh\\AppData\\Roaming\\kyclius\\kokoro\\cmudict.dict';
  it.skipIf(!existsSync(REAL_LEXICON))('real lexicon phonemizes hello like the reference', async () => {
    resetLexiconCacheForTests();
    const lexicon = await loadLexicon(REAL_LEXICON);
    expect(lexicon).not.toBeNull();
    expect(phonemize('hello', lexicon)).toBe('həlˈoʊ');
    resetLexiconCacheForTests();
  });
});
