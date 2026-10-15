import type { EscalationNodeId } from '../schemas/escalation.js';
import { describeUnits, type MedicationForm } from '../schemas/medication.js';
import { formatClockTime } from './time.js';

/**
 * Every sentence the agent says.
 *
 * Kept in one file for two reasons. The obvious one is tone: this app talks to
 * someone who is unwell, and the voice has to be consistent — plain words, no
 * scolding, never a diagnosis. The important one is the guardrail. The agent
 * only ever repeats what the doctor wrote; it does not compose clinical advice
 * at runtime. Confining its vocabulary to a fixed set of templates is what
 * makes that guarantee structural rather than aspirational.
 */

export interface MessageContext {
  patientName: string;
  medicationName: string;
  amount: number;
  /** The dosage form, so the copy says "capsule" when that is what it is. */
  form: MedicationForm;
  scheduledAt: Date;
  timeZone: string;
  doseNumber: number;
  totalDoses: number | null;
  dosesRemaining: number | null;
  dayNumber: number | null;
  durationDays: number | null;
  doctorName: string | null;
  conditionName: string | null;
  familyContactName: string | null;
}

function doseLine(ctx: MessageContext): string {
  return `${describeUnits(ctx.amount, ctx.form)} of ${ctx.medicationName}`;
}

/** The message for a given rung of the escalation ladder. */
export function escalationMessage(nodeId: EscalationNodeId, ctx: MessageContext): string {
  const time = formatClockTime(ctx.scheduledAt, ctx.timeZone);

  switch (nodeId) {
    case 'reminder_1':
      return `It's ${time}, ${ctx.patientName}. Take ${doseLine(ctx)}.`;

    case 'reminder_2': {
      const why = ctx.conditionName
        ? ` It's clearing your ${ctx.conditionName.toLowerCase()}.`
        : '';
      return `Your ${time} ${ctx.medicationName} is still waiting.${why}`;
    }

    case 'text_message':
      return `Hello ${ctx.patientName} — your ${time} ${ctx.medicationName} is still waiting. Have you taken it?`;

    case 'check_in':
      return `Did you take your ${time} ${ctx.medicationName}? Reply Yes, or Not yet.`;

    case 'notify_family': {
      const who = ctx.familyContactName ?? 'your family contact';
      const day = ctx.dayNumber ? ` This is day ${ctx.dayNumber}` : '';
      const of = ctx.durationDays ? ` of ${ctx.durationDays}` : '';
      return `${who} has been told: ${ctx.patientName}'s ${time} ${ctx.medicationName} is unanswered.${day}${of}.`;
    }

    case 'replan':
      return `No problem. Don't double up — take the next one as normal. I've moved the rest of the course so you still finish every dose.`;

    case 'resolved':
      return `Taken. Nothing more to do.`;

    case 'exhausted':
      return `I couldn't reach you for the ${time} dose. I've logged it and moved on to the next one.`;
  }
}

/** The message the family contact receives. Context, and something to say. */
export function familyAlertMessage(ctx: MessageContext): string {
  const time = formatClockTime(ctx.scheduledAt, ctx.timeZone);
  const day =
    ctx.dayNumber && ctx.durationDays
      ? `This is day ${ctx.dayNumber} of ${ctx.durationDays} — the point most people stop. `
      : '';
  return (
    `${ctx.patientName}'s ${time} ${ctx.medicationName} is unanswered after three hours. ` +
    `${day}A phone call works better than another reminder.`
  );
}

/** Shown on the green screen straight after a dose is confirmed. */
export function afterTakeMessage(dosesRemaining: number | null): string {
  if (dosesRemaining === null) return 'Logged. See you at the next one.';
  if (dosesRemaining <= 0) return 'Course complete. Every single dose taken.';
  if (dosesRemaining === 1) return 'One dose left — the last one matters most.';
  return `${dosesRemaining} doses left in this course. Keep going — the last one matters most.`;
}

/** The day 3–4 intervention, in the patient's own terms. */
export function feelBetterMessage(ctx: MessageContext): string {
  const doctor = ctx.doctorName ? `${ctx.doctorName} prescribed` : 'You were prescribed';
  const duration = ctx.durationDays ? `${ctx.durationDays} full days` : 'the full course';
  const left =
    ctx.dayNumber && ctx.durationDays
      ? ` ${Math.max(0, ctx.durationDays - ctx.dayNumber)} days left`
      : '';
  return `You feel better because it's working. ${doctor} ${duration}. Stopping now is how the infection comes back.${left} — I'll see you through it.`;
}

