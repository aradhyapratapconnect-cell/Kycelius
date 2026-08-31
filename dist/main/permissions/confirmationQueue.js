"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enqueueConfirmation = enqueueConfirmation;
exports.resolveConfirmation = resolveConfirmation;
exports.getPendingConfirmations = getPendingConfirmations;
exports.getPendingConfirmationById = getPendingConfirmationById;
exports.isConfirmationPending = isConfirmationPending;
exports.subscribeToQueue = subscribeToQueue;
exports.resetQueue = resetQueue;
const queue = [];
const listeners = new Set();
function snapshot() {
    return queue.map(({ id, toolName, parameters, enqueuedAt }) => ({
        id,
        toolName,
        parameters,
        enqueuedAt,
    }));
}
function notifyListeners() {
    const current = snapshot();
    for (const listener of listeners)
        listener(current);
}
function enqueueConfirmation(input) {
    if (queue.some(entry => entry.id === input.id)) {
        throw new Error(`Confirmation "${input.id}" is already pending`);
    }
    let resolve;
    const promise = new Promise(res => {
        resolve = res;
    });
    const entry = {
        id: input.id,
        toolName: input.toolName,
        parameters: input.parameters,
        enqueuedAt: Date.now(),
        resolve,
        promise,
    };
    queue.push(entry);
    notifyListeners();
    const { id, toolName, parameters, enqueuedAt } = entry;
    return { confirmation: { id, toolName, parameters, enqueuedAt }, response: promise };
}
function resolveConfirmation(id, response) {
    if (!response || !['approve', 'edit', 'deny', 'always_allow'].includes(response.action)) {
        return false;
    }
    const index = queue.findIndex(entry => entry.id === id);
    if (index === -1)
        return false;
    const [entry] = queue.splice(index, 1);
    entry.resolve(response);
    notifyListeners();
    return true;
}
function getPendingConfirmations() {
    return snapshot();
}
function getPendingConfirmationById(id) {
    return snapshot().find(entry => entry.id === id) ?? undefined;
}
function isConfirmationPending(id) {
    return queue.some(entry => entry.id === id);
}
function subscribeToQueue(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
function resetQueue() {
    for (const entry of queue.splice(0)) {
        entry.resolve({ action: 'deny', reason: 'queue reset' });
    }
    notifyListeners();
}
