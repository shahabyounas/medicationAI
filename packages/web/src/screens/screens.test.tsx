import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AppointmentsResponseSchema,
  HistoryResponseSchema,
  type HistoryResponse,
  InsightsResponseSchema,
  MedicinesResponseSchema,
  ProfileResponseSchema,
  ReadingsResponseSchema,
  ResultsResponseSchema,
  ShareSummaryResponseSchema,
} from '@medication-ai/shared';
import { readFileSync } from 'node:fs';
import { HealthScreen } from './HealthScreen.js';
import { HistoryScreen } from './HistoryScreen.js';
import { ShareScreen } from './ShareScreen.js';
import { ProfileScreen } from './ProfileScreen.js';
import { MedicinesScreen } from './MedicinesScreen.js';
import {
  AnchorBars,
  BurnDown,
  DoseGridChart,
  EpisodeTimeline,
  EscalationFunnel,
  LineChart,
  MonthlyBars,
  PunctualityPlot,
  SymptomAgainstDoses,
} from '../components/charts.js';

/**
 * The screens, rendered against the payloads the API actually returns.
 *
 * Fixtures are captured responses rather than hand-written objects, parsed
 * through the same Zod schemas the client parses them with — so a fixture that
 * has drifted from the contract fails here rather than passing a test and
 * breaking the app.
 *
 * The edge cases at the bottom are the ones that break charts: an empty series,
 * a single point (no line to draw, no span to divide by), a day holding fewer
 * doses than the widest day, and a zero denominator.
 */

const FIXTURES = new URL('./__fixtures__/', import.meta.url);

function load<T>(name: string, schema: { parse: (value: unknown) => T }): T {
  const raw = readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8');
  return schema.parse(JSON.parse(raw));
}

const insights = load('insights', InsightsResponseSchema);
const readings = load('readings', ReadingsResponseSchema);
const appointments = load('appointments', AppointmentsResponseSchema);
const results = load('results', ResultsResponseSchema);
const medicines = load('medicines', MedicinesResponseSchema);
const share = load('share', ShareSummaryResponseSchema);
const profile = load('profile', ProfileResponseSchema);

const noop = (): void => undefined;

describe('the Health screen', () => {
  it('renders every section against a real payload', () => {
    const html = renderToString(
      <HealthScreen
        insights={insights}
        readings={readings}
        appointments={appointments}
        results={results}
        busy={false}
        onLogReading={noop}
        onRecordSymptom={noop}
        onAddAppointment={noop}
        onBookFromVisit={noop}
        onSetAppointmentStatus={noop}
        onAddResult={noop}
        onAddImmunisation={noop}
        onOpenDocument={noop}
        onAddDocument={noop}
        onOpenCondition={noop}
        onShare={noop}
      />,
    );

    expect(html).toContain("How you&#x27;re doing");
    // The headline is the fixed-template sentence, not a hard-coded string.
    expect(html).toContain(insights.headline.slice(0, 20));
  });

  it('does not draw a number as NaN anywhere', () => {
    const html = renderToString(
      <HealthScreen
        insights={insights}
        readings={readings}
        appointments={appointments}
        results={results}
        busy={false}
        onLogReading={noop}
        onRecordSymptom={noop}
        onAddAppointment={noop}
        onBookFromVisit={noop}
        onSetAppointmentStatus={noop}
        onAddResult={noop}
        onAddImmunisation={noop}
        onOpenDocument={noop}
        onAddDocument={noop}
        onOpenCondition={noop}
        onShare={noop}
      />,
    );

    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('Infinity');
  });
});

describe('the shareable page', () => {
  it('leads with allergies, and marks the self-managed medicines', () => {
    const html = renderToString(<ShareScreen summary={share} onClose={noop} />);

    const allergyAt = html.indexOf('Allergies');
    const takingAt = html.indexOf('Taking now');
    expect(allergyAt).toBeGreaterThan(-1);
    // Allergies before the medicines list, always.
    expect(allergyAt).toBeLessThan(takingAt);

    // Every self-managed medicine carries its tag, in the same list.
    for (const medicine of share.currentMedicines.filter((m) => m.selfManaged)) {
      expect(html).toContain(medicine.medicationName);
    }
    expect(html).toContain('self-managed');

    // The provenance note is on the page, not in a tooltip.
    expect(html).toContain('not a');
    expect(html).not.toContain('NaN');
  });

  it('says "none recorded" rather than printing nothing', () => {
    const empty = {
      ...share,
      allergies: [],
      currentMedicines: [],
      conditions: [],
    };
    const html = renderToString(<ShareScreen summary={empty} onClose={noop} />);
    expect(html).toContain('None recorded');
  });
});

