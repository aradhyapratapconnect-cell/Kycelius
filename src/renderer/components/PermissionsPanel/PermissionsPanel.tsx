import { useCallback, useEffect, useState } from 'react';
import {
  defaultSettingFor,
  DANGER_NOTE,
  isDangerousTool,
  TIER_OPTIONS,
  toolDisplayLabel,
  type PermissionSetting,
} from './permissionUtils';

interface ToolRow {
  name: string;
  description: string;
  declaredTier: 'auto' | 'confirm_required';
}

export function PermissionsPanel() {
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [overrides, setOverrides] = useState<Record<string, PermissionSetting>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [available, config] = await Promise.all([
          window.kyclius.getAvailableTools(),
          window.kyclius.getAutonomousModeConfig(),
        ]);
        if (cancelled) return;
        setTools(
          available.map(tool => ({
            name: tool.name,
            description: tool.description,
            declaredTier: tool.permissionTier,
          }))
        );
        setOverrides(config.toolOverrides);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();

    if (!window.kyclius?.onAutonomousModeChanged) return;
    const off = window.kyclius.onAutonomousModeChanged(() => {
      window.kyclius
        .getAutonomousModeConfig()
        .then(config => {
          if (!cancelled) setOverrides(config.toolOverrides);
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const setSetting = useCallback(
    async (toolName: string, setting: PermissionSetting) => {
      const next = { ...overrides, [toolName]: setting };
      setOverrides(next);
      setSaving(true);
      setError(null);
      try {
        await window.kyclius.updateAutonomousModeConfig({ toolOverrides: next });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [overrides]
  );

  const hasAnyNonDefault = tools.some(
    tool => overrides[tool.name] !== undefined && overrides[tool.name] !== defaultSettingFor(tool.declaredTier)
  );

  const resetToDefaults = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await window.kyclius.updateAutonomousModeConfig({ toolOverrides: {} });
      setOverrides({});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <section aria-label="Permissions" className="rounded-card border border-outline-variant/10 bg-surface-container/50 backdrop-blur-[20px] shadow-glass-card px-4 py-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-ink">Permissions</h3>
          <p className="text-xs text-bark/80 mt-0.5">
            Choose how every action is gated before Kyclius runs it.
          </p>
        </div>
        {hasAnyNonDefault && (
          <button
            type="button"
            onClick={resetToDefaults}
            disabled={saving}
            className="shrink-0 text-xs text-bark hover:text-ink underline underline-offset-2 disabled:opacity-50"
          >
            Reset all to defaults
          </button>
        )}
      </div>

      {loading && (
        <p className="text-xs text-bark/80" role="status">
          Loading permissions…
        </p>
      )}
      {error && (
        <p className="text-xs text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2" role="alert">
          {error}
        </p>
      )}

      {!loading && tools.length === 0 && (
        <p className="text-xs text-bark/80">No tools are registered yet.</p>
      )}

      <ul className="space-y-3">
        {tools.map(tool => {
          const setting = overrides[tool.name] ?? defaultSettingFor(tool.declaredTier);
          const dangerous = isDangerousTool(tool.name);
          return (
            <li
              key={tool.name}
              className={`rounded-lg border p-3 space-y-2 ${
                dangerous ? 'border-danger/25 bg-danger/5' : 'border-bark/10 bg-stone/20'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${dangerous ? 'text-danger' : 'text-ink'}`}>
                    {toolDisplayLabel(tool.name)}
                  </p>
                  {tool.description && (
                    <p className="text-xs text-bark/80 mt-0.5 leading-relaxed">{tool.description}</p>
                  )}
                </div>
                <span className="sr-only">{tool.name}</span>
              </div>

              <div
                className="flex rounded-lg overflow-hidden border border-outline-variant/20 bg-surface-container"
                role="radiogroup"
                aria-label={`${toolDisplayLabel(tool.name)} permission`}
              >
                {TIER_OPTIONS.map(option => {
                  const selected = setting === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={saving}
                      onClick={() => void setSetting(tool.name, option.value)}
                      title={option.hint}
                      className={[
                        'flex-1 min-w-0 px-1.5 py-1.5 text-[11px] font-medium leading-tight text-center transition-colors',
                        selected
                          ? option.value === 'never'
                            ? 'bg-danger text-on-error'
                            : option.value === 'auto'
                              ? 'bg-primary text-on-primary'
                              : 'bg-surface-highest text-on-surface'
                          : 'text-bark hover:bg-stone/50',
                      ].join(' ')}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              {dangerous && (
                <p className="text-[11px] leading-relaxed text-danger/90 bg-danger/5 rounded px-2 py-1.5">
                  {DANGER_NOTE}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-[11px] leading-relaxed text-bark/70">
        &quot;Never Allow&quot; blocks the action outright, even with Autonomous Mode on.
        &quot;Always Allow&quot; only skips the prompt while Autonomous Mode is on — otherwise
        Kyclius still asks, one action at a time.
      </p>
    </section>
  );
}

export default PermissionsPanel;