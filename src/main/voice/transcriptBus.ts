type TranscriptListener = (text: string, isFinal: boolean) => void;

const listeners = new Set<TranscriptListener>();

export function publishTranscript(text: string, isFinal: boolean): void {
  if (typeof text !== 'string' || text.trim().length === 0) return;
  for (const listener of listeners) listener(text, isFinal);
}

export function subscribeToTranscripts(listener: TranscriptListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetTranscriptBus(): void {
  listeners.clear();
}
