import type { ReactNode } from 'react';
import type {
  ConditionSummary,
  MedicinesResponse,
  SelfCareCourse,
} from '@medication-ai/shared';
import { PillIcon, glyphFor } from '../components/common.js';

/** What a refill needs to know, passed up so the overlay can be opened. */
export interface RefillTarget {
  courseId: string;
  medicationName: string;
  dosesRemaining: number;
  unitsRemaining: number | null;
}

/**
 * Every medicine, grouped under the condition it treats.
 *
 * Grouping by condition rather than listing tablets is the whole point: it
 * answers "what is this one for?" without the patient having to remember, and
 * it puts a course that was abandoned right next to the illness that came back.
 */
export function MedicinesScreen({
  medicines,
  busy,
  onOpenCondition,
  onAddPrescription,
  onOpenRecord,
  recordSummary,
  onAddSelfCare,
  onReportSideEffect,
  onRefill,
  onResume,
  onStopSelfCare,
}: {
  medicines: MedicinesResponse;
  busy: boolean;
  onOpenCondition: (conditionId: string) => void;
  onAddPrescription: () => void;
  onOpenRecord: () => void;
  recordSummary: string;
  onAddSelfCare: () => void;
  onReportSideEffect: (courseId: string | null) => void;
  onRefill: (target: RefillTarget) => void;
  onResume: (courseId: string) => void;
  onStopSelfCare: (courseId: string) => void;
}): ReactNode {
  const nothing =
    medicines.active.length === 0 &&
    medicines.finished.length === 0 &&
    medicines.selfCare.length === 0;

  return (
    <div className="pad">
      <h1 className="h1">My medicines</h1>
      <p className="sub" style={{ marginBottom: 20 }}>
        Everything you take, and what it's for.
      </p>

      {/* Outline, not the big green one. On this screen the loud button was
          competing with the only action that matters anywhere in the app —
          taking a tablet — and it appeared on all four screens at once, twice
          under a different name. This is now its one home. */}
      <div className="btn-row" style={{ marginBottom: 22 }}>
        <button className="btn btn--ghost" onClick={onAddPrescription}>
          + Prescription
        </button>
        {/*
          Equal weight with the prescription button, because most of what
          people take is not prescribed — the vitamin every morning, the
          ibuprofen in the drawer. An app that only knows about prescriptions
          has an incomplete list of what is going into the patient, and it is
          incomplete exactly when the list is asked for.
        */}
        <button className="btn btn--ghost" onClick={onAddSelfCare}>
          + Something I take
        </button>
      </div>

      {/* Above the lists: a reported reaction explains the gaps in them. */}
      {medicines.openSideEffects.map((report) => (
        <div key={report.reportId} className="card card--amber" style={{ marginBottom: 12 }}>
          <div className="eyebrow" style={{ color: 'var(--amber-ink)', marginBottom: 6 }}>
            {report.chasingPaused ? 'Reminders are off' : 'On your record'}
          </div>
          <div style={{ font: '700 16px/1.45 var(--font)' }}>
            {report.medicationName} — {report.symptom} since {report.startedLabel}.
          </div>
          <div style={{ font: '600 14px/1.45 var(--font)', color: 'var(--amber-soft)', marginTop: 4 }}>
            {report.chasingPaused
              ? 'I am not chasing those doses until you have spoken to somebody.'
              : report.severityLabel}
          </div>
        </div>
      ))}

      {nothing && (
        <p className="sub">
          Nothing recorded yet. Add the prescription your doctor gave you to get started.
        </p>
      )}

      {medicines.active.map((condition) => (
        <ActiveCondition
          key={condition._id}
          condition={condition}
          busy={busy}
          onOpen={onOpenCondition}
          onReportSideEffect={onReportSideEffect}
          onRefill={onRefill}
          onResume={onResume}
        />
      ))}

      {/* The medicines nobody prescribed — their own list, same screen. */}
      {medicines.selfCare.length > 0 && (
        <>
          <div className="h2" style={{ marginTop: 26, marginBottom: 4 }}>
            Things you take yourself
          </div>
          <p className="sub" style={{ marginBottom: 12 }}>
            No doctor wrote these down, so they are not a course to finish — but they are part of
            what you are taking, and that is what anybody who asks actually wants to know.
          </p>
          <div className="stack">
            {medicines.selfCare.map((course) => (
              <SelfCareCard
                key={course.courseId}
                course={course}
                busy={busy}
                onReportSideEffect={onReportSideEffect}
                onStop={onStopSelfCare}
              />
            ))}
          </div>
        </>
      )}

      {medicines.finished.length > 0 && (
        <>
          <div className="h2 muted" style={{ marginTop: 26, marginBottom: 11 }}>
            Finished
          </div>
          <div className="stack">
            {medicines.finished.map((condition) => (
              <FinishedCondition
                key={condition._id}
                condition={condition}
                onOpen={onOpenCondition}
              />
            ))}
          </div>
        </>
      )}

      {/* The record, where the question it answers actually comes up. */}
      <button className="row-card" style={{ marginTop: 26 }} onClick={onOpenRecord}>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <span style={{ display: 'block', font: '900 17px/1.25 var(--font)' }}>Your record</span>
          <span
            style={{
              display: 'block',
              font: '600 14.5px/1.35 var(--font)',
              color: 'var(--ink-soft)',
            }}
          >
            {recordSummary}
          </span>
        </span>
        <span style={{ font: '800 19px/1 var(--font)', color: 'var(--ink-soft)' }}>›</span>
      </button>
    </div>
  );
}

