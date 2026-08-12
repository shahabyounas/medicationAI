import type { ReactNode } from 'react';
import type { DoseView, TodayResponse } from '@medication-ai/shared';
import { AgentMark, DayCells, PillIcon, ProgressRing, glyphFor } from '../components/common.js';

/**
 * The home screen: the agent, and the next dose.
 *
 * The design's rule is "one screen, one job" — everything above the fold is
 * about the single tablet that needs taking now. The progress ring, the day
 * cells and the activity log all sit below it, because they are reassurance
 * rather than instruction.
 */
export function TodayScreen({
  today,
  onOpenDose,
  onOpenCondition,
  onAddPrescription,
  busy,
}: {
  today: TodayResponse;
  onOpenDose: (dose: DoseView) => void;
  onOpenCondition: (conditionId: string) => void;
  onAddPrescription: () => void;
  busy: boolean;
}): ReactNode {
  const due = today.nextDose;
  const condition = today.primaryCondition;

  return (
    <div className="pad">
      <div className="row" style={{ gap: 12, marginBottom: 4 }}>
        <AgentMark />
        <div>
          <div style={{ font: '900 19px/1.2 var(--font)' }}>Medication Agent</div>
          <div style={{ font: '600 13.5px/1.3 var(--font)', color: 'var(--green)' }}>
            {today.greeting}, {today.patientName}
          </div>
        </div>
      </div>

      {/* What the agent has to say right now. */}
      <div className="card card--dark" style={{ marginTop: 16, borderRadius: 24 }}>
        <div style={{ font: '600 17.5px/1.5 var(--font)' }}>{today.agentLine}</div>
      </div>

      {due ? (
        <div className="card" style={{ marginTop: 14, borderRadius: 24 }}>
          <div className="row" style={{ gap: 15 }}>
            <PillIcon tone={glyphFor(due.medicationForm)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: '900 22px/1.2 var(--font)' }}>{due.medicationName}</div>
              <div style={{ font: '600 15px/1.4 var(--font)', color: 'var(--ink-soft)' }}>
                {due.amount} tablet · {due.clockTime}
              </div>
            </div>
          </div>
          <button
            className={`btn btn--primary${due.status === 'due' ? ' btn--pulse' : ''}`}
            style={{ marginTop: 16 }}
            onClick={() => onOpenDose(due)}
            disabled={busy}
          >
            {due.status === 'due' ? 'I took it ✓' : 'Take it early'}
          </button>
        </div>
      ) : today.activeCourses.length === 0 ? (
        <div className="card" style={{ marginTop: 14, borderRadius: 24, padding: 26 }}>
          <div className="h2">Nothing to take yet</div>
          <div className="sub" style={{ marginBottom: 18 }}>
            Add the prescription your doctor gave you and I'll turn it into timed doses around
            your mealtimes.
          </div>
          <button className="btn btn--primary" onClick={onAddPrescription} disabled={busy}>
            + Add a prescription
          </button>
        </div>
      ) : (
        <div className="card card--green" style={{ marginTop: 14, borderRadius: 24, padding: 26 }}>
          <div style={{ font: '900 24px/1.25 var(--font)' }}>All doses done for today</div>
          <div style={{ font: '600 16px/1.45 var(--font)', color: '#BFE0D3', marginTop: 6 }}>
            Nothing else to take. I'll remind you tomorrow.
          </div>
        </div>
      )}

      {/* The day 3–4 intervention. */}
      {today.feelBetterNudge && (
        <div className="card card--amber" style={{ marginTop: 14, borderRadius: 22 }}>
          <div style={{ font: '900 17px/1.3 var(--font)', color: 'var(--amber-ink)' }}>
            {today.feelBetterNudge.title}
          </div>
          <div
            style={{
              font: '600 15px/1.5 var(--font)',
              color: 'var(--amber-soft)',
              marginTop: 5,
            }}
          >
            {today.feelBetterNudge.body}
          </div>
        </div>
      )}

      {condition && (
        <button
          className="card card--tap"
          style={{ marginTop: 14, borderRadius: 24 }}
          onClick={() => onOpenCondition(condition.conditionId)}
        >
          <div className="row" style={{ gap: 18 }}>
            <ProgressRing percent={condition.percentComplete} />
            <div style={{ minWidth: 0 }}>
              <div className="h2">{condition.name}</div>
              <div style={{ font: '600 15px/1.4 var(--font)', color: 'var(--ink-soft)' }}>
                Day {condition.dayNumber}
                {condition.durationDays ? ` of ${condition.durationDays}` : ''} ·{' '}
                {condition.takenCount} of {condition.totalDoses} doses
              </div>
            </div>
          </div>
          <DayCells cells={condition.dayCells} />
        </button>
      )}

      <div className="eyebrow" style={{ marginTop: 22, marginBottom: 12 }}>
        Today
      </div>
      <div className="stack">
        {today.doses.length === 0 && (
          <div className="sub">No doses scheduled today.</div>
        )}
        {today.doses.map((dose) => (
          <DoseRow key={dose._id} dose={dose} onOpen={onOpenDose} disabled={busy} />
        ))}
      </div>

      {today.activity.length > 0 && (
        <>
          <div className="eyebrow" style={{ marginTop: 24, marginBottom: 12 }}>
            What your agent did today
          </div>
          <div className="stack">
            {today.activity.map((event) => (
              <div key={event._id} className="row-card">
                <span className={`dot ${activityTone(event.type)}`}>{activityMark(event.type)}</span>
                <span style={{ font: '700 15px/1.35 var(--font)' }}>{event.summary}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DoseRow({
  dose,
  onOpen,
  disabled,
}: {
  dose: DoseView;
  onOpen: (dose: DoseView) => void;
  disabled: boolean;
}): ReactNode {
  const tone =
    dose.status === 'taken' || dose.status === 'taken_late'
      ? 'dot--green'
      : dose.status === 'due'
        ? 'dot--amber'
        : dose.status === 'missed' || dose.status === 'skipped'
          ? 'dot--red'
          : 'dot--grey';

  const mark =
    dose.status === 'taken' || dose.status === 'taken_late'
      ? '✓'
      : dose.status === 'due'
        ? '!'
        : dose.status === 'missed' || dose.status === 'skipped'
          ? '✕'
          : '·';

  const content = (
    <>
      <span className={`dot ${tone}`}>{mark}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', font: '800 17px/1.25 var(--font)' }}>
          {dose.clockTime} · {dose.medicationName}
        </span>
        <span style={{ display: 'block', font: '600 14px/1.35 var(--font)', color: 'var(--ink-soft)' }}>
          {dose.statusLabel}
        </span>
      </span>
    </>
  );

  if (!dose.isActionable) {
    return <div className="row-card">{content}</div>;
  }
  return (
    <button className="row-card" onClick={() => onOpen(dose)} disabled={disabled}>
      {content}
    </button>
  );
}

function activityTone(type: string): string {
  if (type === 'dose_taken' || type === 'course_completed') return 'dot--green';
  if (type === 'dose_missed' || type === 'family_notified' || type === 'course_stopped')
    return 'dot--red';
  if (type === 'reminder_sent' || type === 'escalated' || type === 'refill_warning')
    return 'dot--amber';
  return 'dot--grey';
}

function activityMark(type: string): string {
  if (type === 'dose_taken' || type === 'course_completed') return '✓';
  if (type === 'dose_missed' || type === 'course_stopped') return '✕';
  if (type === 'family_notified') return '!';
  if (type === 'reminder_sent') return '◉';
  if (type === 'dose_rescheduled' || type === 'course_replanned') return '↻';
  if (type === 'course_planned') return '▤';
  return '·';
}
