import { z } from 'zod';
import {
  ChannelSchema,
  DateSchema,
  FoodRuleSchema,
  IdSchema,
  NonEmptyString,
} from '../schemas/common.js';
import { AgentEventSchema } from '../schemas/agentEvent.js';
import { ConditionSchema, ConditionStatusSchema } from '../schemas/condition.js';
import { CourseProgressSchema, CourseSchema } from '../schemas/course.js';
import { DoctorSpecialtySchema, DoctorWithHistorySchema } from '../schemas/doctor.js';
import { DoseSchema, DoseStatusSchema } from '../schemas/dose.js';
import { MedicationFormSchema, MedicationSchema } from '../schemas/medication.js';
import { MealtimesSchema } from '../schemas/patient.js';
import { PrescriptionSchema, PrescriptionSourceSchema } from '../schemas/prescription.js';
import { VisitDetailSchema, VisitTypeSchema } from '../schemas/visit.js';

/**
 * The shapes that cross the wire.
 *
 * The server parses every response through these before sending, and the web
 * client parses every response after receiving. Validating on both ends sounds
 * redundant but it is the cheapest way to make a contract break loudly at the
 * boundary instead of quietly three components deep.
 */

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: NonEmptyString,
    message: NonEmptyString,
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/** A dose with the display fields the Today screen needs. */
export const DoseViewSchema = DoseSchema.extend({
  clockTime: NonEmptyString,
  statusLabel: NonEmptyString,
  isActionable: z.boolean(),
  /**
   * The real dosage form, so the icon depicts what is actually in the packet.
   * Guessing it from the name would show a capsule for a tablet, which is
   * worse than showing nothing to someone identifying medicines by sight.
   */
  medicationForm: MedicationFormSchema,
});
export type DoseView = z.infer<typeof DoseViewSchema>;

/** One thing being treated, with everything the patient takes for it. */
export const TodayCourseGroupSchema = z.object({
  conditionId: IdSchema.nullable(),
  /** The condition, or the medicine's own name when it treats nothing named. */
  name: NonEmptyString,
  /** True for a long-term medicine — there is no finish line to count towards. */
  isOngoing: z.boolean(),
  dayNumber: z.number().int().min(1).nullable(),
  durationDays: z.number().int().min(1).nullable(),
  takenCount: z.number().int().min(0),
  totalDoses: z.number().int().min(0).nullable(),
  remainingCount: z.number().int().min(0).nullable(),
  medicationNames: z.array(NonEmptyString),
  /** Empty for an ongoing course, which has no run of days to show. */
  dayCells: z.array(
    z.object({
      day: z.number().int().min(1),
      state: z.enum(['done', 'today', 'upcoming', 'missed']),
    }),
  ),
});
export type TodayCourseGroup = z.infer<typeof TodayCourseGroupSchema>;

/**
 * A prescription that is saved but has not started, because the patient said
 * they had not collected the medicine yet.
 *
 * It has to reach the home screen. Answering "not yet" used to close the
 * read-back and leave the prescription sitting at `confirmed` for good: nothing
 * listed that state and the only button that could start it had just been
 * dismissed, so the course could never begin.
 */
export const WaitingPrescriptionSchema = z.object({
  _id: IdSchema,
  doctorName: NonEmptyString,
  conditionName: z.string().nullable(),
  medicationNames: z.array(NonEmptyString),
  /** One plain-words line per medicine. */
  lines: z.array(NonEmptyString),
  /** "Added today", "Added yesterday", "Added on 12 October". */
  addedLabel: NonEmptyString,
});
export type WaitingPrescription = z.infer<typeof WaitingPrescriptionSchema>;

