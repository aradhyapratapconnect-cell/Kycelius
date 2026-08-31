import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ProviderCapability,
  ProviderInfo,
  ProviderPresetInfo,
  ProviderSchema,
} from '@shared/types/ipc';

const SCHEMA_LABEL: Record<ProviderSchema, string> = {
  openai_compatible: 'OpenAI-compatible',
  anthropic_native: 'Anthropic native',
  gemini_native: 'Gemini native',
  cloud_stt: 'Cloud STT',
  cloud_tts: 'Cloud TTS',
};

/** N-08: capability-aware copy so the one component serves LLM, STT and TTS. */
const CAPABILITY_COPY: Record<
  Exclude<ProviderCapability, 'llm'>,
  { active: string; defaultHint: string; switchHint: string }
> = {
  stt: {
    active: 'Active speech (STT) provider',
    defaultHint: 'Cloud STT default — spoken commands route here while enabled.',
    switchHint: 'Switching takes effect on your next spoken command.',
  },
  tts: {
    active: 'Active voice (TTS) provider',
    defaultHint: 'Cloud TTS default — spoken replies route here while enabled.',
    switchHint: 'Switching takes effect on your next spoken reply.',
  },
};

const PRESET_HELP_URL: Record<string, string> = {
  groq: 'https://console.groq.com/keys',
  openrouter: 'https://openrouter.ai/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  gemini: 'https://aistudio.google.com/apikey',
  nvidia_nim: 'https://developer.nvidia.com/integrate/DLAI',
  together: 'https://api.together.xyz/settings/api-keys',
  fireworks: 'https://fireworks.ai/account/api-keys',
  mistral: 'https://console.mistral.ai/api-keys/',
  deepseek: 'https://platform.deepseek.com/api_keys',
};

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

