/**
 * English G2P (grapheme-to-phoneme) for the local Kokoro-82M TTS engine.
 *
 * Root cause it fixes: Kokoro's `tokenizer.json` vocab is a mixed
 * character + IPA-phoneme inventory (ASCII at 0–68, IPA symbols like
 * `ɑ æ ə ʃ θ ŋ ˈ` at 69–176). The model is trained on IPA phoneme sequences
 * ("hello" -> /hɛloʊ/), so feeding it raw characters ("hello" -> h,e,l,l,o)
 * hands it meaningless token IDs and it produces garbled audio.
 *
 * Pipeline: raw text -> number/currency expansion -> contraction/case
 * normalization -> CMUdict lookup (ARPAbet) -> ARPAbet-to-IPA with lexical
 * stress (ˈ/ˌ) and intervocalic flapping (water -> wɔɾɚ) -> vocab symbols.
 *
 * The CMUdict lexicon (~134k words, public domain) is downloaded once next to
 * the Kokoro model files (see kokoroModelDownloader) and cached in memory.
 * When it is missing/unreadable, `phonemize` returns normalized text unchanged
 * so the engine degrades to the legacy character path instead of failing.
 */

import { readFile } from 'fs/promises';

/** Upper-cased word -> space-separated ARPAbet phones, e.g. 'HH AH0 L OW1'. */
export type Lexicon = Map<string, string>;

/**
 * Parses raw cmudict.dict content. Comment lines (`;;;`) are skipped and only
 * the first pronunciation of alternates (`WORD`, `WORD(2)`, ...) is kept.
 */
export function parseCmuDict(content: string): Lexicon {
  const lexicon: Lexicon = new Map();
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';;;')) continue;
    const space = line.search(/\s/);
    if (space === -1) continue;
    const key = line.slice(0, space).toUpperCase();
    // Skip alternate pronunciations (WORD(2), ...) — the first entry listed
    // is the most common and the only one we keep.
    if (!key || /\(\d+\)$/.test(key)) continue;
    const phones = line.slice(space).trim().replace(/\s+/g, ' ');
    if (!phones) continue;
    if (!lexicon.has(key)) lexicon.set(key, phones);
  }
  return lexicon;
}

let cachedLexicon: Lexicon | null = null;
let cachedPath = '';

/** Loads (and memoizes) the lexicon file; null when missing/unreadable. */
export async function loadLexicon(lexiconPath: string): Promise<Lexicon | null> {
  if (cachedLexicon && cachedPath === lexiconPath) return cachedLexicon;
  try {
    const raw = await readFile(lexiconPath, 'utf-8');
    cachedLexicon = parseCmuDict(raw);
    cachedPath = lexiconPath;
    return cachedLexicon;
  } catch {
    return null;
  }
}

/** Test seam: drops the memoized lexicon so tests start clean. */
export function resetLexiconCacheForTests(): void {
  cachedLexicon = null;
  cachedPath = '';
}

// ---------------------------------------------------------------------------
// ARPAbet -> IPA (espeak-ng English inventory; every symbol below exists in
// Kokoro's tokenizer.json vocab, confirmed against the file on disk).
// ---------------------------------------------------------------------------

const VOWEL_IPA: Record<string, string> = {
  AA: 'ɑ',
  AE: 'æ',
  AH: 'ʌ', // AH0 (unstressed) is remapped to ə below
  AO: 'ɔ',
  AW: 'aʊ',
  AY: 'aɪ',
  EH: 'ɛ',
  ER: 'ɝ', // ER0 (unstressed) is remapped to ɚ below
  EY: 'eɪ',
  IH: 'ɪ',
  IY: 'i',
  OW: 'oʊ',
  OY: 'ɔɪ',
  UH: 'ʊ',
  UW: 'u',
};

const CONSONANT_IPA: Record<string, string> = {
  B: 'b',
  CH: 'tʃ',
  D: 'd',
  DH: 'ð',
  F: 'f',
  G: 'ɡ', // U+0261 — the vocab has ɡ, not ASCII g
  HH: 'h',
  JH: 'dʒ',
  K: 'k',
  L: 'l',
  M: 'm',
  N: 'n',
  NG: 'ŋ',
  P: 'p',
  R: 'ɹ',
  S: 's',
  SH: 'ʃ',
  T: 't',
  TH: 'θ',
  V: 'v',
  W: 'w',
  Y: 'j',
  Z: 'z',
  ZH: 'ʒ',
};

function isVowelBase(base: string): boolean {
  return base in VOWEL_IPA;
}

interface SplitPhone {
  base: string;
  stress: string; // '' for consonants, '0' | '1' | '2' for vowels
}

