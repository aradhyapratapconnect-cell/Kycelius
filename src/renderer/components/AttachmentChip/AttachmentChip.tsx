import type { ReactNode } from 'react';

export interface AttachmentChipProps {
  /** Display name of the file/folder */
  name: string;
  /** Kind: 'file' or 'folder' */
  kind: 'file' | 'folder';
  /** Size in bytes for display */
  size?: number;
  /** Callback when user clicks remove */
  onRemove: () => void;
  /** Optional additional content */
  children?: ReactNode;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / (1024 * 1024) * 10) / 10} MB`;
}

export function AttachmentChip({ name, kind, size, onRemove, children }: AttachmentChipProps) {
  const isFolder = kind === 'folder';

  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-variant/50 border border-outline-variant/30">
      {isFolder ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-secondary" aria-hidden>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary" aria-hidden>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      )}
      <span className="text-sm text-on-surface truncate max-w-[200px]">{name}</span>
      {size !== undefined && (
        <span className="text-[11px] text-on-surface-variant/60 whitespace-nowrap">{formatSize(size)}</span>
      )}
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="ml-1 p-0.5 rounded text-on-surface-variant hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

export default AttachmentChip;