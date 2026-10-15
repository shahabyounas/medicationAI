import { useMemo, useState, type ReactNode } from 'react';
import {
  describeUnits,
  type DoseView,
  type HistoryEntry,
  type HistoryEntryKind,
  type HistoryEpisode,
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
 * **An illness is one card, not four log lines.** A single appointment
 * produces four entries of equal weight — saw the doctor, got a diagnosis,
 * started two medicines — and listing those is an event log; it is why a
 * record feels long. The card carries what the lines cannot say between them:
 * how the illness ended, and how much of the course was actually taken.
 *
 * Two things keep it readable once there are years of it:
 *
 *  - **The ribbon.** Bar height is how much happened that year, so illness
 *    clusters show before a word is read, and it doubles as the jump control.
 *    Years where nothing happened keep their place in it: a flat year is
 *    information, and dropping it would put 2021 next to 2023 as though the
 *    gap were not there.
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
  const [picked, setPicked] = useState<number | null>(() => history.years[0]?.year ?? null);

  const years = useMemo(() => filterYears(history.years, filter), [history.years, filter]);
  const ribbon = useMemo(() => ribbonYears(years), [years]);
  const busiest = ribbon.reduce((most, year) => Math.max(most, year.entryCount), 0);

  // One year at a time. A decade stacked on one page is a page nobody scrolls,
  // and it makes the ribbon decorative — it is the control that picks the year.
  const selected = picked ?? years[0]?.year ?? null;
  const shown = years.find((year) => year.year === selected) ?? null;

  // What is true right now, before any history: the illnesses still running.
  const current = useMemo(
    () =>
      history.years
        .flatMap((year) => year.episodes)
        .filter((episode) => episode.state === 'in_progress' || episode.state === 'ongoing')
        .slice(0, 2),
    [history.years],
  );

  const nothingAtAll =
    history.years.length === 0 && history.waiting.length === 0 && history.todayDoses.length === 0;

  return (
    <div className="pad">
      <div className="spread">
        <h1 className="h1">Your record</h1>
        <span style={{ font: '800 14px/1 var(--font)', color: 'var(--ink-soft)' }}>
          {history.patientName}
        </span>
      </div>
      <p className="sub" style={{ marginBottom: 16 }}>
        {[
          history.totals.spanLabel,
          countOf(history.totals.conditions, 'illness', 'illnesses'),
          countOf(history.totals.visits, 'appointment', 'appointments'),
          `${history.totals.dosesTaken} doses taken`,
        ].join(' · ')}
      </p>

      {/* 1 — what is true right now */}
      {current.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {current.map((episode) => (
            <CurrentChip key={episode.conditionId} episode={episode} onOpen={onOpenCondition} />
          ))}
        </div>
      )}

      {/* 2 — the one thing to do now, when there is one. The record is the
          screen, but a dose waiting is still the reason the app exists. */}
      {nothingAtAll ? (
        <NothingSetUp onAdd={onAddPrescription} busy={busy} />
      ) : history.due ? (
        <DoseCard dose={history.due} due onOpen={onOpenDose} busy={busy} />
      ) : history.nextDose ? (
        <NextDoseLine dose={history.nextDose} onOpen={onOpenDose} busy={busy} />
      ) : null}

      {history.waiting.map((item) => (
        <WaitingCard key={item._id} item={item} onStart={onStartCourse} busy={busy} />
      ))}

      {history.years.length > 0 && (
        <>
          <Ribbon years={ribbon} busiest={busiest} selected={selected} onSelect={setPicked} />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 18 }}>
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

          {shown ? (
            <YearSection
              year={shown}
              onOpenCondition={onOpenCondition}
              onOpenVisit={onOpenVisit}
            />
          ) : (
            <p className="sub" style={{ marginTop: 22 }}>
              {years.length === 0
                ? 'Nothing of that kind in the record yet.'
                : `Nothing in ${selected}${filter === 'all' ? '' : ' of that kind'}.`}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function countOf(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

/* -------------------------------------------------------------------------- */
/* The filters                                                                */
/* -------------------------------------------------------------------------- */

type FilterId = 'all' | 'illnesses' | 'appointments' | 'medicines';

const FILTER_KINDS: Record<Exclude<FilterId, 'all'>, readonly HistoryEntryKind[]> = {
  // An illness is shown as its card, so the entries it is built from would
  // only repeat it.
  illnesses: [],
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
 * What each year shows, per filter.
 *
 * "Everything" is the cards plus whatever belongs to no illness — a routine
 * check with nothing attached. Listing an illness's own visits beside its card
 * would put the event log straight back on the screen.
 */
function filterYears(years: readonly HistoryYear[], filter: FilterId): HistoryYear[] {
  return years
    .map((year) => {
      const episodes = filter === 'all' || filter === 'illnesses' ? year.episodes : [];
      const carded = new Set(episodes.map((episode) => episode.conditionId));

      // Under "Everything" an entry is dropped only when a card on this same
      // year already stands for it. An annual review in a quiet year belongs to
      // a condition whose card is years earlier, and hiding it would leave the
      // year looking empty when it was not.
      const keep = (entry: HistoryEntry): boolean =>
        filter === 'all'
          ? entry.conditionId === null || !carded.has(entry.conditionId)
          : FILTER_KINDS[filter].includes(entry.kind);

      const months = year.months
        .map((month) => ({ ...month, entries: month.entries.filter(keep) }))
        .filter((month) => month.entries.length > 0);

      return {
        ...year,
        episodes,
        months,
        shown: episodes.length + months.reduce((sum, month) => sum + month.entries.length, 0),
      };
    })
    .filter((year) => year.shown > 0)
    .map(({ shown: _shown, ...year }) => year);
}

/* -------------------------------------------------------------------------- */
/* The ribbon                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every year the record spans, not only the ones with something in them.
 *
 * A ribbon that skips 2022 puts 2021 next to 2023 and quietly claims the
 * record is denser than it is. The empty years get the minimum bar and no
 * link, which reads as what they are: nothing happened.
 */
function ribbonYears(years: readonly HistoryYear[]): { year: number; label: string; entryCount: number }[] {
  if (years.length === 0) return [];
  const numbers = years.map((year) => year.year);
  const first = Math.min(...numbers);
  const last = Math.max(...numbers);
  const counts = new Map(years.map((year) => [year.year, year.entryCount]));

  const out = [];
  for (let year = first; year <= last; year += 1) {
    out.push({ year, label: String(year), entryCount: counts.get(year) ?? 0 });
  }
  return out;
}

function Ribbon({
  years,
  busiest,
  selected,
  onSelect,
}: {
  years: readonly { year: number; label: string; entryCount: number }[];
  busiest: number;
  selected: number | null;
  onSelect: (year: number) => void;
}): ReactNode {
  if (years.length === 0) return null;

  return (
    <nav aria-label="Choose a year" style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 7 }}>
        {years.map((year) => {
          const current = year.year === selected;
          return (
            <button
              key={year.year}
              onClick={() => onSelect(year.year)}
              aria-pressed={current}
              // An empty year is still a year you can land on — it answers
              // "was there really nothing in 2020?" with the year's own page.
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                paddingTop: 10,
              }}
            >
              <span
                style={{
                  width: '100%',
                  // Floor of 5px so an empty year is still a mark on the
                  // timeline; 40px ceiling so a busy year is a bar, not a block.
                  height: Math.max(5, Math.round((year.entryCount / Math.max(1, busiest)) * 40)),
                  borderRadius: 3,
                  display: 'block',
                  background: current
                    ? 'var(--green)'
                    : year.entryCount === 0
                      ? 'var(--canvas)'
                      : '#9BB5A8',
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
            </button>
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
  onOpenCondition,
  onOpenVisit,
}: {
  year: HistoryYear;
  onOpenCondition: (conditionId: string) => void;
  onOpenVisit: (visitId: string) => void;
}): ReactNode {
  const loose = year.months.flatMap((month) => month.entries);

  return (
    <section style={{ marginTop: 22 }}>
      <div className="year-head">
        <span className="h2">{year.label}</span>
        <span style={{ font: '700 13px/1 var(--font)', color: 'var(--ink-soft)' }}>
          {summarise(year)}
        </span>
      </div>

      <div className="stack" style={{ marginTop: 14 }}>
        {year.episodes.map((episode) => (
          <EpisodeCard key={episode.conditionId} episode={episode} onOpen={onOpenCondition} />
        ))}
        {loose.map((entry) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            onOpenCondition={onOpenCondition}
            onOpenVisit={onOpenVisit}
          />
        ))}
      </div>
    </section>
  );
}

/** "3 illnesses · 4 appointments" — the design's own year summary. */
function summarise(year: HistoryYear): string {
  const visits = year.months
    .flatMap((month) => month.entries)
    .filter((entry) => entry.kind === 'visit').length;

  const parts: string[] = [];
  if (year.episodes.length > 0) {
    parts.push(countOf(year.episodes.length, 'illness', 'illnesses'));
  }
  if (visits > 0) parts.push(countOf(visits, 'appointment', 'appointments'));
  if (parts.length === 0) parts.push(countOf(year.entryCount, 'entry', 'entries'));
  return parts.join(' · ');
}

/**
 * One illness, as a card.
 *
 * The rail colour and the pill carry the state, and the pill says it in words
 * because colour alone cannot. The bottom row is doses taken of doses
 * prescribed — the number that says whether the course was finished, which is
 * the whole question the app exists to ask.
 */
function EpisodeCard({
  episode,
  onOpen,
}: {
  episode: HistoryEpisode;
  onOpen: (conditionId: string) => void;
}): ReactNode {
  const tone = EPISODE_TONES[episode.state];

  return (
    <button
      className="card card--tap"
      style={{ borderRadius: 18, borderLeft: `4px solid ${tone.rail}`, textAlign: 'left' }}
      onClick={() => onOpen(episode.conditionId)}
    >
      <div className="spread">
        <div style={{ minWidth: 0 }}>
          <div style={{ font: '900 19px/1.2 var(--font)' }}>{episode.name}</div>
          <div style={{ font: '700 13.5px/1.35 var(--font)', color: 'var(--ink-soft)', marginTop: 3 }}>
            {episode.rangeLabel}
            {episode.doctorName ? ` · ${episode.doctorName}` : ''}
          </div>
        </div>
        <span className={`pill ${tone.pill}`}>{episode.stateLabel}</span>
      </div>

      {episode.medicationNames.length > 0 && (
        <div style={{ font: '700 14px/1.4 var(--font)', color: 'var(--ink-soft)', marginTop: 11 }}>
          {episode.medicationNames.join(' · ')}
        </div>
      )}

      {episode.totalDoses === null ? (
        episode.takenCount > 0 && (
          <div style={{ font: '800 13px/1.3 var(--font)', color: 'var(--green)', marginTop: 10 }}>
            {episode.takenCount} doses taken
          </div>
        )
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 10 }}>
          <span className="bar" style={{ flex: 1, height: 7 }}>
            <span style={{ width: `${episode.percentComplete}%`, background: tone.fill }} />
          </span>
          <span style={{ flex: 'none', font: '800 13px/1 var(--font)', color: tone.text }}>
            {episode.takenCount === episode.totalDoses
              ? `All ${episode.totalDoses}`
              : `${episode.takenCount} of ${episode.totalDoses}`}
          </span>
        </div>
      )}
    </button>
  );
}

const EPISODE_TONES: Record<
  HistoryEpisode['state'],
  { rail: string; pill: string; fill: string; text: string }
> = {
  in_progress: {
    rail: 'var(--amber)',
    pill: 'pill--amber',
    fill: 'var(--green)',
    text: 'var(--ink)',
  },
  cleared: {
    rail: 'var(--green)',
    pill: 'pill--green',
    fill: 'var(--green)',
    text: 'var(--green)',
  },
  stopped: { rail: 'var(--red)', pill: 'pill--red', fill: 'var(--red)', text: 'var(--red-ink)' },
  ongoing: {
    rail: 'var(--green)',
    pill: 'pill--green',
    fill: 'var(--green)',
    text: 'var(--green)',
  },
};

/** An illness still running, as a chip above the record. */
function CurrentChip({
  episode,
  onOpen,
}: {
  episode: HistoryEpisode;
  onOpen: (conditionId: string) => void;
}): ReactNode {
  const amber = episode.state === 'in_progress';
  return (
    <button
      onClick={() => onOpen(episode.conditionId)}
      style={{
        flex: 1,
        minWidth: 0,
        textAlign: 'left',
        borderRadius: 15,
        padding: '11px 13px',
        background: amber ? 'var(--amber-bg)' : 'var(--green-bg)',
        color: amber ? 'var(--amber-ink)' : 'var(--green)',
      }}
    >
      <span
        style={{
          display: 'block',
          font: '900 15.5px/1.25 var(--font)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {episode.name}
      </span>
      <span style={{ display: 'block', marginTop: 2, font: '700 12.5px/1.3 var(--font)' }}>
        {episode.stateLabel}
      </span>
    </button>
  );
}

/**
 * One thing that happened that belongs to no illness.
 *
 * The mark carries the kind, and because colour alone cannot: ✓ finished,
 * ! started, ✕ stopped, · an appointment.
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
    <div className={`card${due ? ' card--amber' : ''}`} style={{ padding: 18 }}>
      <div
        className="eyebrow"
        style={{ color: due ? 'var(--amber-ink)' : 'var(--ink-faint)', marginBottom: 12 }}
      >
        {due ? 'Take this now' : `Next, at ${dose.clockTime}`}
      </div>

      <div className="row" style={{ gap: 13 }}>
        <PillIcon tone={glyphFor(dose.medicationForm)} size={48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: '900 20px/1.2 var(--font)' }}>{dose.medicationName}</div>
          <div style={{ font: '600 14.5px/1.4 var(--font)', color: 'var(--ink-soft)' }}>
            {describeUnits(dose.amount, dose.medicationForm)} at {dose.clockTime}
          </div>
        </div>
      </div>

      <button
        className={`btn btn--primary${due ? ' btn--pulse' : ''}`}
        style={{ marginTop: 14 }}
        onClick={() => onOpen(dose)}
        disabled={busy}
      >
        I took it ✓
      </button>
    </div>
  );
}

/**
 * Nothing is due, so the next dose is a line rather than a card.
 *
 * It was the same tall amber block as a dose that needs taking, which spends
 * the loudest thing on the screen on "nothing to do for six hours".
 */
function NextDoseLine({
  dose,
  onOpen,
  busy,
}: {
  dose: DoseView;
  onOpen: (dose: DoseView) => void;
  busy: boolean;
}): ReactNode {
  return (
    <button className="row-card" onClick={() => onOpen(dose)} disabled={busy}>
      <span className="dot dot--grey" aria-hidden="true">
        ·
      </span>
      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <span style={{ display: 'block', font: '800 16px/1.3 var(--font)' }}>
          Next: {dose.medicationName}
        </span>
        <span
          style={{ display: 'block', font: '600 14px/1.35 var(--font)', color: 'var(--ink-soft)' }}
        >
          {describeUnits(dose.amount, dose.medicationForm)} at {dose.clockTime}
        </span>
      </span>
      <span className="chev">›</span>
    </button>
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
