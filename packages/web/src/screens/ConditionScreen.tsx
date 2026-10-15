import { useState, type ReactNode } from 'react';
import {
  VISIT_TYPE_LABELS,
  type ConditionHistory,
  type ConditionMedicationHistory,
  type DoseLogEntry,
  type VisitDetail,
} from '@medication-ai/shared';
import { formatDate } from './RecordScreen.js';

/**
 * One illness, start to finish.
 *
 * The unit the patient thinks in. A single appointment produces four entries in
 * a flat log — saw the doctor, got a diagnosis, started two medicines — and
 * that is what makes a record feel long. Here they are one thing: the illness,
 * what was seen, what was given, and whether it was finished.
 *
 * The dose log is the part no paper record has. "Did I take the last one, and
 * when?" is answerable down to the minute, which is also the honest version of
 * adherence: not a percentage, the actual times.
 */
export function ConditionScreen({
  condition,
  onOpenVisit,
  onClose,
}: {
  condition: ConditionHistory;
  onOpenVisit: (visitId: string) => void;
  onClose: () => void;
}): ReactNode {
  return (
    <div className="overlay overlay--light">
      <button className="back" onClick={onClose}>
        ← Your record
      </button>

      <div className="spread" style={{ marginTop: 10 }}>
        <h1 className="h1">{condition.name}</h1>
        <span className={`pill ${statusTone(condition)}`}>{condition.statusLabel}</span>
      </div>

      <p className="sub" style={{ marginBottom: 16 }}>
        {formatDate(condition.startedAt)}
        {condition.resolvedAt ? ` – ${formatDate(condition.resolvedAt)}` : ' – now'} ·{' '}
        {condition.durationLabel}
        {condition.doctorNames.length > 0 ? ` · ${condition.doctorNames.join(', ')}` : ''}
      </p>

      {condition.plainDescription && (
        <p style={{ font: '700 16px/1.5 var(--font)', margin: '0 0 16px' }}>
          {condition.plainDescription}
        </p>
      )}

      {/* The pattern the whole app exists to break, stated as dates and counts
          rather than as a diagnosis of why it happened. */}
      {condition.recurrenceNote && (
        <div className="card card--red" style={{ marginBottom: 18 }}>
          <div className="eyebrow" style={{ color: 'var(--red-ink)', marginBottom: 7 }}>
            This has happened before
          </div>
          <div style={{ font: '700 15px/1.5 var(--font)', color: 'var(--red-ink)' }}>
            {condition.recurrenceNote}
          </div>
        </div>
      )}

      <h2 className="h2" style={{ marginBottom: 4 }}>
        What happened
      </h2>
      <p className="sub" style={{ marginBottom: 12 }}>
        {condition.visits.length === 0
          ? 'No appointment is filed against this one.'
          : `${condition.visits.length} ${
              condition.visits.length === 1 ? 'appointment' : 'appointments'
            }.`}
      </p>
      <div className="stack">
        {condition.visits.map((visit) => (
          <VisitRow key={visit._id} visit={visit} onOpen={onOpenVisit} />
        ))}
      </div>

      <h2 className="h2" style={{ marginTop: 26, marginBottom: 4 }}>
        What you were given
      </h2>
      <p className="sub" style={{ marginBottom: 12 }}>
        {condition.medications.length === 0
          ? 'No medicine was prescribed for this one.'
          : 'Every dose, and the time it was actually taken.'}
      </p>
      <div className="stack">
        {condition.medications.map((medication) => (
          <MedicationCard key={medication.courseId} medication={medication} />
        ))}
      </div>
    </div>
  );
}

function statusTone(condition: ConditionHistory): string {
  switch (condition.status) {
    case 'resolved':
      return 'pill--green';
    case 'recurred':
      return 'pill--red';
    case 'ongoing':
      return 'pill--green';
    case 'active':
    default:
      return 'pill--amber';
  }
}

function VisitRow({
  visit,
  onOpen,
}: {
  visit: VisitDetail;
  onOpen: (visitId: string) => void;
}): ReactNode {
  return (
    <button className="card card--tap" style={{ borderRadius: 20 }} onClick={() => onOpen(visit._id)}>
      <div className="spread">
        <div style={{ minWidth: 0 }}>
          <div className="h3">{visit.doctorName}</div>
          <div style={{ font: '600 14px/1.4 var(--font)', color: 'var(--ink-soft)', marginTop: 3 }}>
            {formatDate(visit.visitDate)} · {visit.clinicName}
          </div>
        </div>
        <span className="pill pill--grey">{VISIT_TYPE_LABELS[visit.type]}</span>
      </div>

      <div style={{ font: '700 15px/1.45 var(--font)', marginTop: 12, textAlign: 'left' }}>
        {visit.diagnosis ?? visit.reason}
      </div>
    </button>
  );
}