describe('the profile editor', () => {
  it('renders the allergy list and the family contact', () => {
    const html = renderToString(
      <ProfileScreen profile={profile} busy={false} onSave={noop} onClose={noop} />,
    );
    expect(html).toContain('Things you react to');
    expect(html).toContain('Your last resort');
    expect(html).toContain(profile.patient.name);
  });
});

describe('the Medicines screen', () => {
  it('shows the self-managed list beside the prescribed one', () => {
    const html = renderToString(
      <MedicinesScreen
        medicines={medicines}
        busy={false}
        onOpenCondition={noop}
        onAddPrescription={noop}
        onOpenRecord={noop}
        recordSummary="9 visits · 3 doctors"
        onAddSelfCare={noop}
        onReportSideEffect={noop}
        onRefill={noop}
        onResume={noop}
        onStopSelfCare={noop}
      />,
    );

    expect(html).toContain('Things you take yourself');
    for (const course of medicines.selfCare) {
      expect(html).toContain(course.medicationName);
    }
    expect(html).toContain('I collected more');
    expect(html).not.toContain('NaN');
  });
});

/* -------------------------------------------------------------------------- */
/* The shapes that break charts                                               */
/* -------------------------------------------------------------------------- */

describe('charts on awkward data', () => {
  it('draws nothing rather than dividing by zero on an empty series', () => {
    expect(renderToString(<AnchorBars rows={[]} />)).toBe('');
    expect(renderToString(<MonthlyBars months={[]} />)).toBe('');
    expect(renderToString(<EpisodeTimeline rows={[]} />)).toBe('');
    expect(renderToString(<EscalationFunnel rows={[]} />)).toBe('');
    expect(renderToString(<PunctualityPlot points={[]} />)).toBe('');
    expect(
      renderToString(<LineChart title="Weight" points={[]} unit="kg" />),
    ).toBe('');
  });

  /** One point is not a line: there is no span to divide the x axis by. */
  it('handles a single point without producing NaN', () => {
    const html = renderToString(
      <LineChart
        title="Weight"
        points={[{ dateLabel: '14 October', value: 71.4 }]}
        unit="kg"
        decimals={1}
      />,
    );
    expect(html).toContain('71.4');
    expect(html).not.toContain('NaN');
  });

  it('handles two identical values, where the range is zero', () => {
    const html = renderToString(
      <LineChart
        title="Weight"
        points={[
          { dateLabel: '1 October', value: 71.4 },
          { dateLabel: '8 October', value: 71.4 },
        ]}
        unit="kg"
        decimals={1}
      />,
    );
    expect(html).not.toContain('NaN');
  });

  /** A course that started at lunchtime has a short first day. */
  it('draws a grid row with fewer doses than the widest day', () => {
    const html = renderToString(
      <DoseGridChart
        grid={{
          medicationName: 'Amoxicillin',
          conditionName: 'Chest infection',
          statusLabel: 'In progress',
          columns: [{ label: '8:30 AM' }, { label: '1:30 PM' }, { label: '8:30 PM' }],
          rows: [
            {
              day: 1,
              dateLabel: '12 October',
              isToday: false,
              cells: [
                null,
                {
                  doseId: 'a',
                  status: 'taken',
                  statusLabel: 'Taken',
                  clockTime: '1:30 PM',
                  takenTimeLabel: '1:35 PM',
                  minutesLate: 5,
                },
                {
                  doseId: 'b',
                  status: 'missed',
                  statusLabel: 'Missed',
                  clockTime: '8:30 PM',
                  takenTimeLabel: null,
                  minutesLate: null,
                },
              ],
            },
          ],
          projectionNote: null,
        }}
      />,
    );

    expect(html).toContain('Amoxicillin');
    // The glyph, not just the colour — the legend names the states too.
    expect(html).toContain('✓');
    expect(html).toContain('✕');
    expect(html).toContain('Taken');
    expect(html).toContain('Missed');
    expect(html).not.toContain('NaN');
  });

  it('draws a burn-down where nothing has been taken yet', () => {
    const html = renderToString(
      <BurnDown
        medicationName="Amoxicillin"
        rows={[
          { day: 1, dateLabel: '12 Oct', expectedTaken: 3, actualTaken: 0, isProjection: false },
          { day: 2, dateLabel: '13 Oct', expectedTaken: 6, actualTaken: 0, isProjection: true },
        ]}
      />,
    );
    expect(html).not.toContain('NaN');
  });

  it('draws severity against doses when only one day has doses', () => {
    const html = renderToString(
      <SymptomAgainstDoses
        conditionName="Chest infection"
        points={[
          { dayNumber: 1, dateLabel: '12 Oct', severity: 7, severityLabel: 'Pretty rough', note: null },
          { dayNumber: 2, dateLabel: '13 Oct', severity: 4, severityLabel: 'Getting better', note: null },
        ]}
        doseDays={[{ day: 1, taken: 0, total: 0 }]}
      />,
    );
    expect(html).not.toContain('NaN');
  });
});

