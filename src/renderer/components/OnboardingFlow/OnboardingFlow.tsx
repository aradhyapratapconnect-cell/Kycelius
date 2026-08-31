import { useCallback, useEffect, useState } from 'react';
import {
  SecretField,
  HELP_URLS,
  type ProviderId,
} from '../SettingsPanel/SettingsPanel';
import type { ProviderInfo } from '@shared/types/ipc';
import { VoiceEnrollment } from '../VoiceEnrollment/VoiceEnrollment';

type Step = 'welcome' | 'key' | 'voice' | 'done';

interface OnboardingFlowProps {
  onComplete: () => void;
}

/**
 * S-01 — First-Run Onboarding Flow.
 *
 * Appears once, on first launch only (gated by the `onboarding_complete` flag
 * in user_config read by the renderer entry point). Guides a brand-new user to
 * add an AI provider API key (reusing the Settings key-entry component),
 * offers an optional, skippable voice enrollment (reusing VoiceEnrollment),
 * then sets the completion flag and drops the user into the normal idle home
 * screen.
 *
 * The API key step can be skipped: if it is, chat remains blocked with the
 * existing "no key set" prompt until the user adds a key in Settings — the
 * normal command bar pipeline already handles that, so this flow only has to
 * get out of the way once a decision is made.
 */
export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<Step>('welcome');

  // Provider key entry state (reused T-13 SecretField), registry-driven
  // (N-07): any enabled/dormant provider from the local registry is on offer.
  const [provider, setProvider] = useState<string>('groq');
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [hasKeys, setHasKeys] = useState<Record<string, boolean>>({});
  const [keyAdded, setKeyAdded] = useState(false);

  useEffect(() => {
    if (!window.kyclius) return;
    void Promise.all([
      window.kyclius.listProviders('llm'),
      window.kyclius.getLLMProvider(),
    ])
      .then(async ([all, active]) => {
        const keyMap: Record<string, boolean> = {};
        for (const p of all) {
          keyMap[p.id] = await window.kyclius.hasLLMApiKey(p.id);
        }
        setHasKeys(keyMap);
        const choosable = all.filter(p => p.enabled || p.isDefault || keyMap[p.id]);
        setProviders(choosable.length ? choosable : all);
        setProvider(active || all[0]?.id || 'groq');
        if (Object.values(keyMap).some(Boolean)) setKeyAdded(true);
      })
      .catch(() => {});
  }, []);

  const handleSaveKey = useCallback(async (id: string, value: string) => {
    await window.kyclius.setLLMApiKey(id, value);
    let verified = false;
    try {
      verified = await window.kyclius.validateLLMKey(id, value);
    } catch {
      verified = false;
    }
    setHasKeys(prev => ({ ...prev, [id]: true }));
    setKeyAdded(true);
    return {
      ok: true,
      message: verified
        ? 'Saved — verified working.'
        : 'Saved, but the test call failed. Double-check the key or the model ID in Settings.',
    };
  }, []);

  const finish = useCallback(() => {
    void window.kyclius
      .setOnboardingComplete()
      .catch(() => {})
      .finally(onComplete);
  }, [onComplete]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/70 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Kyclius"
    >
      <div className="relative z-10 w-full max-w-xl mx-4 rounded-card bg-surface/80 backdrop-blur-[20px] border border-outline-variant/20 shadow-glass overflow-hidden">
        <div className="px-8 py-10">
          {step === 'welcome' && (
            <div className="space-y-4">
              <h1 className="font-heading text-3xl text-leaf-primary tracking-tight">
                Welcome to Kyclius
              </h1>
              <p className="text-sm text-bark leading-relaxed">
                Kyclius is a private, local-first AI assistant you talk to out
                loud. To start chatting, connect a free AI provider key and
                optionally enroll your voice.
              </p>
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setStep('key')}
                  className="rounded-lg bg-primary text-on-primary px-5 py-2.5 text-sm font-medium hover:brightness-110 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
                >
                  Get started
                </button>
              </div>
            </div>
          )}

          {step === 'key' && (
            <div className="space-y-5">
              <div>
                <h1 className="font-heading text-xl text-leaf-primary tracking-tight">
                  Connect your AI provider
                </h1>
                <p className="text-xs text-bark leading-relaxed mt-1">
                  Paste a free API key from your AI provider. Kyclius needs one
                  to think and reply — you can skip this and add it in Settings
                  later, but chat stays locked until you do.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {providers.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProvider(p.id)}
                    aria-pressed={provider === p.id}
                    className={[
                      'px-3 py-2.5 rounded-xl border text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep',
                      provider === p.id
                        ? 'border-leaf-primary bg-leaf-primary/10'
                        : 'border-outline-variant/30 bg-surface-container/40 hover:border-outline-variant/60',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'block text-sm font-medium',
                        provider === p.id ? 'text-leaf-primary' : 'text-ink',
                      ].join(' ')}
                    >
                      {p.displayName}
                    </span>
                    <span className="block text-[11px] text-bark mt-0.5">
                      {hasKeys[p.id]
                        ? 'Key saved'
                        : p.defaultModel
                          ? `Default model: ${p.defaultModel}`
                          : 'Free API key'}
                    </span>
                  </button>
                ))}
              </div>

              <SecretField
                keyField={provider}
                placeholder="provider key…"
                stored={hasKeys[provider] ?? false}
                onSave={value => handleSaveKey(provider, value)}
                helpText={`Free key from ${providers.find(p => p.id === provider)?.displayName ?? provider}`}
                helpUrl={HELP_URLS[provider as ProviderId]}
              />

              <div className="flex items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep('voice')}
                  className="text-xs text-bark hover:text-ink underline underline-offset-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep rounded-sm"
                >
                  Skip for now
                </button>
                <button
                  type="button"
                  onClick={() => setStep('voice')}
                  className={[
                    'rounded-lg px-5 py-2.5 text-sm font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep',
                    keyAdded
                      ? 'bg-primary text-on-primary hover:brightness-110'
                      : 'bg-primary-container text-on-primary-container hover:brightness-105',
                  ].join(' ')}
                >
                  {keyAdded ? 'Continue' : 'Continue without a key'}
                </button>
              </div>
            </div>
          )}

          {step === 'voice' && (
            <div className="space-y-5">
              <div>
                <h1 className="font-heading text-xl text-leaf-primary tracking-tight">
                  Voice verification <span className="text-bark/70">(optional)</span>
                </h1>
                <p className="text-xs text-bark leading-relaxed mt-1">
                  Enroll your voice so Kyclius only responds to you. This step is
                  entirely skippable — you can enroll or remove it later in
                  Settings → Voice Biometrics.
                </p>
              </div>

              <VoiceEnrollment />

              <div className="flex items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep('key')}
                  className="text-xs text-bark hover:text-ink underline underline-offset-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep rounded-sm"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep('done')}
                  className="rounded-lg bg-primary text-on-primary px-5 py-2.5 text-sm font-medium hover:brightness-110 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
                >
                  Skip this step → Finish setup
                </button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="space-y-4">
              <h1 className="font-heading text-xl text-leaf-primary tracking-tight">
                You're all set
              </h1>
              <p className="text-sm text-bark leading-relaxed">
                {keyAdded
                  ? 'Your provider is connected. Say "Hey Kyclius" or start typing below to begin.'
                  : 'You skipped adding a key for now. Chat is locked until you add one in Settings — everything else is ready to go.'}
              </p>
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={finish}
                  className="rounded-lg bg-primary text-on-primary px-5 py-2.5 text-sm font-medium hover:brightness-110 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
                >
                  Start using Kyclius
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default OnboardingFlow;
