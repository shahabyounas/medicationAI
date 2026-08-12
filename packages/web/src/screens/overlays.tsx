import type { ReactNode } from 'react';
import {
  VISIT_TYPE_LABELS,
  type CourseReport,
  type DoseView,
  type PrescriptionDetail,
  type VisitDetail,
} from '@medication-ai/shared';
import { AgentMark, PillIcon, glyphFor } from '../components/common.js';
import { formatDate } from './VisitsScreen.js';

/**
 * The full-screen steps.
 *
 * Each one is a single decision with large targets and no gestures — the design
 * rules out swipe-only actions and bottom sheets, because they are invisible
 * affordances to someone who has never been taught them.
 */

/** Taking a dose: took it / later / skip. */
export function DoseOverlay({
  dose,
  busy,
  onTake,
  onSnooze,
  onSkip,
  onClose,
}: {
  dose: DoseView;
  busy: boolean;
  onTake: () => void;
  onSnooze: () => void;
  onSkip: () => void;
  onClose: () => void;
}): ReactNode {
  return (
    <div className="overlay overlay--dark">
      <button className="back back--onDark" onClick={onClose} disabled={busy}>
        ← Back
      </button>

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          gap: 20,
        }}
      >
        <PillIcon tone={glyphFor(dose.medicationForm)} size={132} />
        <div>
          <div style={{ font: '900 34px/1.12 var(--font)' }}>{dose.medicationName}</div>
          <div style={{ font: '600 20px/1.4 var(--font)', color: '#A9B3AC', marginTop: 6 }}>
            Take {dose.amount} tablet
          </div>
          <div style={{ font: '600 17px/1.4 var(--font)', color: 'var(--amber)', marginTop: 12 }}>
            Dose {dose.doseNumber} · {dose.clockTime}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button
          className="btn btn--primary"
          style={{ height: 76, fontSize: 23 }}
          onClick={onTake}
          disabled={busy}
        >
          I took it ✓
        </button>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn--onDark" onClick={onSnooze} disabled={busy}>
            Remind in 30 min
          </button>
          <button
            className="btn btn--onDark"
            style={{ flex: 'none', width: 104, color: '#8B948D' }}
            onClick={onSkip}
            disabled={busy}
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

/** The green confirmation. Short, warm, and it says how many are left. */
export function TakenOverlay({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}): ReactNode {
  return (
    <div className="overlay overlay--green">
      <div
        style={{
          width: 118,
          height: 118,
          borderRadius: 59,
          background: '#fff',
          color: 'var(--green)',
          font: '900 58px/118px var(--font)',
          animation: 'pop .45s ease-out both',
        }}
      >
        ✓
      </div>
      <div style={{ font: '900 34px/1.15 var(--font)' }}>Well done</div>
      <div style={{ font: '600 19px/1.45 var(--font)', color: '#C6E5D8', maxWidth: 290 }}>
        {message}
      </div>
      <button className="btn btn--white" style={{ marginTop: 8 }} onClick={onClose}>
        OK
      </button>
    </div>
  );
}

/**
 * The agent's read-back, and the one question it cannot infer.
 *
 * Two jobs on one screen. First it restates the prescription in plain words so
 * a mistake is caught before anything is scheduled. Then it asks whether the
 * medicine is actually in the house — because the course has to start when the
 * tablets are on the shelf, not when the doctor wrote the note.
 */