export const TodayResponseSchema = z.object({
  patientName: NonEmptyString,
  timeZone: NonEmptyString,
  greeting: NonEmptyString,
  /** The dose the home screen is built around. Null when there is nothing due. */
  nextDose: DoseViewSchema.nullable(),
  agentLine: NonEmptyString,
  doses: z.array(DoseViewSchema),
  activeCourses: z.array(CourseProgressSchema),
  /** The day 3–4 intervention, when it applies. */
  feelBetterNudge: z
    .object({
      title: NonEmptyString,
      body: NonEmptyString,
      daysLeft: z.number().int().min(0),
    })
    .nullable(),
  activity: z.array(AgentEventSchema),
  /**
   * Every course the patient is on, grouped by what it treats.
   *
   * An array, not a single "primary" condition. Showing one meant that adding a
   * prescription made the previous one disappear from this screen — which reads
   * as the app having replaced it. People see different doctors for different
   * things; the home screen has to hold more than one at a time.
   */
  courseGroups: z.array(TodayCourseGroupSchema),
  /**
   * Prescriptions waiting on the medicine arriving. Usually empty.
   *
   * On the home screen rather than buried in Medicines, because until one of
   * these starts the patient has no doses at all — it is the only thing to do.
   */
  waiting: z.array(WaitingPrescriptionSchema),
});
export type TodayResponse = z.infer<typeof TodayResponseSchema>;

export const TakeDoseRequestSchema = z.object({
  via: z.enum(['app', 'sms', 'whatsapp', 'family', 'auto']).default('app'),
  takenAt: DateSchema.optional(),
});
export type TakeDoseRequest = z.infer<typeof TakeDoseRequestSchema>;

export const SnoozeDoseRequestSchema = z.object({
  minutes: z.number().int().min(5).max(240).default(30),
});
export type SnoozeDoseRequest = z.infer<typeof SnoozeDoseRequestSchema>;

export const DoseActionResponseSchema = z.object({
  dose: DoseSchema,
  message: NonEmptyString,
  courseProgress: CourseProgressSchema.nullable(),
  courseCompleted: z.boolean(),
});
export type DoseActionResponse = z.infer<typeof DoseActionResponseSchema>;

/** A condition with everything hanging off it — the Medicines screen. */
export const ConditionSummarySchema = ConditionSchema.extend({
  doctorName: z.string().nullable(),
  courses: z.array(
    CourseSchema.extend({
      progress: CourseProgressSchema,
      medicationPurpose: z.string().nullable(),
      medicationForm: MedicationFormSchema,
      instructionLine: NonEmptyString,
    }),
  ),
  overallPercent: z.number().min(0).max(100),
  dayNumber: z.number().int().min(0).nullable(),
  durationDays: z.number().int().min(1).nullable(),
});
export type ConditionSummary = z.infer<typeof ConditionSummarySchema>;

export const MedicinesResponseSchema = z.object({
  active: z.array(ConditionSummarySchema),
  finished: z.array(ConditionSummarySchema),
});
export type MedicinesResponse = z.infer<typeof MedicinesResponseSchema>;

export const VisitsResponseSchema = z.object({
  doctors: z.array(DoctorWithHistorySchema),
  visits: z.array(VisitDetailSchema),
});
export type VisitsResponse = z.infer<typeof VisitsResponseSchema>;

export const PrescriptionDetailSchema = PrescriptionSchema.extend({
  doctorName: NonEmptyString,
  clinicName: NonEmptyString,
  conditionName: z.string().nullable(),
  /** The agent's read-back, one line per medicine. */
  readBack: z.array(
    z.object({
      medicationName: NonEmptyString,
      instruction: NonEmptyString,
      plan: NonEmptyString,
    }),
  ),
  /** Any spacing the agent applied, explained in plain words. */
  spacingNote: z.string().nullable(),
});
export type PrescriptionDetail = z.infer<typeof PrescriptionDetailSchema>;