function KeyField({
  provider,
  capability,
  onChanged,
}: {
  provider: ProviderInfo;
  capability: ProviderCapability;
  onChanged: () => void;
}) {
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message?: string } | null>(null);

  useEffect(() => {
    if (!provider.hasKey) return;
    setValue('');
    setVisible(false);
  }, [provider.hasKey]);

  const handleSave = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      if (capability === 'llm') {
        await window.kyclius.setLLMApiKey(provider.id, trimmed);
        let verified = false;
        try {
          verified = await window.kyclius.validateLLMKey(provider.id, trimmed);
        } catch {
          verified = false;
        }
        setFeedback(
          verified
            ? { ok: true, message: 'Saved — verified working.' }
            : {
                ok: true,
                message: 'Saved, but the test call failed. Double-check the key or the model ID.',
              }
        );
      } else {
        // N-08: cloud STT/TTS keys are stored the same (encrypted vault) but
        // there's no cheap "test call" — a live transcription/speech round is
        // required, so we just persist and let a spoken request surface issues.
        await window.kyclius.setProviderApiKey(provider.id, trimmed);
        setFeedback({ ok: true, message: 'Saved.' });
      }
      setValue('');
      setVisible(false);
      onChanged();
    } catch (err) {
      setFeedback({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [busy, capability, onChanged, provider.id, value]);

  const handleRemove = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      await window.kyclius.deleteProviderApiKey(provider.id);
      setFeedback({ ok: true, message: 'Key removed.' });
      onChanged();
    } catch (err) {
      setFeedback({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [busy, onChanged, provider.id]);

  const helpUrl = PRESET_HELP_URL[provider.presetKey];

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
          placeholder={provider.presetKey === 'groq' ? 'gsk_…' : 'Key or paste an API key'}
          aria-label={`${provider.displayName} secret`}
          spellCheck={false}
          autoComplete="off"
          className="flex-1 min-w-0 rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-blossom/40 focus:border-blossom"
        />
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          aria-label={visible ? 'Hide secret' : 'Show secret'}
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
        {provider.hasKey && (
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={busy}
            className="px-3 h-9 shrink-0 rounded-lg text-xs font-medium border border-danger/40 text-danger hover:bg-danger/10 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
          >
            Remove
          </button>
        )}
      </div>
      {feedback && (
        <p className={['text-[11px]', feedback.ok ? 'text-leaf-primary' : 'text-danger'].join(' ')}>
          {feedback.message}
        </p>
      )}
      <p className="text-[11px] text-bark">
        {helpUrl ? (
          <>
            Get a key{' '}
            <a
              href={helpUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sky-deep underline underline-offset-2"
              onClick={e => {
                e.preventDefault();
                void window.kyclius.openExternalUrl(helpUrl);
              }}
            >
              from {provider.displayName}
            </a>
            — keys are stored encrypted on this device and never leave it.
          </>
        ) : (
          'Keys are stored encrypted on this device and never leave it.'
        )}
      </p>
    </div>
  );
}

function ModelField({
  provider,
  capability,
  onChanged,
}: {
  provider: ProviderInfo;
  capability: ProviderCapability;
  onChanged: () => void;
}) {
  const [value, setValue] = useState(provider.defaultModel ?? '');
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setValue(provider.defaultModel ?? '');
  }, [provider.defaultModel]);

  const handleSave = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      if (capability === 'llm') {
        await window.kyclius.setLLMModel(provider.id, trimmed);
      } else {
        // N-08: cloud TTS stores the voice/model id on the provider row.
        await window.kyclius.updateProvider(provider.id, { defaultModel: trimmed });
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
      onChanged();
    } finally {
      setBusy(false);
    }
  }, [busy, capability, onChanged, provider.id, value]);

  const handleFetchModels = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const list = await window.kyclius.listProviderModels(provider.id);
      setModels(list);
      if (list.length === 1) setValue(list[0]);
    } finally {
      setBusy(false);
    }
  }, [busy, provider.id]);

  const canFetchModels = capability === 'llm';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-bark">
          {capability === 'tts' ? 'Model / Voice ID' : 'Model ID'}
        </label>
        {canFetchModels && (
          <button
            type="button"
            onClick={() => void handleFetchModels()}
            className="text-[11px] text-sky-deep hover:underline underline-offset-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep rounded-sm"
          >
            {models.length > 0 ? `${models.length} available` : 'Fetch list'}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          list={models.length > 0 ? `models-${provider.id}` : undefined}
          value={value}
          disabled={busy}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void handleSave();
          }}
          spellCheck={false}
          autoComplete="off"
          aria-label={`${provider.displayName} model ID`}
          placeholder={capability === 'tts' ? 'e.g. alloy' : capability === 'stt' ? 'e.g. whisper-1' : undefined}
          className="flex-1 min-w-0 rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-blossom/40 focus:border-blossom"
        />
        {models.length > 0 && (
          <datalist id={`models-${provider.id}`}>
            {models.map(m => (
              <option key={m} value={m} />
            ))}
          </datalist>
        )}
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={busy || value.trim().length === 0 || value === (provider.defaultModel ?? '')}
          className={[
            'px-3 h-9 shrink-0 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep',
            savedFlash
              ? 'bg-primary text-on-primary'
              : 'border border-bark/20 text-bark hover:text-ink hover:border-bark/40 disabled:opacity-50',
          ].join(' ')}
        >
          {savedFlash ? '✓ Saved' : busy ? '…' : 'Set'}
        </button>
      </div>
      <p className="text-[11px] text-bark leading-relaxed">
        {capability === 'stt' || capability === 'tts'
          ? 'Name the transcription model or voice your provider supports — check the provider console for current ids.'
          : 'Free-tier model lists rotate — grab a current chat model ID from the provider&apos;s console.'}
      </p>
    </div>
  );
}

export interface ProviderSettingsProps {
  /** When true, render only the per-provider model fields (Settings > Models). */
  modelsOnly?: boolean;
  /** N-08: which capability to manage. Defaults to LLM providers. */
  capability?: ProviderCapability;
}

/** N-07/N-08: dynamic provider registry settings — preset + custom rows, active
 *  default, keys (write-only), models, enable/disable, add/remove. The same
 *  component serves LLM (`capability="llm"`), cloud STT and cloud TTS. */