export function refillWarningMessage(
  unitsRemaining: number,
  medicationName: string,
  form: MedicationForm,
): string {
  if (unitsRemaining <= 0) return `You've run out of ${medicationName}. You'll need more to finish.`;
  return `${describeUnits(unitsRemaining, form)} of ${medicationName} left — not enough to finish the course. Time to reorder.`;
}

export function courseCompletedMessage(ctx: MessageContext): string {
  const condition = ctx.conditionName ? ` of your ${ctx.conditionName.toLowerCase()} treatment` : '';
  const days = ctx.durationDays ? `all ${ctx.durationDays} days` : 'the whole course';
  return `You finished ${days}${condition}.`;
}

/**
 * The agent noticing a condition has come back after being stopped early.
 * States the pattern; does not diagnose, and does not tell anyone what to do
 * beyond seeing their doctor.
 */
export function recurrenceMessage(
  conditionName: string,
  previousStoppedAtDay: number,
  daysUntilReturn: number,
): string {
  return (
    `You had ${conditionName.toLowerCase()} before and stopped on day ${previousStoppedAtDay}. ` +
    `It returned ${daysUntilReturn} days later. I'll be more persistent this time.`
  );
}

export function rescheduledMessage(from: Date, to: Date, timeZone: string, reason: string): string {
  return `Moved your ${formatClockTime(from, timeZone)} dose to ${formatClockTime(to, timeZone)} — ${reason}`;
}

/* -------------------------------------------------------------------------- */
/* Side effects                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What the agent says when a medicine is making someone ill.
 *
 * This is the hardest copy in the app to get right, and the guardrail makes it
 * harder in the way that matters: the agent cannot say whether the symptom is
 * serious, cannot say whether to stop, and cannot say whether it is the
 * medicine's fault. All three of those are the prescriber's to say.
 *
 * So the sentence does the only three things it is allowed to do — repeat what
 * the patient reported, say what the agent itself has changed, and name the
 * human to ask. Severity changes the urgency of the last part only, never the
 * content of the first two.
 */
export interface SideEffectResponse {
  headline: string;
  body: string;
  /** The label for a call button, when there is a number to call. */
  action: string | null;
}

/**
 * What the agent says when a medicine is making someone ill.
 *
 * The hardest copy in the app, and the guardrail makes it harder in the way
 * that matters: the agent cannot say whether the symptom is serious, whether to
 * stop, or whether the medicine is to blame. All three belong to the prescriber.
 * So the sentence does the only three things it is allowed to — repeat what was
 * reported, say what the agent itself has changed, and name the human to ask.
 *
 * The symptom is quoted rather than slotted into a verb phrase. It is free text
 * in the patient's own words, and "Amoxicillin is giving you rash on my arms"
 * is what embedding it produces. Quoting reads correctly whatever they typed,
 * which is the only way a fixed template can carry arbitrary text at all.
 */
export function sideEffectResponse(input: {
  medicationName: string;
  symptom: string;
  severity: 'mild' | 'moderate' | 'severe';
  doctorName: string | null;
  doctorPhone: string | null;
}): SideEffectResponse {
  const who = input.doctorName ?? 'the doctor who prescribed it';
  const phone = input.doctorPhone ? ` on ${input.doctorPhone}` : '';
  const reported = `${input.medicationName} — "${input.symptom}"`;
  const action = input.doctorPhone ? `Call ${who}` : null;

  switch (input.severity) {
    case 'severe':
      // No triage, no reassurance, no "it's probably fine". The only sentence
      // that is both true and safe here is: stop reading this and ring someone.
      return {
        headline: 'That needs a person, not an app.',
        body:
          `Written down: ${reported}. I have stopped reminding you about it. Please ring ${who}` +
          `${phone} now. If you cannot get through and you feel very unwell, ring 111 — or 999 ` +
          `if you are struggling to breathe, or your face or throat is swelling.`,
        action,
      };

    case 'moderate':
      return {
        headline: "I've noted it and stopped the reminders.",
        body:
          `Written down: ${reported}. I have stopped reminding you about it for now, because ` +
          `whether you keep taking it is ${who}'s decision and not mine. Please ring them` +
          `${phone} today.`,
        action,
      };

    case 'mild':
      return {
        headline: "Noted — I'll keep it on your record.",
        body:
          `Written down: ${reported}. I will carry on reminding you for now, because stopping ` +
          `is ${who}'s decision rather than mine. Tell ${who} about it at your next ` +
          `appointment — or sooner if it gets worse.`,
        action,
      };
  }
}

