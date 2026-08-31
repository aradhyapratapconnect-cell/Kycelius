import { useCallback, useEffect, useState } from 'react';
import type { ScheduledTaskInfo } from '@shared/types/ipc';

const CRON_PRESETS = [
  { label: 'Every 10 minutes', cron: '*/10 * * * *' },
  { label: 'Every 30 minutes', cron: '*/30 * * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Daily at 9:00 AM', cron: '0 9 * * *' },
  { label: 'Every weekday at 9:00 AM', cron: '0 9 * * 1-5' },
  { label: 'Every weekend at 9:00 AM', cron: '0 9 * * 0,6' },
];

interface TaskForm {
  name: string;
  schedule: string;
  command: string;
  enabled: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  running: 'text-leaf-primary',
  success: 'text-leaf-primary',
  failed: 'text-danger',
};

const STATUS_LABELS: Record<string, string> = {
  running: 'Running',
  success: 'Success',
  failed: 'Failed',
};

/** N-05: recurring scheduled commands, kept in the Advanced settings area. */
export function ScheduledTasksSettings() {
  const [tasks, setTasks] = useState<ScheduledTaskInfo[]>([]);
  const [editing, setEditing] = useState<{ id: string | null; form: TaskForm } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setTasks(await window.kyclius.listScheduledTasks());
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void refresh();
    return window.kyclius.onScheduledTasksChanged(() => {
      void refresh();
    });
  }, [refresh]);

  const startCreate = () =>
    setEditing({
      id: null,
      form: { name: '', schedule: CRON_PRESETS[3].cron, command: '', enabled: true },
    });

  const startEdit = (task: ScheduledTaskInfo) =>
    setEditing({
      id: task.id,
      form: {
        name: task.name,
        schedule: task.schedule,
        command: task.command,
        enabled: task.enabled,
      },
    });

  const save = async () => {
    if (!editing || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (editing.id) {
        await window.kyclius.updateScheduledTask(editing.id, editing.form);
      } else {
        await window.kyclius.createScheduledTask(editing.form);
      }
      setEditing(null);
      await refresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
    setBusy(false);
  };

  const toggleEnabled = async (task: ScheduledTaskInfo, next: boolean) => {
    try {
      await window.kyclius.updateScheduledTask(task.id, { enabled: next });
      await refresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  };

  const remove = async (task: ScheduledTaskInfo) => {
    if (!window.confirm(`Delete scheduled task "${task.name}"?`)) return;
    try {
      await window.kyclius.deleteScheduledTask(task.id);
      await refresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  };

  const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

  const inputClass =
    'w-full rounded-md bg-surface-container/60 border border-outline-variant/20 px-2 py-1 text-[12px] text-ink focus:outline-none focus:border-leaf-primary/60';

  return (
    <div className="border-t border-outline-variant/10 pt-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[12px] text-ink font-medium">Scheduled tasks</p>
          <p className="text-[11px] text-bark">
            Recurring commands that run automatically. They still respect your
            permission engine — an action needing confirmation opens the normal
            dialog, never auto-executes.
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={startCreate}
            className="shrink-0 rounded-lg border border-leaf-primary/40 px-3 py-1.5 text-[12px] font-medium text-ink hover:border-leaf-primary"
          >
            New task
          </button>
        )}
      </div>

      {editing && (
        <div className="rounded-lg border border-outline-variant/10 bg-surface-container/40 px-3 py-3 space-y-3">
          <p className="text-[11px] text-ink font-medium">
            {editing.id ? `Edit task` : 'New scheduled task'}
          </p>
          <label className="space-y-0.5 block">
            <span className="text-[10px] uppercase tracking-wide text-bark/70 font-medium">Name</span>
            <input
              type="text"
              value={editing.form.name}
              onChange={e => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })}
              placeholder="Morning summary"
              className={inputClass}
            />
          </label>
          <label className="space-y-0.5 block">
            <span className="text-[10px] uppercase tracking-wide text-bark/70 font-medium">Schedule</span>
            <div className="flex gap-2 flex-wrap">
              <input
                type="text"
                value={editing.form.schedule}
                onChange={e =>
                  setEditing({ ...editing, form: { ...editing.form, schedule: e.target.value } })
                }
                placeholder="0 9 * * 1-5"
                className={inputClass}
              />
              <select
                value=""
                onChange={e => {
                  if (!e.target.value) return;
                  setEditing({
                    ...editing,
                    form: { ...editing.form, schedule: e.target.value },
                  });
                }}
                className="rounded-md bg-surface-container/60 border border-outline-variant/20 px-2 py-1 text-[11px] text-bark focus:outline-none"
              >
                <option value="" disabled>
                  Presets…
                </option>
                {CRON_PRESETS.map(p => (
                  <option key={p.cron} value={p.cron}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <span className="text-[10px] text-bark/70">
              5-field cron, local time: minute hour day-of-month month day-of-week.
            </span>
          </label>
          <label className="space-y-0.5 block">
            <span className="text-[10px] uppercase tracking-wide text-bark/70 font-medium">Command</span>
            <textarea
              value={editing.form.command}
              onChange={e =>
                setEditing({ ...editing, form: { ...editing.form, command: e.target.value } })
              }
              placeholder="Summarize my unread GitHub notifications"
              rows={2}
              className={inputClass}
            />
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={editing.form.enabled}
              onChange={e =>
                setEditing({ ...editing, form: { ...editing.form, enabled: e.target.checked } })
              }
              className="accent-leaf-primary"
            />
            <span className="text-[12px] text-ink">Enabled</span>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="rounded-lg border border-leaf-primary/40 px-3 py-1.5 text-[12px] font-medium text-ink hover:border-leaf-primary disabled:opacity-50"
            >
              {busy ? 'Saving…' : editing.id ? 'Save changes' : 'Create task'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-lg border border-outline-variant/20 px-3 py-1.5 text-[12px] text-bark hover:border-outline-variant/50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {tasks.length === 0 && !editing && (
        <p className="text-[11px] text-bark">
          No scheduled tasks yet. Add one to run a command automatically (e.g. a
          daily summary when you open Kyclius).
        </p>
      )}

      <ul className="space-y-2">
        {tasks.map(task => (
          <li
            key={task.id}
            className={`rounded-lg border border-outline-variant/10 bg-surface-container/40 px-3 py-2 space-y-1.5 ${
              task.enabled ? '' : 'opacity-60'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] text-ink font-medium">{task.name}</p>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={task.enabled}
                  onChange={e => void toggleEnabled(task, e.target.checked)}
                  className="accent-leaf-primary"
                />
                <span className="text-[10px] text-bark">Active</span>
              </label>
            </div>
            <p className="text-[11px] text-ink">
              <span className="text-bark/80">{task.schedule_description ?? task.schedule}</span>
              <span className="text-bark/60"> · {task.schedule}</span>
            </p>
            <p className="text-[11px] text-bark leading-snug break-words">{task.command}</p>
            <p className="text-[10px] text-bark/80">
              Next: <span className="text-ink">{task.enabled ? fmt(task.next_fire_at) : 'paused'}</span>
              {task.last_status && (
                <>
                  {' · '}Last: <span className="text-ink">{fmt(task.last_run_at)}</span>
                  <span className={`ml-1 font-medium ${STATUS_STYLES[task.last_status] ?? 'text-bark'}`}>
                    {STATUS_LABELS[task.last_status] ?? task.last_status}
                  </span>
                </>
              )}
              {task.last_error && <span className="text-danger"> — {task.last_error}</span>}
            </p>
            {!editing && (
              <div className="flex gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => startEdit(task)}
                  className="rounded-md border border-outline-variant/20 px-2.5 py-1 text-[11px] text-bark hover:border-outline-variant/50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void remove(task)}
                  className="rounded-md border border-danger/40 px-2.5 py-1 text-[11px] font-medium text-danger"
                >
                  Delete
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {message && <p className="text-[11px] text-danger">{message.text}</p>}
    </div>
  );
}