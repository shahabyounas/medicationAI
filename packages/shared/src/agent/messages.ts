import type { EscalationNodeId } from '../schemas/escalation.js';
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
  unitLabel: string;
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
  const unit = ctx.amount === 1 ? ctx.unitLabel : `${ctx.unitLabel}s`;
  return `${ctx.amount} ${unit} of ${ctx.medicationName}`;
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

export function refillWarningMessage(unitsRemaining: number, medicationName: string): string {
  if (unitsRemaining <= 0) return `You've run out of ${medicationName}. You'll need more to finish.`;
  return `${unitsRemaining} ${unitsRemaining === 1 ? 'tablet' : 'tablets'} of ${medicationName} left — not enough to finish the course. Time to reorder.`;
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
