import { useState, type ReactNode } from 'react';
import {
  VISIT_TYPE_LABELS,
  type ConditionHistory,
  type ConditionMedicationHistory,
  type DoseLogEntry,
  type VisitDetail,
} from '@medication-ai/shared';

/**
 * One illness, start to finish.
 *
 * The unit the patient thinks in. A single appointment produces four entries in
 * a flat log — saw the doctor, got a diagnosis, started two medicines — and
 * that is what makes a record feel long. Here they are one thing, in the order
 * they happened: what was seen, what was given, where the course has got to,
 * and how it ended.
 *
 * The band at the top carries two numbers rather than one, because "8 of 21" on
 * day five reads as being badly behind when thirteen of those were never due
 * yet. Doses due by now against doses taken is what makes five unrecorded ones
 * visible without overstating them.
 */
export function ConditionScreen({
  condition,
  onOpenVisit,
  onRecordDose,
  onClose,
}: {
  condition: ConditionHistory;
  onOpenVisit: (visitId: string) => void;
  onRecordDose?: (() => void) | undefined;
  onClose: () => void;
}): ReactNode {
  const clinic = condition.visits[0]?.clinicName ?? null;
  const open = condition.resolvedAt === null;

  return (
    <div className="overlay overlay--light">
      <button className="back" onClick={onClose}>
        ← Your record
      </button>

      <h1 className="h1" style={{ marginTop: 10 }}>
        {condition.name}
      </h1>
      <p className="sub" style={{ marginBottom: 16 }}>
        {[
          open ? `Started ${dayMonth(condition.startedAt)}` : dateRange(condition),
          condition.doctorNames[0],
          clinic,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {/* Where the course has got to — the one thing to act on, above the
          history rather than buried under it. */}
      {condition.progress && open ? (
        <section
          style={{
            background: 'var(--amber-bg)',
            borderRadius: 18,
            padding: '14px 16px',
            marginBottom: 20,
          }}
        >
          <div className="spread" style={{ alignItems: 'baseline' }}>
            <span style={{ font: '900 17px/1.2 var(--font)', color: 'var(--amber-ink)' }}>
              {condition.progress.dayLabel ?? condition.statusLabel}
            </span>
            {condition.progress.lastDoseLabel && (
              <span style={{ font: '800 13px/1.2 var(--font)', color: 'var(--amber-ink)' }}>
                {condition.progress.lastDoseLabel}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 11 }}>
            <span
              className="bar"
              style={{ flex: 1, height: 8, background: 'rgba(138,90,18,.22)' }}
            >
              <span
                style={{
                  width: `${condition.progress.percentComplete}%`,
                  background: 'var(--amber-ink)',
                }}
              />
            </span>
            <span style={{ flex: 'none', font: '900 13px/1 var(--font)', color: 'var(--amber-ink)' }}>
              {condition.progress.takenCount} of {condition.progress.totalDoses}
            </span>
          </div>

          <p
            style={{
              margin: '9px 0 0',
              font: '700 13.5px/1.4 var(--font)',
              color: 'var(--amber-ink)',
            }}
          >
            {condition.progress.dueByNow} {condition.progress.dueByNow === 1 ? 'dose was' : 'doses were'}{' '}
            due by now.{' '}
            {condition.progress.notRecorded === 0
              ? 'All of them are recorded.'
              : `${condition.progress.notRecorded} ${
                  condition.progress.notRecorded === 1 ? 'was' : 'were'
                } not recorded as taken.`}
          </p>
        </section>
      ) : (
        condition.progress && (
          <section
            style={{
              background: 'var(--green-bg)',
              borderRadius: 18,
              padding: '14px 16px',
              marginBottom: 20,
            }}
          >
            <div className="spread" style={{ alignItems: 'baseline' }}>
              <span style={{ font: '900 17px/1.2 var(--font)', color: 'var(--green)' }}>
                {condition.statusLabel}
              </span>
              <span style={{ font: '800 13px/1.2 var(--font)', color: 'var(--green)' }}>
                {condition.durationLabel}
              </span>
            </div>
            <p style={{ margin: '9px 0 0', font: '700 13.5px/1.4 var(--font)', color: 'var(--green)' }}>
              {condition.progress.takenCount} of {condition.progress.totalDoses} doses taken.
            </p>
          </section>
        )
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

      <h2 className="eyebrow" style={{ marginBottom: 12 }}>
        What happened
      </h2>
      <Timeline condition={condition} onOpenVisit={onOpenVisit} />

      {condition.medications.length > 0 && (
        <>
          <h2 className="eyebrow" style={{ margin: '26px 0 12px' }}>
            Every dose
          </h2>
          <div className="stack">
            {condition.medications.map((medication) => (
              <MedicationCard key={medication.courseId} medication={medication} />
            ))}
          </div>
        </>
      )}

      {onRecordDose && (
        <button className="btn btn--primary" style={{ marginTop: 22 }} onClick={onRecordDose}>
          Record a dose
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The timeline                                                               */
/* -------------------------------------------------------------------------- */

interface Step {
  key: string;
  title: string;
  detail: string;
  tone: 'done' | 'now' | 'ahead';
  visitId?: string;
}

/**
 * The episode in the order it happened.
 *
 * Built as rows with their own rail rather than one drawn graphic, so the text
 * wraps and the dots stay put: the connector is a 2px line that stretches to
 * whatever height the row's words need.
 */
function Timeline({
  condition,
  onOpenVisit,
}: {
  condition: ConditionHistory;
  onOpenVisit: (visitId: string) => void;
}): ReactNode {
  const steps: Step[] = [];

  for (const visit of condition.visits) {
    steps.push({
      key: visit._id,
      title: `${VISIT_TYPE_LABELS[visit.type]} · ${dayMonth(visit.visitDate)}`,
      detail: visit.diagnosis ?? visit.reason,
      tone: 'done',
      visitId: visit._id,
    });
  }

  for (const medication of condition.medications) {
    steps.push({
      key: medication.courseId,
      title: medication.medicationName,
      detail:
        medication.totalDoses === null
          ? `${medication.instructionLine} — no end date.`
          : `${medication.instructionLine} — ${medication.totalDoses} doses in the course.`,
      tone: 'done',
    });
  }

  const progress = condition.progress;
  if (condition.resolvedAt === null && progress) {
    const left = Math.max(0, progress.totalDoses - progress.takenCount);
    steps.push({
      key: 'today',
      title: 'Today',
      detail:
        left === 0
          ? 'Every dose of the course is recorded.'
          : `${left} ${left === 1 ? 'dose' : 'doses'} still to take.`,
      tone: 'now',
    });
    steps.push({
      key: 'outcome',
      title: 'Outcome',
      detail: 'Not recorded yet. The practice closes this, or you say it came back.',
      tone: 'ahead',
    });
  }

  if (condition.resolvedAt) {
    steps.push({
      key: 'outcome',
      title: `${condition.statusLabel} · ${dayMonth(condition.resolvedAt)}`,
      detail: `${condition.durationLabel} from start to finish.`,
      tone: 'done',
    });
  }

  return (
    <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
      {steps.map((step, index) => (
        <li key={step.key} style={{ display: 'flex', gap: 13 }}>
          <span
            style={{
              flex: 'none',
              width: 13,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <span
              style={{
                width: 13,
                height: 13,
                borderRadius: '50%',
                display: 'block',
                boxSizing: 'border-box',
                background:
                  step.tone === 'done'
                    ? 'var(--green)'
                    : step.tone === 'now'
                      ? 'var(--amber)'
                      : 'var(--app-bg)',
                border: step.tone === 'ahead' ? '2px solid #C9D6CF' : 'none',
              }}
            />
            {index < steps.length - 1 && (
              <span style={{ flex: 1, width: 2, background: 'var(--canvas)', display: 'block' }} />
            )}
          </span>

          <span
            style={{
              flex: 1,
              minWidth: 0,
              paddingBottom: index < steps.length - 1 ? 18 : 0,
            }}
          >
            <span
              style={{
                display: 'block',
                font: '900 16px/1.25 var(--font)',
                color: step.tone === 'ahead' ? 'var(--ink-soft)' : 'var(--ink)',
              }}
            >
              {step.title}
            </span>
            <span
              style={{
                display: 'block',
                marginTop: 3,
                font: '700 13.5px/1.4 var(--font)',
                color: 'var(--ink-soft)',
              }}
            >
              {step.detail}
            </span>
            {step.visitId && (
              <button
                onClick={() => onOpenVisit(step.visitId as string)}
                style={{
                  marginTop: 6,
                  font: '800 13px/1 var(--font)',
                  color: 'var(--green)',
                  minHeight: 44,
                  textAlign: 'left',
                }}
              >
                Read the note ›
              </button>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* The dose log                                                               */
/* -------------------------------------------------------------------------- */

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
          <span style={{ color: 'var(--red)' }}> · {medication.missedCount} not recorded</span>
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

/* -------------------------------------------------------------------------- */

/** "10 October" — the year is carried by the range above, not every line. */
function dayMonth(value: Date | string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' }).format(
    new Date(value),
  );
}

function dateRange(condition: ConditionHistory): string {
  if (!condition.resolvedAt) return `Started ${dayMonth(condition.startedAt)}`;
  return `${dayMonth(condition.startedAt)} – ${dayMonth(condition.resolvedAt)}`;
}
