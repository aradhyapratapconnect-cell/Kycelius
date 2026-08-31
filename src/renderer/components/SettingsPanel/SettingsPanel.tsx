import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type {
  SttEngineId,
  WhisperModelId,
  WhisperModelStatus,
  WhisperDownloadProgress,
} from '@shared/types/ipc';
import { VoiceEnrollment } from '../VoiceEnrollment/VoiceEnrollment';
import { PermissionsPanel } from '../PermissionsPanel/PermissionsPanel';
import { CloudSyncSettings } from './CloudSyncSettings';
import { CommunityAgentsSettings } from './CommunityAgentsSettings';
import { PluginSettings } from './PluginSettings';
import { ModelRoutingSettings } from './ModelRoutingSettings';
import { ProviderSettings } from './ProviderSettings';
import { ScheduledTasksSettings } from './ScheduledTasksSettings';

export type ProviderId = 'groq' | 'openrouter';

export interface SaveResult {
  ok: boolean;
  message?: string;
}

export const HELP_URLS: Record<ProviderId, string> = {
  groq: 'https://console.groq.com/keys',
  openrouter: 'https://openrouter.ai/settings/keys',
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  groq: 'Groq',
  openrouter: 'OpenRouter',
};

/* ------------------------------------------------------------------ */
/*  Settings categories (Frontend Spec §8 — authoritative list)        */
/* ------------------------------------------------------------------ */

type SettingsCategory =
  | 'AI Providers'
  | 'Models'
  | 'Permissions'
  | 'Memory'
  | 'Voice'
  | 'Voice Biometrics'
  | 'Wake Word'
  | 'Autonomous Mode'
  | 'Text-to-Speech'
  | 'Integrations'
  | 'GitHub'
  | 'Activity'
  | 'Privacy'
  | 'Security'
  | 'Appearance'
  | 'Advanced'
  | 'How to Use';

/** Grouping per Spec §8: AI/Model/Voice first, Permissions/Memory/Privacy/
 *  Security next, Integrations/GitHub, then Appearance/Advanced/Help last. */
const CATEGORY_GROUPS: Array<{ label: string; items: SettingsCategory[] }> = [
  { label: 'AI', items: ['AI Providers', 'Models', 'Autonomous Mode'] },
  { label: 'Voice', items: ['Voice', 'Voice Biometrics', 'Wake Word', 'Text-to-Speech'] },
  { label: 'Trust & Data', items: ['Permissions', 'Memory', 'Activity', 'Privacy', 'Security'] },
  { label: 'Connections', items: ['Integrations', 'GitHub'] },
  { label: 'System', items: ['Appearance', 'Advanced', 'How to Use'] },
];

function CategoryIcon({ category }: { category: SettingsCategory }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const;
  switch (category) {
    case 'AI Providers':
      return (
        <svg {...common} aria-hidden><path d="M12 2a10 10 0 1 0 10 10H12V2z" /><rect x="2" y="12" width="20" height="10" rx="2" /></svg>
      );
    case 'Models':
      return (
        <svg {...common} aria-hidden><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" /><line x1="9.5" y1="22" x2="14.5" y2="22" /></svg>
      );
    case 'Permissions':
      return (
        <svg {...common} aria-hidden><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
      );
    case 'Memory':
      return (
        <svg {...common} aria-hidden><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>
      );
    case 'Voice':
      return (
        <svg {...common} aria-hidden><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /></svg>
      );
    case 'Voice Biometrics':
      return (
        <svg {...common} aria-hidden><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5z" /><path d="M20 21a8 8 0 1 0-16 0" /></svg>
      );
    case 'Wake Word':
      return (
        <svg {...common} aria-hidden><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
      );
    case 'Autonomous Mode':
      return (
        <svg {...common} aria-hidden><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
      );
    case 'Text-to-Speech':
      return (
        <svg {...common} aria-hidden><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
      );
    case 'Integrations':
      return (
        <svg {...common} aria-hidden><line x1="18" y1="12" x2="6" y2="12" /><line x1="12" y1="6" x2="12" y2="18" /></svg>
      );
    case 'GitHub':
      return (
        <svg {...common} aria-hidden><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" /></svg>
      );
    case 'Activity':
      return (
        <svg {...common} aria-hidden><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
      );
    case 'Privacy':
      return (
        <svg {...common} aria-hidden><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
      );
    case 'Security':
      return (
        <svg {...common} aria-hidden><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>
      );
    case 'Appearance':
      return (
        <svg {...common} aria-hidden><circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" /></svg>
      );
    case 'Advanced':
      return (
        <svg {...common} aria-hidden><polyline points="4 17 10 11 13 14 20 7" /><polyline points="14 7 20 7 20 13" /></svg>
      );
    case 'How to Use':
      return (
        <svg {...common} aria-hidden><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
      );
  }
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  /** T-22: cross-links from Settings into the app-shell views. */
  onOpenMemory?: () => void;
  onOpenActivity?: () => void;
}

/**
 * T-13/T-22 — Settings: a floating glass modal (~1200px max, 85–90vh, centred)
 * with its own internal ~256px category sidebar listing every settings
 * category (Frontend Spec §8 — the full 16). Keys stay write-only — the panel
 * only ever shows "key is set" indicators, never plaintext (Security doc §8).
 */
