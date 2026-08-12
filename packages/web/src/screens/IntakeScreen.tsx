import { useMemo, useState, type ReactNode } from 'react';
import {
  MEDICATION_FORM_LABELS,
  SPECIALTY_LABELS,
  VISIT_TYPE_LABELS,
  type DoctorSpecialty,
  type FoodRule,
  type IntakeItem,
  type IntakeOptionsResponse,
  type IntakeRequest,
  type MedicationForm,
  type VisitType,
} from '@medication-ai/shared';

/**
 * Adding a prescription — the way anything gets into the app.
 *
 * Four steps, one decision per screen, because the alternative is a single long
 * form that a seventy-year-old abandons halfway. The order follows the physical
 * act: who you saw, what they said, what they gave you, then check it.
 *
 * The doctor step is the one with a rule behind it. Picking someone already on
 * the record adds a visit to them rather than creating a second copy, which is
 * what makes "Dr. Iqbal has treated you for two things" possible at all.
 */

type Step = 'doctor' | 'visit' | 'medicines' | 'review';

const STEPS: Step[] = ['doctor', 'visit', 'medicines', 'review'];

const STEP_TITLES: Record<Step, string> = {
  doctor: 'Who did you see?',
  visit: 'What did they say?',
  medicines: 'What did they give you?',
  review: 'Is this right?',
};

interface NewDoctorForm {
  name: string;
  specialty: DoctorSpecialty;
  clinicName: string;
  clinicPhone: string;
}

interface MedicineForm {
  key: string;
  existingId: string | null;
  name: string;
  strength: string;
  form: MedicationForm;
  purpose: string;
  amountPerDose: number;
  timesPerDay: number;
  foodRule: FoodRule;
  /** Empty string means open-ended. */
  durationDays: string;
}

function blankMedicine(): MedicineForm {
  return {
    key: Math.random().toString(36).slice(2),
    existingId: null,
    name: '',
    strength: '',
    form: 'tablet',
    purpose: '',
    amountPerDose: 1,
    timesPerDay: 3,
    foodRule: 'after_food',
    durationDays: '7',
  };
}

