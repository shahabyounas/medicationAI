import { useState, type ReactNode } from 'react';
import {
  COMMON_SIDE_EFFECTS,
  SIDE_EFFECT_SEVERITY_LABELS,
  type MedicinesResponse,
  type ReportSideEffectRequest,
  type ReportSideEffectResponse,
  type SideEffectSeverity,
} from '@medication-ai/shared';

/**
 * "Something's wrong."
 *
 * The flow that was missing, and the one that changes how the agent behaves.
 * Its whole job is to separate the two reasons people stop taking a medicine,
 * because the right response to each is the opposite of the other: somebody who
 * feels better should be nudged to finish, and somebody the medicine is making
 * ill should be left alone and handed a phone number.
 *
 * Three decisions, one per screen, in the order a person actually has them:
 * which medicine, what is happening, and how bad is it. Nothing is asked that
 * the app could work out, and the free-text box is last rather than first — the
 * common words are offered as buttons because typing on a phone is the thing
 * that stops a report being made at all.
 *
 * What it must not do is any of the deciding. It does not ask whether to stop
 * taking it, because that is not the patient's question to answer alone and
 * certainly not the app's. It records, it stands down, and it says who to ring.
 */
export function SideEffectScreen({
  medicines,
  preselectedCourseId,
  patientId,
  busy,
  onSubmit,
  onCancel,
}: {
  medicines: MedicinesResponse;
  preselectedCourseId?: string | null;
  patientId: string;
  busy: boolean;
  onSubmit: (request: ReportSideEffectRequest) => void;
  onCancel: () => void;
}): ReactNode {
  /** Everything the patient is currently taking, prescribed or not. */
  const options = [
    ...medicines.active.flatMap((condition) =>
      condition.courses
        .filter((course) => course.status === 'active')
        .map((course) => ({
          courseId: course._id,
          name: course.medicationName,
          detail: condition.name,
        })),
    ),
    ...medicines.selfCare.map((course) => ({
      courseId: course.courseId,
      name: course.medicationName,
      detail: course.kindLabel,
    })),
  ];

  const [step, setStep] = useState<1 | 2 | 3>(preselectedCourseId ? 2 : 1);
  const [courseId, setCourseId] = useState<string | null>(preselectedCourseId ?? null);
  const [symptom, setSymptom] = useState('');
  const [other, setOther] = useState('');
  const [severity, setSeverity] = useState<SideEffectSeverity | null>(null);
  const [stoppedTaking, setStoppedTaking] = useState(false);
  const [startedDaysAgo, setStartedDaysAgo] = useState(0);
  const [notes, setNotes] = useState('');

  const chosen = options.find((option) => option.courseId === courseId);
  const finalSymptom = (symptom === 'other' ? other : symptom).trim();

  const submit = (): void => {
    if (!severity || finalSymptom.length === 0) return;
    const startedAt = new Date();
    startedAt.setDate(startedAt.getDate() - startedDaysAgo);

    onSubmit({
      patientId,
      courseId,
      ...(courseId ? {} : { medicationName: finalSymptom ? 'Not sure which' : undefined }),
      symptom: finalSymptom,
      severity,
      startedAt,
      stoppedTaking,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    } as ReportSideEffectRequest);
  };

  return (
    <div className="overlay">
      <button
        className="back"
        onClick={() => (step === 1 || preselectedCourseId ? onCancel() : setStep((s) => (s - 1) as 1 | 2))}
        disabled={busy}
      >
        ← {step === 1 || preselectedCourseId ? 'Cancel' : 'Back'}
      </button>

      <div className="scroll" style={{ flex: 1 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Step {step} of 3
        </div>

        {step === 1 && (
          <>
            <h1 className="h1">Which one is bothering you?</h1>
            <p className="sub" style={{ marginBottom: 18 }}>
              Pick the medicine you think is causing it. If you are not sure, say so — it still
              goes on your record.
            </p>

            <div style={{ display: 'grid', gap: 10 }}>
              {options.map((option) => (
                <button
                  key={option.courseId}
                  className={`choice${courseId === option.courseId ? ' choice--selected' : ''}`}
                  onClick={() => {
                    setCourseId(option.courseId);
                    setStep(2);
                  }}
                >
                  <span className="choice-mark">✓</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', font: '800 17px/1.3 var(--font)' }}>
                      {option.name}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        font: '600 14px/1.35 var(--font)',
                        color: 'var(--ink-soft)',
                      }}
                    >
                      {option.detail}
                    </span>
                  </span>
                </button>
              ))}

              <button
                className="choice"
                onClick={() => {
                  setCourseId(null);
                  setStep(2);
                }}
              >
                <span className="choice-mark">✓</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', font: '800 17px/1.3 var(--font)' }}>
                    I'm not sure which
                  </span>
                  <span
                    style={{
                      display: 'block',
                      font: '600 14px/1.35 var(--font)',
                      color: 'var(--ink-soft)',
                    }}
                  >
                    I'll write down what is happening
                  </span>
                </span>
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="h1">What's happening?</h1>
            <p className="sub" style={{ marginBottom: 18 }}>
              {chosen ? `Since you started ${chosen.name}.` : 'In your own words.'}
            </p>

            <div className="chips">
              {COMMON_SIDE_EFFECTS.map((option) => (
                <button
                  key={option}
                  className={`chip${symptom === option ? ' chip--on' : ''}`}
                  onClick={() => setSymptom(option)}
                >
                  {option}
                </button>
              ))}
              <button
                className={`chip${symptom === 'other' ? ' chip--on' : ''}`}
                onClick={() => setSymptom('other')}
              >
                Something else
              </button>
            </div>

            {symptom === 'other' && (
              <label className="field" style={{ marginTop: 14 }}>
                <span className="field-label">In your own words</span>
                <input
                  className="input"
                  value={other}
                  onChange={(event) => setOther(event.target.value)}
                  placeholder="What is it doing to you?"
                  maxLength={200}
                  autoFocus
                />
              </label>
            )}

            <label className="field" style={{ marginTop: 16 }}>
              <span className="field-label">When did it start?</span>
              <select
                className="select"
                value={startedDaysAgo}
                onChange={(event) => setStartedDaysAgo(Number(event.target.value))}
              >
                <option value={0}>Today</option>
                <option value={1}>Yesterday</option>
                <option value={2}>2 days ago</option>
                <option value={3}>3 days ago</option>
                <option value={7}>About a week ago</option>
                <option value={14}>Longer than that</option>
              </select>
            </label>

            <button
              className="btn btn--primary"
              style={{ marginTop: 20 }}
              disabled={finalSymptom.length === 0}
              onClick={() => setStep(3)}
            >
              Next
            </button>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="h1">How bad is it?</h1>
            <p className="sub" style={{ marginBottom: 18 }}>
              This decides what I do next. I will not tell you whether to stop taking it — that is
              your doctor's to say — but I will stop pestering you about it.
            </p>

            <div style={{ display: 'grid', gap: 10 }}>
              {(['mild', 'moderate', 'severe'] as const).map((level) => (
                <button
                  key={level}
                  className={`choice${severity === level ? ' choice--selected' : ''}`}
                  onClick={() => setSeverity(level)}
                >
                  <span className="choice-mark">✓</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', font: '800 17px/1.3 var(--font)' }}>
                      {SIDE_EFFECT_SEVERITY_LABELS[level]}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        font: '600 14px/1.35 var(--font)',
                        color: 'var(--ink-soft)',
                      }}
                    >
                    {level === 'mild'
                      ? "I'll note it and keep reminding you"
                      : level === 'moderate'
                        ? "I'll stop the reminders and give you the number to ring"
                        : "I'll stop everything and tell you who to ring now"}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <label className="check" style={{ marginTop: 18 }}>
              <input
                type="checkbox"
                checked={stoppedTaking}
                onChange={(event) => setStoppedTaking(event.target.checked)}
              />
              <span>I have already stopped taking it</span>
            </label>

            <label className="field" style={{ marginTop: 16 }}>
              <span className="field-label">Anything else worth writing down?</span>
              <textarea
                className="textarea"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="When it comes on, how long it lasts…"
                maxLength={1000}
              />
            </label>

            <button
              className="btn btn--primary"
              style={{ marginTop: 20 }}
              disabled={busy || severity === null}
              onClick={submit}
            >
              {busy ? 'Saving…' : 'Tell my agent'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * What the agent says back.
 *
 * Fixed copy from `messages.ts` — the agent composes no clinical sentence at
 * runtime, so it cannot invent advice even in principle. The call button is the
 * point of the screen: the next move belongs to a person, and making the
 * patient go and find the surgery's number is how that does not happen.
 */
export function SideEffectReplyScreen({
  reply,
  onClose,
}: {
  reply: ReportSideEffectResponse;
  onClose: () => void;
}): ReactNode {
  const urgent = reply.chasingPaused;

  return (
    <div className="overlay">
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            background: urgent ? 'var(--amber-bg)' : 'var(--green-bg)',
            color: urgent ? 'var(--amber-ink)' : 'var(--green)',
            font: '900 32px/72px var(--font)',
            textAlign: 'center',
            marginBottom: 22,
          }}
          aria-hidden="true"
        >
          {urgent ? '!' : '✓'}
        </div>

        <h1 className="h1" style={{ marginBottom: 12 }}>
          {reply.headline}
        </h1>
        <p style={{ font: '600 17.5px/1.5 var(--font)', color: 'var(--ink-soft)' }}>{reply.body}</p>

        {reply.chasingPaused && reply.dosesCancelled > 0 && (
          <div className="banner banner--info" style={{ marginTop: 18 }}>
            I have stopped chasing the {reply.dosesCancelled}{' '}
            {reply.dosesCancelled === 1 ? 'dose' : 'doses'} still outstanding. They are still on
            your record as owed, so nothing is lost if you are told to carry on.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {reply.action && reply.doctorPhone && (
          <a
            className="btn btn--primary"
            style={{ height: 68, fontSize: 19, display: 'grid', placeItems: 'center' }}
            href={`tel:${reply.doctorPhone.replace(/\s/g, '')}`}
          >
            {reply.action}
          </a>
        )}
        <button className="btn btn--ghost" onClick={onClose}>
          Back to my record
        </button>
      </div>
    </div>
  );
}
