import { useState, type ReactNode } from 'react';
import type { ConditionHistory, ConditionMedicationHistory, DoseLogEntry } from '@medication-ai/shared';
import { PillIcon, glyphFor } from '../components/common.js';
import { formatDate } from './RecordScreen.js';

/**
 * One illness, start to finish.
 *
 * This is where the record stops being a list of events and becomes a story:
 * what it was, who was seen about it, what was prescribed, and — the part
 * nothing in the app surfaced before — every individual dose with the time it
 * was actually swallowed.
 *
 * The dose log is collapsed by default. Twenty-eight rows is the point of the
 * thing, but it is not what someone wants in their face when they open the
 * screen to remember what they were given.
 */
export function ConditionScreen({
  condition,
  onClose,
  onOpenVisit,
}: {
  condition: ConditionHistory;
  onClose: () => void;
  onOpenVisit: (visitId: string) => void;
}): ReactNode {
  return (
    <div className="overlay overlay--light">
      <button className="back" onClick={onClose}>
        ← Back
      </button>

      <div className="spread" style={{ marginTop: 10, alignItems: 'flex-start' }}>
        <h1 className="h1" style={{ margin: 0 }}>
          {condition.name}
        </h1>
        <span className={`pill ${pillToneFor(condition)}`}>{condition.statusLabel}</span>
      </div>

      <p className="sub" style={{ marginTop: 6 }}>
        {formatDate(condition.startedAt)}
        {condition.resolvedAt ? ` — ${formatDate(condition.resolvedAt)}` : ''} · {condition.durationLabel}
      </p>

      {condition.plainDescription && (
        <p style={{ font: '700 16px/1.5 var(--font)', marginTop: 14 }}>
          {condition.plainDescription}
        </p>
      )}

      {condition.recurrenceNote && (
        <div className="card card--amber" style={{ marginTop: 16, borderRadius: 20 }}>
          <div style={{ font: '700 15.5px/1.5 var(--font)', color: 'var(--amber-ink)' }}>
            {condition.recurrenceNote}
          </div>
        </div>
      )}

      {/* ---- Who was seen ---- */}
      {condition.visits.length > 0 && (
        <section style={{ marginTop: 26 }}>
          <h2 className="h2" style={{ marginBottom: 11 }}>
            {condition.visits.length === 1 ? 'The appointment' : 'The appointments'}
          </h2>
          <div className="stack">
            {condition.visits.map((visit) => (
              <button
                key={visit._id}
                className="row-card"
                onClick={() => onOpenVisit(visit._id)}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', font: '800 16.5px/1.3 var(--font)' }}>
                    {visit.doctorName}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      font: '600 14px/1.4 var(--font)',
                      color: 'var(--ink-soft)',
                    }}
                  >
                    {formatDate(visit.visitDate)} · {visit.diagnosis ?? visit.reason}
                  </span>
                </span>
                <span className="chev">›</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---- What was taken for it ---- */}
      <section style={{ marginTop: 26 }}>
        <h2 className="h2" style={{ marginBottom: 11 }}>
          {condition.medications.length === 1 ? 'The medicine' : 'The medicines'}
        </h2>
        {condition.medications.length === 0 ? (
          <p className="sub">Nothing was prescribed for this.</p>
        ) : (
          <div className="stack">
            {condition.medications.map((medication) => (
              <MedicationCard key={medication.courseId} medication={medication} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function pillToneFor(condition: ConditionHistory): string {
  if (condition.status === 'recurred') return 'pill--red';
  if (condition.status === 'resolved') return 'pill--green';
  return 'pill--amber';
}

/* -------------------------------------------------------------------------- */

function MedicationCard({
  medication,
}: {
  medication: ConditionMedicationHistory;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const stopped = medication.status === 'stopped_early';

  return (
    <div className="card" style={{ borderRadius: 20 }}>
      <div className="row" style={{ gap: 14 }}>
        <PillIcon tone={glyphFor(medication.medicationForm)} size={52} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: '900 19px/1.2 var(--font)' }}>{medication.medicationName}</div>
          <div style={{ font: '600 14.5px/1.4 var(--font)', color: 'var(--ink-soft)' }}>
            {medication.instructionLine}
          </div>
        </div>
      </div>

      <div
        style={{
          font: '700 15px/1.45 var(--font)',
          marginTop: 13,
          color: stopped ? 'var(--red)' : 'var(--ink)',
        }}
      >
        {medication.takenCount} of {medication.totalDoses ?? '—'} taken
        {medication.missedCount > 0 ? ` · ${medication.missedCount} missed` : ''}
        {medication.skippedCount > 0 ? ` · ${medication.skippedCount} skipped` : ''}
      </div>

      {medication.startedAt && (
        <div style={{ font: '600 13.5px/1.4 var(--font)', color: 'var(--ink-soft)', marginTop: 4 }}>
          {formatDate(medication.startedAt)}
          {medication.endedAt ? ` — ${formatDate(medication.endedAt)}` : ' — still going'} ·{' '}
          {medication.statusLabel}
        </div>
      )}

      {medication.doses.length > 0 && (
        <>
          <button
            className="btn btn--ghost"
            style={{ marginTop: 14 }}
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            {open ? 'Hide every dose' : `Every dose and when it was taken (${medication.doses.length})`}
          </button>

          {open && (
            <ol className="doselog">
              {medication.doses.map((dose) => (
                <DoseLogRow key={dose._id} dose={dose} />
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One dose, as it happened.
 *
 * The column that matters is the time it was actually taken, so that is the one
 * set in the darker ink; the scheduled time sits underneath as the thing it is
 * being compared against. A dose never taken says so rather than showing a
 * blank where a time should be.
 */
function DoseLogRow({ dose }: { dose: DoseLogEntry }): ReactNode {
  const { tone, mark, headline } = describeLogRow(dose);
  const late = dose.minutesLate !== null && dose.minutesLate > 10;

  return (
    <li className="doselog-row">
      <span className={`dot ${tone}`} aria-hidden="true">
        {mark}
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', font: '800 15px/1.3 var(--font)' }}>{headline}</span>
        <span
          style={{ display: 'block', font: '600 13px/1.35 var(--font)', color: 'var(--ink-soft)' }}
        >
          {dose.dateLabel} · due {dose.scheduledTimeLabel}
          {late ? ` · ${dose.minutesLate} min late` : ''}
        </span>
      </span>

      <span style={{ font: '700 12.5px/1 var(--font)', color: 'var(--ink-faint)' }}>
        #{dose.doseNumber}
      </span>
    </li>
  );
}

/**
 * How one row of the log reads.
 *
 * Three states, not two. A dose still in the future is not a failure, and an
 * earlier version drew it with the same red cross as a missed one — so a course
 * on its first day looked like it had already been abandoned twenty times. Only
 * a dose whose moment has passed unanswered earns the cross.
 */
function describeLogRow(dose: DoseLogEntry): { tone: string; mark: string; headline: string } {
  if (dose.takenAt !== null) {
    return { tone: 'dot--green', mark: '✓', headline: `Taken at ${dose.takenTimeLabel}` };
  }
  switch (dose.status) {
    case 'missed':
      return { tone: 'dot--red', mark: '✕', headline: 'Missed' };
    case 'skipped':
      return { tone: 'dot--red', mark: '✕', headline: 'Skipped' };
    case 'due':
      return { tone: 'dot--amber', mark: '!', headline: 'Due now' };
    default:
      return { tone: 'dot--grey', mark: '·', headline: 'Still to come' };
  }
}
