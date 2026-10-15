import { useEffect, useState, type ReactNode } from 'react';
import type { FamilyResponse, Mealtimes } from '@medication-ai/shared';
import { PushCard } from '../components/PushCard.js';

/**
 * Reminders — when the agent nudges you, how, and who hears about it last.
 *
 * This was the "Family" screen, which held four unrelated things: your son, the
 * button that turns on notifications, the order the agent tries its channels in,
 * and a log. Only one of those is about family. Turning on push beside your
 * son's name made a device setting look like a decision about your relatives.
 *
 * So the screen is organised around the question it actually answers — *how
 * does this thing reach me?* — and family is one rung of that ladder, stated as
 * the last one.
 *
 * Mealtimes lead it, because they are the setting that moves every reminder and
 * the patient has never been shown them. Three screens told her the doses were
 * "planned around your mealtimes" while the times themselves lived only in the
 * database.
 */
export function RemindersScreen({
  family,
  patientId,
  onSaveMealtimes,
  onOpenReport,
  reportAvailable,
  busy,
  onOpenProfile,
  onShare,
  allergyCount,
}: {
  family: FamilyResponse;
  patientId: string;
  onSaveMealtimes: (mealtimes: Mealtimes) => void;
  onOpenReport: () => void;
  reportAvailable: boolean;
  busy: boolean;
  onOpenProfile: () => void;
  onShare: () => void;
  /** Unused for display; kept so the caller's intent stays explicit. */
  allergyCount?: number;
}): ReactNode {
  return (
    <div className="pad">
      <h1 className="h1">Reminders</h1>
      <p className="sub" style={{ marginBottom: 18 }}>
        When I'll nudge you, how, and who hears about it last.
      </p>

      <MealtimesCard
        mealtimes={family.mealtimes}
        onSave={onSaveMealtimes}
        busy={busy}
      />

      <div className="card" style={{ marginTop: 14, borderRadius: 22 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          If you don't answer
        </div>
        <p className="sub" style={{ marginBottom: 16 }}>
          I work down this list and stop the moment you confirm.
        </p>

        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 13 }}>
          {family.channels
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((channel, index) => (
              <li key={channel.channel} className="row" style={{ gap: 12 }}>
                <span
                  className={`dot ${channel.channel === 'family' ? 'dot--amber' : 'dot--green'}`}
                  style={{ width: 30, height: 30, lineHeight: '30px' }}
                >
                  {index + 1}
                </span>
                <span style={{ flex: 1, font: '600 15.5px/1.35 var(--font)' }}>
                  {channel.label}
                </span>
                {channel.channel === 'family' && <span className="pill pill--amber">Last</span>}
              </li>
            ))}
        </ol>

        <p
          style={{
            font: '600 14.5px/1.45 var(--font)',
            color: 'var(--ink-soft)',
            marginTop: 15,
            paddingTop: 14,
            borderTop: '1px solid var(--card-border)',
          }}
        >
          Family is always the last rung and never the first. Being chased by your own son over a
          tablet is what makes people abandon an app like this.
        </p>
      </div>

      <PushCard patientId={patientId} />

      {family.contacts.length === 0 ? (
        <div className="card" style={{ marginTop: 14, borderRadius: 22 }}>
          <div className="h3">Nobody to fall back on yet</div>
          <div className="sub">
            One person can be told if I genuinely cannot reach you. I never contact them first.
          </div>
        </div>
      ) : (
        family.contacts.map((contact) => (
          <div key={contact.id} className="card" style={{ marginTop: 14, borderRadius: 22 }}>
            <div className="eyebrow" style={{ marginBottom: 13 }}>
              Your last resort
            </div>
            <div className="row" style={{ gap: 14 }}>
              <div
                style={{
                  width: 54,
                  height: 54,
                  flex: 'none',
                  borderRadius: 27,
                  background: 'var(--canvas)',
                  color: 'var(--ink-soft)',
                  font: '900 20px/54px var(--font)',
                  textAlign: 'center',
                }}
              >
                {contact.initials}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: '900 18.5px/1.2 var(--font)' }}>{contact.name}</div>
                <div style={{ font: '600 14px/1.4 var(--font)', color: 'var(--ink-soft)' }}>
                  {contact.rule}
                </div>
              </div>
            </div>
          </div>
        ))
      )}

      {family.recentEscalations.length > 0 && (
        <div className="card" style={{ marginTop: 14, borderRadius: 22 }}>
          <div className="eyebrow" style={{ marginBottom: 15 }}>
            What's happened so far
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {family.recentEscalations.slice(0, 6).map((event) => (
              <div key={event._id} className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <span
                  className={`dot ${
                    event.type === 'family_notified' || event.type === 'dose_missed'
                      ? 'dot--red'
                      : 'dot--green'
                  }`}
                  style={{ width: 28, height: 28, lineHeight: '28px', fontSize: 13 }}
                >
                  {event.type === 'family_notified' ? '!' : event.type === 'dose_missed' ? '✕' : '✓'}
                </span>
                <span style={{ font: '600 15px/1.35 var(--font)', flex: 1 }}>{event.summary}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {reportAvailable && (
        <button className="btn btn--ghost" style={{ marginTop: 14 }} onClick={onOpenReport}>
          See the course report
        </button>
      )}

      {/*
        Your details, and the two things that had nowhere to live.
        The allergy list is checked before every new medicine is accepted, and
        the family contact is the ladder's last rung — which no screen in the
        app could edit until now.
      */}
      <button className="row-card" style={{ marginTop: 14 }} onClick={onOpenProfile}>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <span style={{ display: 'block', font: '900 17px/1.25 var(--font)' }}>You</span>
          <span
            style={{
              display: 'block',
              font: '600 14.5px/1.35 var(--font)',
              color: 'var(--ink-soft)',
            }}
          >
            Your details, what you react to, and who I fall back on
          </span>
        </span>
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </button>

      <button className="row-card" style={{ marginTop: 10 }} onClick={onShare}>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <span style={{ display: 'block', font: '900 17px/1.25 var(--font)' }}>
            Show this to a doctor
          </span>
          <span
            style={{
              display: 'block',
              font: '600 14.5px/1.35 var(--font)',
              color: 'var(--ink-soft)',
            }}
          >
            Your whole record on one page you can print
          </span>
        </span>
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const MEALS: { key: keyof Mealtimes; label: string; hint: string }[] = [
  { key: 'breakfast', label: 'Breakfast', hint: 'Morning doses land here' },
  { key: 'lunch', label: 'Lunch', hint: 'Midday doses land here' },
  { key: 'dinner', label: 'Supper', hint: 'Evening doses land here' },
  { key: 'bedtime', label: 'Bedtime', hint: 'For anything taken last thing' },
];

/**
 * The four times the whole schedule hangs off.
 *
 * Saving moves the doses still to come, so the button says so rather than
 * reading "Save" and quietly rewriting a running course. Nothing is sent until
 * something has actually changed.
 */
function MealtimesCard({
  mealtimes,
  onSave,
  busy,
}: {
  mealtimes: Mealtimes;
  onSave: (mealtimes: Mealtimes) => void;
  busy: boolean;
}): ReactNode {
  const [draft, setDraft] = useState<Mealtimes>(mealtimes);

  // A refresh after saving brings the stored times back down; adopt them so the
  // card stops looking unsaved.
  useEffect(() => setDraft(mealtimes), [mealtimes]);

  const changed = MEALS.some(({ key }) => draft[key] !== mealtimes[key]);

  return (
    <div className="card" style={{ borderRadius: 22 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>
        Your mealtimes
      </div>
      <p className="sub" style={{ marginBottom: 16 }}>
        Every dose is planned around these. Correct one and I'll move the rest of your course to
        match.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {MEALS.map(({ key, label, hint }) => (
          <div key={key} className="row" style={{ gap: 12 }}>
            <label htmlFor={`meal-${key}`} style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', font: '800 16.5px/1.3 var(--font)' }}>{label}</span>
              <span
                style={{
                  display: 'block',
                  font: '600 13.5px/1.35 var(--font)',
                  color: 'var(--ink-soft)',
                }}
              >
                {hint}
              </span>
            </label>
            <input
              id={`meal-${key}`}
              type="time"
              className="time-input"
              value={draft[key]}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
            />
          </div>
        ))}
      </div>

      {changed && (
        <button
          className="btn btn--primary"
          style={{ marginTop: 16 }}
          onClick={() => onSave(draft)}
          disabled={busy}
        >
          Save and move my doses
        </button>
      )}
    </div>
  );
}
