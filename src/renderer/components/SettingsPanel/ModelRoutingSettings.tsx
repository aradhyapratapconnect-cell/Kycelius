import { useCallback, useEffect, useRef, useState } from 'react';
import type { LlmRoutingConfig, LlmRoutingRule, ProviderInfo } from '@shared/types/ipc';

const newRule = (defaultProvider: string): LlmRoutingRule => ({
  id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  description: '',
  pattern: '',
  provider: defaultProvider,
  model: '',
});

/** N-04: rule-based multi-LLM routing config (Settings > AI Providers). */
export function ModelRoutingSettings() {
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<LlmRoutingRule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [providerOptions, setProviderOptions] = useState<Array<{ id: string; displayName: string }>>([]);
  const [defaultProvider, setDefaultProvider] = useState('groq');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void Promise.all([
      window.kyclius.getLlmRoutingConfig(),
      window.kyclius.listProviders('llm'),
      window.kyclius.getLLMProvider(),
    ])
      .then(([config, providers, active]: [LlmRoutingConfig, ProviderInfo[], string]) => {
        setEnabled(config.enabled);
        setRules(config.rules);
        setLoaded(true);
        setProviderOptions(
          providers
            .filter(p => p.enabled || p.isDefault || p.hasKey)
            .map(p => ({ id: p.id, displayName: p.displayName }))
        );
        setDefaultProvider(active || providers[0]?.id || 'groq');
      })
      .catch(err => setMessage(err instanceof Error ? err.message : String(err)));
  }, []);

  const persist = useCallback(async (nextEnabled: boolean, nextRules: LlmRoutingRule[]) => {
    try {
      await window.kyclius.setLlmRoutingConfig({
        enabled: nextEnabled,
        rules: nextRules,
      });
      setMessage(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Auto-save a short beat after the last edit.
  const schedulePersist = useCallback(
    (nextEnabled: boolean, nextRules: LlmRoutingRule[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void persist(nextEnabled, nextRules);
      }, 400);
    },
    [persist]
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const updateRule = useCallback(
    (id: string, patch: Partial<LlmRoutingRule>) => {
      setRules(prev => {
        const next = prev.map(r => (r.id === id ? { ...r, ...patch } : r));
        schedulePersist(enabled, next);
        return next;
      });
    },
    [enabled, schedulePersist]
  );

  const handleAdd = useCallback(() => {
    const next = [...rules, newRule(providerOptions[0]?.id ?? defaultProvider)];
    setRules(next);
    schedulePersist(enabled, next);
  }, [rules, enabled, schedulePersist, providerOptions, defaultProvider]);

  const handleRemove = useCallback(
    (id: string) => {
      const next = rules.filter(r => r.id !== id);
      setRules(next);
      schedulePersist(enabled, next);
    },
    [rules, enabled, schedulePersist]
  );

  const handleToggle = useCallback(
    (nextValue: boolean) => {
      setEnabled(nextValue);
      schedulePersist(nextValue, rules);
    },
    [rules, schedulePersist]
  );

  if (!loaded) {
    return (
      <div className="border-t border-outline-variant/10 pt-4">
        <p className="text-[12px] text-ink font-medium">Model routing</p>
        <p className="text-[11px] text-bark mt-1">Loading…</p>
      </div>
    );
  }

  return (
    <div className="border-t border-outline-variant/10 pt-4 space-y-3">
      <div>
        <p className="text-[12px] text-ink font-medium">Model routing</p>
        <p className="text-[11px] text-bark">
          Route requests across providers by rule. Turned off, every request goes
          to the <span className="text-bark font-medium">Active AI provider</span>.
        </p>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => handleToggle(e.target.checked)}
          className="accent-leaf-primary"
        />
        <span className="text-[12px] text-ink">Route by rules</span>
      </label>

      {enabled && (
        <>
          {rules.length === 0 ? (
            <p className="text-[11px] text-bark">
              No rules yet — add one below, or every request uses the active provider.
            </p>
          ) : (
            <ul className="space-y-2">
              {rules.map(rule => (
                <li
                  key={rule.id}
                  className="rounded-lg border border-outline-variant/10 bg-surface-container/40 px-3 py-2 space-y-2"
                >
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-0.5">
                      <span className="text-[10px] uppercase tracking-wide text-bark/70 font-medium">Label</span>
                      <input
                        type="text"
                        value={rule.description}
                        onChange={e => updateRule(rule.id, { description: e.target.value })}
                        placeholder="e.g. Complex planning"
                        className="w-full rounded-md bg-surface-container/60 border border-outline-variant/20 px-2 py-1 text-[12px] text-ink focus:outline-none focus:border-leaf-primary/60"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] uppercase tracking-wide text-bark/70 font-medium">Provider</span>
                      <select
                        value={rule.provider}
                        onChange={e => updateRule(rule.id, { provider: e.target.value })}
                        className="w-full rounded-md bg-surface-container/60 border border-outline-variant/20 px-2 py-1 text-[12px] text-ink focus:outline-none focus:border-leaf-primary/60"
                      >
                        {providerOptions.length === 0 && (
                          <option value={rule.provider}>groq</option>
                        )}
                        {providerOptions.map(p => (
                          <option key={p.id} value={p.id}>{p.displayName}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="space-y-0.5 block">
                    <span className="text-[10px] uppercase tracking-wide text-bark/70 font-medium">When your command includes…</span>
                    <input
                      type="text"
                      value={rule.pattern}
                      onChange={e => updateRule(rule.id, { pattern: e.target.value })}
                      placeholder='plain: "schedule"  or  regex: /planner|plan/'
                      className="w-full rounded-md bg-surface-container/60 border border-outline-variant/20 px-2 py-1 text-[12px] text-ink focus:outline-none focus:border-leaf-primary/60"
                    />
                  </label>
                  <label className="space-y-0.5 block">
                    <span className="text-[10px] uppercase tracking-wide text-bark/70 font-medium">
                      Model (optional)
                    </span>
                    <input
                      type="text"
                      value={rule.model ?? ''}
                      onChange={e => updateRule(rule.id, { model: e.target.value })}
                      placeholder="leave empty to use the provider's model"
                      className="w-full rounded-md bg-surface-container/60 border border-outline-variant/20 px-2 py-1 text-[12px] text-ink focus:outline-none focus:border-leaf-primary/60"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => handleRemove(rule.id)}
                    className="rounded-md border border-danger/40 px-2.5 py-1 text-[11px] font-medium text-danger"
                  >
                    Remove rule
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={handleAdd}
            className="rounded-lg border border-outline-variant/20 px-3 py-1.5 text-[12px] font-medium text-ink hover:border-outline-variant/50"
          >
            Add rule
          </button>

          <p className="text-[11px] text-bark leading-relaxed">
            Rules are checked top to bottom; the first match wins. If no rule
            matches, the active provider handles the request. If a rule&apos;s
            provider has no API key, Kyclius falls back to the active provider.
          </p>
        </>
      )}

      {message && <p className="text-[11px] text-danger">{message}</p>}
    </div>
  );
}