/* -------------------------------------------------------------------------- */
/* The day, at the top of the record                                          */
/* -------------------------------------------------------------------------- */

const history = load('history', HistoryResponseSchema);

/** The same day, with its doses forced into a given state. */
function withToday(
  statuses: ('taken' | 'scheduled' | 'due' | 'missed' | 'skipped')[],
): HistoryResponse {
  const doses = history.todayDoses.slice(0, statuses.length).map((dose, index) => ({
    ...dose,
    status: statuses[index]!,
    isActionable: statuses[index] === 'scheduled' || statuses[index] === 'due',
  }));
  return {
    ...history,
    todayDoses: doses,
    due: doses.find((dose) => dose.status === 'due') ?? null,
  };
}

function renderRecord(data: HistoryResponse): string {
  return renderToString(
    <HistoryScreen
      history={data}
      busy={false}
      onOpenDose={noop}
      onOpenCondition={noop}
      onOpenVisit={noop}
      onAddPrescription={noop}
      onStartCourse={noop}
    />,
  );
}

describe('the Today panel', () => {
  /**
   * The point of the whole thing: a patient wondering whether she has taken her
   * tablet should not have to scroll past a heading, a statistics line and two
   * illness chips to find out.
   */
  it('comes before the record heading', () => {
    const html = renderRecord(withToday(['taken', 'scheduled', 'scheduled']));
    expect(html.indexOf('Today')).toBeLessThan(html.indexOf('Your record'));
  });

  it('lists every dose of the day, not just the next one', () => {
    const html = renderRecord(withToday(['taken', 'scheduled', 'scheduled', 'scheduled']));
    for (const dose of history.todayDoses.slice(0, 4)) {
      expect(html).toContain(dose.clockTime);
    }
  });

  it('counts what is left, not what exists', () => {
    const html = renderRecord(withToday(['taken', 'taken', 'scheduled', 'scheduled']));
    expect(html).toContain('2 still to take today');
    expect(html).toContain('2 of 4 taken');
  });

  it('leads with the missed dose when there is one', () => {
    const html = renderRecord(withToday(['taken', 'missed', 'scheduled']));
    expect(html).toContain('1 missed');
    expect(html).toContain('card--red');
  });

  it('turns amber and names the medicine when one is due', () => {
    const data = withToday(['taken', 'due', 'scheduled']);
    const html = renderRecord(data);
    expect(html).toContain('card--amber');
    expect(html).toContain(`Take your ${data.due!.medicationName} now`);
    // The pulsing button is reserved for a dose that is actually due.
    expect(html).toContain('btn--pulse');
  });

  /**
   * The restraint half. A cue that is always lit is one a patient reads past
   * within a day — this app already made that argument about its tab badge.
   */
  it('stays calm when nothing is due yet', () => {
    const html = renderRecord(withToday(['taken', 'scheduled', 'scheduled']));
    expect(html).not.toContain('card--red');
    expect(html).not.toContain('card--amber');
    expect(html).not.toContain('btn--pulse');
  });

  it('goes quiet and green once everything is taken', () => {
    const html = renderRecord(withToday(['taken', 'taken', 'taken']));
    expect(html).toContain('All 3 taken today');
    expect(html).toContain('Nothing else is owed today');
    expect(html).not.toContain('btn--pulse');
  });

  it('counts a skipped dose honestly rather than as taken', () => {
    const html = renderRecord(withToday(['taken', 'skipped', 'taken']));
    expect(html).toContain('1 skipped');
    expect(html).not.toContain('All 3 taken today');
  });

  it('shows a meaningful status as a word, never colour alone', () => {
    const html = renderRecord(withToday(['taken', 'missed', 'scheduled', 'skipped']));
    for (const word of ['Taken', 'Missed', 'Skipped']) {
      expect(html).toContain(word);
    }
    // A dose still to come needs no word — its time is the status — but a
    // screen reader is still told, through the row's label.
    expect(html).toContain('Later today');
  });

  it('renders nothing at all on a day with no doses', () => {
    const html = renderRecord({ ...history, todayDoses: [], due: null });
    expect(html).not.toContain('still to take today');
  });
});
