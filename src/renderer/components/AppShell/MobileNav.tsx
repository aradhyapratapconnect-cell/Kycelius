import type { AppView } from './views';

interface MobileNavProps {
  /** The active app-shell view, or null while on the immersive home screen. */
  view: AppView | null;
  onNavigate: (view: AppView) => void;
  /** EF-03: return to the ambient home screen (always available on mobile). */
  onGoHome: () => void;
}

const MOBILE_ITEMS: Array<{ view: AppView; label: string; icon: JSX.Element }> = [
  {
    view: 'conversations',
    label: 'Chat',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    view: 'memory',
    label: 'Memory',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
  },
  {
    view: 'activity',
    label: 'Activity',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  {
    view: 'dashboard',
    label: 'Dash',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    ),
  },
];

/**
 * Bottom navigation bar for narrow screens (mockup: activity.html) — replaces
 * the left sidebar on mobile with a glass pill centered at the bottom. Icons
 * + visible labels; the active destination gets a filled secondary-container
 * circular hit area. md+ hides it in favour of SideNav.
 */
export function MobileNav({ view, onNavigate, onGoHome }: MobileNavProps) {
  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 md:hidden
        flex items-center justify-around gap-1 w-[90%] max-w-md px-6 py-3
        bg-surface/40 backdrop-blur-[20px] rounded-full border border-outline-variant/20
        shadow-2xl"
    >
      {/* EF-03: Home is always available on mobile, even from a shell view. */}
      <button
        type="button"
        onClick={onGoHome}
        aria-current={view === null ? 'page' : undefined}
        title="Home"
        className={[
          'flex flex-col items-center justify-center gap-1 rounded-full transition-colors cursor-pointer',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep',
          view === null
            ? 'text-on-secondary-container bg-secondary-container w-12 h-12 p-2 hover:brightness-125'
            : 'text-on-surface-variant w-12 h-12 p-2 hover:brightness-125',
        ].join(' ')}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        <span>Home</span>
      </button>
      {MOBILE_ITEMS.map(item => {
        const active = view === item.view;
        return (
          <button
            key={item.view}
            type="button"
            onClick={() => onNavigate(item.view)}
            aria-current={active ? 'page' : undefined}
            className={[
              'flex flex-col items-center justify-center gap-1 rounded-full transition-colors cursor-pointer',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep',
              active
                ? 'text-on-secondary-container bg-secondary-container w-12 h-12 p-2 hover:brightness-125'
                : 'text-on-surface-variant w-12 h-12 p-2 hover:brightness-125',
            ].join(' ')}
          >
            {item.icon}
            <span className="text-[inherit]">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default MobileNav;