export function SettingsPanel({ open, onClose, onOpenMemory, onOpenActivity }: SettingsPanelProps) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('AI Providers');
  const [provider, setProvider] = useState<ProviderId>('groq');
  const [hasGithubToken, setHasGithubToken] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshStatuses = useCallback(async () => {
    try {
      const [active, github] = await Promise.all([
        window.kyclius.getLLMProvider(),
        window.kyclius.hasGithubToken(),
      ]);
      setProvider(active === 'openrouter' ? 'openrouter' : 'groq');
      setHasGithubToken(github);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (open) void refreshStatuses();
  }, [open, refreshStatuses]);

  useEffect(() => {
    if (!open) setLoadError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Settings">
      {/* Backdrop — click to close */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden />

      <div className="relative z-10 w-full max-w-[1200px] h-[90vh] md:h-[85vh] rounded-card bg-surface/80 backdrop-blur-[20px] border border-outline-variant/20 shadow-glass flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <header className="flex-none px-8 py-5 border-b border-bark/10 flex justify-between items-center">
          <div>
            <h1 className="font-heading text-xl text-leaf-primary tracking-tight">Settings</h1>
            <p className="text-sm text-bark mt-0.5">Configure your digital sanctuary.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Settings"
            className="p-2 rounded-full hover:bg-stone/70 transition-colors text-bark hover:text-ink cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-300 group-hover:rotate-90">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        {/* Body: internal category sidebar + main panel */}
        <div className="flex-1 flex overflow-hidden">
          {/* Category sidebar (desktop) */}
          <aside className="w-64 border-r border-bark/10 flex-none overflow-y-auto py-6 px-4 hidden md:block">
            <nav className="space-y-4" aria-label="Settings categories">
              {CATEGORY_GROUPS.map(group => (
                <div key={group.label}>
                  <p className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-bark/60">
                    {group.label}
                  </p>
                  <div className="space-y-1">
                    {group.items.map(category => {
                      const active = activeCategory === category;
                      return (
                        <button
                          key={category}
                          type="button"
                          onClick={() => setActiveCategory(category)}
                          aria-current={active ? 'true' : undefined}
                          className={[
                            'flex items-center gap-3 px-4 py-2.5 rounded-lg text-[13px] font-medium transition-colors w-full text-left cursor-pointer',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep',
                            active
                              ? 'bg-primary-container/15 text-primary'
                              : 'text-on-surface-variant hover:bg-surface-highest/30 hover:text-on-surface',
                          ].join(' ')}
                        >
                          <span className="shrink-0"><CategoryIcon category={category} /></span>
                          <span>{category}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </aside>

          {/* Category picker (mobile) */}
          <div className="md:hidden absolute top-[72px] left-4 right-4 z-10">
            <select
              value={activeCategory}
              onChange={e => setActiveCategory(e.target.value as SettingsCategory)}
              aria-label="Settings category"
              className="w-full rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2 text-sm text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-secondary/40"
            >
              {CATEGORY_GROUPS.map(group => (
                <optgroup key={group.label} label={group.label}>
                  {group.items.map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Main panel */}
          <div className="flex-1 overflow-y-auto p-6 md:p-10 pt-24 md:pt-10">
            <div className="max-w-3xl mx-auto space-y-6">
              {loadError && (
                <p className="text-xs text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2" role="alert">
                  {loadError}
                </p>
              )}

              {activeCategory === 'AI Providers' && (
                <div className="space-y-6">
                  {/* N-07: dynamic registry cards — preset + custom providers */}
                  <ProviderSettings />
                  {/* N-04: rule-based multi-LLM routing */}
                  <ModelRoutingSettings />
                </div>
              )}

              {activeCategory === 'Models' && (
                <div className="space-y-6">
                  <ProviderSettings modelsOnly />
                </div>
              )}

              {activeCategory === 'Permissions' && (
                <PermissionsPanel />
              )}

              {activeCategory === 'Memory' && (
                <SettingsCard title="Memory" icon={<CategoryIcon category="Memory" />}>
                  <p className="text-[11px] text-bark leading-relaxed">
                    Every fact Kyclius remembers is stored in a local SQLite database on this
                    device — nothing is sent anywhere when you ask it to remember something.
                  </p>
                  <p className="text-[11px] text-bark leading-relaxed">
                    Manage, edit, or delete facts — including what it auto-learns from your
                    conversations — in the Memory view.
                  </p>
                  <div>
                    <button
                      type="button"
                      onClick={onOpenMemory}
                      className="text-[11px] font-medium text-sky-deep hover:text-sky-deep/80 underline underline-offset-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep rounded-sm"
                    >
                      Open the Memory view →
                    </button>
                  </div>
                </SettingsCard>
              )}

              {activeCategory === 'Voice' && (
                <div className="space-y-6">
                  {/* F-07: local whisper.cpp engine + model ladder */}
                  <SttSection />
                  {/* N-08: optional cloud STT provider (registry, "+ Add Provider") */}
                  <ProviderSettings capability="stt" />
                </div>
              )}

              {activeCategory === 'Voice Biometrics' && (
                <VoiceBiometricsSection />
              )}

              {activeCategory === 'Wake Word' && (
                <WakeWordSection />
              )}

              {activeCategory === 'Autonomous Mode' && (
                <AutonomousModeSection />
              )}

              {activeCategory === 'Text-to-Speech' && (
                <div className="space-y-6">
                  <SettingsCard title="Text-to-speech">
                    <p className="text-[11px] text-bark leading-relaxed">
                      Kyclius speaks answers using the local Kokoro-82M voice model. You can
                      override the model with your own files below, or add a cloud TTS
                      provider that takes over while it&apos;s enabled.
                    </p>
                  </SettingsCard>
                  <TtsModelSection />
                  {/* N-08: optional cloud TTS provider (registry, "+ Add Provider") */}
                  <ProviderSettings capability="tts" />
                </div>
              )}

              {activeCategory === 'Integrations' && (
                <SettingsCard title="Integrations" icon={<CategoryIcon category="Integrations" />}>
                  <p className="text-[11px] text-bark leading-relaxed">
                    Third-party connections. GitHub authentication is managed in the{' '}
                    <button type="button" onClick={() => setActiveCategory('GitHub')} className="text-sky-deep hover:underline underline-offset-2 cursor-pointer">GitHub</button>{' '}
                    category.
                  </p>
                  {/* N-01: optional Supabase cloud sync */}
                  <CloudSyncSettings />
                  {/* N-02: shared/community agents */}
                  <CommunityAgentsSettings />
                  {/* N-03: third-party plugins (sandboxed tool registry extensions) */}
                  <PluginSettings />
                </SettingsCard>
              )}

              {activeCategory === 'GitHub' && (
                <SettingsCard title="GitHub token" icon={<CategoryIcon category="GitHub" />}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-bark leading-relaxed">
                      Lets Kyclius read issues/PRs and post comments for you. A classic or
                      fine-grained token with repo scope is enough.
                    </p>
                    <StoredBadge stored={hasGithubToken} />
                  </div>
                  <SecretField
                    keyField="github"
                    placeholder="ghp_… / github_pat_…"
                    stored={hasGithubToken}
                    onSave={async value => {
                      try {
                        await window.kyclius.setGithubToken(value);
                        await refreshStatuses();
                        return { ok: true, message: 'Token saved.' };
                      } catch (err) {
                        return { ok: false, message: err instanceof Error ? err.message : String(err) };
                      }
                    }}
                    onRemove={
                      hasGithubToken
                        ? async () => {
                            try {
                              await window.kyclius.removeGithubToken();
                              await refreshStatuses();
                              return { ok: true };
                            } catch (err) {
                              return { ok: false, message: err instanceof Error ? err.message : String(err) };
                            }
                          }
                        : undefined
                    }
                  />
                </SettingsCard>
              )}

              {activeCategory === 'Activity' && (
                <SettingsCard title="Activity" icon={<CategoryIcon category="Activity" />}>
                  <p className="text-[11px] text-bark leading-relaxed">
                    A full, timestamped audit log of every tool action — approved, denied, run,
                    or failed — lives in the Activity view, with status filters and run details.
                  </p>
                  <div>
                    <button
                      type="button"
                      onClick={onOpenActivity}
                      className="text-[11px] font-medium text-sky-deep hover:text-sky-deep/80 underline underline-offset-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep rounded-sm"
                    >
                      Open the Activity view →
                    </button>
                  </div>
                </SettingsCard>
              )}

              {activeCategory === 'Privacy' && (
                <SettingsCard title="Privacy" icon={<CategoryIcon category="Privacy" />}>
                  <p className="text-[11px] text-bark leading-relaxed">
                    Kyclius is local-first: conversations, memory facts, and the tool activity
                    log live in a local database on this device. API keys are encrypted at rest.
                  </p>
                  <p className="text-[11px] text-bark leading-relaxed">
                    Voice audio is transcribed locally by whisper and is never stored; the wake
                    word path only listens for your phrase. Cloud sync, when offered, is
                    opt-in and off by default.
                  </p>
                </SettingsCard>
              )}

              {activeCategory === 'Security' && (
                <SettingsCard title="Security" icon={<CategoryIcon category="Security" />}>
                  <p className="text-[11px] text-bark leading-relaxed">
                    Every action Kyclius can take has a permission tier: auto-approved,
                    ask-every-time, or never allowed. Actions set to "Never Allow" are refused
                    before they ever reach a confirmation step.
                  </p>
                  <p className="text-[11px] text-bark leading-relaxed">
                    Voice biometrics (when enabled) only accepts your enrolled voice, and voice
                    data can be removed at any time.
                  </p>
                  <div>
                    <button
                      type="button"
                      onClick={() => setActiveCategory('Permissions')}
                      className="text-[11px] font-medium text-sky-deep hover:text-sky-deep/80 underline underline-offset-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep rounded-sm"
                    >
                      Review permissions →
                    </button>
                  </div>
                </SettingsCard>
              )}

              {activeCategory === 'Appearance' && (
                <SettingsCard title="Appearance" icon={<CategoryIcon category="Appearance" />}>
                  <p className="text-[11px] text-bark leading-relaxed">
                    The daylight nature palette is the current theme — calm organic greens and
                    blossom accents with a mist background, rendered as glass panels over the
                    scenery. A theme switcher is on the roadmap.
                  </p>
                </SettingsCard>
              )}

              {activeCategory === 'Advanced' && (
                <div className="space-y-6">
                  <SettingsCard title="Advanced">
                    <p className="text-[11px] text-bark leading-relaxed">
                      Low-level model paths and verification tuning. Leave paths empty to use
                      the auto-downloaded models.
                    </p>
                  </SettingsCard>
                  <VoiceModelPathsSection />
                  {/* N-05: recurring scheduled commands */}
                  <ScheduledTasksSettings />
                </div>
              )}

              {activeCategory === 'How to Use' && (
                <div className="space-y-6">
                  <HowToUseSection />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Wake Word section                                                  */
/* ------------------------------------------------------------------ */

function WakeWordSection() {
  const [phrase, setPhrase] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [phraseInput, setPhraseInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message?: string } | null>(null);

  useEffect(() => {
    if (!window.kyclius) return;
    window.kyclius.getWakeWordConfig().then(cfg => {
      setPhrase(cfg.phrase);
      setPhraseInput(cfg.phrase);
      setEnabled(cfg.enabled);
      setWarnings(cfg.warnings);
    }).catch(() => {});
    // T-18: background listening can be toggled from the tray menu even while
    // this panel (and window) is hidden — keep the switch in sync live so the
    // two always reflect the same underlying setting.
    return window.kyclius.onWakeStateChanged(state => {
      setEnabled(state !== 'off');
    });
  }, []);

  const handleSavePhrase = useCallback(async () => {
    const trimmed = phraseInput.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await window.kyclius.setWakeWord(trimmed);
      setWarnings(result.warnings);
      if (result.ok) {
        setPhrase(trimmed);
        setFeedback({ ok: true, message: 'Wake phrase updated.' });
      } else {
        setFeedback({ ok: false, message: 'Phrase not accepted — see warnings below.' });
      }
    } catch (err) {
      setFeedback({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
    setBusy(false);
  }, [busy, phraseInput]);

  const handleToggle = useCallback(async (next: boolean) => {
    setEnabled(next);
    try {
      await window.kyclius.toggleBackgroundListening(next);
    } catch {
      setEnabled(!next);
    }
  }, []);

  return (
    <SettingsCard title="Wake word" icon={<CategoryIcon category="Wake Word" />}>
      <div className="flex items-center justify-between gap-2">
        <Toggle checked={enabled} onChange={handleToggle} label="Background listening" />
        <p className="text-[11px] text-bark">Listen in the background</p>
      </div>
      <p className="text-[11px] text-bark leading-relaxed">
        When enabled, Kyclius listens for your wake phrase even when this window isn't
        focused. Audio before the phrase is processed locally and never stored.
      </p>

      <div className="space-y-1.5">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-bark">
          Wake phrase
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={phraseInput}
            disabled={busy}
            onChange={e => setPhraseInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleSavePhrase(); }}
            spellCheck={false}
            autoComplete="off"
            aria-label="Wake phrase"
            className="flex-1 min-w-0 rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-blossom/40 focus:border-blossom"
          />
          <button
            type="button"
            onClick={() => void handleSavePhrase()}
            disabled={busy || phraseInput.trim().length === 0 || phraseInput.trim() === phrase}
            className={[
              'px-3 h-9 shrink-0 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep',
              feedback?.ok && feedback.message?.includes('Wake')
                ? 'bg-primary text-on-primary'
                : 'border border-bark/20 text-bark hover:text-ink hover:border-bark/40 disabled:opacity-50',
            ].join(' ')}
          >
            {busy ? '…' : 'Set'}
          </button>
        </div>
        <p className="text-[11px] text-bark leading-relaxed">
          Two to four words work best. Avoid common phrases that might trigger
          accidentally.
        </p>
      </div>

      {warnings.length > 0 && (
        <ul className="space-y-0.5">
          {warnings.map((w, i) => (
            <li key={i} className="text-[11px] text-warning leading-relaxed">⚠ {w}</li>
          ))}
        </ul>
      )}

      {feedback?.message && (
        <p
          role="status"
          className={['text-[11px]', feedback.ok ? 'text-leaf-primary' : 'text-danger'].join(' ')}
        >
          {feedback.message}
        </p>
      )}
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Speech-to-Text section (F-07)                                      */
/* ------------------------------------------------------------------ */

function SttSection() {
  const [engine, setEngine] = useState<SttEngineId>('whisper');
  const [models, setModels] = useState<WhisperModelStatus[]>([]);
  const [activeId, setActiveId] = useState<WhisperModelId | undefined>(undefined);
  const [busyId, setBusyId] = useState<WhisperModelId | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message?: string } | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});

  const refresh = useCallback(async () => {
    const [eng, modelList, active] = await Promise.all([
      window.kyclius.getActiveSttEngine(),
      window.kyclius.getWhisperModels(),
      window.kyclius.getWhisperModel(),
    ]);
    setEngine(eng);
    setModels(modelList);
    setActiveId(active);
  }, []);

  useEffect(() => {
    if (!window.kyclius) return;
    void refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    if (!window.kyclius) return;
    return window.kyclius.onWhisperModelProgress((p: WhisperDownloadProgress) => {
      setProgress(prev => ({
        ...prev,
        [p.model]:
          p.total > 0 ? Math.min(100, Math.round((p.downloaded / p.total) * 100)) : 0,
      }));
    });
  }, []);

  const handleSwitchEngine = useCallback(
    async (next: SttEngineId) => {
      if (next === engine) return;
      const previous = engine;
      setEngine(next);
      try {
        await window.kyclius.setActiveSttEngine(next);
      } catch {
        setEngine(previous);
      }
    },
    [engine]
  );

  const handleDownload = useCallback(
    async (id: WhisperModelId) => {
      if (busyId) return;
      setBusyId(id);
      setFeedback(null);
      setProgress(prev => ({ ...prev, [id]: 0 }));
      try {
        const result = await window.kyclius.downloadWhisperModel(id);
        if (result.ok) {
          setActiveId(id);
          setFeedback({ ok: true, message: `${id} model ready.` });
        } else {
          setFeedback({ ok: false, message: result.message ?? 'Download failed.' });
        }
        await refresh();
      } catch (err) {
        setFeedback({ ok: false, message: err instanceof Error ? err.message : String(err) });
      }
      setBusyId(null);
      setProgress(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [busyId, refresh]
  );

  const handleUse = useCallback(
    async (id: WhisperModelId) => {
      await window.kyclius.setWhisperModel(id);
      setActiveId(id);
      setFeedback({ ok: true, message: `${id} selected.` });
    },
    []
  );

  return (
    <SettingsCard title="Voice" icon={<CategoryIcon category="Voice" />}>
      <p className="text-[11px] text-bark leading-relaxed">
        Local whisper.cpp runs entirely on your machine. The Large v3 Turbo model is
        the default; Small is the one-step-down fallback for slower hardware.
      </p>

      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-bark">Engine:</span>
        <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-stone/70 border border-bark/10">
          {(['whisper', 'system'] as SttEngineId[]).map(id => (
            <button
              key={id}
              type="button"
              onClick={() => void handleSwitchEngine(id)}
              aria-pressed={engine === id}
              className={[
                'px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep',
                engine === id
                  ? 'bg-primary-container text-on-primary-container'
                  : 'text-bark hover:text-ink',
              ].join(' ')}
            >
              {id === 'whisper' ? 'Whisper (local)' : 'System'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {models.map(model => {
          const pct = progress[model.id] ?? 0;
          const busy = busyId === model.id;
          const isActive = !busy && activeId === model.id;
          return (
            <div
              key={model.id}
              className={[
                'flex items-center justify-between gap-2 rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2.5',
                isActive ? 'border-leaf-primary/40 bg-leaf-primary/5' : '',
              ].join(' ')}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-medium text-ink">{model.label}</span>
                  {isActive && (
                    <span className="text-[9px] font-medium uppercase tracking-wide text-leaf-primary bg-leaf-primary/10 rounded-full px-1.5 py-0.5">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-bark leading-relaxed">{model.description}</p>
                {busy && (
                  <div className="mt-1.5 h-1 w-full rounded-full bg-stone overflow-hidden">
                    <div
                      className="h-full bg-leaf-primary transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
              <div className="shrink-0">
                {model.ready && !busy ? (
                  <button
                    type="button"
                    disabled={isActive}
                    onClick={() => void handleUse(model.id)}
                    className={[
                      'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep',
                      isActive
                        ? 'text-leaf-primary cursor-default'
                        : 'border border-bark/20 text-bark hover:text-ink hover:border-bark/40',
                    ].join(' ')}
                  >
                    {isActive ? 'Downloaded' : 'Use'}
                  </button>
                ) : busy ? (
                  <span className="text-[11px] text-bark">{busy && pct > 0 ? `${pct}%` : '…'}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleDownload(model.id)}
                    className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-primary-container text-on-primary-container hover:brightness-110 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
                  >
                    Download
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {feedback?.message && (
        <p
          role="status"
          className={['text-[11px]', feedback.ok ? 'text-leaf-primary' : 'text-danger'].join(' ')}
        >
          {feedback.message}
        </p>
      )}
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Voice Biometrics section                                           */
/* ------------------------------------------------------------------ */

function VoiceBiometricsSection() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!window.kyclius) return;
    window.kyclius
      .getBiometricsStatus()
      .then(status => {
        setEnabled(status.enabled);
      })
      .catch(() => {});
  }, []);

  const handleToggle = useCallback(async (next: boolean) => {
    setEnabled(next);
    try {
      await window.kyclius.setBiometricsEnabled(next);
    } catch {
      setEnabled(!next);
    }
  }, []);

  return (
    <SettingsCard title="Voice biometrics" icon={<CategoryIcon category="Voice Biometrics" />}>
      <div className="flex items-center justify-between gap-2">
        <Toggle checked={enabled} onChange={handleToggle} label="Voice verification" />
        <p className="text-[11px] text-bark">Only respond to your voice</p>
      </div>
      <p className="text-[11px] text-bark leading-relaxed">
        When enabled, Kyclius only responds to your enrolled voice. Others speaking
        near your mic will be ignored. Enrollment needs three short phrases.
      </p>
      <VoiceEnrollment />
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Autonomous Mode section                                            */
/* ------------------------------------------------------------------ */

interface AutonomousConfig {
  enabled: boolean;
  toolOverrides: Record<string, 'auto' | 'confirm_required' | 'never'>;
  maxPlanSteps: number;
  maxPlanDurationSeconds: number;
}

function AutonomousModeSection() {
  const [config, setConfig] = useState<AutonomousConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message?: string } | null>(null);

  useEffect(() => {
    if (!window.kyclius) return;
    window.kyclius.getAutonomousModeConfig().then(cfg => {
      setConfig(cfg);
    }).catch(() => {});
  }, []);

  const updateConfig = useCallback(async (patch: Partial<AutonomousConfig>) => {
    if (!config) return;
    const next = { ...config, ...patch };
    setConfig(next);
    setBusy(true);
    setFeedback(null);
    try {
      await window.kyclius.updateAutonomousModeConfig(patch);
      setFeedback({ ok: true, message: 'Saved.' });
      setTimeout(() => setFeedback(null), 2000);
    } catch (err) {
      setFeedback({ ok: false, message: err instanceof Error ? err.message : String(err) });
      setConfig(config); // revert
    }
    setBusy(false);
  }, [config]);

  if (!config) {
    return (
      <SettingsCard title="Autonomous mode" icon={<CategoryIcon category="Autonomous Mode" />}>
        <p className="text-[11px] text-bark">Loading…</p>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard title="Autonomous mode" icon={<CategoryIcon category="Autonomous Mode" />}>
      <div className="flex items-center justify-between gap-2">
        <Toggle
          checked={config.enabled}
          onChange={next => void updateConfig({ enabled: next })}
          label="Autonomous mode"
        />
        <p className="text-[11px] text-bark">Take some actions without asking</p>
      </div>
      <p className="text-[11px] text-bark leading-relaxed">
        Let Kyclius take some actions without asking first — you choose which
        ones. Each step in a plan is still subject to its permission tier.
      </p>

      {/* Plan limits */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-bark">
            Max steps
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={config.maxPlanSteps}
            disabled={busy}
            onChange={e => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 1 && v <= 20) {
                void updateConfig({ maxPlanSteps: v });
              }
            }}
            className="w-full rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-1.5 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-blossom/40 focus:border-blossom"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-bark">
            Timeout (seconds)
          </label>
          <input
            type="number"
            min={30}
            max={600}
            step={30}
            value={config.maxPlanDurationSeconds}
            disabled={busy}
            onChange={e => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 30 && v <= 600) {
                void updateConfig({ maxPlanDurationSeconds: v });
              }
            }}
            className="w-full rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-1.5 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-blossom/40 focus:border-blossom"
          />
        </div>
      </div>

      {/* T-20: which actions run without asking is owned by the Permissions
          panel (T-21) — not duplicated here, so the two never drift apart. */}
      <div className="space-y-1 rounded-lg border border-bark/10 bg-mist/60 px-3 py-2.5">
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-bark">
          What runs without asking
        </h4>
        <p className="text-[11px] text-bark leading-relaxed">
          Actions you've set to "Always Allow" in the Permissions panel are what
          Autonomous Mode runs without asking. Anything set to "Ask Every Time"
          or "Never Allow" still pauses here.
        </p>
      </div>

      {feedback?.message && (
        <p
          role="status"
          className={['text-[11px]', feedback.ok ? 'text-leaf-primary' : 'text-danger'].join(' ')}
        >
          {feedback.message}
        </p>
      )}
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared small components                                            */
/* ------------------------------------------------------------------ */

function SettingsCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-card border border-outline-variant/10 bg-surface-container/50 backdrop-blur-[20px] shadow-glass-card px-4 py-3.5 space-y-3">
      <h3 className="text-sm font-medium text-ink flex items-center gap-2">
        {icon && <span className="text-leaf-primary shrink-0">{icon}</span>}
        {title}
      </h3>
      {children}
    </section>
  );
}

function StoredBadge({ stored }: { stored: boolean }) {
  return (
    <span
      className={[
        'text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border',
        stored
          ? 'bg-leaf-primary/10 text-leaf-primary border-leaf-primary/30'
          : 'bg-warning/10 text-warning border-warning/40',
      ].join(' ')}
    >
      {stored ? '•••• Key set' : 'Not set'}
    </span>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep',
        checked ? 'bg-leaf-primary' : 'bg-bark/25',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
        ].join(' ')}
      />
    </button>
  );
}

export interface SecretFieldProps {
  keyField: string;
  placeholder: string;
  stored: boolean;
  onSave: (value: string) => Promise<SaveResult>;
  onRemove?: () => Promise<SaveResult>;
  helpText?: string;
  helpUrl?: string;
}

export function SecretField({ keyField, placeholder, stored, onSave, onRemove, helpText, helpUrl }: SecretFieldProps) {
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message?: string } | null>(null);

  useEffect(() => {
    if (!stored) return;
    setValue('');
    setVisible(false);
  }, [stored]);

  const handleSave = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setFeedback(null);
    const result = await onSave(trimmed);
    setBusy(false);
    setFeedback(result);
    if (result.ok) {
      setValue('');
      setVisible(false);
    }
  }, [busy, onSave, value]);

  const handleRemove = useCallback(async () => {
    if (!onRemove || busy) return;
    setBusy(true);
    setFeedback(null);
    const result = await onRemove();
    setBusy(false);
    setFeedback(result.ok ? { ok: true, message: 'Removed.' } : result);
  }, [busy, onRemove]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          disabled={busy}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void handleSave();
          }}
          placeholder={placeholder}
          aria-label={`${keyField} secret`}
          spellCheck={false}
          autoComplete="off"
          className="flex-1 min-w-0 rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-blossom/40 focus:border-blossom"
        />
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          aria-label={visible ? 'Hide secret' : 'Show secret'}
          title={visible ? 'Hide' : 'Show'}
          className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-bark hover:text-ink hover:bg-stone/60 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
        >
          {visible ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={busy || value.trim().length === 0}
          className="px-3 h-9 shrink-0 rounded-lg text-xs font-medium bg-primary-container text-on-primary-container hover:brightness-110 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={busy}
            className="px-3 h-9 shrink-0 rounded-lg text-xs font-medium border border-bark/20 text-bark hover:text-danger hover:border-danger/40 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
          >
            Remove
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        {helpText && helpUrl ? (
          <button
            type="button"
            onClick={() => void window.kyclius.openExternalUrl(helpUrl)}
            className="text-[11px] text-sky-deep hover:text-sky-deep/80 underline underline-offset-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep rounded-sm"
          >
            {helpText} ↗
          </button>
        ) : (
          <span />
        )}
        {feedback?.message && (
          <span
            role="status"
            className={[
              'text-[11px] truncate',
              feedback.ok ? 'text-leaf-primary' : 'text-danger',
            ].join(' ')}
          >
            {feedback.message}
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TTS Model Override section (F-07)                                  */
/* ------------------------------------------------------------------ */

function TtsModelSection() {
  const [modelPath, setModelPath] = useState('');
  const [voicePath, setVoicePath] = useState('');
  const [tokenizerPath, setTokenizerPath] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!window.kyclius) return;
    window.kyclius.getSettings().then(s => {
      setModelPath(s.kokoro_tts_model_path ?? '');
      setVoicePath(s.kokoro_tts_voice_path ?? '');
      setTokenizerPath(s.kokoro_tts_tokenizer_path ?? '');
    }).catch(() => {});
  }, []);

  const handleSave = useCallback(async () => {
    await window.kyclius.updateSettings({
      kokoro_tts_model_path: modelPath || undefined,
      kokoro_tts_voice_path: voicePath || undefined,
      kokoro_tts_tokenizer_path: tokenizerPath || undefined,
    });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }, [modelPath, voicePath, tokenizerPath]);

  const isConfigured = modelPath.length > 0 && voicePath.length > 0 && tokenizerPath.length > 0;

  return (
    <SettingsCard title="Text-to-speech model" icon={<CategoryIcon category="Text-to-Speech" />}>
      <p className="text-[11px] text-bark leading-relaxed">
        Kyclius auto-downloads the Kokoro-82M voice model (~92 MB) on first launch.
        Use these fields to override with a custom model path instead.
      </p>

      <div className="space-y-2">
        <div className="space-y-1">
          <label className="block text-[10px] font-medium uppercase tracking-wide text-bark">
            Model path (.onnx)
          </label>
          <input
            type="text"
            value={modelPath}
            onChange={e => setModelPath(e.target.value)}
            placeholder="Auto-downloaded when empty"
            spellCheck={false}
            className="w-full rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-1.5 text-xs text-ink font-mono focus:outline-none focus:ring-2 focus:ring-sky-deep"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] font-medium uppercase tracking-wide text-bark">
            Voice path (.bin)
          </label>
          <input
            type="text"
            value={voicePath}
            onChange={e => setVoicePath(e.target.value)}
            placeholder="Default: American Female (af)"
            spellCheck={false}
            className="w-full rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-1.5 text-xs text-ink font-mono focus:outline-none focus:ring-2 focus:ring-sky-deep"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] font-medium uppercase tracking-wide text-bark">
            Tokenizer path (tokenizer.json)
          </label>
          <input
            type="text"
            value={tokenizerPath}
            onChange={e => setTokenizerPath(e.target.value)}
            placeholder="Auto-downloaded when empty"
            spellCheck={false}
            className="w-full rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-1.5 text-xs text-ink font-mono focus:outline-none focus:ring-2 focus:ring-sky-deep"
          />
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => void handleSave()}
            className={[
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer',
              savedFlash
                ? 'bg-primary text-on-primary'
                : 'border border-bark/20 text-bark hover:text-ink hover:border-bark/40',
            ].join(' ')}
          >
            {savedFlash ? '✓ Saved' : 'Save Override'}
          </button>
          {isConfigured && (
            <span className="text-[10px] text-leaf-primary font-medium">
              Manual override active
            </span>
          )}
        </div>
      </div>
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Voice model paths (F-07 / F-09 / F-10)                             */
/* ------------------------------------------------------------------ */

const VOICE_PATH_FIELDS: { key: 'vad_model_path' | 'speaker_model_path' | 'whisper_binary_path' | 'whisper_model_path' | 'whisper_language' | 'whisper_initial_prompt'; label: string; placeholder: string }[] = [
  { key: 'vad_model_path', label: 'VAD model path (.onnx)', placeholder: 'Optional — Silero VAD model for speech detection' },
  { key: 'speaker_model_path', label: 'Speaker model path (.onnx)', placeholder: 'Optional — ECAPA-TDNN voiceprint model' },
  { key: 'whisper_binary_path', label: 'Whisper binary path', placeholder: 'Bundled in vendor/ when empty' },
  { key: 'whisper_model_path', label: 'Whisper model path', placeholder: 'Auto-resolved from the model ladder when empty' },
  { key: 'whisper_language', label: 'Whisper language code', placeholder: 'en (or de, fr, …)' },
  { key: 'whisper_initial_prompt', label: 'Whisper initial prompt', placeholder: 'Optional — bias decoding toward your vocabulary' },
];

function VoiceModelPathsSection() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [threshold, setThreshold] = useState('');
  const [hyper, setHyper] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!window.kyclius) return;
    window.kyclius.getSettings().then(s => {
      setValues({
        vad_model_path: s.vad_model_path ?? '',
        speaker_model_path: s.speaker_model_path ?? '',
        whisper_binary_path: s.whisper_binary_path ?? '',
        whisper_model_path: s.whisper_model_path ?? '',
        whisper_language: s.whisper_language ?? '',
        whisper_initial_prompt: s.whisper_initial_prompt ?? '',
      });
      setThreshold(s.speaker_threshold !== undefined ? String(s.speaker_threshold) : '');
    }).catch(() => {});
  }, []);

  const handleSave = useCallback(async () => {
    const patch: Record<string, string | number | undefined> = {};
    for (const field of VOICE_PATH_FIELDS) {
      patch[field.key] = values[field.key]?.trim() || undefined;
    }
    if (threshold.trim()) {
      const num = Number(threshold);
      if (Number.isFinite(num) && num > 0 && num <= 1) patch.speaker_threshold = num;
    } else {
      patch.speaker_threshold = undefined;
    }
    await window.kyclius.updateSettings(patch);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }, [threshold, values]);

  return (
    <SettingsCard title="Voice model paths & verification" icon={<CategoryIcon category="Advanced" />}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setHyper(v => !v)}
          className="text-[11px] text-bark underline underline-offset-2 hover:text-ink cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep rounded-sm"
        >
          {hyper ? 'Show few settings' : 'Show all settings'}
        </button>
      </div>
      <p className="text-[11px] text-bark leading-relaxed -mt-1">
        Leave paths empty to use the auto-downloaded models. These overrides make
        Kyclius use your own ONNX/whisper files instead.
      </p>

      <div className="space-y-1">
        <label className="block text-[10px] font-medium uppercase tracking-wide text-bark">
          Verification threshold (0–1)
        </label>
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={threshold}
          onChange={e => setThreshold(e.target.value)}
          placeholder="0.70 default"
          spellCheck={false}
          className="w-full rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-1.5 text-xs text-ink font-mono focus:outline-none focus:ring-2 focus:ring-sky-deep"
        />
        <p className="text-[10px] text-bark leading-relaxed">
          Higher is stricter: 0.85+ strongly rejects anyone but the enrolled voice.
        </p>
      </div>

      {hyper && (
        <div className="space-y-2">
          {VOICE_PATH_FIELDS.map(field => (
            <div key={field.key} className="space-y-1">
              <label className="block text-[10px] font-medium uppercase tracking-wide text-bark">
                {field.label}
              </label>
              <input
                type="text"
                value={values[field.key] ?? ''}
                onChange={e => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                spellCheck={false}
                className="w-full rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-1.5 text-xs text-ink font-mono focus:outline-none focus:ring-2 focus:ring-sky-deep"
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => void handleSave()}
          className={[
            'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer',
            savedFlash
              ? 'bg-primary text-on-primary'
              : 'border border-bark/20 text-bark hover:text-ink hover:border-bark/40',
          ].join(' ')}
        >
          {savedFlash ? '✓ Saved' : 'Save paths'}
        </button>
      </div>
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ */
/*  How to Use section                                                */
/* ------------------------------------------------------------------ */

function HowToUseSection() {
  const sections = [
    {
      title: 'Getting Started',
      items: [
        { label: 'Add an AI provider', detail: 'Open Settings → AI Providers, pick a preset (Groq, OpenRouter, etc.) or Custom, paste your API key, and click Save. Kyclius needs at least one provider to think and reply.' },
        { label: 'Grant microphone access', detail: 'On first launch, your OS will ask for microphone permission. Allow it so Kyclius can hear your voice commands and wake word.' },
        { label: 'Say "Hey Kyclius"', detail: 'That\'s the default wake phrase. You can change it in Settings → Wake Word. When Kyclius hears it, it will reply aloud and start listening for your command.' },
      ],
    },
    {
      title: 'Voice Commands vs. Typed Fallback',
      items: [
        { label: 'Voice is primary', detail: 'Click the mic button or say the wake word to speak your request. Kyclius will transcribe, think, and reply aloud.' },
        { label: 'Type anytime', detail: 'Click in the command bar and type — press Enter to send. This is always available as a fallback or for accessibility.' },
        { label: 'Global shortcut', detail: 'Press Cmd+K (Mac) or Ctrl+K (Windows/Linux) from anywhere in the app to focus the command bar instantly.' },
      ],
    },
    {
      title: 'Permissions: Always Allow / Ask Every Time / Never Allow',
      items: [
        { label: 'Always Allow', detail: 'The action runs immediately without any confirmation. Default for low-risk actions like opening apps or creating files.' },
        { label: 'Ask Every Time', detail: 'A confirmation dialog appears. You can approve by clicking "Allow Once" or saying "okay"/"continue". Default for sending email, deleting files, running shell commands.' },
        { label: 'Never Allow', detail: 'The action is blocked outright — no dialog, no voice confirmation, no Autonomous Mode override. Use for actions you never want Kyclius to take.' },
        { label: 'Edit in Settings → Permissions', detail: 'Each action has a three-way toggle. Changing it here takes effect immediately.' },
      ],
    },
    {
      title: 'Autonomous Mode',
      items: [
        { label: 'What it does', detail: 'When enabled, Kyclius can chain multiple tool calls toward a goal without pausing at every step — but only for actions you\'ve set to "Always Allow" in Permissions.' },
        { label: 'Runaway protection', detail: 'Hard ceilings: max steps (default 10) and max duration (default 5 min). You can adjust these in Settings → Autonomous Mode.' },
        { label: 'Recommended defaults', detail: 'Keep "delete_file" and "run_shell_command" on "Ask Every Time" — they\'re irreversible or high-risk.' },
      ],
    },
    {
      title: 'Voice Biometrics',
      items: [
        { label: 'What it protects', detail: 'When enrolled, only your voice can issue commands and approve confirmations. An unrecognized voice falls back to click/typed interaction.' },
        { label: 'What it doesn\'t guarantee', detail: 'A good recording of your voice could fool it. For stronger security, use the typed fallback or a PIN (not yet implemented).' },
        { label: 'Enroll / Re-enroll / Remove', detail: 'Go to Settings → Voice Biometrics. Enrollment takes 3 short phrases. You can remove it anytime — Kyclius immediately accepts any voice again.' },
      ],
    },
    {
      title: 'Attaching Files & Folders',
      items: [
        { label: 'Drag and drop', detail: 'Drag any file or folder from your OS file manager onto the command bar — a chip appears with the name and size.' },
        { label: 'Click the "+" icon', detail: 'Opens a native file/folder picker. You can select multiple files or a whole folder.' },
        { label: 'What happens', detail: 'Kyclius reads the content fresh from disk for that request only (never stored). Text files are included in context; binary files are summarized.' },
      ],
    },
    {
      title: 'Adding Paid or Custom Providers',
      items: [
        { label: 'Built-in presets', detail: 'Groq, OpenRouter, OpenAI, Anthropic, Gemini, NVIDIA NIM, Together AI, Fireworks, Mistral, DeepSeek — just paste your key.' },
        { label: 'Custom / OpenAI-Compatible', detail: 'For Ollama, LM Studio, vLLM, or any OpenAI-compatible endpoint: pick "Custom", enter the base URL, your key, and a model name.' },
        { label: 'What "Default" means', detail: 'The provider marked with a star is used when you don\'t explicitly choose one. Change it in Settings → AI Providers.' },
      ],
    },
    {
      title: 'Q&A Dashboard',
      items: [
        { label: 'What it shows', detail: 'Every question you asked and every answer Kyclius gave — written transcript + a "Listen" button to replay the spoken answer.' },
        { label: 'Filters', detail: 'Search by text, filter by Spoken vs Typed input.' },
        { label: 'Open from the sidebar', detail: 'Click "Dashboard" in the top nav or sidebar.' },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      {sections.map((section, i) => (
        <SettingsCard key={section.title} title={section.title} icon={<CategoryIcon category="How to Use" />}>
          <div className="space-y-3">
            {section.items.map((item, j) => (
              <div key={`${i}-${j}`} className="space-y-1 p-3 rounded-lg bg-surface-container/50 border border-outline-variant/10">
                <p className="text-[11px] font-medium text-on-surface">{item.label}</p>
                <p className="text-[11px] text-bark leading-relaxed">{item.detail}</p>
              </div>
            ))}
          </div>
        </SettingsCard>
      ))}
    </div>
  );
}

export default SettingsPanel;