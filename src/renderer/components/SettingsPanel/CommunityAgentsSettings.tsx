import { useCallback, useEffect, useState } from 'react';
import type {
  InstalledAgentInfo,
  AgentImportPreview,
  AgentToolReview,
} from '@shared/types/ipc';

/** N-02: Shared/Community Agents — import, review, activate, export. */
export function CommunityAgentsSettings() {
  const [agents, setAgents] = useState<InstalledAgentInfo[]>([]);
  const [preview, setPreview] = useState<AgentImportPreview | null>(null);
  const [approvedAuto, setApprovedAuto] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setAgents(await window.kyclius.listInstalledAgents());
    } catch {
      setAgents([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleImport = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.kyclius.previewAgentBundle();
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
      await window.kyclius.confirmImportAgent({ preview, approvedAuto });
      setPreview(null);
      await load();
      setMessage({ ok: true, text: 'Agent installed.' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [preview, approvedAuto, load]);

  const handleActivate = useCallback(
    async (id: string) => {
      const next = agents.find(a => a.id === id)?.active ? null : id;
      await window.kyclius.selectActiveAgent(next);
      await load();
    },
    [agents, load]
  );

  const handleRemove = useCallback(
    async (id: string) => {
      await window.kyclius.removeAgent(id);
      await load();
    },
    [load]
  );

  const handleExport = useCallback(async (id: string) => {
    try {
      await window.kyclius.exportAgent(id);
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const toggleApproved = useCallback((name: string) => {
    setApprovedAuto(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  }, []);

  return (
    <div className="space-y-4 border-t border-outline-variant/10 pt-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[12px] text-ink font-medium">Community agents</p>
          <p className="text-[11px] text-bark">
            Import an agent bundle to use a shared persona. You review every tool
            and permission it claims before it&apos;s enabled.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={handleImport}
          className="shrink-0 rounded-lg bg-leaf-primary px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
        >
          Import agent…
        </button>
      </div>

      {agents.length === 0 ? (
        <p className="text-[11px] text-bark">No agents installed yet.</p>
      ) : (
        <ul className="space-y-2">
          {agents.map(agent => (
            <li
              key={agent.id}
              className="rounded-lg border border-outline-variant/10 bg-surface-container/40 px-3 py-2 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12px] text-ink font-medium truncate">
                    {agent.name}
                    {agent.active && <span className="ml-2 text-[10px] uppercase text-leaf-primary">active</span>}
                  </p>
                  <p className="text-[11px] text-bark line-clamp-1">{agent.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleActivate(agent.id)}
                  className="rounded-md bg-surface-container/60 border border-outline-variant/10 px-2.5 py-1 text-[11px] font-medium text-ink disabled:opacity-50"
                >
                  {agent.active ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  type="button"
                  onClick={() => handleExport(agent.id)}
                  className="rounded-md bg-surface-container/60 border border-outline-variant/10 px-2.5 py-1 text-[11px] font-medium text-ink"
                >
                  Export
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(agent.id)}
                  className="rounded-md border border-danger/40 px-2.5 py-1 text-[11px] font-medium text-danger"
                >
                  Remove
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

      {preview && <ImportReview
        name={preview.agent.name}
        version={preview.agent.version}
        description={preview.agent.description}
        tools={preview.tools}
        missingTools={preview.missingTools}
        approvedAuto={approvedAuto}
        busy={busy}
        onToggleAuto={toggleApproved}
        onConfirm={handleConfirm}
        onCancel={() => setPreview(null)}
      />}
    </div>
  );
}

function ImportReview({
  name,
  version,
  description,
  tools,
  missingTools,
  approvedAuto,
  busy,
  onToggleAuto,
  onConfirm,
  onCancel,
}: {
  name: string;
  version: string;
  description: string;
  tools: AgentToolReview[];
  missingTools: string[];
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
          <h3 className="text-sm font-medium text-ink">Review agent before install</h3>
          <p className="text-[11px] text-bark">
            {name} · v{version}
          </p>
          <p className="text-[11px] text-bark mt-1">{description}</p>
        </div>

        {tools.length > 0 && (
          <div>
            <p className="text-[11px] text-ink font-medium mb-1.5">Tools and permissions</p>
            <ul className="space-y-1.5">
              {tools.map(tool => (
                <li key={tool.name} className="rounded-lg border border-outline-variant/10 bg-surface-container/40 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-ink font-mono">{tool.name}</span>
                    <TierBadge actual={tool.actualTier} claimed={tool.claimedTier} />
                  </div>
                  <p className="text-[11px] text-bark">{tool.description}</p>
                  {tool.wouldDowngrade && (
                    <p className="text-[10px] text-warning mt-1">
                      This bundle asks for “auto”, but the tool cannot run automatically here — it stays “ask first”.
                    </p>
                  )}
                  {tool.canRunAuto && (
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
                </li>
              ))}
            </ul>
          </div>
        )}

        {missingTools.length > 0 && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
            <p className="text-[11px] text-warning font-medium">Unavailable tools (not installed)</p>
            <p className="text-[11px] text-bark">
              {missingTools.join(', ')} — these will be skipped.
            </p>
          </div>
        )}

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
            {busy ? 'Installing…' : 'Install agent'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TierBadge({ actual, claimed }: { actual: string; claimed: string }) {
  const askFirst = claimed === 'confirm_required' || actual === 'confirm_required';
  return (
    <span
      className={[
        'text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border',
        !askFirst
          ? 'bg-warning/10 text-warning border-warning/40'
          : 'bg-leaf-primary/10 text-leaf-primary border-leaf-primary/30',
      ].join(' ')}
    >
      {!askFirst ? 'Auto (approved)' : 'Ask each time'}
    </span>
  );
}
