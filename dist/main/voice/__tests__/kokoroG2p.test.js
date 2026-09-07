"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const vitest_1 = require("vitest");
const kokoroG2p_1 = require("../engines/kokoroG2p");
/** Tiny lexicon covering exactly the words these tests exercise. */
function testLexicon() {
    return (0, kokoroG2p_1.parseCmuDict)([
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
    ].join('\n'));
}
(0, vitest_1.describe)('parseCmuDict', () => {
    (0, vitest_1.it)('skips comments, uppercases keys, and keeps the first pronunciation', () => {
        const lex = testLexicon();
        (0, vitest_1.expect)(lex.get('HELLO')).toBe('HH AH0 L OW1');
        (0, vitest_1.expect)(lex.get('hello')).toBeUndefined(); // keys are upper-cased
        (0, vitest_1.expect)(lex.size).toBe(11);
    });
});
(0, vitest_1.describe)('arpabetToIpa', () => {
    (0, vitest_1.it)('maps hello to espeak-style phonemes with stress', () => {
        // HH AH0 L OW1 -> h + ə + l + ˈoʊ (NOT the char ids for h,e,l,l,o).
        (0, vitest_1.expect)((0, kokoroG2p_1.arpabetToIpa)('HH AH0 L OW1')).toBe('həlˈoʊ');
    });
    (0, vitest_1.it)('marks secondary stress with ˌ and maps the full vowel inventory', () => {
        (0, vitest_1.expect)((0, kokoroG2p_1.arpabetToIpa)('AE1')).toBe('ˈæ');
        (0, vitest_1.expect)((0, kokoroG2p_1.arpabetToIpa)('AE2')).toBe('ˌæ');
        (0, vitest_1.expect)((0, kokoroG2p_1.arpabetToIpa)('AA1 AO1 AW1 AY1 EH1 EY1 IH1 IY1 OW1 OY1 UH1 UW1')).toBe('ˈɑˈɔˈaʊˈaɪˈɛˈeɪˈɪˈiˈoʊˈɔɪˈʊˈu');
        (0, vitest_1.expect)((0, kokoroG2p_1.arpabetToIpa)('ER0')).toBe('ɚ');
        (0, vitest_1.expect)((0, kokoroG2p_1.arpabetToIpa)('ER1')).toBe('ˈɝ');
    });
    (0, vitest_1.it)('uses ɡ (U+0261) for G and ɹ for R, matching the vocab', () => {
        (0, vitest_1.expect)((0, kokoroG2p_1.arpabetToIpa)('G R')).toBe('ɡɹ');
        (0, vitest_1.expect)((0, kokoroG2p_1.arpabetToIpa)('CH JH SH TH NG ZH DH')).toBe('tʃdʒʃθŋʒð');
    });
    (0, vitest_1.it)('flaps intervocalic t/d after a stressed vowel (water, city)', () => {
        (0, vitest_1.expect)((0, kokoroG2p_1.arpabetToIpa)('W AO1 T ER0')).toBe('wˈɔɾɚ');
        (0, vitest_1.expect)((0, kokoroG2p_1.arpabetToIpa)('S IH1 T IY0')).toBe('sˈɪɾi');
    });
    (0, vitest_1.it)('does not flap before a stressed vowel (attack)', () => {
        (0, vitest_1.expect)((0, kokoroG2p_1.arpabetToIpa)('AH0 T AE1 K')).toBe('ətˈæk');
    });
    (0, vitest_1.it)('drops unknown phones instead of inventing IDs', () => {
        (0, vitest_1.expect)((0, kokoroG2p_1.arpabetToIpa)('HH QX1 L')).toBe('hl');
    });
});
(0, vitest_1.describe)('expandNumbers', () => {
    (0, vitest_1.it)('expands cardinals, decimals, currency, percent, and ordinals', () => {
        (0, vitest_1.expect)((0, kokoroG2p_1.expandNumbers)('3')).toBe('three');
        (0, vitest_1.expect)((0, kokoroG2p_1.expandNumbers)('3.14')).toBe('three point one four');
        (0, vitest_1.expect)((0, kokoroG2p_1.expandNumbers)('$5')).toBe('five dollars');
        (0, vitest_1.expect)((0, kokoroG2p_1.expandNumbers)('50%')).toBe('fifty percent');
        (0, vitest_1.expect)((0, kokoroG2p_1.expandNumbers)('1st')).toBe('first');
        (0, vitest_1.expect)((0, kokoroG2p_1.expandNumbers)('21st')).toBe('twenty-first');
        (0, vitest_1.expect)((0, kokoroG2p_1.expandNumbers)('I have 2 apples')).toBe('I have two apples');
    });
});
(0, vitest_1.describe)('phonemize', () => {
    (0, vitest_1.it)('converts words to IPA via the lexicon (the tokenizer-bug fix)', () => {
        (0, vitest_1.expect)((0, kokoroG2p_1.phonemize)('hello world', testLexicon())).toBe('həlˈoʊ wˈɝld');
    });
    (0, vitest_1.it)('keeps sentence punctuation for pauses and drops the rest', () => {
        (0, vitest_1.expect)((0, kokoroG2p_1.phonemize)('hello, "world"!', testLexicon())).toBe('həlˈoʊ , wˈɝld !');
    });
    (0, vitest_1.it)('splits hyphen compounds and voices possessives', () => {
        (0, vitest_1.expect)((0, kokoroG2p_1.phonemize)("state-of-the-art john's test", testLexicon())).toBe('stˈeɪt əv ðə ˈɑɹt dʒˈɑnz tˈɛst');
    });
    (0, vitest_1.it)('de-stresses function words the way running speech does', () => {
        // OF is AH1 V in citation form but surfaces unstressed between content words.
        (0, vitest_1.expect)((0, kokoroG2p_1.phonemize)('of', testLexicon())).toBe('əv');
    });
    (0, vitest_1.it)('falls back to plain letters for out-of-vocabulary words', () => {
        (0, vitest_1.expect)((0, kokoroG2p_1.phonemize)('hello xyzqw', testLexicon())).toBe('həlˈoʊ xyzqw');
    });
    (0, vitest_1.it)('returns normalized text unchanged when the lexicon is missing (legacy path)', () => {
        (0, vitest_1.expect)((0, kokoroG2p_1.phonemize)("Hello, can't stop!", null)).toBe('hello, cannot stop!');
    });
    (0, vitest_1.it)('never returns empty for non-empty input', () => {
        (0, vitest_1.expect)((0, kokoroG2p_1.phonemize)('###', testLexicon())).toBe('###');
    });
    // Guards the real-data path: the shipped cmudict.dict must resolve the same
    // words the same way. Skips on machines without the model files installed.
    const REAL_LEXICON = 'C:\\Users\\aradh\\AppData\\Roaming\\kyclius\\kokoro\\cmudict.dict';
    vitest_1.it.skipIf(!(0, fs_1.existsSync)(REAL_LEXICON))('real lexicon phonemizes hello like the reference', async () => {
        (0, kokoroG2p_1.resetLexiconCacheForTests)();
        const lexicon = await (0, kokoroG2p_1.loadLexicon)(REAL_LEXICON);
        (0, vitest_1.expect)(lexicon).not.toBeNull();
        (0, vitest_1.expect)((0, kokoroG2p_1.phonemize)('hello', lexicon)).toBe('həlˈoʊ');
        (0, kokoroG2p_1.resetLexiconCacheForTests)();
    });
});
