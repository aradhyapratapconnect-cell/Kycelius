import { useCallback, useEffect, useState } from 'react';
import type { SyncStatus, SyncRunResult } from '@shared/types/ipc';

/** N-01: Cloud sync (optional Supabase) controls for the Settings →
 *  Integrations category. Fully local-first: every action surfaces the current
 *  status and never pretends sync is available when it isn't configured. */
export function CloudSyncSettings() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastSync, setLastSync] = useState<SyncRunResult | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await window.kyclius.getSyncStatus());
    } catch {
      // Querying status never blocks the app; swallow and leave stale/empty.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSendLink = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    setMessage(null);
    try {
      await window.kyclius.signIn(trimmed);
      setMessage({ ok: true, text: 'Magic link sent. Check your inbox, then click it.' });
      // Wait for the browser redirect to deliver the auth code back here.
      await window.kyclius.awaitSignInCompletion();
      await load();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [email, load]);

  const handleToggle = useCallback(
    async (next: boolean) => {
      setBusy(true);
      setMessage(null);
      try {
        setStatus(await window.kyclius.setSyncEnabled(next));
      } catch (err) {
        setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const handleSyncNow = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.kyclius.syncNow();
      setLastSync(result);
      if (!result.ok) {
        setMessage({ ok: false, text: result.error ?? 'Sync failed.' });
      } else {
        setMessage({ ok: true, text: 'Synced.' });
      }
      await load();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [load]);

  const handleSignOut = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      await window.kyclius.signOut();
      setEmail('');
      setLastSync(null);
      await load();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [load]);

  if (!status) return null;

  if (!status.configured) {
    return (
      <p className="text-[11px] text-bark leading-relaxed">
        Cloud sync is optional and off. This build wasn&apos;t started with Supabase
        configured, so sync is unavailable — everything stays 100% local. To enable it,
        run with <code className="font-mono text-ink">SUPABASE_URL</code> and{' '}
        <code className="font-mono text-ink">SUPABASE_ANON_KEY</code> set.
      </p>
    );
  }

  if (!status.signedIn) {
    return (
      <div className="space-y-3">
        <p className="text-[11px] text-bark leading-relaxed">
          Sign in (optionally) to mirror your conversations, memory and tool history to a
          cloud project scoped only to your account. Nothing syncs unless you sign in and
          enable it below.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 min-w-0 rounded-lg border border-outline-variant/10 bg-surface-container/50 px-3 py-1.5 text-[12px] text-ink placeholder:text-bark/50 focus:outline-none focus:ring-2 focus:ring-sky-deep"
          />
          <button
            type="button"
            disabled={busy || email.trim().length === 0}
            onClick={handleSendLink}
            className="shrink-0 rounded-lg bg-leaf-primary px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send magic link'}
          </button>
        </div>
        {message && <StatusNote ok={message.ok} text={message.text} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-bark leading-relaxed">
          Signed in as <span className="text-ink font-medium">{status.email}</span>. Your
          conversations, messages, memory and tool log are mirrored to a project scoped by
          row-level security to your account only.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[12px] text-ink font-medium">Cloud sync</p>
          <p className="text-[11px] text-bark">
            {status.syncEnabled
              ? `Last synced ${status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : 'never'}`
              : 'Sync is off. Local data is untouched.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={status.syncEnabled}
          aria-label="Cloud sync"
          disabled={busy}
          onClick={() => handleToggle(!status.syncEnabled)}
          className={[
            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-deep disabled:opacity-50',
            status.syncEnabled ? 'bg-leaf-primary' : 'bg-bark/25',
          ].join(' ')}
        >
          <span
            className={[
              'inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform',
              status.syncEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]',
            ].join(' ')}
          />
        </button>
      </div>

      <button
        type="button"
        disabled={busy || !status.syncEnabled}
        onClick={handleSyncNow}
        className="rounded-lg bg-surface-container/60 border border-outline-variant/10 px-3 py-1.5 text-[12px] font-medium text-ink disabled:opacity-50"
      >
        {busy ? 'Syncing…' : 'Sync now'}
      </button>

      {lastSync?.perTable && (
        <div className="text-[11px] text-bark space-y-0.5">
          {Object.entries(lastSync.perTable).map(([table, r]) => (
            <p key={table} className="font-mono">
              {table}: {r.pushed} pushed · {r.pulled} pulled · {r.conflicts} conflicted
            </p>
          ))}
        </div>
      )}

      {message && <StatusNote ok={message.ok} text={message.text} />}

      <button
        type="button"
        onClick={handleSignOut}
        className="rounded-lg border border-danger/40 px-3 py-1.5 text-[12px] font-medium text-danger"
      >
        Sign out
      </button>
    </div>
  );
}

function StatusNote({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p className={`text-[11px] leading-relaxed ${ok ? 'text-leaf-primary' : 'text-danger'}`}>
      {text}
    </p>
  );
}
