export type ConfirmationAction = 'approve' | 'edit' | 'deny' | 'always_allow';

export interface ConfirmationResponse {
  action: ConfirmationAction;
  editedParams?: Record<string, unknown>;
  reason?: string;
}

export interface QueuedConfirmation {
  id: string;
  toolName: string;
  parameters: Record<string, unknown>;
  enqueuedAt: number;
}

interface QueueEntry extends QueuedConfirmation {
  resolve: (response: ConfirmationResponse) => void;
  promise: Promise<ConfirmationResponse>;
}

const queue: QueueEntry[] = [];
const listeners = new Set<(pending: readonly QueuedConfirmation[]) => void>();

function snapshot(): QueuedConfirmation[] {
  return queue.map(({ id, toolName, parameters, enqueuedAt }) => ({
    id,
    toolName,
    parameters,
    enqueuedAt,
  }));
}

function notifyListeners(): void {
  const current = snapshot();
  for (const listener of listeners) listener(current);
}

export function enqueueConfirmation(input: {
  id: string;
  toolName: string;
  parameters: Record<string, unknown>;
}): { confirmation: QueuedConfirmation; response: Promise<ConfirmationResponse> } {
  if (queue.some(entry => entry.id === input.id)) {
    throw new Error(`Confirmation "${input.id}" is already pending`);
  }

  let resolve!: (response: ConfirmationResponse) => void;
  const promise = new Promise<ConfirmationResponse>(res => {
    resolve = res;
  });

  const entry: QueueEntry = {
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

export function resolveConfirmation(id: string, response: ConfirmationResponse): boolean {
  if (!response || !['approve', 'edit', 'deny', 'always_allow'].includes(response.action)) {
    return false;
  }
  const index = queue.findIndex(entry => entry.id === id);
  if (index === -1) return false;

  const [entry] = queue.splice(index, 1);
  entry.resolve(response);
  notifyListeners();
  return true;
}

export function getPendingConfirmations(): QueuedConfirmation[] {
  return snapshot();
}

export function getPendingConfirmationById(id: string): QueuedConfirmation | undefined {
  return snapshot().find(entry => entry.id === id) ?? undefined;
}

export function isConfirmationPending(id: string): boolean {
  return queue.some(entry => entry.id === id);
}

export function subscribeToQueue(
  listener: (pending: readonly QueuedConfirmation[]) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetQueue(): void {
  for (const entry of queue.splice(0)) {
    entry.resolve({ action: 'deny', reason: 'queue reset' });
  }
  notifyListeners();
}
