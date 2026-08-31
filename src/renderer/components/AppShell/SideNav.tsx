import { LogoMark } from '../LogoMark';
import type { AppView } from './views';

interface SideNavProps {
  view: AppView;
  onNavigate: (view: AppView) => void;
  onOpenSettings: () => void;
  onNewSession: () => void;
  /** EF-03: return to the ambient home screen (clocked from the brand header). */
  onGoHome: () => void;
}

const NAV_ITEMS: Array<{ view: AppView; label: string; icon: JSX.Element }> = [
  {
    view: 'conversations',
    label: 'Conversations',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    view: 'activity',
    label: 'Activity',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  {
    view: 'memory',
    label: 'Memory',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
  },
  {
    view: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    ),
  },
];

/**
 * App-level persistent left sidebar (mockup: activity.html) — the sole
 * navigation for every non-home view. Flush dark glass panel against the left
 * edge, ~288px wide, brand header, solid primary-container New Session +
 * active item, Settings pinned at bottom.
 */
export function SideNav({ view, onNavigate, onOpenSettings, onNewSession, onGoHome }: SideNavProps) {
  return (
    <nav
      aria-label="Primary"
      className="hidden md:flex fixed left-0 top-0 bottom-0 w-72 z-40 flex-col p-6
        bg-surface/60 backdrop-blur-[20px] border-r border-outline-variant/10
        rounded-r-xl shadow-glass"
    >
      {/* Header — logo mark + wordmark. EF-03: the whole brand header is a
          click target that returns to the ambient home screen from any view. */}
      <button
        type="button"
        onClick={onGoHome}
        aria-label="Back to home"
        title="Back to home"
        className="flex items-center gap-4 mb-8 w-full text-left cursor-pointer
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep rounded-lg"
      >
        <div className="w-12 h-12 rounded-full bg-primary-container/20 border border-primary/30 flex items-center justify-center shrink-0 overflow-hidden">
          <LogoMark size={34} />
        </div>
        <div>
          <h1 className="font-heading text-[32px] leading-tight text-primary tracking-tight">Kyclius</h1>
          <p className="text-sm text-on-surface-variant">Digital Sanctuary</p>
        </div>
      </button>

      {/* New Session primary action */}
      <button
        type="button"
        onClick={onNewSession}
        className="w-full py-3 mb-8 bg-primary-container text-on-primary-container rounded-lg
          text-[12px] font-semibold uppercase tracking-wider
          flex items-center justify-center gap-2
          hover:bg-primary-container/80 transition-colors shadow-lg shadow-primary-container/20
          cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        New Session
      </button>

      {/* Primary nav group */}
      <div className="flex flex-col gap-2 flex-grow">
        {NAV_ITEMS.map(item => {
          const active = view === item.view;
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => onNavigate(item.view)}
              aria-current={active ? 'page' : undefined}
              className={[
                'flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep',
                active
                  ? 'bg-primary-container text-on-primary-container font-semibold shadow-lg shadow-primary-container/10'
                  : 'text-on-surface-variant hover:bg-surface-highest/30 hover:text-on-surface',
              ].join(' ')}
            >
              <span className="shrink-0">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Settings — pinned to the bottom, separated from primary nav */}
      <div className="mt-auto">
        <div className="h-px bg-outline-variant/20 my-4" aria-hidden="true" />
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium
            text-on-surface-variant hover:bg-surface-highest/30 hover:text-on-surface transition-colors w-full cursor-pointer
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>Settings</span>
        </button>
      </div>
    </nav>
  );
}

export default SideNav;