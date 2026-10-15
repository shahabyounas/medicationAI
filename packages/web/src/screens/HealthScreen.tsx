import { useMemo, useState, type ReactNode } from 'react';
import {
  APPOINTMENT_STATUS_LABELS,
  DOCUMENT_KIND_LABELS,
  LAB_FLAG_LABELS,
  type AppointmentsResponse,
  type InsightsResponse,
  type ReadingMetric,
  type ReadingsResponse,
  type ResultsResponse,
} from '@medication-ai/shared';
import {
  AnchorBars,
  BurnDown,
  DoseGridChart,
  EpisodeTimeline,
  EscalationFunnel,
  Figure,
  LineChart,
  MonthlyBars,
  PunctualityPlot,
  SeverityPicker,
  StatTiles,
  SymptomAgainstDoses,
} from '../components/charts.js';

/**
 * The fourth tab: how you're doing.
 *
 * The app had no analytics surface at all. Everything here was already in the
 * database — the planned and actual time of every dose, the anchor each hangs
 * off, the drift the agent taught itself, which rung settled each chase — and a
 * patient could see a progress bar.
 *
 * Four sections rather than four tabs, because they answer four different
 * questions and the patient arrives with one of them: *am I keeping up?*,
 * *what are my numbers doing?*, *when am I next seen?*, *what did the tests
 * say?*. The segmented control is above everything it scopes, not inside a
 * card, so switching section never re-renders a chart into a different shape.
 */
type Section = 'trends' | 'readings' | 'appointments' | 'results';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'trends', label: 'Patterns' },
  { id: 'readings', label: 'Readings' },
  { id: 'appointments', label: 'Appointments' },
  { id: 'results', label: 'Results' },
];

