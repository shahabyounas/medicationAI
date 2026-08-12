import type { ReactNode } from 'react';
import type { FamilyResponse } from '@medication-ai/shared';
import { PushCard } from '../components/PushCard.js';

/**
 * The family screen.
 *
 * The copy does the important work here: it tells the patient, plainly, that
 * her son is the last resort and not the first. The design is explicit that
 * being chased by your family over a tablet is what makes people abandon these
 * apps, so the escalation order is shown rather than hidden.
 */
export function FamilyScreen({
  family,
  patientId,
  onOpenReport,
  reportAvailable,
}: {
  family: FamilyResponse;
  patientId: string;
  onOpenReport: () => void;
  reportAvailable: boolean;
}): ReactNode {
  return (
    <div className="pad">
      <h1 className="h1">Family</h1>
      <p className="sub" style={{ marginBottom: 18 }}>
        Your agent only involves them when it can't reach you.
      </p>

      {family.contacts.length === 0 ? (
        <div className="card" style={{ borderRadius: 22 }}>
          <div className="h3">Nobody added yet</div>
          <div className="sub">
            One person can be told if your agent can't reach you. It never contacts them first.
          </div>
        </div>
      ) : (
        family.contacts.map((contact) => (
          <div key={contact.id} className="card" style={{ borderRadius: 22 }}>
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

      <PushCard patientId={patientId} />

      <div className="card" style={{ marginTop: 14, borderRadius: 22 }}>
        <div className="eyebrow" style={{ marginBottom: 15 }}>
          How your agent reaches you
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          {family.channels
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((channel) => (
              <div key={channel.channel} className="row" style={{ gap: 12 }}>
                <span
                  className={`dot ${channel.channel === 'family' ? 'dot--amber' : 'dot--green'}`}
                  style={{ width: 30, height: 30, lineHeight: '30px' }}
                >
                  {channel.channel === 'push' ? '◉' : channel.channel === 'sms' ? '✉' : '♡'}
                </span>
                <span style={{ font: '600 15.5px/1.3 var(--font)' }}>{channel.label}</span>
              </div>
            ))}
        </div>
      </div>

      {family.recentEscalations.length > 0 && (
        <div className="card" style={{ marginTop: 14, borderRadius: 22 }}>
          <div className="eyebrow" style={{ marginBottom: 15 }}>
            Recently
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
                <span style={{ font: '600 15px/1.35 var(--font)', flex: 1 }}>
                  {event.summary}
                </span>
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
    </div>
  );
}
