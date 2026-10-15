import { useEffect, useRef } from 'react';
import { api } from './api/client.js';

/**
 * The open app is the agent's clock.
 *
 * Locally the server runs the loop on a timer. Deployed it cannot: a function
 * that is frozen between requests has no timer, and Vercel Hobby allows one
 * cron a day, which is useless to a ladder measured in minutes. So the thing
 * that advances the agent is a request arriving — and the app being open is a
 * request arriving.
 *
 * Without this the deployed app looks finished and does nothing: a dose never
 * turns `due`, no reminder is ever sent, and the home screen shows the same
 * "next at 8:30 PM" forever. That is the worst kind of broken, because nothing
 * reports an error.
 *
 * Three triggers, in order of how much they matter:
 *
 *  - **On open.** Catches up everything that came due while nobody was looking.
 *  - **On coming back.** Returning to the tab is the strongest signal there is
 *    that someone is about to read the screen, and a phone freezes timers in
 *    background tabs anyway.
 *  - **On an interval, while visible.** A dose that comes due with the app
 *    already open still has to light up on its own.
 *
 * Ticks are safe to repeat and safe to run from several devices at once: the
 * cursor lives in MongoDB, so a tick is a function of persisted state rather
 * than of who called it. Overlapping calls are still skipped — not for
 * correctness, but because two in flight is pure waste.
 *
 * A failed tick is silent. It is housekeeping the patient did not ask for, and
 * a banner saying "could not advance the agent" would mean nothing to her; the
 * reads that back the screen report their own failures.
 */

/** While the app is open and nobody is mid-action. Phones throttle this anyway. */
const TICK_INTERVAL_MS = 60_000;

export function useAgentClock({
  enabled,
  onAdvance,
}: {
  enabled: boolean;
  /** Called only when the tick actually changed something worth re-reading. */
  onAdvance: () => void;
}): void {
  // Held in refs so a new `onAdvance` identity each render does not restart the
  // interval — which would mean a tick on every render instead of every minute.
  const onAdvanceRef = useRef(onAdvance);
  onAdvanceRef.current = onAdvance;
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const run = async (): Promise<void> => {
      if (inFlight.current || document.visibilityState === 'hidden') return;
      inFlight.current = true;
      try {
        const result = await api.tick();
        const changed =
          result.statesExamined > 0 || result.actionsTaken > 0 || result.dosesMarkedMissed > 0;
        if (changed && !cancelled) onAdvanceRef.current();
      } catch {
        // Silent on purpose — see the note above.
      } finally {
        inFlight.current = false;
      }
    };

    void run();

    const timer = window.setInterval(() => void run(), TICK_INTERVAL_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
}
