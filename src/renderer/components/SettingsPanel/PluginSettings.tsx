import { useCallback, useEffect, useState } from 'react';
import type {
  InstalledPluginInfo,
  PluginInstallPreview,
} from '@shared/types/ipc';

/** N-03: Third-Party Plugins — install (with capability/tool disclosure), activate, uninstall. */
export function PluginSettings() {
  const [plugins, setPlugins] = useState<InstalledPluginInfo[]>([]);
  const [preview, setPreview] = useState<PluginInstallPreview | null>(null);
  const [approvedAuto, setApprovedAuto] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setPlugins(await window.kyclius.listPlugins());
    } catch {
      setPlugins([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleInstall = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.kyclius.previewInstallPlugin();
      if (result.canceled || !result.preview) return;
      setApprovedAuto([]);
      setPreview(result.preview);
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    setMessage(null);
    try {
      await window.kyclius.confirmInstallPlugin({ preview, approvedAuto });
      setPreview(null);
      await load();
      setMessage({ ok: true, text: 'Plugin installed and enabled.' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [preview, approvedAuto, load]);

  const handleToggleActive = useCallback(
    async (plugin: InstalledPluginInfo) => {
      setMessage(null);
      try {
        await window.kyclius.setPluginActive(plugin.id, !plugin.active);
      } catch (err) {
        setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
      } finally {
        await load();
      }
    },
    [load]
  );

  const handleRemove = useCallback(
    async (id: string) => {
      setMessage(null);
      try {
        await window.kyclius.uninstallPlugin(id);
        setMessage({ ok: true, text: 'Plugin uninstalled.' });
      } catch (err) {
        setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
      } finally {
        await load();
      }
    },
    [load]
  );

  const toggleApproved = useCallback((name: string) => {
    setApprovedAuto(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  }, []);

  return (
    <div className="space-y-4 border-t border-outline-variant/10 pt-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[12px] text-ink font-medium">Third-party plugins</p>
          <p className="text-[11px] text-bark">
            Sandboxed plugins can register new tools. You review every declared
            capability and tool permission before a plugin is installed.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={handleInstall}
          className="shrink-0 rounded-lg bg-leaf-primary px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
        >
          Install plugin…
        </button>
      </div>

      {plugins.length === 0 ? (
        <p className="text-[11px] text-bark">No plugins installed yet.</p>
      ) : (
        <ul className="space-y-2">
          {plugins.map(plugin => (
            <li
              key={plugin.id}
              className="rounded-lg border border-outline-variant/10 bg-surface-container/40 px-3 py-2 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12px] text-ink font-medium truncate">
                    {plugin.name}
                    <span className="ml-2 text-[10px] text-bark">v{plugin.version}</span>
                    {plugin.active && (
                      <span className="ml-2 text-[10px] uppercase text-leaf-primary">enabled</span>
                    )}
                    {!plugin.running && (
                      <span className="ml-2 text-[10px] uppercase text-danger">not running</span>
                    )}
                  </p>
                  <p className="text-[11px] text-bark line-clamp-1">{plugin.description}</p>
                  {plugin.toolNames.length > 0 && (
                    <p className="text-[10px] text-bark/80 font-mono mt-0.5">
                      {plugin.toolNames.join(', ')}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleToggleActive(plugin)}
                  className="rounded-md bg-surface-container/60 border border-outline-variant/10 px-2.5 py-1 text-[11px] font-medium text-ink disabled:opacity-50"
                >
                  {plugin.active ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(plugin.id)}
                  className="rounded-md border border-danger/40 px-2.5 py-1 text-[11px] font-medium text-danger"
                >
                  Uninstall
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {message && (
        <p className={`text-[11px] leading-relaxed ${message.ok ? 'text-leaf-primary' : 'text-danger'}`}>
          {message.text}
        </p>
      )}

      {preview && (
        <PluginReview
          preview={preview}
          approvedAuto={approvedAuto}
          busy={busy}
          onToggleAuto={toggleApproved}
          onConfirm={handleConfirm}
          onCancel={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function PluginReview({
  preview,
  approvedAuto,
  busy,
  onToggleAuto,
  onConfirm,
  onCancel,
}: {
  preview: PluginInstallPreview;
  approvedAuto: string[];
  busy: boolean;
  onToggleAuto: (name: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-card border border-outline-variant/10 bg-surface-container/90 backdrop-blur-[20px] p-5 space-y-4 shadow-glass-card">
        <div>
          <h3 className="text-sm font-medium text-ink">Review plugin before install</h3>
          <p className="text-[11px] text-bark">
            {preview.manifest.name} · v{preview.manifest.version}
            {preview.manifest.author ? ` · by ${preview.manifest.author}` : ''}
          </p>
          <p className="text-[11px] text-bark mt-1">{preview.manifest.description}</p>
        </div>

        <div>
          <p className="text-[11px] text-ink font-medium mb-1.5">Declared resource access</p>
          {preview.capabilities.length === 0 ? (
            <p className="text-[11px] text-bark">None declared.</p>
          ) : (
            <ul className="space-y-1">
              {preview.capabilities.map((capability, index) => (
                <li
                  key={index}
                  className="rounded-lg border border-outline-variant/10 bg-surface-container/40 px-3 py-1.5"
                >
                  <span className="text-[11px] text-ink font-medium">{CapabilityLabel(capability.kind)}</span>
                  <span className="text-[11px] text-bark"> — {capability.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-[11px] text-ink font-medium mb-1.5">Tools</p>
          {preview.tools.length === 0 ? (
            <p className="text-[11px] text-bark">No tools were registered.</p>
          ) : (
            <ul className="space-y-1.5">
              {preview.tools.map(tool => (
                <li key={tool.name} className="rounded-lg border border-outline-variant/10 bg-surface-container/40 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-ink font-mono">{tool.name}</span>
                    <PluginTierBadge claimed={tool.permissionTier} approved={approvedAuto.includes(tool.name)} />
                  </div>
                  <p className="text-[11px] text-bark">{tool.description}</p>
                  {tool.permissionTier === 'auto' && (
                    <label className="mt-1.5 flex items-center gap-2 cursor-pointer text-[11px] text-bark">
                      <input
                        type="checkbox"
                        checked={approvedAuto.includes(tool.name)}
                        onChange={() => onToggleAuto(tool.name)}
                        className="accent-leaf-primary"
                      />
                      Allow this tool to run automatically
                    </label>
                  )}
                  {tool.permissionTier === 'confirm_required' && (
                    <p className="text-[10px] text-bark/80 mt-1">
                      This tool asks before every run.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
          <p className="text-[10px] text-warning leading-relaxed">
            Plugin code runs in a sandboxed child process. Tools it registers go
            through the same permission checks and audit log as built-in tools,
            and &quot;auto&quot; is only honored if you explicitly approve it above.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-outline-variant/10 px-3 py-1.5 text-[12px] text-bark"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded-lg bg-leaf-primary px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Installing…' : 'Install plugin'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CapabilityLabel(kind: string): string {
  switch (kind) {
    case 'network':
      return 'Network access';
    case 'filesystem':
      return 'File access';
    case 'os':
      return 'OS access';
    default:
      return 'Other capability';
  }
}

function PluginTierBadge({ claimed, approved }: { claimed: string; approved: boolean }) {
  const auto = claimed === 'auto';
  return (
    <span
      className={[
        'text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border',
        auto && approved
          ? 'bg-leaf-primary/10 text-leaf-primary border-leaf-primary/30'
          : auto
            ? 'bg-warning/10 text-warning border-warning/40'
            : 'bg-surface-container/60 text-bark border-outline-variant/10',
      ].join(' ')}
    >
      {auto ? (approved ? 'Auto (approved)' : 'Auto — needs approval') : 'Ask each time'}
    </span>
  );
}