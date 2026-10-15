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
      {/*
        Today, before anything else.
        
        The record is the product and it is still the screen — but the screen
        opens on a patient who is standing in her kitchen at half past one
        wondering whether she has taken her tablet, and the answer to that was
        four hundred pixels down, under a heading, a statistics line and two
        illness chips. Nothing above it was anything she could act on.
      */}
      <TodayPanel
        doses={history.todayDoses}
        due={history.due}
        onOpenDose={onOpenDose}
        busy={busy}
      />

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

      {/* The day itself is at the top of the screen now; what is left here is
          the case where there is no day to show because nothing is set up. */}
      {nothingAtAll && <NothingSetUp onAdd={onAddPrescription} busy={busy} />}

      {/* Nothing today, but something is running — say when it next comes round
          rather than leaving the screen silent about it. */}
      {!nothingAtAll && history.todayDoses.length === 0 && history.nextDose && (
        <NextDoseLine dose={history.nextDose} onOpen={onOpenDose} busy={busy} />
      )}

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
  /**
   * The rows an episode card does not already say.
   *
   * Every illness emits its own log lines — the diagnosis, each medicine
   * started, each one finished — and a card is built from exactly those. Left
   * alone, one appointment therefore shows up five times on the same screen:
   * once as the card and four more as rows beneath it, all carrying the same
   * date. That duplication is what made the list feel endless.
   *
   * So a year shows its cards, plus the appointments no card in *this* year
   * accounts for. That second clause matters: a diabetes review in 2026 belongs
   * to an illness whose card sits in 2021, and dropping it on the grounds that
   * it has a condition would erase the visit from the year it happened in.
   */
  const covered = new Set(year.episodes.map((episode) => episode.conditionId));
  const loose = year.months
    .flatMap((month) => month.entries)
    .filter(
      (entry) =>
        entry.kind === 'visit' && (entry.conditionId === null || !covered.has(entry.conditionId)),
    );

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

      {/*
        What the unfinished course went on to cost. Without this the record
        archives a failure; with it, the record makes the argument the whole
        app exists to make.
      */}
      {episode.note && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 11,
            paddingTop: 10,
            borderTop: '1px solid var(--card-border)',
            font: '800 13.5px/1.35 var(--font)',
            color: 'var(--red)',
            textAlign: 'left',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 2.6-6.4" />
            <path d="M3 4v4.5h4.5" />
          </svg>
          {episode.note}
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

/**
 * The whole day, at the top of the screen.
 *
 * This replaces two components that between them never answered the question a
 * patient actually arrives with. There was a loud amber card when one dose was
 * *due*, and a quiet grey line naming the *next* one otherwise — so at half
 * past one, with a tablet taken at eight and two still to come, the screen said
 * "Next: Metformin, 8:00 AM" and nothing about the rest of the day. "Have I
 * taken it?" and "what is left?" were both unanswerable without tapping
 * through.
 *
 * So it lists every dose of the day, in order, with what became of each one.
 *
 * **The volume is proportional, and that is deliberate.** The temptation with a
 * panel like this is to make it permanently red so it cannot be missed, and
 * that is exactly how it stops being information: a cue that is always lit is
 * one a patient reads past within a day, and this app already made that
 * argument about its own tab badge. So:
 *
 *   - something missed → red, and it says so first
 *   - something due now → amber, with the pulsing button
 *   - doses still to come → present and prominent, but calm
 *   - everything taken → a plain card and a green tick, nothing more
 *
 * The finished state is deliberately the *quietest* of the four. A solid green
 * card would be louder than the one that says three doses are still owed, which
 * is backwards: congratulation should never outweigh instruction.
 *
 * It is at the top in all four states, because consistency of *position* is
 * what makes a glance work. It is only the colour that moves.
 */
function TodayPanel({
  doses,
  due,
  onOpenDose,
  busy,
}: {
  doses: readonly DoseView[];
  due: DoseView | null;
  onOpenDose: (dose: DoseView) => void;
  busy: boolean;
}): ReactNode {
  if (doses.length === 0) return null;

  const ordered = [...doses].sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  );

  const taken = ordered.filter((d) => d.status === 'taken' || d.status === 'taken_late');
  const missed = ordered.filter((d) => d.status === 'missed');
  const skipped = ordered.filter((d) => d.status === 'skipped');
  const toCome = ordered.filter((d) => d.status === 'scheduled');

  // The dose the big button acts on: the one due now, or the next one owed.
  const actionable = due ?? missed[0] ?? null;

  const tone: 'missed' | 'due' | 'waiting' | 'done' =
    missed.length > 0 ? 'missed' : due ? 'due' : toCome.length > 0 ? 'waiting' : 'done';

  const cardClass =
    tone === 'missed'
      ? 'card card--red'
      : tone === 'due'
        ? 'card card--amber'
        : 'card';

  const ink =
    tone === 'missed'
      ? 'var(--red-ink)'
      : tone === 'due'
        ? 'var(--amber-ink)'
        : 'var(--ink)';

  const remaining = toCome.length + missed.length;

  /** The one line that has to work at a glance, from across a kitchen. */
  const headline =
    tone === 'missed'
      ? `${missed.length} missed${
          toCome.length > 0 ? `, ${toCome.length} still to take` : ''
        }`
      : tone === 'due'
        ? `Take your ${due!.medicationName} now`
        : tone === 'waiting'
          ? `${toCome.length} still to take today`
          : `All ${taken.length} taken today`;

  const subline =
    tone === 'done'
      ? skipped.length > 0
        ? `${skipped.length} skipped. Nothing else is owed.`
        : 'Nothing else is owed today.'
      : `${taken.length} of ${ordered.length} taken${
          skipped.length > 0 ? ` · ${skipped.length} skipped` : ''
        }`;

  return (
    <div
      className={cardClass}
      style={{ padding: 18, marginBottom: 18 }}
      // A live region: the day changes under the patient as the agent ticks,
      // and a screen reader should hear that a dose has come due.
      aria-live="polite"
    >
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow" style={{ color: ink, marginBottom: 6 }}>
            Today
          </div>
          <div style={{ font: '900 22px/1.2 var(--font)', color: ink }}>{headline}</div>
          <div
            style={{
              font: '600 14.5px/1.4 var(--font)',
              color: tone === 'done' ? 'var(--ink-soft)' : ink,
              opacity: tone === 'done' ? 1 : 0.85,
              marginTop: 3,
            }}
          >
            {subline}
          </div>
        </div>

        {tone === 'done' && (
          <span className="dot dot--green" aria-hidden="true" style={{ flex: 'none' }}>
            ✓
          </span>
        )}
      </div>

      {/* Every dose of the day, so "what is left?" never needs a tap. */}
      <div className="stack" style={{ marginTop: 14, gap: 6 }}>
        {ordered.map((dose) => (
          <DoseRow key={dose._id} dose={dose} onOpen={onOpenDose} busy={busy} />
        ))}
      </div>

      {actionable && (
        <button
          className={`btn btn--primary${due ? ' btn--pulse' : ''}`}
          style={{ marginTop: 14 }}
          onClick={() => onOpenDose(actionable)}
          disabled={busy}
        >
          {due
            ? `I took my ${due.medicationName} ✓`
            : `Record the ${actionable.clockTime} ${actionable.medicationName}`}
        </button>
      )}

      {!actionable && remaining > 0 && (
        <div
          style={{
            font: '600 14px/1.4 var(--font)',
            color: 'var(--ink-soft)',
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--card-border)',
          }}
        >
          I'll remind you at {toCome[0]!.clockTime}. Tap any of them to record it early.
        </div>
      )}
    </div>
  );
}

