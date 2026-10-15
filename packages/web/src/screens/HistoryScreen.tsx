import { useMemo, useState, type ReactNode } from 'react';
import {
  describeUnits,
  type DoseView,
  type HistoryEntry,
  type HistoryEntryKind,
  type HistoryResponse,
  type HistoryYear,
  type WaitingPrescription,
} from '@medication-ai/shared';
import { PillIcon, glyphFor } from '../components/common.js';

/**
 * The record, and the app's home screen.
 *
 * One chronology, newest first. The dose due in ten minutes sits at the top of
 * it rather than on a screen of its own, because it is the newest thing that
 * has happened to this patient — and that is the only arrangement where a
 * lifetime of history cannot bury it.
 *
 * Two things keep it readable once there are years of it:
 *
 *  - **The ribbon.** Bar height is how much happened that year, so illness
 *    clusters show before a word is read, and it doubles as the jump control.
 *  - **One line a year.** Only the newest year is open. Everything earlier
 *    collapses to a row with its count, which is enough to decide whether to
 *    look — a screen that renders a decade at once is a screen nobody scrolls.
 */
export function HistoryScreen({
  history,
  onOpenDose,
  onOpenCondition,
  onOpenVisit,
  onAddPrescription,
  onStartCourse,
  busy,
}: {
  history: HistoryResponse;
  onOpenDose: (dose: DoseView) => void;
  onOpenCondition: (conditionId: string) => void;
  onOpenVisit: (visitId: string) => void;
  onAddPrescription: () => void;
  onStartCourse: (prescriptionId: string) => void;
  busy: boolean;
}): ReactNode {
  const [filter, setFilter] = useState<FilterId>('all');
  const [openYears, setOpenYears] = useState<number[]>(() =>
    history.years[0] ? [history.years[0].year] : [],
  );

  const years = useMemo(() => filterYears(history.years, filter), [history.years, filter]);
  const busiest = years.reduce((most, year) => Math.max(most, year.entryCount), 0);

  const nothingAtAll =
    history.years.length === 0 && history.waiting.length === 0 && history.todayDoses.length === 0;

  const openYear = (year: number): void =>
    setOpenYears((current) => (current.includes(year) ? current : [...current, year]));

  return (
    <div className="pad">
      <div className="spread">
        <h1 className="h1">Your record</h1>
        <span style={{ font: '800 14px/1 var(--font)', color: 'var(--ink-soft)' }}>
          {history.patientName}
        </span>
      </div>
      <p className="sub" style={{ marginBottom: 16 }}>
        {history.totals.spanLabel}. {history.greeting}.
      </p>

      {/* What it adds up to. Real counts — nothing here is an estimate. */}
      {!nothingAtAll && (
        <div className="totals" style={{ marginBottom: 20 }}>
          <Total value={history.totals.conditions} label="illnesses" one="illness" />
          <Total value={history.totals.visits} label="appointments" one="appointment" />
          <Total value={history.totals.medicines} label="medicines" one="medicine" />
          <Total value={history.totals.dosesTaken} label="doses taken" one="dose taken" />
        </div>
      )}

      {/* 1 — the present, at the top of its own chronology */}
      {nothingAtAll ? (
        <NothingSetUp onAdd={onAddPrescription} busy={busy} />
      ) : history.due ? (
        <DoseCard dose={history.due} due onOpen={onOpenDose} busy={busy} />
      ) : history.nextDose ? (
        <DoseCard dose={history.nextDose} due={false} onOpen={onOpenDose} busy={busy} />
      ) : history.todayDoses.length > 0 ? (
        <AllDoneCard />
      ) : null}

      {history.waiting.map((item) => (
        <WaitingCard key={item._id} item={item} onStart={onStartCourse} busy={busy} />
      ))}

      {history.years.length > 0 && (
        <>
          {/* 2 — where you are in the record, and where to jump */}
          <Ribbon years={years} busiest={busiest} onJump={openYear} />

          {/* 3 — what kind of thing you are looking for */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 7,
              marginTop: 18,
            }}
          >
            {FILTERS.map((option) => (
              <button
                key={option.id}
                onClick={() => setFilter(option.id)}
                aria-pressed={filter === option.id}
                className={`pill ${filter === option.id ? '' : 'pill--grey'}`}
                style={
                  filter === option.id
                    ? { background: 'var(--ink)', color: '#fff', minHeight: 36, padding: '0 14px' }
                    : { minHeight: 36, padding: '0 14px' }
                }
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* 4 — the record itself */}
          {years.length === 0 ? (
            <p className="sub" style={{ marginTop: 22 }}>
              Nothing of that kind in the record yet.
            </p>
          ) : (
            years.map((year) => (
              <YearSection
                key={year.year}
                year={year}
                open={openYears.includes(year.year)}
                onToggle={() =>
                  setOpenYears((current) =>
                    current.includes(year.year)
                      ? current.filter((value) => value !== year.year)
                      : [...current, year.year],
                  )
                }
                onOpenCondition={onOpenCondition}
                onOpenVisit={onOpenVisit}
              />
            ))
          )}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The filters                                                                */
/* -------------------------------------------------------------------------- */

type FilterId = 'all' | 'illnesses' | 'appointments' | 'medicines';

const FILTER_KINDS: Record<Exclude<FilterId, 'all'>, readonly HistoryEntryKind[]> = {
  illnesses: ['condition_opened', 'condition_resolved', 'condition_recurred'],
  appointments: ['visit'],
  medicines: ['course_started', 'course_completed', 'course_stopped'],
};

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'illnesses', label: 'Illnesses' },
  { id: 'appointments', label: 'Appointments' },
  { id: 'medicines', label: 'Medicines' },
];

/**
 * A filter narrows what is shown, including the ribbon.
 *
 * Counting the whole record while showing a slice of it would mean a year whose
 * bar is tall and whose list is empty — the one thing the ribbon must never do,
 * since its entire job is to say where the record is dense.
 */
function filterYears(years: readonly HistoryYear[], filter: FilterId): HistoryYear[] {
  if (filter === 'all') return [...years];
  const kinds = FILTER_KINDS[filter];

  return years
    .map((year) => {
      const months = year.months
        .map((month) => ({
          ...month,
          entries: month.entries.filter((entry) => kinds.includes(entry.kind)),
        }))
        .filter((month) => month.entries.length > 0);

      return {
        ...year,
        months,
        entryCount: months.reduce((sum, month) => sum + month.entries.length, 0),
      };
    })
    .filter((year) => year.entryCount > 0);
}

/* -------------------------------------------------------------------------- */
/* The ribbon                                                                 */
/* -------------------------------------------------------------------------- */

function Ribbon({
  years,
  busiest,
  onJump,
}: {
  years: readonly HistoryYear[];
  busiest: number;
  onJump: (year: number) => void;
}): ReactNode {
  if (years.length === 0) return null;

  // Oldest on the left, so the ribbon reads the way a timeline does even though
  // the list beneath it runs the other way.
  const ordered = [...years].sort((a, b) => a.year - b.year);
  const newest = ordered[ordered.length - 1]?.year;

  return (
    <nav aria-label="Jump to a year" style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 7 }}>
        {ordered.map((year) => {
          const current = year.year === newest;
          return (
            <a
              key={year.year}
              href={`#year-${year.year}`}
              onClick={() => onJump(year.year)}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                textDecoration: 'none',
              }}
            >
              <span
                style={{
                  width: '100%',
                  // A floor of 6px: a year with one entry still has to be a
                  // target you can hit, and an invisible bar reads as a gap in
                  // the record rather than a quiet year.
                  height: Math.max(6, Math.round((year.entryCount / Math.max(1, busiest)) * 42)),
                  borderRadius: 3,
                  background: current ? 'var(--green)' : 'var(--canvas)',
                }}
              />
              <span
                style={{
                  font: `${current ? 900 : 700} 11.5px/1 var(--font)`,
                  color: current ? 'var(--green)' : 'var(--ink-soft)',
                }}
              >
                {year.label}
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* A year                                                                     */
/* -------------------------------------------------------------------------- */

function YearSection({
  year,
  open,
  onToggle,
  onOpenCondition,
  onOpenVisit,
}: {
  year: HistoryYear;
  open: boolean;
  onToggle: () => void;
  onOpenCondition: (conditionId: string) => void;
  onOpenVisit: (visitId: string) => void;
}): ReactNode {
  return (
    <section id={`year-${year.year}`} style={{ marginTop: 22, scrollMarginTop: 16 }}>
      <button className="year-head" onClick={onToggle} aria-expanded={open} style={{ width: '100%' }}>
        <span className="h2">{year.label}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ font: '700 13px/1 var(--font)', color: 'var(--ink-soft)' }}>
            {year.entryCount} {year.entryCount === 1 ? 'entry' : 'entries'}
          </span>
          <span className="chev">{open ? '⌃' : '⌄'}</span>
        </span>
      </button>

      {open &&
        year.months.map((month) => (
          <div key={month.month} style={{ marginTop: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 9 }}>
              {month.label}
            </div>
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
  );
}

/**
 * One thing that happened.
 *
 * Every entry is the same row — a mark, a date, a title, a line of detail —
 * whatever kind it is. The mark carries the kind, and because colour alone
 * cannot: ✓ cleared, ! started, ✕ stopped, · an appointment.
 */
function EntryRow({
  entry,
  onOpenCondition,
  onOpenVisit,
}: {
  entry: HistoryEntry;
  onOpenCondition: (conditionId: string) => void;
  onOpenVisit: (visitId: string) => void;
}): ReactNode {
  const { tone, mark } = describeKind(entry.kind);

  const inner = (
    <>
      <span className={`dot ${tone}`} aria-hidden="true">
        {mark}
      </span>
      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <span style={{ display: 'block', font: '800 17px/1.3 var(--font)' }}>{entry.title}</span>
        <span
          style={{
            display: 'block',
            font: '600 14.5px/1.35 var(--font)',
            color: 'var(--ink-soft)',
          }}
        >
          {entry.dateLabel}
          {entry.detail ? ` · ${entry.detail}` : ''}
        </span>
      </span>
    </>
  );

  // An illness opens in full; an appointment with no illness attached opens its
  // own note. An entry that leads nowhere stays a plain row rather than a
  // button that does nothing when pressed.
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

function describeKind(kind: HistoryEntryKind): { tone: string; mark: string } {
  switch (kind) {
    case 'condition_resolved':
    case 'course_completed':
      return { tone: 'dot--green', mark: '✓' };
    case 'condition_recurred':
    case 'course_stopped':
      return { tone: 'dot--red', mark: '✕' };
    case 'condition_opened':
    case 'course_started':
      return { tone: 'dot--amber', mark: '!' };
    case 'visit':
    default:
      return { tone: 'dot--grey', mark: '·' };
  }
}

/* -------------------------------------------------------------------------- */
/* The present                                                                */
/* -------------------------------------------------------------------------- */

function Total({
  value,
  label,
  one,
}: {
  value: number;
  label: string;
  one: string;
}): ReactNode {
  return (
    <div className="total">
      <div style={{ font: '900 21px/1.1 var(--font)' }}>{value}</div>
      <div style={{ font: '600 12.5px/1.3 var(--font)', color: 'var(--ink-soft)' }}>
        {value === 1 ? one : label}
      </div>
    </div>
  );
}

function DoseCard({
  dose,
  due,
  onOpen,
  busy,
}: {
  dose: DoseView;
  due: boolean;
  onOpen: (dose: DoseView) => void;
  busy: boolean;
}): ReactNode {
  return (
    <div className={`card${due ? ' card--amber' : ''}`} style={{ padding: 20 }}>
      <div
        className="eyebrow"
        style={{ color: due ? 'var(--amber-ink)' : 'var(--ink-faint)', marginBottom: 13 }}
      >
        {due ? 'Take this now' : `Next, at ${dose.clockTime}`}
      </div>

      <div className="row" style={{ gap: 14 }}>
        <PillIcon tone={glyphFor(dose.medicationForm)} size={56} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: '900 22px/1.2 var(--font)' }}>{dose.medicationName}</div>
          <div style={{ font: '600 15.5px/1.4 var(--font)', color: 'var(--ink-soft)' }}>
            {describeUnits(dose.amount, dose.medicationForm)} at {dose.clockTime}
          </div>
        </div>
      </div>

      <button
        className={`btn btn--primary${due ? ' btn--pulse' : ''}`}
        style={{ marginTop: 16 }}
        onClick={() => onOpen(dose)}
        disabled={busy}
      >
        {due ? 'I took it ✓' : 'Take it early'}
      </button>
    </div>
  );
}

function AllDoneCard(): ReactNode {
  return (
    <div className="card card--green" style={{ padding: 22 }}>
      <div style={{ font: '900 22px/1.25 var(--font)' }}>Nothing left to take today</div>
      <div style={{ font: '600 15.5px/1.45 var(--font)', color: '#BFE0D3', marginTop: 6 }}>
        I'll remind you when the next one is due.
      </div>
    </div>
  );
}

/** A prescription saved but not started: the medicine is not in the house yet. */
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

function NothingSetUp({ onAdd, busy }: { onAdd: () => void; busy: boolean }): ReactNode {
  return (
    <div className="card" style={{ padding: 24 }}>
      <div className="h2">Your record starts here</div>
      <div className="sub" style={{ marginBottom: 18 }}>
        Add the prescription your doctor gave you. I'll turn it into timed doses, and everything
        that happens after that is kept here.
      </div>
      <button className="btn btn--primary" onClick={onAdd} disabled={busy}>
        + Add a prescription
      </button>
    </div>
  );
}
