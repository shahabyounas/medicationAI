import type { ReactNode } from 'react';
import type { ConditionSummary, MedicinesResponse } from '@medication-ai/shared';
import { PillIcon, glyphFor } from '../components/common.js';

/**
 * Every medicine, grouped under the condition it treats.
 *
 * Grouping by condition rather than listing tablets is the whole point: it
 * answers "what is this one for?" without the patient having to remember, and
 * it puts a course that was abandoned right next to the illness that came back.
 */
export function MedicinesScreen({
  medicines,
  onOpenCondition,
  onAddPrescription,
}: {
  medicines: MedicinesResponse;
  onOpenCondition: (conditionId: string) => void;
  onAddPrescription: () => void;
}): ReactNode {
  const nothing = medicines.active.length === 0 && medicines.finished.length === 0;

  return (
    <div className="pad">
      <h1 className="h1">My medicines</h1>
      <p className="sub" style={{ marginBottom: 20 }}>
        Everything you take, and what it's for.
      </p>

      <button className="btn btn--primary" style={{ marginBottom: 26 }} onClick={onAddPrescription}>
        + Add a prescription
      </button>

      {nothing && (
        <p className="sub">
          Nothing recorded yet. Add the prescription your doctor gave you to get started.
        </p>
      )}

      {medicines.active.map((condition) => (
        <ActiveCondition key={condition._id} condition={condition} onOpen={onOpenCondition} />
      ))}

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
    </div>
  );
}

function ActiveCondition({
  condition,
  onOpen,
}: {
  condition: ConditionSummary;
  onOpen: (id: string) => void;
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