export function HealthScreen({
  insights,
  readings,
  appointments,
  results,
  busy,
  onLogReading,
  onRecordSymptom,
  onAddAppointment,
  onBookFromVisit,
  onSetAppointmentStatus,
  onAddResult,
  onAddImmunisation,
  onOpenDocument,
  onAddDocument,
  onOpenCondition,
  onShare,
}: {
  insights: InsightsResponse;
  readings: ReadingsResponse;
  appointments: AppointmentsResponse;
  results: ResultsResponse;
  busy: boolean;
  onLogReading: (metric: ReadingMetric) => void;
  onRecordSymptom: (conditionId: string, severity: number) => void;
  onAddAppointment: () => void;
  onBookFromVisit: (visitId: string) => void;
  onSetAppointmentStatus: (
    appointmentId: string,
    status: 'attended' | 'missed' | 'cancelled',
  ) => void;
  onAddResult: () => void;
  onAddImmunisation: () => void;
  onOpenDocument: (documentId: string) => void;
  onAddDocument: () => void;
  onOpenCondition: (conditionId: string) => void;
  onShare: () => void;
}): ReactNode {
  const [section, setSection] = useState<Section>('trends');

  return (
    <div className="pad">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 className="h1">How you're doing</h1>
          <p className="sub">Everything I've been keeping track of.</p>
        </div>
        <button className="btn btn--ghost" style={{ width: 'auto', padding: '0 16px' }} onClick={onShare}>
          Share
        </button>
      </div>

      <div className="segments" role="tablist" aria-label="What to look at">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={section === item.id}
            className={`segment${section === item.id ? ' segment--on' : ''}`}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {section === 'trends' && (
        <TrendsSection
          insights={insights}
          busy={busy}
          onRecordSymptom={onRecordSymptom}
          onOpenCondition={onOpenCondition}
        />
      )}
      {section === 'readings' && (
        <ReadingsSection readings={readings} onLogReading={onLogReading} />
      )}
      {section === 'appointments' && (
        <AppointmentsSection
          appointments={appointments}
          busy={busy}
          onAdd={onAddAppointment}
          onBookFromVisit={onBookFromVisit}
          onSetStatus={onSetAppointmentStatus}
        />
      )}
      {section === 'results' && (
        <ResultsSection
          results={results}
          onAddResult={onAddResult}
          onAddImmunisation={onAddImmunisation}
          onOpenDocument={onOpenDocument}
          onAddDocument={onAddDocument}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Patterns                                                                   */
/* -------------------------------------------------------------------------- */

function TrendsSection({
  insights,
  busy,
  onRecordSymptom,
  onOpenCondition,
}: {
  insights: InsightsResponse;
  busy: boolean;
  onRecordSymptom: (conditionId: string, severity: number) => void;
  onOpenCondition: (conditionId: string) => void;
}): ReactNode {
  /**
   * The doses-per-day strip under each severity line.
   *
   * Derived from the grid rather than fetched separately, because they have to
   * be the same days — two plots on a shared axis is the honest way to put
   * severity next to doses, and it only works if the axes genuinely agree.
   */
  const doseDaysByCondition = useMemo(() => {
    const map = new Map<string, { day: number; taken: number; total: number }[]>();
    for (const grid of insights.grids) {
      if (!grid.conditionName) continue;
      const rows = grid.rows.map((row) => ({
        day: row.day,
        taken: row.cells.filter(
          (cell) => cell?.status === 'taken' || cell?.status === 'taken_late',
        ).length,
        total: row.cells.filter((cell) => cell !== null).length,
      }));
      map.set(grid.conditionName, rows);
    }
    return map;
  }, [insights.grids]);

  const [showFinished, setShowFinished] = useState(false);

  const running = insights.grids.filter((grid) => grid.status === 'active');
  const finished = insights.grids.filter((grid) => grid.status !== 'active');

  return (
    <>
      <div className="card card--note" style={{ marginBottom: 14 }}>
        {insights.headline}
      </div>

      {insights.openSideEffects.length > 0 && (
        <div className="card card--amber" style={{ marginBottom: 14 }}>
          <div className="eyebrow" style={{ color: 'var(--amber-ink)', marginBottom: 8 }}>
            Still bothering you
          </div>
          {insights.openSideEffects.map((report) => (
            <div key={`${report.medicationName}-${report.symptom}`} style={{ marginBottom: 6 }}>
              <strong>{report.medicationName}</strong> — {report.symptom} since{' '}
              {report.startedLabel} ({report.severityLabel.toLowerCase()})
            </div>
          ))}
        </div>
      )}

      {insights.hasEnoughData && (
        <StatTiles
          tiles={[
            {
              label: 'Of the doses due',
              value: `${insights.overall.percentOfElapsed}%`,
              hint: `${insights.overall.taken + insights.overall.late} taken, ${insights.overall.missed} missed`,
              tone: insights.overall.percentOfElapsed >= 85 ? 'good' : 'plain',
            },
            {
              label: 'In a row right now',
              value: String(insights.overall.currentStreak),
              hint: `Your best run is ${insights.overall.longestStreak}`,
            },
            {
              label: 'Taken within the hour',
              value: `${insights.punctuality.onTimePercent}%`,
              hint:
                insights.punctuality.medianMinutesLate === null
                  ? null
                  : `Usually ${insights.punctuality.medianMinutesLate} min after I ask`,
            },
            {
              label: 'Courses finished',
              value: String(insights.overall.coursesCompleted),
              hint:
                insights.overall.coursesStoppedEarly > 0
                  ? `${insights.overall.coursesStoppedEarly} stopped early`
                  : 'None abandoned',
              tone: insights.overall.coursesStoppedEarly > 0 ? 'plain' : 'good',
            },
          ]}
        />
      )}

      {/* The daily question nobody has ever been asked. */}
      {insights.symptoms
        .filter((series) => !series.recordedToday)
        .map((series) => (
          <div key={series.conditionId} className="card" style={{ marginBottom: 14 }}>
            <div className="h3">How is your {series.conditionName.toLowerCase()} today?</div>
            <p className="sub" style={{ marginBottom: 14 }}>
              0 is completely well, 10 is as bad as it has been. One tap — it is the only way the
              record knows whether you actually got better.
            </p>
            <SeverityPicker
              value={null}
              disabled={busy}
              onChange={(severity) => onRecordSymptom(series.conditionId, severity)}
            />
          </div>
        ))}

      {insights.hasEnoughData && <AnchorBars rows={insights.byAnchor} />}

      {insights.symptoms.map((series) => (
        <SymptomAgainstDoses
          key={series.conditionId}
          conditionName={series.conditionName}
          points={series.points}
          doseDays={doseDaysByCondition.get(series.conditionName) ?? []}
          note={series.turningPointNote}
        />
      ))}

      {running.map((grid) => (
        <div key={grid.courseId}>
          <DoseGridChart grid={grid} />
          {/*
            Only where there is a plan to burn down. An open-ended medicine has
            no last dose, so an "expected" line would climb for as long as the
            patient takes it and imply a finish line that does not exist.
          */}
          {grid.hasFinishLine && (
            <BurnDown
              rows={grid.burnDown}
              medicationName={grid.medicationName}
              note={grid.projectionNote}
            />
          )}
        </div>
      ))}

      {insights.hasEnoughData && (
        <PunctualityPlot
          points={insights.punctuality.points}
          driftNote={insights.punctuality.driftNote}
        />
      )}

      <MonthlyBars months={insights.monthly} />

      <EpisodeTimeline
        rows={insights.timeline.map((episode) => ({
          ...episode,
          startedAt: new Date(episode.startedAt),
          endedAt: episode.endedAt ? new Date(episode.endedAt) : null,
        }))}
        onOpen={onOpenCondition}
      />

      <EscalationFunnel rows={insights.escalation} />

      {/*
        Behind a tap. Rendering a grid for every course the patient has ever
        finished turned this screen into twenty-one charts on one scroll, and
        the finished ones are history rather than something to act on.
      */}
      {finished.length > 0 && (
        <>
          <button
            className="btn btn--ghost"
            style={{ marginTop: 22 }}
            onClick={() => setShowFinished((open) => !open)}
            aria-expanded={showFinished}
          >
            {showFinished
              ? 'Hide the courses you have finished'
              : `Show the ${finished.length} ${
                  finished.length === 1 ? 'course' : 'courses'
                } you have finished`}
          </button>
          {showFinished &&
            finished.map((grid) => <DoseGridChart key={grid.courseId} grid={grid} />)}
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Readings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What the patient measured.
 *
 * Every metric is listed, including the ones with nothing in them, because a
 * screen that shows only what has been measured never tells anybody what else
 * they could measure — and this screen starts empty for everyone.
 */
function ReadingsSection({
  readings,
  onLogReading,
}: {
  readings: ReadingsResponse;
  onLogReading: (metric: ReadingMetric) => void;
}): ReactNode {
  const tracked = readings.series.filter((series) => series.points.length > 0);
  const untracked = readings.series.filter((series) => series.points.length === 0);

  return (
    <>
      {tracked.length === 0 && (
        <div className="card card--note" style={{ marginBottom: 14 }}>
          Nothing measured yet. Your blood pressure, your weight, your blood sugar — anything you
          are asked to keep an eye on. I draw it and nothing else: what a number means is a
          conversation with your doctor, not with me.
        </div>
      )}

      {tracked.map((series) => (
        <div key={series.metric}>
          <LineChart
            title={series.label}
            caption={[series.latestLabel, series.latestAtLabel].filter(Boolean).join(' · ')}
            points={series.points.map((point) => ({
              dateLabel: point.dateLabel,
              value: point.value,
              secondValue: point.secondValue,
              label: point.label,
              muted: point.fromVisit,
              note: point.note,
            }))}
            unit={series.unit}
            decimals={series.decimals}
            band={series.referenceBand}
            seriesLabels={series.hasPair ? ['Top number', 'Bottom number'] : undefined}
            note={[series.changeLabel, series.averageLabel].filter(Boolean).join(' · ') || null}
          />
          <button
            className="btn btn--ghost"
            style={{ marginBottom: 20 }}
            onClick={() => onLogReading(series.metric)}
          >
            Add a {series.label.toLowerCase()} reading
          </button>
        </div>
      ))}

      {untracked.length > 0 && (
        <div className="card" style={{ marginTop: 6 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Also worth keeping
          </div>
          <p className="sub" style={{ marginBottom: 14 }}>
            Start any of these and I will keep the chart.
          </p>
          <div className="chips">
            {untracked.map((series) => (
              <button
                key={series.metric}
                className="chip"
                onClick={() => onLogReading(series.metric)}
              >
                + {series.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Appointments                                                               */
/* -------------------------------------------------------------------------- */

/**
 * When you are next seen.
 *
 * `suggestedFromVisits` is the interesting part: follow-up dates the app has
 * been told about since its first version and done nothing with. Offering them
 * for one tap is the migration — and they are offered rather than booked,
 * because "come back in three weeks" on a visit note is frequently an
 * instruction to ring the surgery rather than an appointment that exists.
 */
function AppointmentsSection({
  appointments,
  busy,
  onAdd,
  onBookFromVisit,
  onSetStatus,
}: {
  appointments: AppointmentsResponse;
  busy: boolean;
  onAdd: () => void;
  onBookFromVisit: (visitId: string) => void;
  onSetStatus: (appointmentId: string, status: 'attended' | 'missed' | 'cancelled') => void;
}): ReactNode {
  return (
    <>
      <button className="btn btn--primary" style={{ marginBottom: 16 }} onClick={onAdd}>
        + Add an appointment
      </button>

      {appointments.suggestedFromVisits.length > 0 && (
        <div className="card card--amber" style={{ marginBottom: 14 }}>
          <div className="eyebrow" style={{ color: 'var(--amber-ink)', marginBottom: 8 }}>
            You were told to come back
          </div>
          <p className="sub" style={{ marginBottom: 14 }}>
            These are on your visit notes and I am not reminding you about them yet. Tap one and I
            will — a week before, the day before, and on the morning.
          </p>
          {appointments.suggestedFromVisits.map((suggestion) => (
            <button
              key={suggestion.visitId}
              className="row-card"
              disabled={busy}
              onClick={() => onBookFromVisit(suggestion.visitId)}
              style={{ width: '100%', textAlign: 'left' }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', font: '800 16.5px/1.3 var(--font)' }}>
                  {suggestion.dateLabel} — {suggestion.doctorName}
                </span>
                <span
                  style={{
                    display: 'block',
                    font: '600 14px/1.35 var(--font)',
                    color: 'var(--ink-soft)',
                  }}
                >
                  {suggestion.conditionName
                    ? `For your ${suggestion.conditionName.toLowerCase()} · `
                    : ''}
                  from your visit on {suggestion.visitDateLabel}
                </span>
              </span>
              <span className="chev" aria-hidden="true">
                ＋
              </span>
            </button>
          ))}
        </div>
      )}

      {appointments.immunisationsDue.length > 0 && (
        <div className="card card--amber" style={{ marginBottom: 14 }}>
          <div className="eyebrow" style={{ color: 'var(--amber-ink)', marginBottom: 8 }}>
            Due for a jab
          </div>
          {appointments.immunisationsDue.map((jab) => (
            <div key={jab.immunisationId} style={{ font: '600 16px/1.5 var(--font)' }}>
              <strong>{jab.name}</strong> — due {jab.dateLabel} ({jab.whenLabel.toLowerCase()})
            </div>
          ))}
        </div>
      )}

      {appointments.upcoming.length === 0 ? (
        <div className="card">
          <div className="h3">Nothing booked</div>
          <div className="sub">
            Add one and I will remind you a week before, the day before, and on the morning.
          </div>
        </div>
      ) : (
        appointments.upcoming.map((appointment) => (
          <div key={appointment._id} className="card" style={{ marginBottom: 12 }}>
            <div className="spread">
              <div style={{ minWidth: 0 }}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>
                  {appointment.whenLabel}
                </div>
                <div style={{ font: '900 19px/1.25 var(--font)' }}>{appointment.withWhom}</div>
                <div style={{ font: '600 15px/1.45 var(--font)', color: 'var(--ink-soft)' }}>
                  {appointment.dateLabel} at {appointment.clockTime}
                  {appointment.clinicName ? ` · ${appointment.clinicName}` : ''}
                </div>
                {appointment.conditionName && (
                  <div style={{ font: '600 14px/1.4 var(--font)', color: 'var(--ink-faint)' }}>
                    About your {appointment.conditionName.toLowerCase()}
                  </div>
                )}
              </div>
              <span className="pill pill--green">{appointment.typeLabel}</span>
            </div>

            {appointment.notes && (
              <div className="card card--note" style={{ marginTop: 12 }}>
                <strong>To ask:</strong> {appointment.notes}
              </div>
            )}

            <div style={{ font: '600 13.5px/1.4 var(--font)', color: 'var(--ink-faint)', marginTop: 12 }}>
              {appointment.remindersPending.length === 0
                ? 'I have sent all the reminders for this one.'
                : `I will remind you: ${appointment.remindersPending
                    .map((rung) =>
                      rung === 'week_before'
                        ? 'a week before'
                        : rung === 'day_before'
                          ? 'the day before'
                          : 'on the morning',
                    )
                    .join(', ')}.`}
            </div>

            <div className="btn-row" style={{ marginTop: 12 }}>
              {appointment.clinicPhone && (
                <a
                  className="btn btn--ghost"
                  style={{ display: 'grid', placeItems: 'center' }}
                  href={`tel:${appointment.clinicPhone.replace(/\s/g, '')}`}
                >
                  Call the clinic
                </a>
              )}
              <button
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => onSetStatus(appointment._id, 'attended')}
              >
                I went
              </button>
            </div>
          </div>
        ))
      )}

      {appointments.past.length > 0 && (
        <>
          <div className="eyebrow" style={{ margin: '22px 0 10px' }}>
            Before now
          </div>
          {appointments.past.slice(0, 10).map((appointment) => (
            <div key={appointment._id} className="row-card">
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', font: '700 16px/1.3 var(--font)' }}>
                  {appointment.withWhom}
                </span>
                <span
                  style={{
                    display: 'block',
                    font: '600 13.5px/1.35 var(--font)',
                    color: 'var(--ink-soft)',
                  }}
                >
                  {appointment.dateLabel} · {appointment.whenLabel}
                </span>
              </span>
              <span
                className={`pill ${
                  appointment.status === 'attended'
                    ? 'pill--green'
                    : appointment.status === 'missed'
                      ? 'pill--red'
                      : 'pill--grey'
                }`}
              >
                {APPOINTMENT_STATUS_LABELS[appointment.status]}
              </span>
            </div>
          ))}
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Test results, jabs and photographs of the paper.
 *
 * Transcription, never interpretation. The flag beside a line is the H or the L
 * the lab printed, copied across — it is never worked out by comparing the
 * value against the range, because deciding that a number is abnormal is the one
 * thing this app must not do.
 */
function ResultsSection({
  results,
  onAddResult,
  onAddImmunisation,
  onOpenDocument,
  onAddDocument,
}: {
  results: ResultsResponse;
  onAddResult: () => void;
  onAddImmunisation: () => void;
  onOpenDocument: (documentId: string) => void;
  onAddDocument: () => void;
}): ReactNode {
  return (
    <>
      <div className="btn-row" style={{ marginBottom: 16 }}>
        <button className="btn btn--ghost" onClick={onAddResult}>
          + Test result
        </button>
        <button className="btn btn--ghost" onClick={onAddImmunisation}>
          + Jab
        </button>
      </div>

      {results.trends.map((trend) => (
        <LineChart
          key={trend.name}
          title={trend.name}
          caption={
            trend.referenceRange
              ? `The report's range: ${trend.referenceRange}${trend.unit ? ` ${trend.unit}` : ''}`
              : null
          }
          points={trend.points.map((point) => ({
            dateLabel: point.dateLabel,
            value: point.value,
            label: point.display,
            note: point.flag === 'unknown' ? null : LAB_FLAG_LABELS[point.flag],
          }))}
          unit={trend.unit ?? ''}
          decimals={trend.points.some((point) => !Number.isInteger(point.value)) ? 1 : 0}
          note="Copied from your report. Whether a number matters is your doctor's to say."
        />
      ))}

      {results.labs.length === 0 ? (
        <div className="card card--note" style={{ marginBottom: 14 }}>
          Nothing typed in yet. Copy a result off the paper and I will keep it — and if the same
          test is done twice, I will draw the line.
        </div>
      ) : (
        results.labs.map((lab) => (
          <div key={lab._id} className="card" style={{ marginBottom: 12 }}>
            <div className="spread">
              <div>
                <div style={{ font: '800 17px/1.3 var(--font)' }}>{lab.panelName}</div>
                <div style={{ font: '600 14px/1.4 var(--font)', color: 'var(--ink-soft)' }}>
                  {lab.dateLabel}
                  {lab.doctorName ? ` · ${lab.doctorName}` : ''}
                </div>
              </div>
              {lab.flaggedCount > 0 && (
                <span className="pill pill--amber">{lab.flaggedCount} marked</span>
              )}
            </div>

            <div className="doselog" style={{ marginTop: 12 }}>
              {lab.items.map((item) => (
                <div key={item.id} className="doselog-row">
                  <span style={{ flex: 1, font: '700 15px/1.4 var(--font)' }}>{item.name}</span>
                  <span style={{ font: '700 15px/1.4 var(--font)', fontVariantNumeric: 'tabular-nums' }}>
                    {item.value}
                    {item.unit ? ` ${item.unit}` : ''}
                  </span>
                  {item.referenceRange && (
                    <span
                      style={{
                        font: '600 13px/1.4 var(--font)',
                        color: 'var(--ink-faint)',
                        marginLeft: 8,
                      }}
                    >
                      ({item.referenceRange})
                    </span>
                  )}
                  {item.flag !== 'unknown' && item.flag !== 'normal' && (
                    <span className="pill pill--amber" style={{ marginLeft: 8 }}>
                      {item.flag === 'low' ? 'L' : item.flag === 'high' ? 'H' : '!'}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {lab.notes && (
              <div className="card card--note" style={{ marginTop: 12 }}>
                {lab.notes}
              </div>
            )}
          </div>
        ))
      )}

      <div className="eyebrow" style={{ margin: '22px 0 10px' }}>
        Jabs
      </div>
      {results.immunisations.length === 0 ? (
        <div className="card">
          <div className="sub">
            Nothing recorded. This is the one part of a record somebody else usually asks for.
          </div>
        </div>
      ) : (
        results.immunisations.map((jab) => (
          <div key={jab._id} className="row-card">
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', font: '700 16px/1.3 var(--font)' }}>
                {jab.name}
                {jab.doseLabel ? ` · ${jab.doseLabel}` : ''}
              </span>
              <span
                style={{
                  display: 'block',
                  font: '600 13.5px/1.35 var(--font)',
                  color: 'var(--ink-soft)',
                }}
              >
                {jab.dateLabel}
                {jab.administeredBy ? ` · ${jab.administeredBy}` : ''}
              </span>
            </span>
            {jab.nextDueLabel && (
              <span className={`pill ${jab.overdue ? 'pill--red' : 'pill--grey'}`}>
                {jab.overdue ? 'Due' : jab.nextDueLabel}
              </span>
            )}
          </div>
        ))
      )}

      <div className="spread" style={{ margin: '22px 0 10px' }}>
        <div className="eyebrow">Photographs</div>
        <button
          className="btn btn--ghost"
          style={{ width: 'auto', padding: '0 14px', minHeight: 38 }}
          onClick={onAddDocument}
        >
          + Add
        </button>
      </div>
      {results.documents.length === 0 ? (
        <div className="card">
          <div className="sub">
            A picture of the prescription, a letter, a printed result. It is the thing you can
            actually produce in the ten seconds after an appointment.
          </div>
        </div>
      ) : (
        results.documents.map((document) => (
          <button
            key={document._id}
            className="row-card"
            style={{ width: '100%', textAlign: 'left' }}
            onClick={() => onOpenDocument(document._id)}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', font: '700 16px/1.3 var(--font)' }}>
                {document.title}
              </span>
              <span
                style={{
                  display: 'block',
                  font: '600 13.5px/1.35 var(--font)',
                  color: 'var(--ink-soft)',
                }}
              >
                {DOCUMENT_KIND_LABELS[document.kind]} · {document.dateLabel} · {document.sizeLabel}
              </span>
            </span>
            <span className="chev" aria-hidden="true">
              ›
            </span>
          </button>
        ))
      )}
    </>
  );
}