function splitPhone(phone: string): SplitPhone {
  const match = /^([A-Z]+)([012])?$/.exec(phone);
  if (!match) return { base: phone, stress: '' };
  return { base: match[1], stress: match[2] ?? '' };
}

/**
 * Converts one ARPAbet phone string to IPA, applying lexical stress (ˈ for
 * primary, ˌ for secondary) and the intervocalic flap (water -> wɔɾɚ,
 * city -> sɪɾi). Unknown phones are dropped — they must never reach the
 * model as made-up IDs.
 */
export function arpabetToIpa(arpabet: string): string {
  const phones = arpabet.split(/\s+/).filter(Boolean).map(splitPhone);
  let out = '';
  for (let i = 0; i < phones.length; i++) {
    const { base, stress } = phones[i];
    if (isVowelBase(base)) {
      const mark = stress === '1' ? 'ˈ' : stress === '2' ? 'ˌ' : '';
      if (base === 'AH' && stress === '0') out += `${mark}ə`;
      else if (base === 'ER' && stress === '0') out += `${mark}ɚ`;
      else out += `${mark}${VOWEL_IPA[base]}`;
      continue;
    }
    // Flap: /t,d/ -> [ɾ] between a stressed vowel and an unstressed vowel.
    if ((base === 'T' || base === 'D') && i > 0 && i < phones.length - 1) {
      const prev = phones[i - 1];
      const next = phones[i + 1];
      if (
        isVowelBase(prev.base) &&
        prev.stress !== '0' &&
        isVowelBase(next.base) &&
        next.stress === '0'
      ) {
        out += 'ɾ';
        continue;
      }
    }
    const ipa = CONSONANT_IPA[base];
    if (ipa) out += ipa;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Number / currency / percent / ordinal expansion (CMUdict has no digits).
// ---------------------------------------------------------------------------

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const DIGIT_NAMES = ['oh', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

function cardinalUnderThousand(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const ten = Math.floor(n / 10);
    const rest = n % 10;
    return rest === 0 ? TENS[ten] : `${TENS[ten]}-${ONES[rest]}`;
  }
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  return rest === 0 ? `${ONES[hundred]} hundred` : `${ONES[hundred]} hundred ${cardinalUnderThousand(rest)}`;
}

function cardinal(n: number): string {
  if (!Number.isSafeInteger(n)) return String(n);
  if (n < 0) return `minus ${cardinal(-n)}`;
  if (n < 1000) return cardinalUnderThousand(n);
  if (n < 1_000_000) {
    const high = Math.floor(n / 1000);
    const rest = n % 1000;
    return rest === 0
      ? `${cardinalUnderThousand(high)} thousand`
      : `${cardinalUnderThousand(high)} thousand ${cardinalUnderThousand(rest)}`;
  }
  if (n < 1_000_000_000) {
    const high = Math.floor(n / 1_000_000);
    const rest = n % 1_000_000;
    return rest === 0 ? `${cardinal(high)} million` : `${cardinal(high)} million ${cardinal(rest)}`;
  }
  const high = Math.floor(n / 1_000_000_000);
  const rest = n % 1_000_000_000;
  return rest === 0 ? `${cardinal(high)} billion` : `${cardinal(high)} billion ${cardinal(rest)}`;
}

function spellDigits(digits: string): string {
  return digits
    .split('')
    .map(d => DIGIT_NAMES[Number(d)] ?? d)
    .join(' ');
}

function plainInteger(token: string): string {
  const bare = token.replace(/,/g, '');
  // Leading zeros ("007") are spelled out digit by digit.
  if (/^0\d/.test(bare)) return spellDigits(bare);
  const n = Number(bare);
  return Number.isSafeInteger(n) ? cardinal(n) : spellDigits(bare.replace(/\D/g, ''));
}

const ORDINAL_SPECIAL: Record<string, string> = {
  '1st': 'first',
  '2nd': 'second',
  '3rd': 'third',
  '5th': 'fifth',
  '8th': 'eighth',
  '9th': 'ninth',
  '12th': 'twelfth',
};

function ordinal(token: string): string {
  const lower = token.toLowerCase();
  if (ORDINAL_SPECIAL[lower]) return ORDINAL_SPECIAL[lower];
  const num = lower.replace(/(st|nd|rd|th)$/, '');
  // Compounds ("twenty-one") ordinalize their last segment ("twenty-first").
  const words = plainInteger(num);
  const dash = words.lastIndexOf('-');
  const head = dash === -1 ? '' : `${words.slice(0, dash)}-`;
  const tailBase = dash === -1 ? words : words.slice(dash + 1);
  const tailOrd =
    tailBase === 'one'
      ? 'first'
      : tailBase === 'two'
        ? 'second'
        : tailBase === 'three'
          ? 'third'
          : tailBase === 'five'
            ? 'fifth'
            : tailBase === 'eight'
              ? 'eighth'
              : tailBase === 'nine'
                ? 'ninth'
                : tailBase === 'twelve'
                  ? 'twelfth'
                  : tailBase.endsWith('y')
                    ? `${tailBase.slice(0, -1)}ieth`
                    : `${tailBase}th`;
  return `${head}${tailOrd}`;
}

function money(amount: string, one: string, many: string, smallOne: string, smallMany: string): string {
  const [dollars, cents] = amount.replace(/,/g, '').split('.');
  const d = Number(dollars || '0');
  let out = `${cardinal(d)} ${d === 1 ? one : many}`;
  if (cents !== undefined) {
    const c = Number((cents + '00').slice(0, 2));
    if (c > 0) out += ` and ${cardinal(c)} ${c === 1 ? smallOne : smallMany}`;
  }
  return out;
}

/** Expands digits/currency/percent/ordinals to speakable words. Exported for tests. */
export function expandNumbers(text: string): string {
  let out = text;
  out = out.replace(/\$(\d[\d,]*)(?:\.(\d{1,2}))?/g, (_m, d: string, c: string | undefined) =>
    money(`${d}${c !== undefined ? `.${c}` : ''}`, 'dollar', 'dollars', 'cent', 'cents')
  );
  out = out.replace(/£(\d[\d,]*)(?:\.(\d{1,2}))?/g, (_m, d: string, c: string | undefined) =>
    money(`${d}${c !== undefined ? `.${c}` : ''}`, 'pound', 'pounds', 'penny', 'pence')
  );
  out = out.replace(/€(\d[\d,]*)(?:\.(\d{1,2}))?/g, (_m, d: string, c: string | undefined) =>
    money(`${d}${c !== undefined ? `.${c}` : ''}`, 'euro', 'euros', 'cent', 'cents')
  );
  out = out.replace(/\b(\d[\d,]*\.?\d*)\s?%/g, (_m, n: string) => `${plainInteger(n)} percent`);
  out = out.replace(/\b(\d+)(st|nd|rd|th)\b/gi, m => ordinal(m));
  out = out.replace(/\b(\d[\d,]*)\.(\d+)\b/g, (_m, a: string, b: string) =>
    `${plainInteger(a)} point ${spellDigits(b)}`
  );
  out = out.replace(/\b\d[\d,]*\b/g, m => plainInteger(m));
  return out;
}

// ---------------------------------------------------------------------------
// Text normalization (moved here from kokoroTtsEngine so phonemize owns the
// full text -> phoneme front-end; re-exported for the engine).
// ---------------------------------------------------------------------------

export function normalizeText(text: string): string {
  let out = text.toLowerCase();

  out = out
    .replace(/\bcan't\b/g, 'cannot')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/\bdon't\b/g, 'do not')
    .replace(/\bit's\b/g, 'it is')
    .replace(/\bi'm\b/g, 'i am')
    .replace(/\bthat's\b/g, 'that is')
    .replace(/\bwhat's\b/g, 'what is')
    .replace(/\bthere's\b/g, 'there is')
    .replace(/\bthey're\b/g, 'they are')
    .replace(/\byou're\b/g, 'you are')
    .replace(/\bwe're\b/g, 'we are')
    .replace(/\bhe's\b/g, 'he is')
    .replace(/\bshe's\b/g, 'she is')
    .replace(/\blet's\b/g, 'let us')
    .replace(/\bisn't\b/g, 'is not')
    .replace(/\baren't\b/g, 'are not')
    .replace(/\bwasn't\b/g, 'was not')
    .replace(/\bweren't\b/g, 'were not')
    .replace(/\bhasn't\b/g, 'has not')
    .replace(/\bhaven't\b/g, 'have not')
    .replace(/\bhadn't\b/g, 'had not')
    .replace(/\bdoesn't\b/g, 'does not')
    .replace(/\bdidn't\b/g, 'did not')
    .replace(/\bcouldn't\b/g, 'could not')
    .replace(/\bwouldn't\b/g, 'would not')
    .replace(/\bshouldn't\b/g, 'should not');

  out = out.replace(/\./g, '. ');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

// ---------------------------------------------------------------------------
// Word-level phonemization.
// ---------------------------------------------------------------------------

/** Phones that devoice a following possessive 's (bath's -> bɑθs). */
const VOICELESS_ENDINGS = new Set(['P', 'T', 'K', 'F', 'TH', 'S', 'SH', 'CH', 'HH']);

function pluralSibilant(stemPhones: string): string {
  const last = stemPhones.split(/\s+/).filter(Boolean).pop() ?? '';
  const base = splitPhone(last).base;
  return VOICELESS_ENDINGS.has(base) ? 's' : 'z';
}

function lookupWord(word: string, lexicon: Lexicon): string | null {
  const upper = word.toUpperCase();
  if (lexicon.has(upper)) return lexicon.get(upper) ?? null;
  // Dotted abbreviations ("mr." -> "mr", "u.s.a" -> "usa").
  const stripped = upper.replace(/\./g, '');
  if (stripped !== upper && lexicon.has(stripped)) return lexicon.get(stripped) ?? null;
  return null;
}

/**
 * Function words (articles, prepositions, pronouns, auxiliaries) lose their
 * citation stress in running speech — espeak de-stresses them the same way
 * ("of" -> əv, not ˈʌv). Without this every word comes out emphasized and
 * prosody sounds robotic. Contrastive emphasis ("I said THE car") is lost,
 * which is the right trade-off for a default voice.
 */
const FUNCTION_WORDS = new Set(
  'a an the of and or but to in on at for with from by as are was were be been being am has have had do does did will would can could shall should may might must not nor so yet if than then that this these those it its he him his she her hers they them their theirs we us our ours you your yours i me my mine who whom whose which what when where why how there here up out off over under again once while till until toward towards into onto upon within without about above across after against along among around before behind below beneath beside between beyond during except inside near past since through throughout upon within'.split(
    ' '
  )
);

/** Rewrites stressed vowels to unstressed (AH1 -> AH0, which maps to ə). */
function destress(arpabet: string): string {
  return arpabet
    .split(/\s+/)
    .map(phone => {
      const { base, stress } = splitPhone(phone);
      return isVowelBase(base) && (stress === '1' || stress === '2') ? `${base}0` : phone;
    })
    .join(' ');
}

function phonemizeWord(word: string, lexicon: Lexicon): string {
  // Possessives ("john's" -> stem phones + s/z by voicing).
  const possessive = /^(.*)['’]s$/.exec(word);
  if (possessive) {
    const stem = lookupWord(possessive[1], lexicon);
    if (stem) return `${arpabetToIpa(stem)}${pluralSibilant(stem)}`;
  }
  const direct = lookupWord(word, lexicon);
  if (direct) return arpabetToIpa(FUNCTION_WORDS.has(word) ? destress(direct) : direct);
  // Out-of-vocabulary: keep plain letters so the word still renders instead of
  // vanishing (legacy character-level behavior for that word only).
  const letters = word.replace(/[^a-z]/g, '');
  return letters;
}

/** Sentence punctuation the model renders as pauses; everything else becomes a space. */
function isKeptPunct(ch: string): boolean {
  return ch === '.' || ch === ',' || ch === '!' || ch === '?' || ch === ';' || ch === ':';
}

function splitAffixes(token: string): { leading: string; core: string; trailing: string } {
  let start = 0;
  let end = token.length;
  while (start < end && !/[a-z0-9'’-]/.test(token[start])) start++;
  while (end > start && !/[a-z0-9'’-]/.test(token[end - 1])) end--;
  return {
    leading: token.slice(0, start),
    core: token.slice(start, end),
    trailing: token.slice(end),
  };
}

function punctToSpaceRun(run: string): string {
  return run.split('').filter(isKeptPunct).join(' ');
}

/**
 * Full front-end: raw assistant text -> IPA phoneme string (plus kept
 * punctuation). With a null lexicon the normalized text is returned unchanged
 * so callers degrade to character tokenization instead of failing.
 */
export function phonemize(text: string, lexicon: Lexicon | null): string {
  const normalized = normalizeText(expandNumbers(text));
  if (!lexicon) return normalized;
  const out: string[] = [];
  for (const token of normalized.split(/\s+/)) {
    if (!token) continue;
    const { leading, core, trailing } = splitAffixes(token);
    const lead = punctToSpaceRun(leading);
    const trail = punctToSpaceRun(trailing);
    if (lead) out.push(lead);
    if (core) {
      const parts = core
        .split(/[-–—]/)
        .map(part => phonemizeWord(part, lexicon))
        .filter(Boolean);
      if (parts.length > 0) out.push(parts.join(' '));
    }
    if (trail) out.push(trail);
  }
  const result = out.join(' ').replace(/\s+/g, ' ').trim();
  // Never return empty for non-empty input — fall back to the normalized text
  // (character path) so the caller still vocalizes something.
  return result || normalized;
}