/**
 * One course, with its dose log behind a toggle.
 *
 * Twenty-one rows under every medicine would bury the illness in its own
 * tablets, so the card answers "was it finished?" on its own and the log is
 * there for the one question it cannot answer: which ones, and when.
 */
function MedicationCard({ medication }: { medication: ConditionMedicationHistory }): ReactNode {
  const [showLog, setShowLog] = useState(false);

  const percent =
    medication.totalDoses && medication.totalDoses > 0
      ? Math.min(100, Math.round((medication.takenCount / medication.totalDoses) * 100))
      : 0;

  return (
    <div className="card" style={{ borderRadius: 20 }}>
      <div className="spread">
        <div style={{ minWidth: 0 }}>
          <div className="h3">{medication.medicationName}</div>
          <div style={{ font: '600 14px/1.4 var(--font)', color: 'var(--ink-soft)', marginTop: 3 }}>
            {medication.instructionLine}
          </div>
        </div>
        <span className={`pill ${courseTone(medication.status)}`}>{medication.statusLabel}</span>
      </div>

      {medication.totalDoses !== null && (
        <div className="bar" style={{ marginTop: 13, height: 8 }}>
          <span style={{ width: `${percent}%` }} />
        </div>
      )}

      <div style={{ font: '700 14.5px/1.4 var(--font)', marginTop: 8 }}>
        {medication.totalDoses === null
          ? `${medication.takenCount} doses taken`
          : `${medication.takenCount} of ${medication.totalDoses} taken`}
        {medication.missedCount > 0 && (
          <span style={{ color: 'var(--red)' }}> · {medication.missedCount} missed</span>
        )}
        {medication.skippedCount > 0 && (
          <span style={{ color: 'var(--red)' }}> · {medication.skippedCount} skipped</span>
        )}
      </div>

      {medication.doses.length > 0 && (
        <>
          <button
            className="btn btn--ghost"
            style={{ marginTop: 14 }}
            onClick={() => setShowLog((open) => !open)}
            aria-expanded={showLog}
          >
            {showLog ? 'Hide the doses' : `Show all ${medication.doses.length} doses`}
          </button>

          {showLog && (
            <ul className="doselog">
              {medication.doses.map((dose) => (
                <DoseLogRow key={dose._id} dose={dose} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function courseTone(status: string): string {
  switch (status) {
    case 'completed':
      return 'pill--green';
    case 'stopped_early':
    case 'cancelled':
      return 'pill--red';
    case 'active':
      return 'pill--amber';
    default:
      return 'pill--grey';
  }
}

function DoseLogRow({ dose }: { dose: DoseLogEntry }): ReactNode {
  const { tone, mark, text } = describeDose(dose);
  const lateness = latenessNote(dose.minutesLate);

  return (
    <li className="doselog-row">
      <span className={`dot ${tone}`} aria-hidden="true">
        {mark}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', font: '800 15px/1.3 var(--font)' }}>
          Dose {dose.doseNumber}
        </span>
        <span
          style={{ display: 'block', font: '600 13px/1.35 var(--font)', color: 'var(--ink-soft)' }}
        >
          {dose.dateLabel} · due {dose.scheduledTimeLabel}
        </span>
      </span>
      <span style={{ flex: 'none', textAlign: 'right' }}>
        <span style={{ display: 'block', font: '800 14px/1.3 var(--font)' }}>{text}</span>
        {lateness && (
          <span
            style={{ display: 'block', font: '600 12.5px/1.3 var(--font)', color: 'var(--ink-soft)' }}
          >
            {lateness}
          </span>
        )}
      </span>
    </li>
  );
}

/** The dose in the words a patient reads, not the status the database stores. */
function describeDose(dose: DoseLogEntry): { tone: string; mark: string; text: string } {
  switch (dose.status) {
    case 'taken':
    case 'taken_late':
      return { tone: 'dot--green', mark: '✓', text: dose.takenTimeLabel ?? 'Taken' };
    case 'missed':
      // "Missed" is what the record can honestly claim: the window closed with
      // nothing confirmed. Whether the tablet was swallowed is unknowable here.
      return { tone: 'dot--red', mark: '✕', text: 'Not recorded' };
    case 'skipped':
      return { tone: 'dot--red', mark: '✕', text: 'Skipped' };
    case 'due':
      return { tone: 'dot--amber', mark: '!', text: 'Due now' };
    case 'scheduled':
    default:
      return { tone: 'dot--grey', mark: '·', text: 'To come' };
  }
}

/**
 * How far off the scheduled time it was taken.
 *
 * Silent within twenty minutes either way. A record that captions every dose
 * "3 minutes late" is noise, and it would make a patient who is doing fine look
 * like one who is not.
 */
function latenessNote(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes >= 90) {
    const hours = Math.round(minutes / 60);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} late`;
  }
  if (minutes >= 20) return `${minutes} min late`;
  if (minutes <= -20) return `${Math.abs(minutes)} min early`;
  return null;
}
