import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { voiceCapture } from './voice/audioCapture';
import { useAssistantStore } from './state/assistantStore';
import { useChatStore } from './state/chatStore';
import { useAutonomousModeStore } from './state/autonomousModeStore';
import { HomeScreen } from './components/HomeScreen';
import { ChatWorkspace } from './components/ChatWorkspace';
import { CommandBar } from './components/CommandBar';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { LogoMark } from './components/LogoMark';
import { SideNav, MobileNav, type AppView } from './components/AppShell';
import { MemoryView } from './components/MemoryPanel';
import { ToolHistoryView } from './components/ToolHistoryPanel';
import { DashboardView } from './components/DashboardPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { OnboardingFlow } from './components/OnboardingFlow/OnboardingFlow';
import { HomeReplyStrip } from './components/HomeReplyStrip';

type View = 'home' | AppView;

interface IconButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
}

/** Ghost icon-only button, dark-theme styling from the reference mockups. */
function IconButton({ label, onClick, children }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="p-2 rounded-full text-primary/80 hover:text-primary hover:bg-white/10 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
    >
      {children}
    </button>
  );
}

function TopBar({ view, onNavigate, onOpenSettings }: { view: View; onNavigate: (v: AppView) => void; onOpenSettings: () => void }) {
  const desktopLinks = [
    { view: 'activity' as AppView, label: 'Activity' },
    { view: 'memory' as AppView, label: 'Memory' },
    { view: 'dashboard' as AppView, label: 'Dashboard' },
  ];

  return (
    <div
      className={[
        'absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-6 md:px-8 py-4',
        // Dark gradient backdrop so the bar stays readable over bright scenery
        'bg-gradient-to-b from-background/80 via-background/40 to-transparent',
        // Desktop views carry their brand in the sidebar — the top bar only
        // floats on the home screen there. Mobile keeps it on every view.
        view !== 'home' ? 'md:hidden' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-3">
        <LogoMark size={30} />
        <span className="font-heading text-[22px] md:text-2xl text-primary tracking-tight">Kyclius</span>
      </div>

      <div className="flex items-center gap-2">
        {/* Desktop home: text nav links (mockup home top nav) */}
        <div className="hidden md:flex items-center gap-1 mr-3">
          {desktopLinks.map(link => (
            <button
              key={link.view}
              type="button"
              onClick={() => onNavigate(link.view)}
              className="px-3 py-2 rounded-lg text-sm text-primary/80 hover:text-primary hover:bg-white/10 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
            >
              {link.label}
            </button>
          ))}
        </div>

        <IconButton label="History" onClick={() => onNavigate('conversations')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l4 2" />
          </svg>
        </IconButton>
        <IconButton label="Settings" onClick={onOpenSettings}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}

/** T-22: home quick-action chips — real actions only ("Open an app" and
 *  "Check GitHub" run the actual command; "View memory" navigates). */
const HOME_QUICK_ACTIONS = [
  { label: 'Open an app', onTap: 'command' as const },
  { label: 'Check GitHub', onTap: 'command' as const },
  { label: 'View memory', onTap: 'memory' as const },
];

function App() {
  const setAssistantState = useAssistantStore(s => s.setAssistantState);
  const setAutonomousEnabled = useAutonomousModeStore(s => s.setEnabled);
  const sendMessage = useChatStore(s => s.sendMessage);
  const startNewConversation = useChatStore(s => s.startNewConversation);

  const [view, setView] = useState<View>('home');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [onboardingActive, setOnboardingActive] = useState(false);
  const [keyBanner, setKeyBanner] = useState<{ provider: string; displayName?: string } | null>(null);
  const [keyBannerDismissed, setKeyBannerDismissed] = useState(false);

  const navigate = useCallback((next: AppView) => setView(next), []);
  const goHome = useCallback(() => setView('home'), []);
  const openSettings = useCallback(() => setIsSettingsOpen(true), []);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);

  // AC (T-13): a missing/unset key is surfaced prominently instead of failing
  // silently — the chat pipeline already degrades with a helpful reply, this
  // banner makes the fix one click away. Re-checked when Settings closes.
  const checkApiKeyStatus = useCallback(async () => {
    try {
      if (!window.kyclius) return;
      const provider = await window.kyclius.getLLMProvider();
      const hasKey = await window.kyclius.hasLLMApiKey(provider);
      let displayName: string | undefined;
      try {
        const providers = await window.kyclius.listProviders('llm');
        displayName = providers.find(p => p.id === provider)?.displayName;
      } catch {
        displayName = undefined;
      }
      setKeyBanner(hasKey ? null : { provider, displayName });
      setKeyBannerDismissed(false);
    } catch {
      // IPC not ready — leave the banner alone.
    }
  }, []);

  useEffect(() => {
    void checkApiKeyStatus();
  }, [checkApiKeyStatus]);

  useEffect(() => {
    if (!isSettingsOpen && !keyBannerDismissed) {
      void checkApiKeyStatus();
    }
    // Reset dismissal whenever settings closes so a still-missing key re-prompts once.
  }, [isSettingsOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // S-01: show the first-run onboarding flow exactly once — gated by the
  // `onboarding_complete` flag in the main process. The overlay covers the
  // command bar (fixed, hi-z), so the user can't reach normal chat until they
  // either finish or explicitly skip.
  useEffect(() => {
    if (!window.kyclius) return;
    window.kyclius
      .getOnboardingComplete()
      .then(done => {
        if (!done) setOnboardingActive(true);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Test that the IPC bridge is working
    if (window.kyclius) {
      // Drive the central assistant-state store from main-process broadcasts
      const unsubscribe = window.kyclius.onAssistantStateChange(state => {
        setAssistantState(state);
      });

      const teardownVoice = voiceCapture.initialize(window.kyclius);

      return () => {
        unsubscribe();
        teardownVoice();
      };
    }
  }, [setAssistantState]);

  useEffect(() => {
    // T-20: keep the composer's Autonomous badge in sync with the real config.
    if (!window.kyclius) return;
    window.kyclius
      .getAutonomousModeConfig()
      .then(cfg => setAutonomousEnabled(cfg.enabled))
      .catch(() => {});
    return window.kyclius.onAutonomousModeChanged(cfg => {
      setAutonomousEnabled(cfg.enabled);
    });
  }, [setAutonomousEnabled]);

  const handleNewSession = useCallback(() => {
    startNewConversation();
    setView('conversations');
  }, [startNewConversation]);

  const handleQuickAction = useCallback((onTap: 'command' | 'memory', prompt: string) => {
    if (onTap === 'memory') {
      setView('memory');
      return;
    }
    void sendMessage(prompt, 'text');
  }, [sendMessage]);

  const shellView: AppView | null = view === 'home' ? null : view;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background font-body">
      {/* S-01: first-run onboarding — renders above everything on first launch */}
      {onboardingActive && (
        <OnboardingFlow onComplete={() => setOnboardingActive(false)} />
      )}

      {/* Confirmation dialog — renders above everything when a confirm_required action is pending (T-04) */}
      <ConfirmationDialog />

      {/* Ambient home screen — scenery stays mounted underneath every view */}
      <HomeScreen />

      {/* Icon-only top navigation: desktop home + all mobile views (mockup layout) */}
      <TopBar view={view} onNavigate={navigate} onOpenSettings={openSettings} />

      {/* Shell content — floats over the scenery beside the sidebar (mockup main) */}
      {shellView && (
        <main
          aria-label="Kyclius app"
          className={[
            'absolute inset-0 z-10 flex flex-col',
            'ml-0 md:ml-72',
            'px-6 md:px-10',
            'pt-24 md:pt-10',
            'pb-40 md:pb-10',
            'overflow-hidden',
          ].join(' ')}
        >
          <div className="w-full max-w-6xl mx-auto h-full min-h-0">
            {shellView === 'conversations' && (
              <ChatWorkspace embedded onGoHome={goHome} />
            )}
            {shellView === 'activity' && <ToolHistoryView onGoHome={goHome} />}
            {shellView === 'memory' && <MemoryView onGoHome={goHome} />}
            {shellView === 'dashboard' && (
              <DashboardView onGoHome={goHome} onOpenActivity={() => navigate('activity')} />
            )}
          </div>
        </main>
      )}

      {/* App-level sidebar (desktop non-home) */}
      {shellView && (
        <SideNav
          view={shellView}
          onNavigate={navigate}
          onOpenSettings={openSettings}
          onNewSession={handleNewSession}
          onGoHome={goHome}
        />
      )}

      {/* Mobile bottom navigation — all views, replaces the sidebar */}
      <MobileNav view={shellView} onNavigate={navigate} onGoHome={goHome} />

      {/* Settings — floating glass modal (spec §8) with its own internal sidebar */}
      <SettingsPanel
        open={isSettingsOpen}
        onClose={closeSettings}
        onOpenMemory={() => {
          closeSettings();
          navigate('memory');
        }}
        onOpenActivity={() => {
          closeSettings();
          navigate('activity');
        }}
      />

      {/* No-API-key prompt (T-13 AC) — one click from fix, dismissible */}
      {keyBanner && !keyBannerDismissed && (
        <div className="absolute bottom-32 left-0 right-0 px-4 flex justify-center pointer-events-none z-30">
          <div className="pointer-events-auto flex items-center gap-3 px-4 py-2 rounded-full bg-surface/80 backdrop-blur-xl border border-warning/40 shadow-glass">
            <p className="text-xs text-on-surface-variant">
              Kyclius can't think yet — no {keyBanner.displayName ?? 'AI'} API key is set.
            </p>
            <button
              type="button"
              onClick={openSettings}
              className="text-xs font-medium text-secondary hover:text-primary underline underline-offset-2 cursor-pointer whitespace-nowrap"
            >
              Add a key in Settings
            </button>
            <button
              type="button"
              onClick={() => setKeyBannerDismissed(true)}
              aria-label="Dismiss key reminder"
              className="w-5 h-5 rounded-full flex items-center justify-center text-on-surface-variant/70 hover:text-on-surface transition-colors cursor-pointer"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Command bar — docked bottom, persistent across views/pages (spec §5).
          Home layout mirrors the mockup: greeting, glass capsule, quick chips. */}
      <div className="absolute bottom-0 left-0 right-0 px-4 pt-4 pb-28 md:pb-10">
        {view === 'home' && (
          <div className="mb-5 text-center opacity-80">
            <h1 className="font-heading text-5xl text-primary-fixed drop-shadow-md">Hello.</h1>
            <p className="mt-2 text-lg text-secondary-fixed">The forest is quiet today.</p>
          </div>
        )}
        {view === 'home' && (
          <HomeReplyStrip onOpenConversation={() => setView('conversations')} />
        )}
        <CommandBar />
        {view === 'home' && (
          <div className="flex gap-3 justify-center flex-wrap mt-4">
            {HOME_QUICK_ACTIONS.map(action => (
              <button
                key={action.label}
                type="button"
                onClick={() => handleQuickAction(action.onTap, action.label)}
                className="px-4 py-2 rounded-full bg-secondary/10 backdrop-blur-md border border-secondary/20 text-secondary
                  text-[12px] font-semibold uppercase tracking-wide hover:bg-secondary/20 transition-colors cursor-pointer
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;