function ActiveCondition({
  condition,
  busy,
  onOpen,
  onReportSideEffect,
  onRefill,
  onResume,
}: {
  condition: ConditionSummary;
  busy: boolean;
  onOpen: (id: string) => void;
  onReportSideEffect: (courseId: string | null) => void;
  onRefill: (target: RefillTarget) => void;
  onResume: (courseId: string) => void;
}): ReactNode {
  const ongoing = condition.isChronic || condition.durationDays === null;

  return (
    <div style={{ marginBottom: 26 }}>
      <button
        onClick={() => onOpen(condition._id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          width: '100%',
          marginBottom: 11,
          textAlign: 'left',
        }}
      >
        <span className="h2">
          {condition.name}{' '}
          <span style={{ font: '700 14px/1 var(--font)', color: 'var(--ink-soft)' }}>
            · {condition.courses.length}{' '}
            {condition.courses.length === 1 ? 'medicine' : 'medicines'}
          </span>
        </span>
        <span className={`pill ${ongoing ? 'pill--green' : 'pill--amber'}`}>
          {ongoing
            ? 'Ongoing'
            : `Day ${condition.dayNumber ?? 1} of ${condition.durationDays}`}
        </span>
      </button>

      {condition.courses.map((course) => (
        <div key={course._id} className="card" style={{ marginBottom: 10, borderRadius: 20 }}>
          <div className="row" style={{ gap: 14 }}>
            <PillIcon tone={glyphFor(course.medicationForm)} size={52} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: '900 19px/1.2 var(--font)' }}>{course.medicationName}</div>
              {course.medicationPurpose && (
                <div style={{ font: '600 14.5px/1.4 var(--font)', color: 'var(--ink-soft)' }}>
                  {course.medicationPurpose}
                </div>
              )}
            </div>
          </div>

          <div style={{ font: '700 15px/1.4 var(--font)', marginTop: 13 }}>
            {course.instructionLine}
          </div>

          {course.progress.totalDoses !== null && (
            <div className="bar" style={{ marginTop: 11, height: 8 }}>
              <span style={{ width: `${course.progress.percentComplete}%` }} />
            </div>
          )}

          <div
            style={{
              font: '600 13.5px/1.4 var(--font)',
              marginTop: 7,
              color:
                course.progress.unitsRemaining !== null && course.progress.unitsRemaining <= 3
                  ? 'var(--red)'
                  : 'var(--ink-soft)',
            }}
          >
            {course.progress.unitsRemaining !== null
              ? `${course.progress.unitsRemaining} left`
              : 'Ongoing'}
            {course.progress.totalDoses !== null &&
              ` · ${course.progress.takenCount} of ${course.progress.totalDoses} doses taken`}
          </div>

          {course.pausedNote && (
            <div className="card card--amber" style={{ marginTop: 12 }}>
              <div style={{ font: '700 14.5px/1.45 var(--font)', color: 'var(--amber-ink)' }}>
                {course.pausedNote}
              </div>
              {/*
                The resume is the patient telling the agent what a human
                decided. The agent never makes this call itself — it stood down
                because a reaction was reported, and only a doctor can say
                carry on.
              */}
              <button
                className="btn btn--ghost"
                style={{ marginTop: 10 }}
                disabled={busy}
                onClick={() => onResume(course._id)}
              >
                My doctor said to carry on
              </button>
            </div>
          )}

          <div className="btn-row" style={{ marginTop: 12 }}>
            {/*
              A refill was impossible until now: `unitsRemaining` only ever
              counted down, so the running-out warning fired once and could
              never be cleared, for the rest of the course.
            */}
            <button
              className="btn btn--ghost"
              disabled={busy}
              onClick={() =>
                onRefill({
                  courseId: course._id,
                  medicationName: course.medicationName,
                  dosesRemaining: course.dosesRemaining,
                  unitsRemaining: course.progress.unitsRemaining,
                })
              }
            >
              I collected more
            </button>
            <button
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => onReportSideEffect(course._id)}
            >
              It's not agreeing with me
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function FinishedCondition({
  condition,
  onOpen,
}: {
  condition: ConditionSummary;
  onOpen: (id: string) => void;
}): ReactNode {
  const stoppedEarly = condition.courses.some((c) => c.status === 'stopped_early');
  const totalDoses = condition.courses.reduce((sum, c) => sum + (c.totalDoses ?? 0), 0);
  const taken = condition.courses.reduce((sum, c) => sum + c.progress.takenCount, 0);

  return (
    <button className="card card--tap" style={{ borderRadius: 20 }} onClick={() => onOpen(condition._id)}>
      <div className="spread">
        <div>
          <div className="h3">{condition.name}</div>
          <div style={{ font: '600 14px/1.4 var(--font)', color: 'var(--ink-soft)', marginTop: 3 }}>
            {condition.courses.map((c) => c.medicationName).join(', ')}
            {condition.doctorName ? ` · ${condition.doctorName}` : ''}
          </div>
        </div>
        <span className={`pill ${stoppedEarly ? 'pill--red' : 'pill--green'}`}>
          {stoppedEarly ? 'Stopped early' : `All ${totalDoses} taken`}
        </span>
      </div>

      {stoppedEarly && (
        <div style={{ font: '700 13.5px/1.4 var(--font)', color: 'var(--red)', marginTop: 11 }}>
          Stopped after {taken} of {totalDoses} doses
          {condition.status === 'recurred'
            ? ' — it came back. This is the pattern the agent exists to break.'
            : '.'}
        </div>
      )}
    </button>
  );
}

/**
 * Something the patient takes because they decided to.
 *
 * Deliberately not drawn like a course. There is no progress bar and no "day 4
 * of 7", because there is no finish line and nobody prescribed one — showing a
 * completion ring on a multivitamin would invent a goal the patient never set.
 * What it does show is the thing that matters about it: that it is on the list,
 * and whether the app is nudging about it.
 */
function SelfCareCard({
  course,
  busy,
  onReportSideEffect,
  onStop,
}: {
  course: SelfCareCourse;
  busy: boolean;
  onReportSideEffect: (courseId: string | null) => void;
  onStop: (courseId: string) => void;
}): ReactNode {
  return (
    <div className="card" style={{ borderRadius: 20 }}>
      <div className="row" style={{ gap: 14 }}>
        <PillIcon tone={glyphFor(course.medicationForm)} size={46} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: '900 18px/1.2 var(--font)' }}>{course.medicationName}</div>
          {course.purpose && (
            <div style={{ font: '600 14px/1.4 var(--font)', color: 'var(--ink-soft)' }}>
              {course.purpose}
            </div>
          )}
        </div>
        <span className="pill pill--grey">{course.kindLabel}</span>
      </div>

      <div style={{ font: '700 14.5px/1.4 var(--font)', marginTop: 12 }}>
        {course.instructionLine}
      </div>

      <div
        style={{
          font: '600 13.5px/1.45 var(--font)',
          color: 'var(--ink-soft)',
          marginTop: 6,
        }}
      >
        {[
          course.startedLabel,
          course.reminded ? "I'll remind you" : 'No reminders — just on the list',
          course.unitsRemaining !== null ? `${course.unitsRemaining} left` : null,
          course.conditionName ? `For your ${course.conditionName.toLowerCase()}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>

      {course.sideEffectNote && (
        <div style={{ font: '700 13.5px/1.4 var(--font)', color: 'var(--amber-ink)', marginTop: 8 }}>
          {course.sideEffectNote}
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 12 }}>
        <button
          className="btn btn--ghost"
          disabled={busy}
          onClick={() => onReportSideEffect(course.courseId)}
        >
          It's not agreeing with me
        </button>
        {/*
          Stopping is the patient's to do, with no ceremony and no warning —
          this is theirs, not a course of treatment somebody prescribed.
        */}
        <button className="btn btn--ghost" disabled={busy} onClick={() => onStop(course.courseId)}>
          I've stopped taking it
        </button>
      </div>
    </div>
  );
}