export function ReadBackOverlay({
  detail,
  busy,
  onStart,
  onNotYet,
}: {
  detail: PrescriptionDetail;
  busy: boolean;
  onStart: () => void;
  onNotYet: () => void;
}): ReactNode {
  return (
    <div className="overlay overlay--light">
      <div className="row" style={{ gap: 12, marginBottom: 6 }}>
        <AgentMark size={40} />
        <h2 className="h1">Here's what I read</h2>
      </div>
      <p className="sub" style={{ marginBottom: 18 }}>
        <strong style={{ color: 'var(--ink)' }}>{detail.doctorName}</strong> ·{' '}
        {formatDate(detail.issuedAt)}
        {detail.conditionName ? ` · for ${detail.conditionName.toLowerCase()}` : ''}
      </p>

      <div style={{ flex: 1 }} className="stack">
        {detail.readBack.map((line) => (
          <div className="card" key={line.medicationName} style={{ borderRadius: 20 }}>
            <div style={{ font: '900 20px/1.2 var(--font)' }}>{line.medicationName}</div>
            <div
              style={{ font: '600 15.5px/1.45 var(--font)', color: 'var(--ink-soft)', marginTop: 5 }}
            >
              {line.instruction}
            </div>
            <div style={{ font: '800 14px/1.35 var(--font)', color: 'var(--green)', marginTop: 11 }}>
              {line.plan}
            </div>
          </div>
        ))}

        {detail.spacingNote && (
          <div className="card card--amber" style={{ borderRadius: 20 }}>
            <div style={{ font: '700 15px/1.5 var(--font)', color: 'var(--amber-ink)' }}>
              {detail.spacingNote}
            </div>
          </div>
        )}

        <div className="card card--dark" style={{ borderRadius: 20, marginTop: 8 }}>
          <div style={{ font: '900 19px/1.3 var(--font)' }}>Do you have the medicine at home?</div>
          <div style={{ font: '600 15.5px/1.5 var(--font)', color: '#A9B3AC', marginTop: 6 }}>
            Reminders start only once you have it.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20 }} className="stack">
        <button className="btn btn--primary" onClick={onStart} disabled={busy}>
          {busy ? 'Planning your doses…' : 'Yes, I have it'}
        </button>
        <button className="btn btn--ghost" onClick={onNotYet} disabled={busy}>
          Not yet — remind me to buy it
        </button>
      </div>
    </div>
  );
}