function todayAsInputValue(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function IntakeScreen({
  options,
  patientId,
  busy,
  onCancel,
  onSubmit,
}: {
  options: IntakeOptionsResponse;
  patientId: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (request: IntakeRequest) => void;
}): ReactNode {
  const [step, setStep] = useState<Step>('doctor');

  // Doctor
  const [doctorId, setDoctorId] = useState<string | null>(options.doctors[0]?.id ?? null);
  const [addingDoctor, setAddingDoctor] = useState(options.doctors.length === 0);
  const [newDoctor, setNewDoctor] = useState<NewDoctorForm>({
    name: '',
    specialty: 'general_practice',
    clinicName: '',
    clinicPhone: '',
  });

  // Visit
  const [visitDate, setVisitDate] = useState(todayAsInputValue());
  const [visitType, setVisitType] = useState<VisitType>('consultation');
  const [reason, setReason] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [notes, setNotes] = useState('');
  const [followUp, setFollowUp] = useState('');

  // Condition
  const [conditionChoice, setConditionChoice] = useState<string>('new');

  // Medicines
  const [medicines, setMedicines] = useState<MedicineForm[]>([blankMedicine()]);

  const [problem, setProblem] = useState<string | null>(null);

  const doctorLabel = useMemo(() => {
    if (addingDoctor) return newDoctor.name || 'New doctor';
    return options.doctors.find((d) => d.id === doctorId)?.name ?? '—';
  }, [addingDoctor, newDoctor.name, doctorId, options.doctors]);

  const conditionLabel = useMemo(() => {
    if (conditionChoice === 'none') return null;
    if (conditionChoice === 'new') return diagnosis.trim() || null;
    return options.conditions.find((c) => c.id === conditionChoice)?.name ?? null;
  }, [conditionChoice, diagnosis, options.conditions]);

  function validate(target: Step): string | null {
    if (target === 'doctor') {
      if (addingDoctor) {
        if (!newDoctor.name.trim()) return "Enter the doctor's name.";
        if (!newDoctor.clinicName.trim()) return 'Enter the surgery or clinic name.';
      } else if (!doctorId) {
        return 'Choose a doctor, or add a new one.';
      }
    }
    if (target === 'visit') {
      if (!visitDate) return 'Enter the date of the visit.';
      if (!reason.trim()) return 'Say briefly what you went in for.';
      if (conditionChoice === 'new' && !diagnosis.trim()) {
        return 'Enter the diagnosis, or choose an existing condition.';
      }
    }
    if (target === 'medicines') {
      if (medicines.length === 0) return 'Add at least one medicine.';
      for (const medicine of medicines) {
        if (!medicine.existingId && !medicine.name.trim()) return 'Every medicine needs a name.';
        if (medicine.durationDays !== '') {
          const days = Number(medicine.durationDays);
          if (!Number.isInteger(days) || days < 1 || days > 365) {
            return 'Days must be a whole number between 1 and 365, or blank for ongoing.';
          }
        }
      }
    }
    return null;
  }

  function goNext(): void {
    const issue = validate(step);
    if (issue) {
      setProblem(issue);
      return;
    }
    setProblem(null);
    const index = STEPS.indexOf(step);
    const next = STEPS[index + 1];
    if (next) setStep(next);
  }

  function goBack(): void {
    setProblem(null);
    const index = STEPS.indexOf(step);
    if (index === 0) {
      onCancel();
      return;
    }
    const previous = STEPS[index - 1];
    if (previous) setStep(previous);
  }

  function buildRequest(): IntakeRequest {
    return {
      patientId,
      doctor: addingDoctor
        ? {
            create: {
              name: newDoctor.name.trim(),
              specialty: newDoctor.specialty,
              clinicName: newDoctor.clinicName.trim(),
              ...(newDoctor.clinicPhone.trim() ? { clinicPhone: newDoctor.clinicPhone.trim() } : {}),
            },
          }
        : { existingId: doctorId ?? undefined },
      visit: {
        // A date input gives a local calendar day; midday avoids it sliding
        // into the previous day for anyone west of UTC.
        visitDate: new Date(`${visitDate}T12:00:00`),
        type: visitType,
        reason: reason.trim(),
        ...(diagnosis.trim() ? { diagnosis: diagnosis.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        followUpDate: followUp ? new Date(`${followUp}T12:00:00`) : null,
      },
      condition:
        conditionChoice === 'none'
          ? null
          : conditionChoice === 'new'
            ? { create: { name: diagnosis.trim(), isChronic: false } }
            : { existingId: conditionChoice },
      items: medicines.map(
        (medicine): IntakeItem => ({
          medication: medicine.existingId
            ? { existingId: medicine.existingId }
            : {
                create: {
                  name: medicine.name.trim(),
                  ...(medicine.strength.trim() ? { strength: medicine.strength.trim() } : {}),
                  form: medicine.form,
                  ...(medicine.purpose.trim() ? { purpose: medicine.purpose.trim() } : {}),
                },
              },
          amountPerDose: medicine.amountPerDose,
          timesPerDay: medicine.timesPerDay,
          foodRule: medicine.foodRule,
          durationDays: medicine.durationDays === '' ? null : Number(medicine.durationDays),
        }),
      ),
      source: 'manual',
    };
  }

  function submit(): void {
    for (const target of STEPS) {
      const issue = validate(target);
      if (issue) {
        setProblem(issue);
        setStep(target);
        return;
      }
    }
    setProblem(null);
    onSubmit(buildRequest());
  }

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="overlay overlay--light">
      <button className="back" onClick={goBack} disabled={busy}>
        {stepIndex === 0 ? '← Cancel' : '← Back'}
      </button>

      <div className="steps" aria-hidden="true">
        {STEPS.map((each, index) => (
          <span
            key={each}
            className={`step-pip ${
              index < stepIndex ? 'step-pip--done' : index === stepIndex ? 'step-pip--current' : ''
            }`}
          />
        ))}
      </div>

      <h2 className="h1">{STEP_TITLES[step]}</h2>
      <p className="sub" style={{ marginBottom: 22 }}>
        Step {stepIndex + 1} of {STEPS.length}
      </p>

      {problem && (
        <div className="banner banner--error" style={{ marginBottom: 18 }}>
          {problem}
        </div>
      )}

      <div style={{ flex: 1 }}>
        {step === 'doctor' && (
          <DoctorStep
            options={options}
            doctorId={doctorId}
            setDoctorId={setDoctorId}
            addingDoctor={addingDoctor}
            setAddingDoctor={setAddingDoctor}
            newDoctor={newDoctor}
            setNewDoctor={setNewDoctor}
          />
        )}

        {step === 'visit' && (
          <VisitStep
            options={options}
            visitDate={visitDate}
            setVisitDate={setVisitDate}
            visitType={visitType}
            setVisitType={setVisitType}
            reason={reason}
            setReason={setReason}
            diagnosis={diagnosis}
            setDiagnosis={setDiagnosis}
            notes={notes}
            setNotes={setNotes}
            followUp={followUp}
            setFollowUp={setFollowUp}
            conditionChoice={conditionChoice}
            setConditionChoice={setConditionChoice}
          />
        )}

        {step === 'medicines' && (
          <MedicinesStep
            options={options}
            medicines={medicines}
            setMedicines={setMedicines}
          />
        )}

        {step === 'review' && (
          <ReviewStep
            doctorLabel={doctorLabel}
            isNewDoctor={addingDoctor}
            visitDate={visitDate}
            visitType={visitType}
            reason={reason}
            conditionLabel={conditionLabel}
            medicines={medicines}
          />
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        {step === 'review' ? (
          <button className="btn btn--primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Save and plan the doses'}
          </button>
        ) : (
          <button className="btn btn--primary" onClick={goNext} disabled={busy}>
            Continue
          </button>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function DoctorStep({
  options,
  doctorId,
  setDoctorId,
  addingDoctor,
  setAddingDoctor,
  newDoctor,
  setNewDoctor,
}: {
  options: IntakeOptionsResponse;
  doctorId: string | null;
  setDoctorId: (id: string) => void;
  addingDoctor: boolean;
  setAddingDoctor: (value: boolean) => void;
  newDoctor: NewDoctorForm;
  setNewDoctor: (value: NewDoctorForm) => void;
}): ReactNode {
  return (
    <>
      {options.doctors.length > 0 && (
        <>
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            Someone you've seen before
          </div>
          {options.doctors.map((doctor) => (
            <button
              key={doctor.id}
              className={`choice${!addingDoctor && doctorId === doctor.id ? ' choice--selected' : ''}`}
              onClick={() => {
                setAddingDoctor(false);
                setDoctorId(doctor.id);
              }}
            >
              <span className="choice-mark">✓</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', font: '900 17px/1.25 var(--font)' }}>
                  {doctor.name}
                </span>
                <span
                  style={{
                    display: 'block',
                    font: '600 14px/1.4 var(--font)',
                    color: 'var(--ink-soft)',
                  }}
                >
                  {doctor.specialty} · {doctor.clinicName}
                  {doctor.visitCount > 0
                    ? ` · ${doctor.visitCount} ${doctor.visitCount === 1 ? 'visit' : 'visits'}`
                    : ''}
                </span>
              </span>
            </button>
          ))}
        </>
      )}

      <button
        className={`choice${addingDoctor ? ' choice--selected' : ''}`}
        style={{ marginTop: options.doctors.length > 0 ? 14 : 0 }}
        onClick={() => setAddingDoctor(true)}
      >
        <span className="choice-mark">✓</span>
        <span style={{ font: '900 17px/1.25 var(--font)' }}>
          {options.doctors.length > 0 ? 'Someone new' : 'Add the doctor'}
        </span>
      </button>

      {addingDoctor && (
        <div className="card" style={{ marginTop: 14 }}>
          <label className="field">
            <span className="field-label">Doctor's name</span>
            <input
              className="input"
              value={newDoctor.name}
              placeholder="Dr. Farhan Iqbal"
              onChange={(e) => setNewDoctor({ ...newDoctor, name: e.target.value })}
            />
          </label>

          <label className="field">
            <span className="field-label">Surgery or clinic</span>
            <input
              className="input"
              value={newDoctor.clinicName}
              placeholder="Ashworth Road Surgery"
              onChange={(e) => setNewDoctor({ ...newDoctor, clinicName: e.target.value })}
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span className="field-label">What they treat</span>
              <select
                className="select"
                value={newDoctor.specialty}
                onChange={(e) =>
                  setNewDoctor({ ...newDoctor, specialty: e.target.value as DoctorSpecialty })
                }
              >
                {Object.entries(SPECIALTY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">Phone (optional)</span>
              <input
                className="input"
                inputMode="tel"
                value={newDoctor.clinicPhone}
                placeholder="0161 296 0100"
                onChange={(e) => setNewDoctor({ ...newDoctor, clinicPhone: e.target.value })}
              />
            </label>
          </div>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function VisitStep(props: {
  options: IntakeOptionsResponse;
  visitDate: string;
  setVisitDate: (v: string) => void;
  visitType: VisitType;
  setVisitType: (v: VisitType) => void;
  reason: string;
  setReason: (v: string) => void;
  diagnosis: string;
  setDiagnosis: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  followUp: string;
  setFollowUp: (v: string) => void;
  conditionChoice: string;
  setConditionChoice: (v: string) => void;
}): ReactNode {
  return (
    <>
      <div className="field-row">
        <label className="field">
          <span className="field-label">Date of the visit</span>
          <input
            className="input"
            type="date"
            value={props.visitDate}
            onChange={(e) => props.setVisitDate(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Kind of visit</span>
          <select
            className="select"
            value={props.visitType}
            onChange={(e) => props.setVisitType(e.target.value as VisitType)}
          >
            {Object.entries(VISIT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span className="field-label">What you went in for</span>
        <input
          className="input"
          value={props.reason}
          placeholder="Cough with green phlegm for a week"
          onChange={(e) => props.setReason(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="field-label">What the doctor said it is</span>
        <input
          className="input"
          value={props.diagnosis}
          placeholder="Chest infection"
          onChange={(e) => props.setDiagnosis(e.target.value)}
        />
        <span className="field-hint">
          Your medicines are grouped under this, so you can see what each one is for.
        </span>
      </label>

      {props.options.conditions.length > 0 && (
        <label className="field">
          <span className="field-label">Group these medicines under</span>
          <select
            className="select"
            value={props.conditionChoice}
            onChange={(e) => props.setConditionChoice(e.target.value)}
          >
            <option value="new">A new condition — the diagnosis above</option>
            {props.options.conditions.map((condition) => (
              <option key={condition.id} value={condition.id}>
                {condition.name} (already being treated)
              </option>
            ))}
            <option value="none">Nothing — this visit produced no course</option>
          </select>
        </label>
      )}

      <label className="field">
        <span className="field-label">The doctor's notes (optional)</span>
        <textarea
          className="textarea"
          value={props.notes}
          placeholder="Crackles at the right base. Finish the whole course."
          onChange={(e) => props.setNotes(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="field-label">Follow-up date (optional)</span>
        <input
          className="input"
          type="date"
          value={props.followUp}
          onChange={(e) => props.setFollowUp(e.target.value)}
        />
      </label>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function MedicinesStep({
  options,
  medicines,
  setMedicines,
}: {
  options: IntakeOptionsResponse;
  medicines: MedicineForm[];
  setMedicines: (value: MedicineForm[]) => void;
}): ReactNode {
  function update(key: string, patch: Partial<MedicineForm>): void {
    setMedicines(medicines.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  }

  return (
    <>
      {medicines.map((medicine, index) => (
        <div className="card" key={medicine.key} style={{ marginBottom: 14 }}>
          <div className="spread" style={{ marginBottom: 14 }}>
            <span className="eyebrow">Medicine {index + 1}</span>
            {medicines.length > 1 && (
              <button
                style={{ font: '800 14px/1 var(--font)', color: 'var(--red)' }}
                onClick={() => setMedicines(medicines.filter((m) => m.key !== medicine.key))}
              >
                Remove
              </button>
            )}
          </div>

          <label className="field">
            <span className="field-label">Medicine</span>
            <select
              className="select"
              value={medicine.existingId ?? 'new'}
              onChange={(e) =>
                update(medicine.key, {
                  existingId: e.target.value === 'new' ? null : e.target.value,
                })
              }
            >
              <option value="new">Type a new one…</option>
              {options.medications.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.strength ? ` ${m.strength}` : ''}
                </option>
              ))}
            </select>
          </label>

          {!medicine.existingId && (
            <>
              <div className="field-row">
                <label className="field">
                  <span className="field-label">Name</span>
                  <input
                    className="input"
                    value={medicine.name}
                    placeholder="Amoxicillin"
                    onChange={(e) => update(medicine.key, { name: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Strength</span>
                  <input
                    className="input"
                    value={medicine.strength}
                    placeholder="500mg"
                    onChange={(e) => update(medicine.key, { strength: e.target.value })}
                  />
                </label>
              </div>

              <div className="field-row">
                <label className="field">
                  <span className="field-label">Form</span>
                  <select
                    className="select"
                    value={medicine.form}
                    onChange={(e) =>
                      update(medicine.key, { form: e.target.value as MedicationForm })
                    }
                  >
                    {Object.keys(MEDICATION_FORM_LABELS).map((form) => (
                      <option key={form} value={form}>
                        {form.charAt(0).toUpperCase() + form.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">What it's for</span>
                  <input
                    className="input"
                    value={medicine.purpose}
                    placeholder="Clears the infection"
                    onChange={(e) => update(medicine.key, { purpose: e.target.value })}
                  />
                </label>
              </div>
            </>
          )}

          <div className="field-row">
            <label className="field">
              <span className="field-label">How many</span>
              <select
                className="select"
                value={medicine.amountPerDose}
                onChange={(e) =>
                  update(medicine.key, { amountPerDose: Number(e.target.value) })
                }
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Times a day</span>
              <select
                className="select"
                value={medicine.timesPerDay}
                onChange={(e) => update(medicine.key, { timesPerDay: Number(e.target.value) })}
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span className="field-label">Food</span>
              <select
                className="select"
                value={medicine.foodRule}
                onChange={(e) => update(medicine.key, { foodRule: e.target.value as FoodRule })}
              >
                <option value="after_food">After food</option>
                <option value="before_food">Before food</option>
                <option value="with_food">With food</option>
                <option value="any">Any time</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">For how many days</span>
              <input
                className="input"
                inputMode="numeric"
                value={medicine.durationDays}
                placeholder="7"
                onChange={(e) =>
                  update(medicine.key, { durationDays: e.target.value.replace(/\D/g, '') })
                }
              />
              <span className="field-hint">Leave blank for a long-term medicine.</span>
            </label>
          </div>

          <div
            style={{
              marginTop: 4,
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--green-bg)',
              font: '700 15px/1.4 var(--font)',
              color: 'var(--green)',
            }}
          >
            {describePlan(medicine)}
          </div>
        </div>
      ))}

      <button
        className="btn btn--ghost"
        onClick={() => setMedicines([...medicines, blankMedicine()])}
      >
        + Add another medicine
      </button>
    </>
  );
}

/** "= 21 tablets in total" — the number the agent will actually schedule. */
function describePlan(medicine: MedicineForm): string {
  if (medicine.durationDays === '') {
    return `${medicine.timesPerDay} a day, ongoing — no finish line.`;
  }
  const days = Number(medicine.durationDays);
  if (!Number.isFinite(days) || days < 1) return 'Enter how many days.';
  const total = medicine.timesPerDay * days * medicine.amountPerDose;
  return `= ${total} in total, over ${days} ${days === 1 ? 'day' : 'days'}.`;
}

/* -------------------------------------------------------------------------- */

function ReviewStep({
  doctorLabel,
  isNewDoctor,
  visitDate,
  visitType,
  reason,
  conditionLabel,
  medicines,
}: {
  doctorLabel: string;
  isNewDoctor: boolean;
  visitDate: string;
  visitType: VisitType;
  reason: string;
  conditionLabel: string | null;
  medicines: MedicineForm[];
}): ReactNode {
  return (
    <>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          The visit
        </div>
        <div style={{ font: '900 20px/1.25 var(--font)' }}>{doctorLabel}</div>
        <div style={{ font: '600 15px/1.45 var(--font)', color: 'var(--ink-soft)', marginTop: 4 }}>
          {new Intl.DateTimeFormat('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }).format(new Date(`${visitDate}T12:00:00`))}{' '}
          · {VISIT_TYPE_LABELS[visitType]}
        </div>
        <div style={{ font: '600 15px/1.45 var(--font)', marginTop: 10 }}>{reason}</div>
        {conditionLabel && (
          <div style={{ marginTop: 12 }}>
            <span className="pill pill--amber">{conditionLabel}</span>
          </div>
        )}
        {!isNewDoctor && (
          <div style={{ font: '600 13.5px/1.4 var(--font)', color: 'var(--green)', marginTop: 12 }}>
            Added as a new visit to a doctor already on your record.
          </div>
        )}
      </div>

      {medicines.map((medicine) => (
        <div className="card" key={medicine.key}>
          <div style={{ font: '900 19px/1.2 var(--font)' }}>
            {medicine.existingId ? 'Existing medicine' : medicine.name || 'Unnamed medicine'}
            {medicine.strength ? ` ${medicine.strength}` : ''}
          </div>
          <div style={{ font: '600 15px/1.45 var(--font)', color: 'var(--ink-soft)', marginTop: 5 }}>
            {medicine.amountPerDose} · {medicine.timesPerDay} times a day ·{' '}
            {medicine.foodRule.replace('_', ' ')}
          </div>
          <div style={{ font: '800 14px/1.35 var(--font)', color: 'var(--green)', marginTop: 10 }}>
            {describePlan(medicine)}
          </div>
        </div>
      ))}

      <div className="card card--dark" style={{ marginTop: 12 }}>
        <div className="eyebrow" style={{ color: 'var(--mint)', marginBottom: 8 }}>
          What happens next
        </div>
        <div style={{ font: '600 15.5px/1.5 var(--font)' }}>
          I'll turn this into timed doses around your mealtimes. Then I'll ask one thing: whether
          you have the medicine yet. That answer starts the clock.
        </div>
      </div>
    </>
  );
}