/** The line on the record. One sentence, written for the patient to re-read. */
export function sideEffectEventSummary(
  medicationName: string,
  symptom: string,
  severity: 'mild' | 'moderate' | 'severe',
): string {
  const tail = severity === 'mild' ? '' : ' — reminders paused';
  return `${medicationName} — reported "${symptom}" (${severity})${tail}`;
}

export function chasingResumedMessage(medicationName: string): string {
  return `Reminders for ${medicationName} are back on.`;
}

/* -------------------------------------------------------------------------- */
/* Allergies                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The allergy flag.
 *
 * The agent matches a name against a name. It does not know what a medicine is,
 * it cannot tell that amoxicillin is a penicillin, and it must never imply it
 * can — so the sentence states what is on the record and hands the question to
 * a human. It is deliberately not phrased as a warning about the medicine,
 * because the app is in no position to issue one.
 */
export function allergyFlagMessage(input: {
  medicationName: string;
  substance: string;
  severity: 'mild' | 'severe' | 'life_threatening';
  reaction: string | null;
  doctorName: string | null;
}): string {
  const reaction = input.reaction ? ` (${input.reaction})` : '';
  const who = input.doctorName ?? 'whoever prescribed it';
  const weight =
    input.severity === 'life_threatening'
      ? 'a life-threatening reaction'
      : input.severity === 'severe'
        ? 'a severe reaction'
        : 'a reaction';
  return (
    `Your record says you have had ${weight} to ${input.substance}${reaction}, and this ` +
    `prescription is for ${input.medicationName}. I cannot tell whether those are related — ` +
    `please check it with ${who} before you start.`
  );
}

/* -------------------------------------------------------------------------- */
/* Appointments                                                               */
/* -------------------------------------------------------------------------- */

export function appointmentReminderMessage(input: {
  rung: 'week_before' | 'day_before' | 'morning_of';
  withWhom: string;
  clockTime: string;
  location: string | null;
}): string {
  const where = input.location ? ` at ${input.location}` : '';
  switch (input.rung) {
    case 'week_before':
      return `A week today: ${input.withWhom}, ${input.clockTime}${where}.`;
    case 'day_before':
      return `Tomorrow: ${input.withWhom}, ${input.clockTime}${where}.`;
    case 'morning_of':
      return `Today at ${input.clockTime}: ${input.withWhom}${where}.`;
  }
}

export function appointmentBookedMessage(withWhom: string, dateLabel: string): string {
  return `Appointment with ${withWhom} on ${dateLabel} — I'll remind you a week before, the day before, and on the morning.`;
}

/* -------------------------------------------------------------------------- */
/* Readings, refills and self-care                                            */
/* -------------------------------------------------------------------------- */

/**
 * The acknowledgement for a reading.
 *
 * Note what it does not do: it does not say whether the number is good. The app
 * draws the number on a chart and shows the range printed on the monitor's own
 * leaflet; saying "that's a bit high" would be the one thing the guardrail
 * forbids, and it is also the sentence a patient would most remember.
 */
export function readingRecordedMessage(input: {
  label: string;
  reading: string;
  countThisMonth: number;
}): string {
  const context =
    input.countThisMonth <= 1
      ? ''
      : ` That's ${input.countThisMonth} this month — the chart is filling up.`;
  return `${input.label} ${input.reading}, written down.${context}`;
}

export function refillCollectedMessage(input: {
  medicationName: string;
  unitsNow: number;
  dosesRemaining: number;
  unit: string;
}): string {
  const covers =
    input.unitsNow >= input.dosesRemaining
      ? 'That covers the rest of the course.'
      : `That is ${input.dosesRemaining - input.unitsNow} short of finishing the course.`;
  return `${input.medicationName}: ${input.unitsNow} ${input.unit} on the shelf. ${covers}`;
}

export function selfCareStartedMessage(input: {
  medicationName: string;
  timesPerDay: number;
  openEnded: boolean;
}): string {
  const when =
    input.timesPerDay === 1 ? 'once a day' : `${input.timesPerDay} times a day`;
  const ending = input.openEnded ? 'with no end date' : 'until the course is done';
  return `${input.medicationName} added — ${when}, ${ending}. It is on your list for anyone who asks what you take.`;
}
