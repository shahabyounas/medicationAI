import { useState, type ReactNode } from 'react';
import {
  MEDICATION_FORM_LABELS,
  MEDICATION_KIND_LABELS,
  READING_METRICS,
  type IntakeOptionsResponse,
  type CreateAppointmentRequest,
  type CreateImmunisationRequest,
  type CreateLabResultRequest,
  type MedicationForm,
  type MedicationKind,
  type ReadingMetric,
  type RecordReadingRequest,
  type SelfCareIntakeRequest,
  type VisitsResponse,
} from '@medication-ai/shared';

/**
 * The short forms.
 *
 * Each one is a single thing being written down, so each is one screen with no
 * steps. They share two rules with the rest of the app: nothing interactive is
 * under 44px, and no field is asked for that the app could work out — a reading
 * defaults to now, a supplement defaults to no reminders, a jab defaults to
 * today.
 */

function todayValue(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function nowTimeValue(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/* -------------------------------------------------------------------------- */
/* A reading                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One measurement.
 *
 * Blood pressure asks for two numbers because it is two numbers; everything
 * else asks for one. The app says nothing about whether the answer is good —
 * the chart draws it against the range printed on the monitor's own leaflet and
 * stops there.
 */
export function ReadingOverlay({
  metric,
  patientId,
  busy,
  onSubmit,
  onCancel,
}: {
  metric: ReadingMetric;
  patientId: string;
  busy: boolean;
  onSubmit: (request: RecordReadingRequest) => void;
  onCancel: () => void;
}): ReactNode {
  const spec = READING_METRICS[metric];
  const [value, setValue] = useState('');
  const [secondValue, setSecondValue] = useState('');
  const [date, setDate] = useState(todayValue());
  const [time, setTime] = useState(nowTimeValue());
  const [note, setNote] = useState('');

  const first = Number(value);
  const second = Number(secondValue);
  const valid =
    value.trim() !== '' &&
    Number.isFinite(first) &&
    first >= spec.min &&
    first <= spec.max &&
    (spec.secondValueLabel === null || (secondValue.trim() !== '' && Number.isFinite(second)));

  return (
    <div className="overlay overlay--light">
      <button className="back" onClick={onCancel} disabled={busy}>
        ← Cancel
      </button>

      <div className="scroll" style={{ flex: 1 }}>
        <h1 className="h1">{spec.label}</h1>
        <p className="sub" style={{ marginBottom: 20 }}>
          I write it down and draw it. What it means is a conversation with your doctor.
        </p>

        <div className="field-row">
          <label className="field">
            <span className="field-label">{spec.valueLabel}</span>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              step={spec.decimals === 0 ? 1 : 0.1}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={spec.unit}
              autoFocus
            />
          </label>

          {spec.secondValueLabel && (
            <label className="field">
              <span className="field-label">{spec.secondValueLabel}</span>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={secondValue}
                onChange={(event) => setSecondValue(event.target.value)}
                placeholder={spec.unit}
              />
            </label>
          )}
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field-label">Date</span>
            <input
              className="input"
              type="date"
              value={date}
              max={todayValue()}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Time</span>
            <input
              className="input"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
        </div>

        <label className="field">
          <span className="field-label">Anything worth noting?</span>
          <input
            className="input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Sitting down, after breakfast…"
            maxLength={300}
          />
        </label>

        {!valid && value.trim() !== '' && (
          <div className="field-hint">
            {spec.label} should be between {spec.min} and {spec.max} {spec.unit}.
          </div>
        )}
      </div>

      <button
        className="btn btn--primary"
        disabled={busy || !valid}
        onClick={() =>
          onSubmit({
            patientId,
            metric,
            takenAt: new Date(`${date}T${time}`),
            value: first,
            secondValue: spec.secondValueLabel === null ? null : second,
            conditionId: null,
            ...(note.trim() ? { note: note.trim() } : {}),
          })
        }
      >
        {busy ? 'Saving…' : 'Write it down'}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Something you take yourself                                                */
/* -------------------------------------------------------------------------- */

/**
 * The medicines nobody prescribed.
 *
 * Deliberately shorter than the prescription form, and deliberately not it.
 * There is no doctor, no visit, no diagnosis and no read-back, because none of
 * those happened — and reminders are off by default, because nobody wants an
 * escalating ladder and a phone call to their son over a multivitamin.
 */
export function SelfCareOverlay({
  options,
  patientId,
  busy,
  onSubmit,
  onCancel,
}: {
  options: IntakeOptionsResponse;
  patientId: string;
  busy: boolean;
  onSubmit: (request: SelfCareIntakeRequest) => void;
  onCancel: () => void;
}): ReactNode {
  const [existingId, setExistingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [strength, setStrength] = useState('');
  const [form, setForm] = useState<MedicationForm>('tablet');
  const [kind, setKind] = useState<MedicationKind>('supplement');
  const [purpose, setPurpose] = useState('');
  const [timesPerDay, setTimesPerDay] = useState(1);
  const [amountPerDose, setAmountPerDose] = useState(1);
  const [remindMe, setRemindMe] = useState(false);
  const [unitsInHand, setUnitsInHand] = useState('');
  const [openEnded, setOpenEnded] = useState(true);
  const [durationDays, setDurationDays] = useState(14);
  const [startedWhen, setStartedWhen] = useState(todayValue());
  const [conditionId, setConditionId] = useState<string | null>(null);

  const valid = existingId !== null || name.trim().length > 0;

  return (
    <div className="overlay overlay--light">
      <button className="back" onClick={onCancel} disabled={busy}>
        ← Cancel
      </button>

      <div className="scroll" style={{ flex: 1 }}>
        <h1 className="h1">Something you take yourself</h1>
        <p className="sub" style={{ marginBottom: 20 }}>
          A vitamin, a painkiller from the drawer, anything a doctor did not write down. It goes on
          the list of what you are taking, which is the list people actually ask for.
        </p>

        {options.medications.length > 0 && (
          <label className="field">
            <span className="field-label">Already on your record</span>
            <select
              className="select"
              value={existingId ?? ''}
              onChange={(event) => setExistingId(event.target.value || null)}
            >
              <option value="">Something new</option>
              {options.medications.map((medication) => (
                <option key={medication.id} value={medication.id}>
                  {medication.name}
                  {medication.strength ? ` ${medication.strength}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        {existingId === null && (
          <>
            <label className="field">
              <span className="field-label">What is it called?</span>
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Vitamin D, ibuprofen, cod liver oil…"
                maxLength={160}
              />
            </label>

            <div className="field-row">
              <label className="field">
                <span className="field-label">Strength</span>
                <input
                  className="input"
                  value={strength}
                  onChange={(event) => setStrength(event.target.value)}
                  placeholder="1000 IU"
                  maxLength={40}
                />
              </label>
              <label className="field">
                <span className="field-label">What is it?</span>
                <select
                  className="select"
                  value={form}
                  onChange={(event) => setForm(event.target.value as MedicationForm)}
                >
                  {Object.entries(MEDICATION_FORM_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="field">
              <span className="field-label">Where did it come from?</span>
              <select
                className="select"
                value={kind}
                onChange={(event) => setKind(event.target.value as MedicationKind)}
              >
                <option value="supplement">
                  {MEDICATION_KIND_LABELS.supplement} — a vitamin or similar
                </option>
                <option value="over_the_counter">
                  {MEDICATION_KIND_LABELS.over_the_counter} — bought at a chemist or shop
                </option>
              </select>
            </label>

            <label className="field">
              <span className="field-label">Why do you take it?</span>
              <input
                className="input"
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                placeholder="Your own words — I only ever repeat them back"
                maxLength={300}
              />
            </label>
          </>
        )}

        <div className="field-row">
          <label className="field">
            <span className="field-label">How many at a time?</span>
            <input
              className="input"
              type="number"
              min={1}
              max={20}
              value={amountPerDose}
              onChange={(event) => setAmountPerDose(Math.max(1, Number(event.target.value)))}
            />
          </label>
          <label className="field">
            <span className="field-label">How many times a day?</span>
            <select
              className="select"
              value={timesPerDay}
              onChange={(event) => setTimesPerDay(Number(event.target.value))}
            >
              {[1, 2, 3, 4].map((times) => (
                <option key={times} value={times}>
                  {times === 1 ? 'Once' : `${times} times`}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={openEnded}
            onChange={(event) => setOpenEnded(event.target.checked)}
          />
          <span>I take it with no end date</span>
        </label>

        {!openEnded && (
          <label className="field" style={{ marginTop: 12 }}>
            <span className="field-label">For how many days?</span>
            <input
              className="input"
              type="number"
              min={1}
              max={365}
              value={durationDays}
              onChange={(event) => setDurationDays(Math.max(1, Number(event.target.value)))}
            />
          </label>
        )}

        <div className="field-row" style={{ marginTop: 12 }}>
          <label className="field">
            <span className="field-label">Since when?</span>
            <input
              className="input"
              type="date"
              value={startedWhen}
              max={todayValue()}
              onChange={(event) => setStartedWhen(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">How many in the house?</span>
            <input
              className="input"
              type="number"
              min={0}
              value={unitsInHand}
              onChange={(event) => setUnitsInHand(event.target.value)}
              placeholder="Optional"
            />
          </label>
        </div>

        {options.conditions.length > 0 && (
          <label className="field">
            <span className="field-label">Is it for something you are being treated for?</span>
            <select
              className="select"
              value={conditionId ?? ''}
              onChange={(event) => setConditionId(event.target.value || null)}
            >
              <option value="">No — I just take it</option>
              {options.conditions.map((condition) => (
                <option key={condition.id} value={condition.id}>
                  {condition.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {/*
          Off by default, and the copy says why. An escalating ladder over a
          multivitamin is how somebody turns the whole app off.
        */}
        <div className="card" style={{ marginTop: 6 }}>
          <label className="check">
            <input
              type="checkbox"
              checked={remindMe}
              onChange={(event) => setRemindMe(event.target.checked)}
            />
            <span>Remind me about this one</span>
          </label>
          <div className="field-hint" style={{ marginTop: 0 }}>
            {remindMe
              ? 'I will plan it around your mealtimes and nudge you, the same as a prescription.'
              : 'I will keep it on your list without nudging you. Most people want this for a vitamin.'}
          </div>
        </div>
      </div>

      <button
        className="btn btn--primary"
        disabled={busy || !valid}
        onClick={() =>
          onSubmit({
            patientId,
            medication: existingId
              ? { existingId }
              : {
                  create: {
                    name: name.trim(),
                    ...(strength.trim() ? { strength: strength.trim() } : {}),
                    form,
                    kind,
                    ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
                  },
                },
            amountPerDose,
            timesPerDay,
            foodRule: 'any',
            durationDays: openEnded ? null : durationDays,
            conditionId,
            remindMe,
            unitsInHand: unitsInHand.trim() === '' ? null : Number(unitsInHand),
            startedAt: new Date(`${startedWhen}T09:00:00`),
          })
        }
      >
        {busy ? 'Adding…' : 'Add it to my list'}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* An appointment                                                             */
/* -------------------------------------------------------------------------- */

export function AppointmentOverlay({
  options,
  patientId,
  busy,
  onSubmit,
  onCancel,
}: {
  options: IntakeOptionsResponse;
  patientId: string;
  busy: boolean;
  onSubmit: (request: CreateAppointmentRequest) => void;
  onCancel: () => void;
}): ReactNode {
  const [doctorId, setDoctorId] = useState<string | null>(options.doctors[0]?.id ?? null);
  const [withWhom, setWithWhom] = useState('');
  const [date, setDate] = useState(todayValue());
  const [time, setTime] = useState('09:00');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [conditionId, setConditionId] = useState<string | null>(null);

  const valid = doctorId !== null || withWhom.trim().length > 0;

  return (
    <div className="overlay overlay--light">
      <button className="back" onClick={onCancel} disabled={busy}>
        ← Cancel
      </button>

      <div className="scroll" style={{ flex: 1 }}>
        <h1 className="h1">An appointment</h1>
        <p className="sub" style={{ marginBottom: 20 }}>
          I will remind you a week before, the day before, and on the morning.
        </p>

        <label className="field">
          <span className="field-label">Who with?</span>
          <select
            className="select"
            value={doctorId ?? ''}
            onChange={(event) => setDoctorId(event.target.value || null)}
          >
            {options.doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name} · {doctor.clinicName}
              </option>
            ))}
            <option value="">Somebody else</option>
          </select>
        </label>

        {doctorId === null && (
          <label className="field">
            <span className="field-label">Their name</span>
            <input
              className="input"
              value={withWhom}
              onChange={(event) => setWithWhom(event.target.value)}
              placeholder="The nurse, the eye clinic…"
              maxLength={160}
            />
          </label>
        )}

        <div className="field-row">
          <label className="field">
            <span className="field-label">Date</span>
            <input
              className="input"
              type="date"
              value={date}
              min={todayValue()}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Time</span>
            <input
              className="input"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
        </div>

        <label className="field">
          <span className="field-label">Where?</span>
          <input
            className="input"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Optional"
            maxLength={240}
          />
        </label>

        {options.conditions.length > 0 && (
          <label className="field">
            <span className="field-label">What is it about?</span>
            <select
              className="select"
              value={conditionId ?? ''}
              onChange={(event) => setConditionId(event.target.value || null)}
            >
              <option value="">Nothing in particular</option>
              {options.conditions.map((condition) => (
                <option key={condition.id} value={condition.id}>
                  {condition.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          <span className="field-label">Anything you want to remember to ask?</span>
          <textarea
            className="textarea"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="I will put this in front of you the day before."
            maxLength={2000}
          />
        </label>
      </div>

      <button
        className="btn btn--primary"
        disabled={busy || !valid}
        onClick={() =>
          onSubmit({
            patientId,
            doctorId,
            ...(doctorId === null ? { withWhom: withWhom.trim() } : {}),
            conditionId,
            scheduledFor: new Date(`${date}T${time}`),
            type: 'follow_up',
            ...(location.trim() ? { location: location.trim() } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          })
        }
      >
        {busy ? 'Saving…' : 'Save it and remind me'}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* A test result                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Copying a result off the paper.
 *
 * The flag is a question about what the report says, never a judgement the app
 * makes: "was it marked?" rather than "is it abnormal?". Comparing the value
 * against the range to work that out would be the app deciding something
 * clinical, which is the one thing it must not do.
 */
export function LabResultOverlay({
  options,
  patientId,
  busy,
  onSubmit,
  onCancel,
}: {
  options: IntakeOptionsResponse;
  patientId: string;
  busy: boolean;
  onSubmit: (request: CreateLabResultRequest) => void;
  onCancel: () => void;
}): ReactNode {
  const [panelName, setPanelName] = useState('');
  const [date, setDate] = useState(todayValue());
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [conditionId, setConditionId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([
    { name: '', value: '', unit: '', referenceRange: '', flagged: false },
  ]);

  const valid =
    panelName.trim().length > 0 &&
    lines.some((line) => line.name.trim().length > 0 && line.value.trim().length > 0);

  const update = (index: number, patch: Partial<(typeof lines)[number]>): void =>
    setLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <div className="overlay overlay--light">
      <button className="back" onClick={onCancel} disabled={busy}>
        ← Cancel
      </button>

      <div className="scroll" style={{ flex: 1 }}>
        <h1 className="h1">A test result</h1>
        <p className="sub" style={{ marginBottom: 20 }}>
          Copy it off the paper as it is written. If the same test comes round again, I will draw
          the line.
        </p>

        <label className="field">
          <span className="field-label">What was the test?</span>
          <input
            className="input"
            value={panelName}
            onChange={(event) => setPanelName(event.target.value)}
            placeholder="Blood count, thyroid, diabetes bloods…"
            maxLength={160}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field-label">When?</span>
            <input
              className="input"
              type="date"
              value={date}
              max={todayValue()}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          {options.doctors.length > 0 && (
            <label className="field">
              <span className="field-label">Who ordered it?</span>
              <select
                className="select"
                value={doctorId ?? ''}
                onChange={(event) => setDoctorId(event.target.value || null)}
              >
                <option value="">Not sure</option>
                {options.doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="eyebrow" style={{ margin: '6px 0 10px' }}>
          The lines on the report
        </div>

        {lines.map((line, index) => (
          <div key={index} className="card" style={{ marginBottom: 10 }}>
            <div className="field-row">
              <label className="field" style={{ marginBottom: 10 }}>
                <span className="field-label">Name</span>
                <input
                  className="input"
                  value={line.name}
                  onChange={(event) => update(index, { name: event.target.value })}
                  placeholder="HbA1c"
                  maxLength={160}
                />
              </label>
              <label className="field" style={{ marginBottom: 10 }}>
                <span className="field-label">Value</span>
                <input
                  className="input"
                  value={line.value}
                  onChange={(event) => update(index, { value: event.target.value })}
                  placeholder="51"
                  maxLength={60}
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field" style={{ marginBottom: 10 }}>
                <span className="field-label">Unit</span>
                <input
                  className="input"
                  value={line.unit}
                  onChange={(event) => update(index, { unit: event.target.value })}
                  placeholder="mmol/mol"
                  maxLength={40}
                />
              </label>
              <label className="field" style={{ marginBottom: 10 }}>
                <span className="field-label">Range on the report</span>
                <input
                  className="input"
                  value={line.referenceRange}
                  onChange={(event) => update(index, { referenceRange: event.target.value })}
                  placeholder="20–41"
                  maxLength={80}
                />
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={line.flagged}
                onChange={(event) => update(index, { flagged: event.target.checked })}
              />
              <span>The report marked this one</span>
            </label>
          </div>
        ))}

        <button
          className="btn btn--ghost"
          onClick={() =>
            setLines((rows) => [
              ...rows,
              { name: '', value: '', unit: '', referenceRange: '', flagged: false },
            ])
          }
        >
          + Another line
        </button>

        <label className="field" style={{ marginTop: 16 }}>
          <span className="field-label">What did the doctor say about it?</span>
          <textarea
            className="textarea"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={2000}
          />
        </label>

        {options.conditions.length > 0 && (
          <label className="field">
            <span className="field-label">Is it about something being treated?</span>
            <select
              className="select"
              value={conditionId ?? ''}
              onChange={(event) => setConditionId(event.target.value || null)}
            >
              <option value="">Nothing in particular</option>
              {options.conditions.map((condition) => (
                <option key={condition.id} value={condition.id}>
                  {condition.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <button
        className="btn btn--primary"
        disabled={busy || !valid}
        onClick={() =>
          onSubmit({
            patientId,
            panelName: panelName.trim(),
            takenAt: new Date(`${date}T09:00:00`),
            doctorId,
            conditionId,
            ...(notes.trim() ? { notes: notes.trim() } : {}),
            items: lines
              .filter((line) => line.name.trim() && line.value.trim())
              .map((line) => ({
                name: line.name.trim(),
                value: line.value.trim(),
                ...(line.unit.trim() ? { unit: line.unit.trim() } : {}),
                ...(line.referenceRange.trim()
                  ? { referenceRange: line.referenceRange.trim() }
                  : {}),
                // "Marked on the report", not "we decided it was abnormal".
                flag: line.flagged ? ('abnormal' as const) : ('unknown' as const),
              })),
          })
        }
      >
        {busy ? 'Saving…' : 'Keep this result'}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* A jab                                                                      */
/* -------------------------------------------------------------------------- */

export function ImmunisationOverlay({
  patientId,
  busy,
  onSubmit,
  onCancel,
}: {
  patientId: string;
  busy: boolean;
  onSubmit: (request: CreateImmunisationRequest) => void;
  onCancel: () => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [date, setDate] = useState(todayValue());
  const [doseLabel, setDoseLabel] = useState('');
  const [administeredBy, setAdministeredBy] = useState('');
  const [nextDue, setNextDue] = useState('');

  return (
    <div className="overlay overlay--light">
      <button className="back" onClick={onCancel} disabled={busy}>
        ← Cancel
      </button>

      <div className="scroll" style={{ flex: 1 }}>
        <h1 className="h1">A jab</h1>
        <p className="sub" style={{ marginBottom: 20 }}>
          The one part of a record somebody else usually asks for — and the usual answer is "about
          five years ago, I think".
        </p>

        <label className="field">
          <span className="field-label">What was it?</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Flu, Covid, tetanus…"
            maxLength={160}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field-label">When?</span>
            <input
              className="input"
              type="date"
              value={date}
              max={todayValue()}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Which one?</span>
            <input
              className="input"
              value={doseLabel}
              onChange={(event) => setDoseLabel(event.target.value)}
              placeholder="Booster, 1st dose…"
              maxLength={60}
            />
          </label>
        </div>

        <label className="field">
          <span className="field-label">Who gave it to you?</span>
          <input
            className="input"
            value={administeredBy}
            onChange={(event) => setAdministeredBy(event.target.value)}
            placeholder="The surgery, a chemist…"
            maxLength={160}
          />
        </label>

        <label className="field">
          <span className="field-label">When is the next one due?</span>
          <input
            className="input"
            type="date"
            value={nextDue}
            onChange={(event) => setNextDue(event.target.value)}
          />
          <span className="field-hint">
            Leave it blank if there isn't one. If you fill it in, I will tell you when it comes
            round.
          </span>
        </label>
      </div>

      <button
        className="btn btn--primary"
        disabled={busy || name.trim().length === 0}
        onClick={() =>
          onSubmit({
            patientId,
            name: name.trim(),
            givenAt: new Date(`${date}T09:00:00`),
            ...(doseLabel.trim() ? { doseLabel: doseLabel.trim() } : {}),
            ...(administeredBy.trim() ? { administeredBy: administeredBy.trim() } : {}),
            nextDueAt: nextDue ? new Date(`${nextDue}T09:00:00`) : null,
          })
        }
      >
        {busy ? 'Saving…' : 'Keep this'}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* A refill                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * "I've collected more."
 *
 * The count is what the patient says it is rather than something added to a
 * previous figure, because the only reliable way to know how many tablets are
 * in a house is for somebody to look in the packet and count them.
 */
export function RefillOverlay({
  medicationName,
  dosesRemaining,
  unitsRemaining,
  busy,
  onSubmit,
  onCancel,
}: {
  medicationName: string;
  dosesRemaining: number;
  unitsRemaining: number | null;
  busy: boolean;
  onSubmit: (unitsNow: number) => void;
  onCancel: () => void;
}): ReactNode {
  const [units, setUnits] = useState(String(unitsRemaining ?? ''));
  const parsed = Number(units);
  const valid = units.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;

  return (
    <div className="overlay overlay--light">
      <button className="back" onClick={onCancel} disabled={busy}>
        ← Cancel
      </button>

      <div className="scroll" style={{ flex: 1 }}>
        <h1 className="h1">{medicationName}</h1>
        <p className="sub" style={{ marginBottom: 20 }}>
          Count what is in the house and tell me the number. {dosesRemaining}{' '}
          {dosesRemaining === 1 ? 'dose is' : 'doses are'} still on the schedule.
        </p>

        <label className="field">
          <span className="field-label">How many have you got?</span>
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            value={units}
            onChange={(event) => setUnits(event.target.value)}
            autoFocus
          />
        </label>

        {valid && parsed < dosesRemaining && (
          <div className="banner banner--info">
            That is {dosesRemaining - parsed} short of finishing the course. Worth ordering more
            before you run out.
          </div>
        )}
      </div>

      <button
        className="btn btn--primary"
        disabled={busy || !valid}
        onClick={() => onSubmit(parsed)}
      >
        {busy ? 'Saving…' : 'That is what I have'}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* A photograph                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A picture of the paper.
 *
 * Downscaled in the browser before it is sent. A phone camera's full-resolution
 * JPEG is several megabytes and the server refuses anything over 1.5MB — doing
 * the resize here means a photograph taken on a modern phone works, rather than
 * failing with a size error the patient can do nothing about.
 */
export function DocumentOverlay({
  patientId,
  busy,
  onSubmit,
  onCancel,
}: {
  patientId: string;
  busy: boolean;
  onSubmit: (request: {
    patientId: string;
    kind: 'prescription_photo' | 'letter' | 'test_result' | 'discharge_note' | 'other';
    title: string;
    capturedAt: Date;
    visitId: null;
    conditionId: null;
    mimeType: string;
    dataBase64: string;
    notes?: string;
  }) => void;
  onCancel: () => void;
}): ReactNode {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<
    'prescription_photo' | 'letter' | 'test_result' | 'discharge_note' | 'other'
  >('prescription_photo');
  const [date, setDate] = useState(todayValue());
  const [preview, setPreview] = useState<string | null>(null);
  const [data, setData] = useState<{ base64: string; mimeType: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const pick = async (file: File): Promise<void> => {
    setError(null);
    setWorking(true);
    try {
      if (file.type === 'application/pdf') {
        const raw = await file.arrayBuffer();
        if (raw.byteLength > 1_500_000) {
          setError('That PDF is too big. A photograph of the page works better.');
          return;
        }
        setData({ base64: toBase64(raw), mimeType: 'application/pdf' });
        setPreview(null);
      } else {
        const resized = await downscale(file);
        setData({ base64: resized.base64, mimeType: 'image/jpeg' });
        setPreview(`data:image/jpeg;base64,${resized.base64}`);
      }
      if (title.trim() === '') setTitle(file.name.replace(/\.[^.]+$/, ''));
    } catch {
      setError('I could not read that file.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="overlay overlay--light">
      <button className="back" onClick={onCancel} disabled={busy}>
        ← Cancel
      </button>

      <div className="scroll" style={{ flex: 1 }}>
        <h1 className="h1">A photograph</h1>
        <p className="sub" style={{ marginBottom: 20 }}>
          The prescription, a letter, a printed result. It is what makes the typed record
          checkable later — by you, or by somebody who does not trust it.
        </p>

        <label className="field">
          <span className="field-label">Take or choose a picture</span>
          <input
            className="input"
            type="file"
            accept="image/*,application/pdf"
            style={{ paddingTop: 12 }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void pick(file);
            }}
          />
        </label>

        {working && <div className="field-hint">Making it smaller…</div>}
        {error && <div className="banner banner--error">{error}</div>}

        {preview && (
          <img
            src={preview}
            alt="The picture you chose"
            style={{
              width: '100%',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--card-border)',
              marginBottom: 16,
            }}
          />
        )}

        <label className="field">
          <span className="field-label">What is it?</span>
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Amoxicillin label, Dr Iqbal's letter…"
            maxLength={160}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field-label">Kind</span>
            <select
              className="select"
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
            >
              <option value="prescription_photo">Prescription</option>
              <option value="letter">Letter</option>
              <option value="test_result">Test result</option>
              <option value="discharge_note">Discharge note</option>
              <option value="other">Something else</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Dated</span>
            <input
              className="input"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
        </div>
      </div>

      <button
        className="btn btn--primary"
        disabled={busy || working || data === null || title.trim().length === 0}
        onClick={() =>
          data &&
          onSubmit({
            patientId,
            kind,
            title: title.trim(),
            capturedAt: new Date(`${date}T09:00:00`),
            visitId: null,
            conditionId: null,
            mimeType: data.mimeType,
            dataBase64: data.base64,
          })
        }
      >
        {busy ? 'Saving…' : 'Keep it'}
      </button>
    </div>
  );
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked: a single apply over a multi-megabyte array blows the call stack.
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Longest edge to 1600px, re-encoded as JPEG — comfortably under the cap. */
async function downscale(file: File): Promise<{ base64: string }> {
  const bitmap = await createImageBitmap(file);
  const max = 1600;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext('2d');
  if (!context) throw new Error('no canvas');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  // Step the quality down until it fits, rather than failing at the server.
  for (const quality of [0.82, 0.7, 0.58, 0.45]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    const base64 = url.split(',')[1] ?? '';
    if (base64.length * 0.75 < 1_400_000) return { base64 };
  }
  throw new Error('too big');
}
