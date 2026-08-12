import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  disablePush,
  enablePush,
  readPushStatus,
  sendTestNotification,
  type PushState,
} from '../push.js';

/**
 * Turning reminders on.
 *
 * This sits on the Family screen next to the list of channels the agent uses,
 * because that is where the patient already reads "how your agent reaches you"
 * — and until this is switched on, the first two rungs of that ladder go
 * nowhere. The card says so plainly rather than pretending to be optional
 * polish.
 */
export function PushCard({ patientId }: { patientId: string }): ReactNode {
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [deviceCount, setDeviceCount] = useState(0);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const status = await readPushStatus(patientId);
    setState(status.state);
    setDeviceCount(status.deviceCount);
    setPublicKey(status.publicKey);
  }, [patientId]);

  useEffect(() => {
    void refresh().catch(() => setState('unsupported'));
  }, [refresh]);

  const turnOn = async (): Promise<void> => {
    if (!publicKey) return;
    setBusy(true);
    setProblem(null);
    setSent(null);
    try {
      const result = await enablePush(patientId, publicKey);
      if (result === 'denied') {
        setProblem(
          'Your browser is blocking notifications. Allow them for this site in its settings, then try again.',
        );
      }
      await refresh();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Could not turn reminders on.');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    setSent(null);
    try {
      await disablePush();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const test = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      const delivered = await sendTestNotification(patientId);
      setSent(
        delivered > 0
          ? `Sent to ${delivered} device${delivered === 1 ? '' : 's'}. It should appear in a moment.`
          : 'No devices are registered yet.',
      );
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Could not send a test.');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') return null;

  return (
    <div
      className={`card${state === 'on' ? '' : ' card--amber'}`}
      style={{ marginTop: 14, borderRadius: 22 }}
    >
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        Reminders on this device
      </div>

      <div
        style={{
          font: '900 18px/1.25 var(--font)',
          color: state === 'on' ? 'var(--ink)' : 'var(--amber-ink)',
        }}
      >
        {
          {
            on: 'Reminders are on',
            off: 'Reminders are off',
            'no-worker': 'Reminders need the built app',
            denied: 'Notifications are blocked',
            unsupported: 'This browser cannot show reminders',
            unconfigured: 'Reminders are not set up on the server',
          }[state]
        }
      </div>

      <div
        style={{
          font: '600 15px/1.5 var(--font)',
          color: state === 'on' ? 'var(--ink-soft)' : 'var(--amber-soft)',
          marginTop: 6,
        }}
      >
        {
          {
            on:
              deviceCount === 1
                ? "I'll notify you here when a dose is due, even when the app is closed."
                : `I'll notify ${deviceCount} devices when a dose is due, even when the app is closed.`,
            off: "Without this, I can only remind you inside the app — so you'd have to be looking at it already.",
            denied:
              'You (or this browser) turned notifications off for this site. Only your browser settings can turn them back on.',
            unsupported:
              'Push notifications need a modern browser over HTTPS. Add the app to your home screen, or open it in Chrome, Edge or Safari 16.4+.',
            'no-worker':
              'The service worker that receives reminders is switched off on the dev server. Run `npm run build -w @medication-ai/web` and `npm run preview -w @medication-ai/web` to try it.',
            unconfigured:
              'The server has no push keys. Run `npm run vapid`, add them to .env, and restart.',
          }[state]
        }
      </div>

      {problem && (
        <div className="banner banner--error" style={{ marginTop: 14 }}>
          {problem}
        </div>
      )}
      {sent && (
        <div className="banner banner--info" style={{ marginTop: 14 }}>
          {sent}
        </div>
      )}

      {state === 'off' && (
        <button className="btn btn--primary" style={{ marginTop: 16 }} onClick={() => void turnOn()} disabled={busy}>
          {busy ? 'Turning on…' : 'Turn on reminders'}
        </button>
      )}

      {state === 'on' && (
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn btn--ghost" onClick={() => void test()} disabled={busy}>
            Send a test
          </button>
          <button className="btn btn--ghost" onClick={() => void turnOff()} disabled={busy}>
            Turn off
          </button>
        </div>
      )}
    </div>
  );
}
