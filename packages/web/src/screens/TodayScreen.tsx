import type { ReactNode } from 'react';
import {
  describeUnits,
  type DoseView,
  type TodayCourseGroup,
  type TodayResponse,
  type WaitingPrescription,
} from '@medication-ai/shared';
import { DayCells, PillIcon, glyphFor } from '../components/common.js';

/**
 * The home screen.
 *
 * Rebuilt to answer one question first — *what do I take right now?* — and then
 * two follow-ups in plain words: what else is left today, and how far through
 * each course I am.
 *
 * What was removed, and why:
 *
 *  - The dark "agent says" card restated the dose card directly beneath it.
 *    Two blocks saying the same thing is how a screen starts feeling busy.
 *  - The activity log ("what your agent did today") listed internal events like
 *    "planned 21 tablets around your mealtimes". That is an audit trail, not
 *    something a patient needs at breakfast; it lives on the Family screen,
 *    where it already appeared under "Recently".
 *  - The percentage ring answered "36% of what?" with nothing. Counts of real
 *    tablets — "10 of 21 taken, 11 to go" — say it without asking anyone to do
 *    arithmetic.
 *  - Only one condition used to be shown, so adding a prescription looked like
 *    it had replaced the previous one. Every course is listed now.
 */
export function TodayScreen({
  today,
  onOpenDose,
  onOpenCondition,
  onAddPrescription,
  onStartCourse,
  busy,
}: {
  today: TodayResponse;
  onOpenDose: (dose: DoseView) => void;
  onOpenCondition: (conditionId: string) => void;
  onAddPrescription: () => void;
  onStartCourse: (prescriptionId: string) => void;
  busy: boolean;
}): ReactNode {
  const next = today.nextDose;
  const laterToday = today.doses.filter((dose) => dose._id !== next?._id);
  // Nothing set up at all is different from nothing running *yet*: a waiting
  // prescription means the one thing to do is tell the agent it has arrived,
  // not fill the form in again.
  const nothingSetUp = today.courseGroups.length === 0 && today.waiting.length === 0;
  const nothingRunningYet = today.courseGroups.length === 0 && today.waiting.length > 0;

  return (
    <div className="pad">
      <h1 className="h1">
        {today.greeting}, {today.patientName}
      </h1>
      <p className="sub" style={{ marginBottom: 20 }}>
        {today.agentLine}
      </p>

      {/* 1 — the one thing to do now */}
      {nothingSetUp ? (
        <NothingSetUp onAdd={onAddPrescription} busy={busy} />
      ) : next ? (
        <NextDoseCard dose={next} onOpen={onOpenDose} busy={busy} />
      ) : nothingRunningYet ? (
        <NothingRunningCard count={today.waiting.length} />
      ) : (
        <AllDoneCard />
      )}

      {/* 1b — a prescription the agent is holding until the medicine arrives */}
      {today.waiting.map((item) => (
        <WaitingCard key={item._id} item={item} onStart={onStartCourse} busy={busy} />
      ))}

      {/* 2 — the day 3–4 intervention */}
      {today.feelBetterNudge && (
        <div className="card card--note" style={{ marginTop: 14 }}>
          <div style={{ font: '900 17px/1.3 var(--font)', color: 'var(--amber-ink)' }}>
            {today.feelBetterNudge.title}
          </div>
          <div
            style={{ font: '600 15px/1.5 var(--font)', color: 'var(--amber-soft)', marginTop: 5 }}
          >
            {today.feelBetterNudge.body}
          </div>
        </div>
      )}

      {/* 3 — everything else due today */}
      {laterToday.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <h2 className="h2" style={{ marginBottom: 4 }}>
            The rest of today
          </h2>
          <p className="sub" style={{ marginBottom: 12 }}>
            {countRemaining(laterToday)}
          </p>
          <div className="stack">
            {laterToday.map((dose) => (
              <DoseRow key={dose._id} dose={dose} onOpen={onOpenDose} busy={busy} />
            ))}
          </div>
        </section>
      )}

      {/* 4 — how far through each course */}
      {today.courseGroups.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <h2 className="h2" style={{ marginBottom: 4 }}>
            What you're being treated for
          </h2>
          <p className="sub" style={{ marginBottom: 12 }}>
            {today.courseGroups.length === 1
              ? 'One course of treatment.'
              : `${today.courseGroups.length} courses of treatment.`}
          </p>
          <div className="stack">
            {today.courseGroups.map((group) => (
              <CourseGroupCard
                key={group.conditionId ?? group.name}
                group={group}
                onOpen={onOpenCondition}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** The hero: one medicine, one time, one very large button. */
function NextDoseCard({
  dose,
  onOpen,
  busy,
}: {
  dose: DoseView;
  onOpen: (dose: DoseView) => void;
  busy: boolean;
}): ReactNode {
  const isDue = dose.status === 'due';

  return (
    <div className={`card${isDue ? ' card--amber' : ''}`} style={{ padding: 22 }}>
      <div
        className="eyebrow"
        style={{ color: isDue ? 'var(--amber-ink)' : 'var(--ink-faint)', marginBottom: 14 }}
      >
        {isDue ? 'Take this now' : `Next, at ${dose.clockTime}`}
      </div>

      <div className="row" style={{ gap: 15 }}>
        <PillIcon tone={glyphFor(dose.medicationForm)} size={62} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: '900 23px/1.2 var(--font)' }}>{dose.medicationName}</div>
          <div style={{ font: '600 16px/1.4 var(--font)', color: 'var(--ink-soft)' }}>
            {describeAmount(dose)}
          </div>
        </div>
      </div>

      <button
        className={`btn btn--primary${isDue ? ' btn--pulse' : ''}`}
        style={{ marginTop: 18 }}
        onClick={() => onOpen(dose)}
        disabled={busy}
      >
        {isDue ? 'I took it ✓' : 'Take it early'}
      </button>
    </div>
  );
}

function AllDoneCard(): ReactNode {
  return (
    <div className="card card--green" style={{ padding: 24 }}>
      <div style={{ font: '900 24px/1.25 var(--font)' }}>Nothing left to take today</div>
      <div style={{ font: '600 16px/1.45 var(--font)', color: '#BFE0D3', marginTop: 6 }}>
        I'll remind you when the next one is due.
      </div>
    </div>
  );
}

/**
 * A prescription that is saved but not started.
 *
 * The clock starts when the tablets are in the house, not when the doctor wrote
 * the note — so "not yet" is a legitimate answer, and this is where it lands.
 * Before this card existed the answer was a dead end: the prescription stayed at
 * `confirmed`, no screen listed it, and the one button that could start it had
 * just been dismissed.
 */
function WaitingCard({
  item,
  onStart,
  busy,
}: {
  item: WaitingPrescription;
  onStart: (prescriptionId: string) => void;
  busy: boolean;
}): ReactNode {
  return (
    <div className="card card--amber" style={{ marginTop: 14, padding: 20 }}>
      <div className="eyebrow" style={{ color: 'var(--amber-ink)', marginBottom: 12 }}>
        Waiting for the medicine
      </div>

      <div style={{ font: '900 21px/1.25 var(--font)' }}>
        {item.conditionName ?? item.medicationNames.join(' and ')}
      </div>

      <div className="stack" style={{ marginTop: 10 }}>
        {item.lines.map((line) => (
          <div key={line} style={{ font: '700 15.5px/1.45 var(--font)', color: 'var(--amber-ink)' }}>
            {line}
          </div>
        ))}
      </div>

      <div
        style={{ font: '600 14.5px/1.45 var(--font)', color: 'var(--amber-soft)', marginTop: 12 }}
      >
        {item.addedLabel} by {item.doctorName}. You told me you hadn't collected it, so I've
        scheduled nothing and told nobody.
      </div>

      <button
        className="btn btn--primary"
        style={{ marginTop: 16 }}
        onClick={() => onStart(item._id)}
        disabled={busy}
      >
        I've got it — start today
      </button>
    </div>
  );
}

/** Nothing running, but something is waiting below. */
function NothingRunningCard({ count }: { count: number }): ReactNode {
  return (
    <div className="card" style={{ padding: 22 }}>
      <div style={{ font: '900 22px/1.25 var(--font)' }}>Nothing to take today</div>
      <div style={{ font: '600 15.5px/1.45 var(--font)', color: 'var(--ink-soft)', marginTop: 6 }}>
        {count === 1
          ? 'One prescription is waiting on you below.'
          : `${count} prescriptions are waiting on you below.`}
      </div>
    </div>
  );
}

function NothingSetUp({ onAdd, busy }: { onAdd: () => void; busy: boolean }): ReactNode {
  return (
    <div className="card" style={{ padding: 24 }}>
      <div className="h2">Nothing to take yet</div>
      <div className="sub" style={{ marginBottom: 18 }}>
        Add the prescription your doctor gave you and I'll turn it into timed doses around your
        mealtimes.
      </div>
      <button className="btn btn--primary" onClick={onAdd} disabled={busy}>
        + Add a prescription
      </button>
    </div>
  );
}

/** One row in "the rest of today". Plain words, no jargon. */
function DoseRow({
  dose,
  onOpen,
  busy,
}: {
  dose: DoseView;
  onOpen: (dose: DoseView) => void;
  busy: boolean;
}): ReactNode {
  const { tone, mark, label } = describeStatus(dose);

  const inner = (
    <>
      <span className={`dot ${tone}`}>{mark}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', font: '800 17px/1.3 var(--font)' }}>
          {dose.medicationName}
        </span>
        <span
          style={{ display: 'block', font: '600 14.5px/1.35 var(--font)', color: 'var(--ink-soft)' }}
        >
          {label}
        </span>
      </span>
    </>
  );

  if (!dose.isActionable) return <div className="row-card">{inner}</div>;
  return (
    <button className="row-card" onClick={() => onOpen(dose)} disabled={busy}>
      {inner}
    </button>
  );
}

/** One condition, with everything taken for it. */
function CourseGroupCard({
  group,
  onOpen,
}: {
  group: TodayCourseGroup;
  onOpen: (conditionId: string) => void;
}): ReactNode {
  const percent =
    group.totalDoses && group.totalDoses > 0
      ? Math.round((group.takenCount / group.totalDoses) * 100)
      : 0;

  const body = (
    <>
      <div className="spread">
        <div style={{ minWidth: 0 }}>
          <div className="h3">{group.name}</div>
          <div style={{ font: '600 14px/1.4 var(--font)', color: 'var(--ink-soft)', marginTop: 3 }}>
            {group.medicationNames.join(' and ')}
          </div>
        </div>
        <span className={`pill ${group.isOngoing ? 'pill--green' : 'pill--amber'}`}>
          {group.isOngoing
            ? 'Ongoing'
            : `Day ${group.dayNumber ?? 1} of ${group.durationDays ?? '?'}`}
        </span>
      </div>

      {group.isOngoing ? (
        <div style={{ font: '600 14.5px/1.4 var(--font)', color: 'var(--ink-soft)', marginTop: 12 }}>
          A long-term medicine — no finish line to work towards.
        </div>
      ) : (
        <>
          <div className="bar" style={{ marginTop: 14, height: 8 }}>
            <span style={{ width: `${percent}%` }} />
          </div>
          <div style={{ font: '700 14.5px/1.4 var(--font)', marginTop: 8 }}>
            {group.takenCount} of {group.totalDoses} taken
            {group.remainingCount ? ` · ${group.remainingCount} to go` : ' · all done'}
          </div>
          {group.dayCells.length > 0 && <DayCells cells={group.dayCells} />}
        </>
      )}
    </>
  );

  if (!group.conditionId) return <div className="card">{body}</div>;
  const conditionId = group.conditionId;
  return (
    <button className="card card--tap" onClick={() => onOpen(conditionId)}>
      {body}
    </button>
  );
}

/* -------------------------------------------------------------------------- */

function describeAmount(dose: DoseView): string {
  // The unit comes from the real dosage form, so an inhaler is puffs and a
  // bottle is doses rather than everything being a tablet.
  return `${describeUnits(dose.amount, dose.medicationForm)} at ${dose.clockTime}`;
}

/** Status in words a patient reads, not the status the database stores. */
function describeStatus(dose: DoseView): { tone: string; mark: string; label: string } {
  switch (dose.status) {
    case 'taken':
      return { tone: 'dot--green', mark: '✓', label: `Taken at ${dose.clockTime}` };
    case 'taken_late':
      return { tone: 'dot--green', mark: '✓', label: `Taken, a little after ${dose.clockTime}` };
    case 'due':
      return { tone: 'dot--amber', mark: '!', label: 'Waiting for you now' };
    case 'missed':
      return { tone: 'dot--red', mark: '✕', label: `Missed — was due at ${dose.clockTime}` };
    case 'skipped':
      return { tone: 'dot--red', mark: '✕', label: 'You chose to skip this one' };
    case 'scheduled':
    default:
      return { tone: 'dot--grey', mark: '·', label: `Later, at ${dose.clockTime}` };
  }
}

/**
 * The one-line summary above the list.
 *
 * It has to account for every row beneath it. An earlier version counted only
 * taken and upcoming, so a day with a missed dose read "2 taken, 2 still to
 * come" above a list of five — the missing one being exactly the thing worth
 * noticing.
 */
function countRemaining(doses: readonly DoseView[]): string {
  const left = doses.filter((d) => d.status === 'scheduled' || d.status === 'due').length;
  const taken = doses.filter((d) => d.status === 'taken' || d.status === 'taken_late').length;
  const missed = doses.filter((d) => d.status === 'missed' || d.status === 'skipped').length;

  const parts: string[] = [];
  if (taken > 0) parts.push(`${taken} taken`);
  if (missed > 0) parts.push(`${missed} missed`);
  if (left > 0) parts.push(`${left} still to come`);

  if (parts.length === 0) return 'Nothing else today.';
  if (left === 0 && missed === 0) return `All ${taken} done.`;
  return `${parts.join(', ')}.`;
}
