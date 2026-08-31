"use strict";
/**
 * T-11 — Local Memory System
 *
 * Durable facts about the user ("my default editor is VS Code"), stored in
 * the F-03 `memory_facts` table and surfaced to the LLM reasoning step:
 *
 * - Pre-LLM: `getRelevantFacts` scores stored facts against the user's text
 *   and returns ONLY a small relevant subset (never the whole table), which
 *   `buildMemoryContextBlock` renders as an extra system message.
 * - Post-response: `learnFromUserMessage` detects fact statements/corrections
 *   in what the user said ("my X is Y", "remember ...", "call me N") and
 *   upserts them with source 'auto_learned'. Upserting by key means a
 *   correction overwrites rather than duplicates (AC).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFact = getFact;
exports.setFact = setFact;
exports.listFacts = listFacts;
exports.deleteFact = deleteFact;
exports.getRelevantFacts = getRelevantFacts;
exports.buildMemoryContextBlock = buildMemoryContextBlock;
exports.extractFactCandidates = extractFactCandidates;
exports.learnFromUserMessage = learnFromUserMessage;
const db_1 = require("../db/db");
const KEY_MAX_LENGTH = 60;
const VALUE_MAX_LENGTH = 200;
const RELEVANT_FACT_LIMIT = 5;
// ---------------------------------------------------------------------------
// Core CRUD (ticket-required API)
// ---------------------------------------------------------------------------
function getFact(key) {
    const normalized = normalizeKey(key);
    if (!normalized)
        return undefined;
    return db_1.memoryFacts.getByKey(normalized);
}
/** Upserts by key: an existing fact for the same key is overwritten. */
function setFact(key, value, source = 'user_added') {
    const normalizedKey = normalizeKey(key);
    const normalizedValue = normalizeValue(value);
    if (!normalizedKey || !normalizedValue)
        return null;
    return db_1.memoryFacts.set(normalizedKey, normalizedValue, source);
}
function listFacts() {
    return db_1.memoryFacts.getAll();
}
function deleteFact(id) {
    if (typeof id !== 'string' || id.trim().length === 0)
        return;
    db_1.memoryFacts.delete(id);
}
function normalizeKey(key) {
    if (typeof key !== 'string')
        return null;
    const cleaned = key.toLowerCase().replace(/\s+/g, ' ').trim();
    if (cleaned.length === 0 || cleaned.length > KEY_MAX_LENGTH)
        return null;
    return cleaned;
}
function normalizeValue(value) {
    if (typeof value !== 'string')
        return null;
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (cleaned.length === 0 || cleaned.length > VALUE_MAX_LENGTH)
        return null;
    return cleaned;
}
// ---------------------------------------------------------------------------
// Relevance: a small matching subset per request, never the entire store
// ---------------------------------------------------------------------------
const STOPWORDS = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'his', 'her',
    'its', 'this', 'that', 'with', 'have', 'has', 'was', 'were', 'what',
    'when', 'how', 'who', 'why', 'can', 'could', 'will', 'would', 'should',
    'does', 'did', 'into', 'about', 'out', 'off', 'over', 'under', 'again',
    'them', 'they', 'their', 'there', 'then', 'than', 'she', 'him', 'all',
    'any', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'only',
    'own', 'same', 'too', 'very', 'just', 'also', 'get', 'got', 'use',
    'using', 'please', 'kyclius',
]);
function tokenize(text) {
    const tokens = new Set();
    for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
        if (raw.length >= 3 && !STOPWORDS.has(raw))
            tokens.add(raw);
    }
    return tokens;
}
/**
 * Scores every stored fact against the request text; returns the top matches
 * above zero. Key-word hits weigh double (a fact's key names the topic).
 */
function getRelevantFacts(userText, limit = RELEVANT_FACT_LIMIT) {
    const requestTokens = tokenize(String(userText ?? ''));
    if (requestTokens.size === 0)
        return [];
    const scored = [];
    for (const fact of listFacts()) {
        const keyTokens = tokenize(fact.key);
        const valueTokens = tokenize(fact.value);
        let score = 0;
        for (const token of requestTokens) {
            if (keyTokens.has(token))
                score += 2;
            else if (valueTokens.has(token))
                score += 1;
        }
        if (score > 0)
            scored.push({ fact, score });
    }
    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(1, limit))
        .map(entry => entry.fact);
}
/** Renders matched facts as a system-message block, or null when empty. */
function buildMemoryContextBlock(facts) {
    if (facts.length === 0)
        return null;
    const lines = facts.map(fact => `- ${fact.key}: ${fact.value}`);
    return ('Durable facts you already know about the user (use naturally when relevant):\n' +
        lines.join('\n'));
}
const FACT_PATTERNS = [
    /^(?:hey\s+kyclius[,\s]*)?remember\s+(?:that\s+)?my\s+(.{2,60}?)\s+(?:is|=)\s+(.{2,200})$/i,
    /^(?:hey\s+kyclius[,\s]*)?(?:actually,?\s*)?my\s+(.{2,60}?)\s+(?:is|are|was)\s+(?:now\s+)?(.{2,200})$/i,
    /^(?:hey\s+kyclius[,\s]*)?i\s+(?:prefer|use)\s+(.{2,200})\s+(?:as|for)\s+my\s+(.{2,60})$/i,
    /^(?:hey\s+kyclius[,\s]*)?from\s+now\s+on\s+(?:my\s+)?(.{2,60}?)\s+(?:is|will\s+be)\s+(.{2,200})$/i,
];
/**
 * Extracts fact candidates from a user utterance. Deliberately conservative
 * (explicit possessive/statement shapes only) to avoid storing chatter.
 */
function extractFactCandidates(userText) {
    const text = String(userText ?? '').trim();
    if (text.length === 0 || text.length > 300)
        return [];
    const candidates = [];
    for (const pattern of FACT_PATTERNS) {
        const match = text.match(pattern);
        if (!match)
            continue;
        // Patterns 1/2/4 capture (key, value); the preference pattern captures
        // (value, key) — "I prefer VS Code as my editor".
        let key = match[1];
        let value = match[2];
        if (pattern.source.includes('prefer|use')) {
            [value, key] = [match[1], match[2]];
        }
        const cleanKey = normalizeKey(stripPunctuation(key));
        const cleanValue = normalizeValue(stripTrailingPunctuation(value));
        if (cleanKey && cleanValue)
            candidates.push({ key: cleanKey, value: cleanValue });
    }
    return candidates.slice(0, 3);
}
function stripPunctuation(text) {
    return text.replace(/[.!?]+$/, '').trim();
}
function stripTrailingPunctuation(text) {
    return text.replace(/[.!?]+\s*$/, '').trim();
}
/**
 * Post-exchange hook: persists any durable facts stated in this turn with
 * source 'auto_learned'. Never throws — memory must not break the reply.
 * Returns the keys that were learned (or overwritten).
 */
function learnFromUserMessage(userText) {
    const learned = [];
    try {
        for (const candidate of extractFactCandidates(userText)) {
            const saved = setFact(candidate.key, candidate.value, 'auto_learned');
            if (saved)
                learned.push(candidate.key);
        }
    }
    catch (err) {
        console.warn('[memory] auto-learn failed:', err instanceof Error ? err.message : err);
    }
    return learned;
}