/** A visit in full — what was said, and what came of it. */
export function VisitOverlay({
  visit,
  onClose,
}: {
  visit: VisitDetail;
  onClose: () => void;
}): ReactNode {
  const vitals = visit.vitals;
  const hasVitals =
    vitals &&
    (vitals.bloodPressure || vitals.temperatureC || vitals.pulseBpm || vitals.weightKg);

  return (
    <div className="overlay overlay--light">
      <button className="back" onClick={onClose}>
        ← Your record
      </button>

      <h2 className="h1" style={{ marginTop: 12 }}>
        {visit.doctorName}
      </h2>
      <p className="sub">
        {formatDate(visit.visitDate)} · {visit.doctorSpecialty}
        <br />
        {visit.clinicName}
      </p>

      <div style={{ marginTop: 18 }} className="stack">
        <div className="card" style={{ borderRadius: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            {VISIT_TYPE_LABELS[visit.type]}
          </div>
          <div style={{ font: '700 16px/1.5 var(--font)' }}>{visit.reason}</div>
          {visit.diagnosis && (
            <div
              style={{
                font: '600 15.5px/1.5 var(--font)',
                color: 'var(--ink-soft)',
                marginTop: 10,
                paddingTop: 10,
                borderTop: '1px solid var(--card-border)',
              }}
            >
              <strong style={{ color: 'var(--ink)' }}>Diagnosis:</strong> {visit.diagnosis}
            </div>
          )}
        </div>

        {visit.medicationNames.length > 0 && (
          <div className="card" style={{ borderRadius: 20 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              Prescribed at this visit
            </div>
            {/*
              A neutral marker rather than a pill glyph: a historic visit
              records the medicine's name, not its dosage form, and drawing a
              guessed shape here would misinform.
            */}
            {visit.medicationNames.map((name) => (
              <div key={name} className="row" style={{ gap: 12, marginTop: 8 }}>
                <span className="dot dot--green">℞</span>
                <span style={{ font: '800 16px/1.3 var(--font)' }}>{name}</span>
              </div>
            ))}
          </div>
        )}

        {hasVitals && (
          <div className="card" style={{ borderRadius: 20 }}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>
              Recorded that day
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
              {vitals.bloodPressure && <Vital label="Blood pressure" value={vitals.bloodPressure} />}
              {vitals.temperatureC !== undefined && (
                <Vital label="Temperature" value={`${vitals.temperatureC}°C`} />
              )}
              {vitals.pulseBpm !== undefined && <Vital label="Pulse" value={`${vitals.pulseBpm}`} />}
              {vitals.weightKg !== undefined && (
                <Vital label="Weight" value={`${vitals.weightKg} kg`} />
              )}
            </div>
          </div>
        )}

        {visit.notes && (
          <div className="card" style={{ borderRadius: 20 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              The doctor's notes
            </div>
            <div style={{ font: '600 15.5px/1.55 var(--font)', color: 'var(--ink-soft)' }}>
              {visit.notes}
            </div>
          </div>
        )}

        {visit.followUpDate && (
          <div className="card card--amber" style={{ borderRadius: 20 }}>
            <div style={{ font: '900 16px/1.3 var(--font)', color: 'var(--amber-ink)' }}>
              Follow-up booked
            </div>
            <div style={{ font: '600 15px/1.45 var(--font)', color: 'var(--amber-soft)', marginTop: 4 }}>
              {formatDate(visit.followUpDate)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Vital({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div>
      <div style={{ font: '900 20px/1.1 var(--font)' }}>{value}</div>
      <div style={{ font: '600 13px/1.35 var(--font)', color: 'var(--ink-soft)' }}>{label}</div>
    </div>
  );
}

/** The end-of-course report. */
export function ReportOverlay({
  report,
  onClose,
}: {
  report: CourseReport;
  onClose: () => void;
}): ReactNode {
  return (
    <div className="overlay overlay--light">
      <button className="back" onClick={onClose}>
        ← Back
      </button>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 12,
          marginTop: 18,
        }}
      >
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: 44,
            background: report.completedInFull ? 'var(--green)' : 'var(--amber)',
            color: '#fff',
            font: '900 44px/88px var(--font)',
          }}
        >
          {report.completedInFull ? '✓' : '!'}
        </div>
        <div style={{ font: '900 28px/1.15 var(--font)' }}>
          {report.completedInFull ? 'Course completed' : 'Course in progress'}
        </div>
        <div style={{ font: '600 16.5px/1.45 var(--font)', color: 'var(--ink-soft)' }}>
          {report.conditionName}
          {report.doctorName ? ` · ${report.doctorName}` : ''}
        </div>
      </div>

      <div style={{ marginTop: 20 }} className="stack">
        <div className="card" style={{ borderRadius: 20, display: 'flex', gap: 14 }}>
          <BigStat
            value={`${report.takenCount}/${report.totalDoses}`}
            label="doses taken"
            tone="green"
          />
          <BigStat value={String(report.lateCount)} label="taken late" />
          <BigStat
            value={String(report.familyInterventions)}
            label={report.familyInterventions === 1 ? 'time family helped' : 'times family helped'}
          />
        </div>

        <div className="card" style={{ borderRadius: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            Saved to your record
          </div>
          <div style={{ font: '600 15.5px/1.55 var(--font)' }}>{report.summaryLine}</div>
        </div>

        <div className="card card--dark" style={{ borderRadius: 20 }}>
          <div
            className="eyebrow"
            style={{ color: 'var(--mint)', marginBottom: 9 }}
          >
            What happens now
          </div>
          <div style={{ font: '600 15.5px/1.5 var(--font)' }}>
            {report.completedInFull
              ? "I'll check on you in 10 days. If it comes back, tell me and I'll have this record ready for your doctor."
              : `${report.missedCount} ${report.missedCount === 1 ? 'dose has' : 'doses have'} been missed. I'll keep going until the course is finished.`}
          </div>
        </div>
      </div>

      <button className="btn btn--primary" style={{ marginTop: 16 }} onClick={onClose}>
        Done
      </button>
    </div>
  );
}

function BigStat({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone?: 'green';
}): ReactNode {
  return (
    <div style={{ flex: 1 }}>
      <div
        style={{
          font: '900 26px/1.1 var(--font)',
          color: tone === 'green' ? 'var(--green)' : 'var(--ink)',
        }}
      >
        {value}
      </div>
      <div style={{ font: '600 13px/1.35 var(--font)', color: 'var(--ink-soft)', marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}