export const FamilyResponseSchema = z.object({
  contacts: z.array(
    z.object({
      id: IdSchema,
      name: NonEmptyString,
      relation: NonEmptyString,
      phone: NonEmptyString,
      rule: NonEmptyString,
      initials: NonEmptyString,
    }),
  ),
  channels: z.array(
    z.object({
      channel: ChannelSchema,
      label: NonEmptyString,
      order: z.number().int(),
    }),
  ),
  recentEscalations: z.array(AgentEventSchema),
  /**
   * The times the whole schedule is anchored to.
   *
   * Every screen tells the patient their doses were "planned around your
   * mealtimes" and nothing has ever shown them what those times are, let alone
   * let them be corrected — so a schedule built on a wrong supper time stays
   * wrong, and the reminders look arbitrary.
   */
  mealtimes: MealtimesSchema,
});
export type FamilyResponse = z.infer<typeof FamilyResponseSchema>;

export const CourseReportSchema = z.object({
  conditionName: NonEmptyString,
  doctorName: z.string().nullable(),
  startedAt: DateSchema.nullable(),
  endedAt: DateSchema.nullable(),
  medicationNames: z.array(NonEmptyString),
  totalDoses: z.number().int().min(0),
  takenCount: z.number().int().min(0),
  lateCount: z.number().int().min(0),
  missedCount: z.number().int().min(0),
  familyInterventions: z.number().int().min(0),
  completedInFull: z.boolean(),
  summaryLine: NonEmptyString,
});
export type CourseReport = z.infer<typeof CourseReportSchema>;

export const AgentTickResponseSchema = z.object({
  ranAt: DateSchema,
  statesExamined: z.number().int().min(0),
  actionsTaken: z.number().int().min(0),
  dosesMarkedMissed: z.number().int().min(0),
  events: z.array(AgentEventSchema),
});
export type AgentTickResponse = z.infer<typeof AgentTickResponseSchema>;

export const MedicationListResponseSchema = z.object({
  medications: z.array(MedicationSchema),
});
export type MedicationListResponse = z.infer<typeof MedicationListResponseSchema>;

/** Confirming "yes, I have the medicine" — the moment the clock starts. */
export const StartPrescriptionRequestSchema = z.object({
  startAt: DateSchema.optional(),
});
export type StartPrescriptionRequest = z.infer<typeof StartPrescriptionRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Push notifications                                                         */
/* -------------------------------------------------------------------------- */

export const PushPublicKeyResponseSchema = z.object({
  /** Null when the server has no VAPID keys, so the UI can say so plainly. */
  publicKey: z.string().nullable(),
  configured: z.boolean(),
});
export type PushPublicKeyResponse = z.infer<typeof PushPublicKeyResponseSchema>;

export const PushSubscribeRequestSchema = z.object({
  patientId: IdSchema,
  endpoint: NonEmptyString.max(2000),
  keys: z.object({
    p256dh: NonEmptyString.max(255),
    auth: NonEmptyString.max(255),
  }),
  userAgent: z.string().trim().max(400).optional(),
});
export type PushSubscribeRequest = z.infer<typeof PushSubscribeRequestSchema>;

export const PushSubscribeResponseSchema = z.object({
  subscribed: z.boolean(),
  deviceCount: z.number().int().min(0),
});
export type PushSubscribeResponse = z.infer<typeof PushSubscribeResponseSchema>;

export const PushStatusResponseSchema = z.object({
  configured: z.boolean(),
  deviceCount: z.number().int().min(0),
});
export type PushStatusResponse = z.infer<typeof PushStatusResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Intake — a prescription arriving                                           */
/* -------------------------------------------------------------------------- */

/**
 * Either/or references.
 *
 * Every part of an intake is either something already on the record or
 * something new. Expressing that as two optional fields with a refinement —
 * rather than letting the client send a name and hoping the server matches it —
 * makes "same doctor as last time" an explicit choice rather than a
 * string-comparison accident.
 */
