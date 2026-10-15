import type { ReactNode } from 'react';
import {
  describeUnits,
  type DoseView,
  type HistoryEntry,
  type HistoryResponse,
  type WaitingPrescription,
} from '@medication-ai/shared';
import { PillIcon, glyphFor } from '../components/common.js';

/**
 * The home screen: a lifetime record with now at the top of it.
 *
 * The app keeps everything — every illness, every appointment, every course,
 * every tablet actually swallowed — for as long as someone keeps using it. That
 * record is the product, so it is the first thing on screen.
 *
 * The risk in making a timeline the home screen is obvious: a patient opening
 * the app to take a tablet should not have to scroll past 2019 to find it. So
 * the present is simply the newest part of the same list. Today's dose sits in
 * a band above the years, with the same big button it always had, and the
 * record begins directly underneath. Nothing is buried and nothing is a
 * separate screen.
 */
export function HistoryScreen({
  history,
  busy,
  onOpenDose,
  onOpenCondition,
  onOpenVisit,
  onAddPrescription,
  onStartCourse,
}: {
  history: HistoryResponse;
  busy: boolean;
  onOpenDose: (dose: DoseView) => void;
  onOpenCondition: (conditionId: string) => void;
  onOpenVisit: (visitId: string) => void;
  onAddPrescription: () => void;
  onStartCourse: (prescriptionId: string) => void;
}): ReactNode {
  const { totals } = history;
  const nothingAtAll = history.years.length === 0 && history.waiting.length === 0;

  return (
    <div className="pad">
      <h1 className="h1">
        {history.greeting}, {history.patientName}
      </h1>
      <p className="sub" style={{ marginBottom: 20 }}>
        {totals.spanLabel}
      </p>

      {/* ---- Now: the newest entries, pinned ---- */}
      {nothingAtAll ? (
        <NothingYet onAdd={onAddPrescription} busy={busy} />
      ) : history.due ? (
        <DueCard dose={history.due} onOpen={onOpenDose} busy={busy} />
      ) : history.nextDose ? (
        <NextCard dose={history.nextDose} onOpen={onOpenDose} busy={busy} />
      ) : (
        <NothingDueCard waiting={history.waiting.length} />
      )}

      {history.waiting.map((item) => (
        <WaitingCard key={item._id} item={item} onStart={onStartCourse} busy={busy} />
      ))}

      {/* ---- What the record adds up to ---- */}
      {!nothingAtAll && (
        <div className="totals" style={{ marginTop: 22 }}>
          <Total value={totals.conditions} label={totals.conditions === 1 ? 'illness' : 'illnesses'} />
          <Total value={totals.visits} label={totals.visits === 1 ? 'visit' : 'visits'} />
          <Total value={totals.medicines} label={totals.medicines === 1 ? 'medicine' : 'medicines'} />
          <Total value={totals.dosesTaken} label="doses taken" />
        </div>
      )}

      {/* ---- The record itself ---- */}
      {history.years.map((year) => (
        <section key={year.year} style={{ marginTop: 30 }}>
          <div className="year-head">
            <h2 className="h1" style={{ margin: 0 }}>
              {year.label}
            </h2>
            <span className="sub">
              {year.entryCount} {year.entryCount === 1 ? 'entry' : 'entries'}
            </span>
          </div>

          {year.months.map((month) => (
            <div key={month.month} style={{ marginTop: 16 }}>
              <h3 className="eyebrow" style={{ marginBottom: 10 }}>
                {month.label}
              </h3>
              <div className="stack">
                {month.entries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    onOpenCondition={onOpenCondition}
                    onOpenVisit={onOpenVisit}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}

      {!nothingAtAll && (
        <p className="sub" style={{ marginTop: 26, textAlign: 'center' }}>
          Nothing here was typed in from memory — every date is the moment it was recorded.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The mark beside an entry.
 *
 * Shape and letter, never colour alone: the three that matter most — an illness
 * opening, one coming back, a course abandoned — have to be distinguishable by
 * someone who cannot tell the red from the green.
 */
function markFor(kind: HistoryEntry['kind']): { glyph: string; tone: string } {
  switch (kind) {
    case 'visit':
      return { glyph: '✚', tone: 'dot--grey' };
    case 'condition_opened':
      return { glyph: '●', tone: 'dot--amber' };
    case 'condition_recurred':
      return { glyph: '↻', tone: 'dot--red' };
    case 'condition_resolved':
      return { glyph: '✓', tone: 'dot--green' };
    case 'course_started':
      return { glyph: '▶', tone: 'dot--grey' };
    case 'course_completed':
      return { glyph: '✓', tone: 'dot--green' };
    case 'course_stopped':
      return { glyph: '✕', tone: 'dot--red' };
  }
}

function EntryRow({
  entry,
  onOpenCondition,
  onOpenVisit,
}: {
  entry: HistoryEntry;
  onOpenCondition: (conditionId: string) => void;
  onOpenVisit: (visitId: string) => void;
}): ReactNode {
  const { glyph, tone } = markFor(entry.kind);

  const inner = (
    <>
      <span className={`dot ${tone}`} aria-hidden="true">
        {glyph}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', font: '800 16.5px/1.3 var(--font)' }}>{entry.title}</span>
        <span
          style={{ display: 'block', font: '600 14px/1.4 var(--font)', color: 'var(--ink-soft)' }}
        >
          {entry.dateLabel}
          {entry.detail ? ` · ${entry.detail}` : ''}
        </span>
      </span>
    </>
  );

  // A condition is the richer destination: it carries the visits and the whole
  // dose log. A visit-only entry opens the visit note.
  if (entry.conditionId) {
    const conditionId = entry.conditionId;
    return (
      <button className="row-card" onClick={() => onOpenCondition(conditionId)}>
        {inner}
        <span className="chev">›</span>
      </button>
    );
  }
  if (entry.visitId) {
    const visitId = entry.visitId;
    return (
      <button className="row-card" onClick={() => onOpenVisit(visitId)}>
        {inner}
        <span className="chev">›</span>
      </button>
    );
  }
  return <div className="row-card">{inner}</div>;
}

function Total({ value, label }: { value: number; label: string }): ReactNode {
  return (
    <div className="total">
      <div style={{ font: '900 23px/1.1 var(--font)' }}>{value}</div>
      <div style={{ font: '700 12.5px/1.3 var(--font)', color: 'var(--ink-soft)' }}>{label}</div>
    </div>
  );
}

/* ---- the now band ---- */

function DueCard({
  dose,
  onOpen,
  busy,
}: {
  dose: DoseView;
  onOpen: (dose: DoseView) => void;
  busy: boolean;
}): ReactNode {
  return (
    <div className="card card--amber" style={{ padding: 22 }}>
      <div className="eyebrow" style={{ color: 'var(--amber-ink)', marginBottom: 14 }}>
        Take this now · {dose.clockTime}
      </div>
      <div className="row" style={{ gap: 15 }}>
        <PillIcon tone={glyphFor(dose.medicationForm)} size={62} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: '900 23px/1.2 var(--font)' }}>{dose.medicationName}</div>
          <div style={{ font: '600 16px/1.4 var(--font)', color: 'var(--amber-ink)' }}>
            {describeUnits(dose.amount, dose.medicationForm)}
          </div>
        </div>
      </div>
      <button
        className="btn btn--primary btn--pulse"
        style={{ marginTop: 18 }}
        onClick={() => onOpen(dose)}
        disabled={busy}
      >
        I took it ✓
      </button>
    </div>
  );
}

function NextCard({
  dose,
  onOpen,
  busy,
}: {
  dose: DoseView;
  onOpen: (dose: DoseView) => void;
  busy: boolean;
}): ReactNode {
  return (
    <div className="card" style={{ padding: 22 }}>
      <div className="eyebrow" style={{ marginBottom: 14 }}>
        Next, at {dose.clockTime}
      </div>
      <div className="row" style={{ gap: 15 }}>
        <PillIcon tone={glyphFor(dose.medicationForm)} size={62} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: '900 23px/1.2 var(--font)' }}>{dose.medicationName}</div>
          <div style={{ font: '600 16px/1.4 var(--font)', color: 'var(--ink-soft)' }}>
            {describeUnits(dose.amount, dose.medicationForm)}
          </div>
        </div>
      </div>
      <button className="btn btn--ghost" style={{ marginTop: 18 }} onClick={() => onOpen(dose)} disabled={busy}>
        I'm taking it early
      </button>
    </div>
  );
}

function NothingDueCard({ waiting }: { waiting: number }): ReactNode {
  return (
    <div className="card" style={{ padding: 22 }}>
      <div style={{ font: '900 22px/1.25 var(--font)' }}>Nothing to take today</div>
      <div style={{ font: '600 15.5px/1.45 var(--font)', color: 'var(--ink-soft)', marginTop: 6 }}>
        {waiting > 0
          ? 'One prescription is waiting on you below.'
          : "I'll tell you when the next one is due."}
      </div>
    </div>
  );
}

function NothingYet({ onAdd, busy }: { onAdd: () => void; busy: boolean }): ReactNode {
  return (
    <div className="card" style={{ padding: 24 }}>
      <div className="h2">Your record starts here</div>
      <div className="sub" style={{ marginBottom: 18 }}>
        Add the first prescription and I'll keep the whole story from now on — what you had, who you
        saw, and every dose you take.
      </div>
      <button className="btn btn--primary" onClick={onAdd} disabled={busy}>
        + Add a prescription
      </button>
    </div>
  );
}

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
      <div style={{ font: '600 14.5px/1.45 var(--font)', color: 'var(--amber-soft)', marginTop: 12 }}>
        {item.addedLabel} by {item.doctorName}. Nothing is scheduled until you have it.
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