/**
 * One dose of the day.
 *
 * Status is a glyph, a word and a colour together, never colour alone — the
 * same rule the charts follow, and for the same reason: taken-against-missed is
 * green-against-red, which is precisely the pair a red-green colourblind reader
 * cannot separate.
 */
function DoseRow({
  dose,
  onOpen,
  busy,
}: {
  dose: DoseView;
  onOpen: (dose: DoseView) => void;
  busy: boolean;
}): ReactNode {
  const state = describeDoseState(dose.status);
  const tappable = dose.isActionable || dose.status === 'missed';

  const content = (
    <>
      <span className={`dot ${state.dot}`} aria-hidden="true" style={{ flex: 'none' }}>
        {state.glyph}
      </span>
      <span
        style={{
          font: '800 15px/1.3 var(--font)',
          width: 70,
          flex: 'none',
          fontVariantNumeric: 'tabular-nums',
          textAlign: 'left',
        }}
      >
        {dose.clockTime}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: 'left',
          font: '700 15px/1.3 var(--font)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          opacity: state.spent ? 0.65 : 1,
        }}
      >
        {dose.medicationName}
      </span>
      <span
        style={{
          font: '700 13.5px/1.3 var(--font)',
          color: state.ink,
          flex: 'none',
        }}
      >
        {state.label}
      </span>
      {tappable && (
        <span className="chev" aria-hidden="true" style={{ flex: 'none' }}>
          ›
        </span>
      )}
    </>
  );

  if (!tappable) {
    return (
      <div className="dose-row" aria-label={`${dose.clockTime} ${dose.medicationName}: ${state.label || dose.statusLabel}`}>
        {content}
      </div>
    );
  }

  return (
    <button
      className="dose-row dose-row--tap"
      onClick={() => onOpen(dose)}
      disabled={busy}
      aria-label={`${dose.clockTime} ${dose.medicationName}: ${state.label || dose.statusLabel}. Record it.`}
    >
      {content}
    </button>
  );
}

function describeDoseState(status: DoseView['status']): {
  dot: string;
  glyph: string;
  label: string;
  ink: string;
  spent: boolean;
} {
  switch (status) {
    case 'taken':
      return { dot: 'dot--green', glyph: '✓', label: 'Taken', ink: 'var(--green)', spent: true };
    case 'taken_late':
      return {
        dot: 'dot--green',
        glyph: '✓',
        label: 'Taken late',
        ink: 'var(--green)',
        spent: true,
      };
    case 'due':
      return { dot: 'dot--amber', glyph: '!', label: 'Take it now', ink: 'var(--amber-ink)', spent: false };
    case 'missed':
      return { dot: 'dot--red', glyph: '✕', label: 'Missed', ink: 'var(--red)', spent: false };
    case 'skipped':
      return { dot: 'dot--grey', glyph: '–', label: 'Skipped', ink: 'var(--ink-soft)', spent: true };
    default:
      // No word: "Later" beside "1:30 PM" repeats what the time already says,
      // and on a 360px phone it costs the medicine name the width it needs to
      // be read. The dot and the time carry it; the row's aria-label spells it
      // out for a screen reader.
      return { dot: 'dot--grey', glyph: '·', label: '', ink: 'var(--ink-faint)', spent: false };
  }
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