export function ProviderSettings({ modelsOnly = false, capability = 'llm' }: ProviderSettingsProps) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const copy = capability === 'llm' ? null : CAPABILITY_COPY[capability];

  const refresh = useCallback(async () => {
    try {
      const [rows, active] = await Promise.all([
        window.kyclius.listProviders(capability),
        window.kyclius.getActiveProvider(capability),
      ]);
      setProviders(rows);
      setActiveId(active);
      setMessage(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }, [capability]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sorted = [...providers].sort(
    (a, b) => Number(b.isDefault) - Number(a.isDefault) || a.displayName.localeCompare(b.displayName)
  );

  const setDefault = useCallback(
    async (id: string) => {
      if (id === activeId) return;
      try {
        await window.kyclius.setActiveProvider(capability, id);
        await refresh();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : String(err));
      }
    },
    [activeId, capability, refresh]
  );

  const toggleEnabled = useCallback(
    async (provider: ProviderInfo, enabled: boolean) => {
      try {
        await window.kyclius.updateProvider(provider.id, { enabled });
        await refresh();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh]
  );

  const remove = useCallback(
    async (provider: ProviderInfo) => {
      if (!window.confirm(`Remove ${provider.displayName}? Its saved API key will be deleted.`)) {
        return;
      }
      try {
        await window.kyclius.removeProvider(provider.id);
        await refresh();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh]
  );

  if (!modelsOnly) {
    return (
      <div className="space-y-6">
        <section aria-label={copy?.active ?? 'Active AI provider'} className="rounded-card border border-outline-variant/10 bg-surface-container/50 backdrop-blur-[20px] shadow-glass-card px-4 py-3.5 space-y-3">
          <h3 className="text-sm font-medium text-ink">{copy?.active ?? 'Active AI provider'}</h3>
          <div className="grid grid-cols-2 gap-2">
            {sorted.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => void setDefault(p.id)}
                aria-pressed={p.id === activeId}
                className={[
                  'px-3 py-2.5 rounded-xl border text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep',
                  p.id === activeId
                    ? 'border-leaf-primary bg-leaf-primary/10'
                    : 'border-outline-variant/30 bg-surface-container/40 hover:border-outline-variant/60',
                ].join(' ')}
              >
                <span
                  className={[
                    'block text-sm font-medium flex items-center gap-2',
                    p.id === activeId ? 'text-leaf-primary' : 'text-ink',
                  ].join(' ')}
                >
                  {p.displayName}
                  {p.id === activeId && (
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-leaf-primary">
                      default
                    </span>
                  )}
                </span>
                <span className="block text-[11px] text-bark mt-0.5">
                  {SCHEMA_LABEL[p.schema]}
                </span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-bark">
            {copy?.switchHint ?? 'Switching takes effect on your very next command.'}
          </p>
        </section>

        {sorted.map(p => (
          <section
            key={`section-${p.id}`}
            aria-label={`${p.displayName}`}
            className="rounded-card border border-outline-variant/10 bg-surface-container/50 backdrop-blur-[20px] shadow-glass-card px-4 py-3.5 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-ink flex items-center gap-2">
                {p.displayName}
                {!p.hasKey && (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-bark/60">
                    {p.presetKey}
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2">
                <StoredBadge stored={p.hasKey} />
                <Toggle
                  checked={p.enabled}
                  onChange={next => void toggleEnabled(p, next)}
                  label={`Enable ${p.displayName}`}
                />
              </div>
            </div>

            {p.isDefault && (
              <p className="text-[11px] text-leaf-primary">
                {copy?.defaultHint ?? 'Default LLM provider — answers route here.'}
              </p>
            )}

            {p.baseUrl && (
              <p className="text-[11px] text-bark break-all">
                Base URL: <span className="font-mono">{p.baseUrl}</span>
              </p>
            )}

            <KeyField provider={p} capability={capability} onChanged={() => void refresh()} />
            <ModelField provider={p} capability={capability} onChanged={() => void refresh()} />

            <div className="flex items-center gap-2 pt-1">
              {p.id !== activeId && (
                <button
                  type="button"
                  onClick={() => void setDefault(p.id)}
                  className="rounded-md border border-outline-variant/20 px-3 py-1.5 text-[11px] font-medium text-ink hover:border-outline-variant/50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
                >
                  Set as default
                </button>
              )}
              <button
                type="button"
                onClick={() => void remove(p)}
                className="rounded-md border border-danger/40 px-3 py-1.5 text-[11px] font-medium text-danger hover:bg-danger/10 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
              >
                Remove
              </button>
            </div>
          </section>
        ))}

        <AddProvider
          capability={capability}
          onAdded={() => void refresh()}
          adding={adding}
          setAdding={setAdding}
        />

        {message && <p className="text-[11px] text-danger" role="alert">{message}</p>}
      </div>
    );
  }

  // Settings > Models: just the per-provider model IDs.
  return (
    <div className="space-y-6">
      {sorted.map(p => (
        <section
          key={`model-${p.id}`}
          aria-label={`${p.displayName} model`}
          className="rounded-card border border-outline-variant/10 bg-surface-container/50 backdrop-blur-[20px] shadow-glass-card px-4 py-3.5 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-ink">{p.displayName} default model</h3>
            {p.isDefault && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-leaf-primary">
                default
              </span>
            )}
          </div>
          <ModelField provider={p} capability={capability} onChanged={() => void refresh()} />
          <p className="text-[11px] text-bark leading-relaxed">
            This model handles the responses Kyclius writes after acting.
          </p>
        </section>
      ))}
    </div>
  );
}

function AddProvider({
  capability,
  onAdded,
  adding,
  setAdding,
}: {
  capability: ProviderCapability;
  onAdded: () => void;
  adding: boolean;
  setAdding: (next: boolean) => void;
}) {
  const [presets, setPresets] = useState<ProviderPresetInfo[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [baseUrl, setBaseUrl] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!adding) return;
    void window.kyclius
      .listProviderPresets(capability)
      .then(rows => {
        // The LLM surface offers the OpenAI-compatible `custom` preset plus the
        // named providers; voice offers its own `custom_stt`/`custom_tts`.
        if (capability === 'llm') {
          setPresets(rows.filter(r => !r.presetKey.startsWith('custom_') || r.presetKey === 'custom'));
        } else {
          setPresets(rows);
        }
      })
      .catch(err => setFeedback(err instanceof Error ? err.message : String(err)));
  }, [adding, capability]);

  const handleAdd = useCallback(async () => {
    if (!selected || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const isCustom = selected === 'custom' || selected.startsWith('custom_');
      await window.kyclius.addProvider({
        capability,
        presetKey: selected,
        ...(isCustom
          ? {
              displayName: displayName.trim() || undefined,
              baseUrl: baseUrl.trim() || undefined,
              defaultModel: defaultModel.trim() || undefined,
            }
          : {}),
      });
      setAdding(false);
      setSelected('');
      setBaseUrl('');
      setDisplayName('');
      setDefaultModel('');
      onAdded();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [baseUrl, busy, capability, defaultModel, displayName, onAdded, selected, setAdding]);

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="rounded-card border border-dashed border-outline-variant/30 px-4 py-3 text-[12px] font-medium text-bark hover:text-ink hover:border-outline-variant/60 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
      >
        + Add provider
      </button>
    );
  }

  return (
    <section
      aria-label="Add provider"
      className="rounded-card border border-outline-variant/20 bg-surface-container/50 backdrop-blur-[20px] shadow-glass-card px-4 py-3.5 space-y-3"
    >
      <h3 className="text-sm font-medium text-ink">Add a provider</h3>
      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-wide text-bark/70 font-medium">Provider</span>
        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          className="w-full rounded-md bg-surface-container/60 border border-outline-variant/20 px-2 py-1.5 text-[12px] text-ink focus:outline-none focus:border-leaf-primary/60"
        >
          <option value="">Choose a provider…</option>
          {presets.map(p => (
            <option key={p.presetKey} value={p.presetKey}>
              {p.displayName} — {SCHEMA_LABEL[p.schema]}
            </option>
          ))}
        </select>
      </label>

      {capability !== 'llm' || selected === 'custom' || selected.startsWith('custom_') ? (
        <>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-bark/70 font-medium">Name</span>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="e.g. My STT gateway"
              className="w-full rounded-md bg-surface-container/60 border border-outline-variant/20 px-2 py-1.5 text-[12px] text-ink focus:outline-none focus:border-leaf-primary/60"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-bark/70 font-medium">Base URL</span>
            <input
              type="text"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="w-full rounded-md bg-surface-container/60 border border-outline-variant/20 px-2 py-1.5 font-mono text-[12px] text-ink focus:outline-none focus:border-leaf-primary/60"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-bark/70 font-medium">Default model / voice</span>
            <input
              type="text"
              value={defaultModel}
              onChange={e => setDefaultModel(e.target.value)}
              placeholder="e.g. whisper-1 / alloy"
              className="w-full rounded-md bg-surface-container/60 border border-outline-variant/20 px-2 py-1.5 font-mono text-[12px] text-ink focus:outline-none focus:border-leaf-primary/60"
            />
          </label>
        </>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={!selected || busy}
          className="rounded-md border border-outline-variant/20 px-3 py-1.5 text-[12px] font-medium text-ink hover:border-outline-variant/50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button
          type="button"
          onClick={() => setAdding(false)}
          className="rounded-md px-3 py-1.5 text-[12px] text-bark hover:text-ink cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep"
        >
          Cancel
        </button>
      </div>
      {feedback && (
        <p className="text-[11px] text-danger" role="alert">
          {feedback}
        </p>
      )}
    </section>
  );
}

export default ProviderSettings;