function exactlyOne<T extends { existingId?: unknown; create?: unknown }>(
  value: T,
  ctx: z.RefinementCtx,
  label: string,
): void {
  const hasExisting = value.existingId !== undefined && value.existingId !== null;
  const hasNew = value.create !== undefined && value.create !== null;
  if (hasExisting === hasNew) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${label}: send either existingId or create, not both and not neither`,
    });
  }
}

export const IntakeDoctorSchema = z
  .object({
    existingId: IdSchema.optional(),
    create: z
      .object({
        name: NonEmptyString.max(120),
        specialty: DoctorSpecialtySchema.default('general_practice'),
        clinicName: NonEmptyString.max(160),
        clinicAddressLine: z.string().trim().max(240).optional(),
        clinicPhone: z.string().trim().max(20).optional(),
        registrationNumber: z.string().trim().max(60).optional(),
      })
      .optional(),
  })
  .superRefine((value, ctx) => exactlyOne(value, ctx, 'doctor'));
export type IntakeDoctor = z.infer<typeof IntakeDoctorSchema>;

export const IntakeConditionSchema = z
  .object({
    existingId: IdSchema.optional(),
    create: z
      .object({
        name: NonEmptyString.max(160),
        plainDescription: z.string().trim().max(400).optional(),
        isChronic: z.boolean().default(false),
      })
      .optional(),
  })
  .superRefine((value, ctx) => exactlyOne(value, ctx, 'condition'));
export type IntakeCondition = z.infer<typeof IntakeConditionSchema>;

export const IntakeMedicationSchema = z
  .object({
    existingId: IdSchema.optional(),
    create: z
      .object({
        name: NonEmptyString.max(160),
        strength: z.string().trim().max(40).optional(),
        form: MedicationFormSchema.default('tablet'),
        purpose: z.string().trim().max(300).optional(),
      })
      .optional(),
  })
  .superRefine((value, ctx) => exactlyOne(value, ctx, 'medication'));
export type IntakeMedication = z.infer<typeof IntakeMedicationSchema>;

/** One medicine line as the intake form collects it. */
export const IntakeItemSchema = z.object({
  medication: IntakeMedicationSchema,
  amountPerDose: z.number().positive().max(20).default(1),
  timesPerDay: z.number().int().min(1).max(6),
  foodRule: FoodRuleSchema.default('any'),
  /** Null for an open-ended, long-term medicine. */
  durationDays: z.number().int().min(1).max(365).nullable(),
  instructions: z.string().trim().max(400).optional(),
});
export type IntakeItem = z.infer<typeof IntakeItemSchema>;

/**
 * A whole prescription arriving, in one request.
 *
 * The client sends the doctor, the visit, the condition and the medicines
 * together because they are one act — "I saw Dr. Iqbal today and he gave me
 * these". Making the browser orchestrate four dependent POSTs would mean a
 * half-written record whenever one of them failed.
 */
export const IntakeRequestSchema = z.object({
  patientId: IdSchema,
  doctor: IntakeDoctorSchema,
  visit: z.object({
    visitDate: DateSchema,
    type: VisitTypeSchema.default('consultation'),
    reason: NonEmptyString.max(500),
    diagnosis: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(4000).optional(),
    followUpDate: DateSchema.nullable().default(null),
  }),
  /** Null when the visit produced no ongoing condition to group under. */
  condition: IntakeConditionSchema.nullable().default(null),
  items: z.array(IntakeItemSchema).min(1, 'add at least one medicine'),
  source: PrescriptionSourceSchema.default('manual'),
});
export type IntakeRequest = z.infer<typeof IntakeRequestSchema>;

export const IntakeResponseSchema = z.object({
  prescriptionId: IdSchema,
  doctorId: IdSchema,
  visitId: IdSchema,
  conditionId: IdSchema.nullable(),
  /** True when this intake created the doctor rather than reusing one. */
  doctorWasCreated: z.boolean(),
  medicationsCreated: z.array(NonEmptyString),
});
export type IntakeResponse = z.infer<typeof IntakeResponseSchema>;

/** Existing records the intake form offers as choices. */
export const IntakeOptionsResponseSchema = z.object({
  doctors: z.array(
    z.object({
      id: IdSchema,
      name: NonEmptyString,
      specialty: NonEmptyString,
      clinicName: NonEmptyString,
      lastVisitAt: DateSchema.nullable(),
      visitCount: z.number().int().min(0),
    }),
  ),
  conditions: z.array(
    z.object({
      id: IdSchema,
      name: NonEmptyString,
      status: NonEmptyString,
      isChronic: z.boolean(),
    }),
  ),
  medications: z.array(
    z.object({
      id: IdSchema,
      name: NonEmptyString,
      strength: z.string().nullable(),
      form: MedicationFormSchema,
      purpose: z.string().nullable(),
    }),
  ),
});
export type IntakeOptionsResponse = z.infer<typeof IntakeOptionsResponseSchema>;

/* ========================================================================== */
/* The lifetime record                                                        */
/* ========================================================================== */

/**
 * One thing that happened, on one date.
 *
 * Deliberately a flat shape rather than a discriminated union. Every entry is
 * rendered the same way — a date, a title, a line of detail — and the only
 * thing `kind` changes is the mark beside it and where tapping it goes. A union
 * would push that decision into the component for no gain.
 */
export const HistoryEntryKindSchema = z.enum([
  'condition_opened',
  'condition_resolved',
  'condition_recurred',
  'visit',
  'course_started',
  'course_completed',
  'course_stopped',
]);
export type HistoryEntryKind = z.infer<typeof HistoryEntryKindSchema>;

export const HistoryEntrySchema = z.object({
  /** Stable across rebuilds — the source document's id plus the kind. */
  id: NonEmptyString,
  kind: HistoryEntryKindSchema,
  occurredAt: DateSchema,
  /** "14 October" — the year is the heading it sits under. */
  dateLabel: NonEmptyString,
  title: NonEmptyString,
  detail: z.string().nullable(),
  /** Where tapping it leads, when it leads anywhere. */
  conditionId: IdSchema.nullable(),
  visitId: IdSchema.nullable(),
  doctorName: z.string().nullable(),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const HistoryMonthSchema = z.object({
  /** 1–12. */
  month: z.number().int().min(1).max(12),
  label: NonEmptyString,
  entries: z.array(HistoryEntrySchema),
});
export type HistoryMonth = z.infer<typeof HistoryMonthSchema>;

/**
 * One illness, as the record shows it: a card, not a run of log lines.
 *
 * A single appointment produces four entries of equal weight — saw the doctor,
 * got a diagnosis, started two medicines — and a list of those is an event log.
 * It is why a record feels long. An illness is the unit people think in, so one
 * card carries its own visits, medicines and outcome, and the entries it is
 * built from stay in `months` for anything that wants them.
 */
export const HistoryEpisodeSchema = z.object({
  conditionId: IdSchema,
  name: NonEmptyString,
  /** When it opened — what it files under, and what it sorts by. */
  occurredAt: DateSchema,
  /** "10 October → now", "2 – 7 May". */
  rangeLabel: NonEmptyString,
  doctorName: z.string().nullable(),
  state: z.enum(['in_progress', 'cleared', 'stopped', 'ongoing']),
  /** "Day 5 of 7", "Cleared", "Stopped", "Ongoing · 5 years". */
  stateLabel: NonEmptyString,
  medicationNames: z.array(NonEmptyString),
  takenCount: z.number().int().min(0),
  /** Null for a long-term condition: there is no finish line to count to. */
  totalDoses: z.number().int().min(0).nullable(),
  percentComplete: z.number().min(0).max(100),
});
export type HistoryEpisode = z.infer<typeof HistoryEpisodeSchema>;

export const HistoryYearSchema = z.object({
  year: z.number().int(),
  label: NonEmptyString,
  entryCount: z.number().int().min(0),
  /** The illnesses that opened this year, newest first. */
  episodes: z.array(HistoryEpisodeSchema).default([]),
  months: z.array(HistoryMonthSchema),
});
export type HistoryYear = z.infer<typeof HistoryYearSchema>;

/**
 * The whole record, newest first, plus what needs doing right now.
 *
 * The present sits at the top of the same list as 1998: today's doses are the
 * newest entries in the record, not a separate screen. That is what keeps a
 * lifetime timeline from burying the one dose that is due in ten minutes.
 */
export const HistoryResponseSchema = z.object({
  patientName: NonEmptyString,
  timeZone: NonEmptyString,
  greeting: NonEmptyString,
  /** Pinned above the timeline. Null when nothing is outstanding. */
  due: DoseViewSchema.nullable(),
  nextDose: DoseViewSchema.nullable(),
  todayDoses: z.array(DoseViewSchema),
  waiting: z.array(WaitingPrescriptionSchema),
  years: z.array(HistoryYearSchema),
  totals: z.object({
    conditions: z.number().int().min(0),
    visits: z.number().int().min(0),
    medicines: z.number().int().min(0),
    dosesTaken: z.number().int().min(0),
    firstRecordedAt: DateSchema.nullable(),
    /** "4 months of records", "12 years of records". */
    spanLabel: NonEmptyString,
  }),
});
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;

/** One dose, as it actually happened. The unit of the medication log. */
export const DoseLogEntrySchema = z.object({
  _id: IdSchema,
  doseNumber: z.number().int().min(1),
  scheduledAt: DateSchema,
  takenAt: DateSchema.nullable(),
  status: DoseStatusSchema,
  statusLabel: NonEmptyString,
  dateLabel: NonEmptyString,
  scheduledTimeLabel: NonEmptyString,
  /** Null unless it was actually taken — this is the column that matters. */
  takenTimeLabel: z.string().nullable(),
  /** Positive when late, negative when early. Null when never taken. */
  minutesLate: z.number().int().nullable(),
});
export type DoseLogEntry = z.infer<typeof DoseLogEntrySchema>;

export const ConditionMedicationHistorySchema = z.object({
  courseId: IdSchema,
  medicationName: NonEmptyString,
  medicationForm: MedicationFormSchema,
  instructionLine: NonEmptyString,
  status: NonEmptyString,
  statusLabel: NonEmptyString,
  startedAt: DateSchema.nullable(),
  endedAt: DateSchema.nullable(),
  totalDoses: z.number().int().min(0).nullable(),
  takenCount: z.number().int().min(0),
  missedCount: z.number().int().min(0),
  skippedCount: z.number().int().min(0),
  /** Every dose, newest first. The "what time did I take it" list. */
  doses: z.array(DoseLogEntrySchema),
});
export type ConditionMedicationHistory = z.infer<typeof ConditionMedicationHistorySchema>;

/** One illness, start to finish, with everything that happened for it. */
export const ConditionHistorySchema = z.object({
  _id: IdSchema,
  name: NonEmptyString,
  plainDescription: z.string().nullable(),
  status: ConditionStatusSchema,
  statusLabel: NonEmptyString,
  isChronic: z.boolean(),
  startedAt: DateSchema,
  resolvedAt: DateSchema.nullable(),
  /** "11 days", "ongoing for 3 years". */
  durationLabel: NonEmptyString,
  doctorNames: z.array(NonEmptyString),
  visits: z.array(VisitDetailSchema),
  medications: z.array(ConditionMedicationHistorySchema),
  /** Set when this illness is a return of an earlier one. */
  recurrenceOfConditionId: IdSchema.nullable(),
  recurrenceNote: z.string().nullable(),
});
export type ConditionHistory = z.infer<typeof ConditionHistorySchema>;
