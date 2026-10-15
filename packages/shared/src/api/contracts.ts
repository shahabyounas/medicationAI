import { z } from 'zod';
import {
  ChannelSchema,
  DateSchema,
  FoodRuleSchema,
  IdSchema,
  NonEmptyString,
} from '../schemas/common.js';
import { AgentEventSchema } from '../schemas/agentEvent.js';
import {
  AllergySchema,
  FamilyContactSchema,
  MealtimesSchema,
  PatientSchema,
} from '../schemas/patient.js';
import {
  AppointmentSchema,
  AppointmentStatusSchema,
  AppointmentReminderRungSchema,
} from '../schemas/appointment.js';
import { HealthDocumentKindSchema, HealthDocumentSummarySchema } from '../schemas/healthDocument.js';
import { ImmunisationSchema } from '../schemas/immunisation.js';
import { LabFlagSchema, LabResultSchema } from '../schemas/labResult.js';
import { MedicationKindSchema } from '../schemas/medication.js';
import { ReadingMetricSchema, ReadingSchema } from '../schemas/reading.js';
import {
  SideEffectReportSchema,
  SideEffectSeveritySchema,
} from '../schemas/sideEffect.js';
import { SymptomEntrySchema } from '../schemas/symptom.js';
import { CourseOriginSchema } from '../schemas/course.js';
import { DoseAnchorSchema } from '../schemas/common.js';
import { ConditionSchema, ConditionStatusSchema } from '../schemas/condition.js';
import { CourseProgressSchema, CourseSchema } from '../schemas/course.js';
import { DoctorSpecialtySchema, DoctorWithHistorySchema } from '../schemas/doctor.js';
import { DoseSchema, DoseStatusSchema } from '../schemas/dose.js';
import { MedicationFormSchema, MedicationSchema } from '../schemas/medication.js';
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

/**
 * Why a dose is being skipped.
 *
 * Optional, because demanding a reason before letting somebody skip a tablet is
 * how you teach them to lie to the app. But offered, because the record could
 * not previously tell "I felt better" from "it was making me ill" — and those
 * are the two cases the whole product turns on.
 */
export const SkipDoseRequestSchema = z.object({
  reason: z.string().trim().max(300).optional(),
  /** Set when the skip came out of the side-effect flow. */
  dueToSideEffect: z.boolean().default(false),
});
export type SkipDoseRequest = z.infer<typeof SkipDoseRequestSchema>;

/** "I've collected more" — the only thing that puts units back on the shelf. */
export const RefillRequestSchema = z.object({
  /** Tablets now in the house, counted by the patient. */
  unitsNow: z.number().min(0).max(1000),
});
export type RefillRequest = z.infer<typeof RefillRequestSchema>;

export const RefillResponseSchema = z.object({
  courseId: IdSchema,
  unitsRemaining: z.number().min(0),
  dosesRemaining: z.number().int().min(0),
  message: NonEmptyString,
});
export type RefillResponse = z.infer<typeof RefillResponseSchema>;

export const StopCourseRequestSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});
export type StopCourseRequest = z.infer<typeof StopCourseRequestSchema>;

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

/** A self-managed course, as the Medicines screen shows it. */
export const SelfCareCourseSchema = z.object({
  courseId: IdSchema,
  medicationId: IdSchema,
  medicationName: NonEmptyString,
  medicationForm: MedicationFormSchema,
  kind: MedicationKindSchema,
  kindLabel: NonEmptyString,
  purpose: z.string().nullable(),
  instructionLine: NonEmptyString,
  status: NonEmptyString,
  startedAt: DateSchema.nullable(),
  startedLabel: z.string().nullable(),
  /** Null when the patient asked for no reminders — most of the time. */
  progress: CourseProgressSchema.nullable(),
  reminded: z.boolean(),
  takenToday: z.number().int().min(0),
  expectedToday: z.number().int().min(0),
  unitsRemaining: z.number().min(0).nullable(),
  conditionId: IdSchema.nullable(),
  conditionName: z.string().nullable(),
  /** Any reported side effect still open against it. */
  sideEffectNote: z.string().nullable(),
});
export type SelfCareCourse = z.infer<typeof SelfCareCourseSchema>;

/** A condition with everything hanging off it — the Medicines screen. */
export const ConditionSummarySchema = ConditionSchema.extend({
  doctorName: z.string().nullable(),
  courses: z.array(
    CourseSchema.extend({
      progress: CourseProgressSchema,
      medicationPurpose: z.string().nullable(),
      medicationForm: MedicationFormSchema,
      instructionLine: NonEmptyString,
      /** Scheduled doses still to come — what a refill has to cover. */
      dosesRemaining: z.number().int().min(0),
      /** True when a reported side effect has the reminders paused. */
      paused: z.boolean(),
      pausedNote: z.string().nullable(),
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
  /**
   * Everything the patient takes that no doctor wrote down.
   *
   * A separate list rather than a fake condition, because a multivitamin is not
   * a thing being treated — but on the same screen, because "what am I on right
   * now?" has one answer and the vitamin D is part of it.
   */
  selfCare: z.array(SelfCareCourseSchema).default([]),
  /** Reported side effects still open, surfaced above the lists. */
  openSideEffects: z.array(
    z.object({
      reportId: IdSchema,
      medicationName: NonEmptyString,
      symptom: NonEmptyString,
      severity: SideEffectSeveritySchema,
      severityLabel: NonEmptyString,
      startedLabel: NonEmptyString,
      chasingPaused: z.boolean(),
    }),
  ).default([]),
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
  /** Allergy name matches, repeated here so they are seen before the first dose. */
  allergyFlags: z.array(NonEmptyString).default([]),
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
  /** What the patient reported about the medicine itself. */
  sideEffectCount: z.number().int().min(0),
  sideEffectLines: z.array(NonEmptyString),
  /**
   * How they said they felt, start to finish.
   *
   * The report used to be able to say twenty-one tablets went in and call the
   * illness resolved, while never having asked anybody whether they got better.
   */
  symptomStart: z.number().int().min(0).max(10).nullable(),
  symptomEnd: z.number().int().min(0).max(10).nullable(),
  outcomeLine: z.string().nullable(),
  /** The day the patient first said they felt better, if they ever did. */
  feltBetterOnDay: z.number().int().min(1).nullable(),
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
  /**
   * One sentence per allergy on the record whose name appears in a medicine on
   * this prescription. A name match and nothing more — the app does not know
   * what a medicine contains and must not imply that it does.
   */
  allergyFlags: z.array(NonEmptyString).default([]),
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
  /**
   * What this illness went on to cost — "Came back in October".
   *
   * Drawn on the course that was abandoned, pointing at the illness that
   * followed it. This is the one line that makes the record argue rather than
   * archive, and the whole reason an unfinished course is worth showing at all.
   */
  note: z.string().nullable(),
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

/**
 * Where an illness's treatment has got to — the band above an open episode.
 *
 * `dueByNow` is the honest denominator mid-course: "8 of 21" alone reads as
 * being behind when thirteen were never due yet. The pair of numbers is what
 * makes five unrecorded doses visible without overstating them.
 */
export const ConditionProgressSchema = z.object({
  /** "Day 5 of 7". Null when no course in it has an end date. */
  dayLabel: z.string().nullable(),
  /** "Last dose 17 October". */
  lastDoseLabel: z.string().nullable(),
  takenCount: z.number().int().min(0),
  totalDoses: z.number().int().min(0),
  dueByNow: z.number().int().min(0),
  /** Due, with nothing recorded against them. */
  notRecorded: z.number().int().min(0),
  percentComplete: z.number().min(0).max(100),
});
export type ConditionProgress = z.infer<typeof ConditionProgressSchema>;

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
  /** Null for a long-term condition: there is no course to be partway through. */
  progress: ConditionProgressSchema.nullable(),
  visits: z.array(VisitDetailSchema),
  medications: z.array(ConditionMedicationHistorySchema),
  /** Set when this illness is a return of an earlier one. */
  recurrenceOfConditionId: IdSchema.nullable(),
  recurrenceNote: z.string().nullable(),
});
export type ConditionHistory = z.infer<typeof ConditionHistorySchema>;

/* ========================================================================== */
/* Side effects — "this medicine is making me worse"                          */
/* ========================================================================== */

export const ReportSideEffectRequestSchema = z.object({
  patientId: IdSchema,
  /** Null when the patient cannot say which medicine it is. */
  courseId: IdSchema.nullable().default(null),
  /** Required when there is no course — a medicine they are no longer on. */
  medicationName: NonEmptyString.max(160).optional(),
  symptom: NonEmptyString.max(200),
  severity: SideEffectSeveritySchema,
  startedAt: DateSchema,
  /** True when they have already stopped taking it. */
  stoppedTaking: z.boolean().default(false),
  notes: z.string().trim().max(1000).optional(),
});
export type ReportSideEffectRequest = z.infer<typeof ReportSideEffectRequestSchema>;

/**
 * What the agent says back, and what it actually did.
 *
 * The two are separate fields because they are separate promises: `headline`
 * and `body` are fixed copy from `messages.ts`, while `chasingPaused` and
 * `dosesCancelled` are facts about state that changed. A patient told "I've
 * stopped reminding you" has to be able to rely on it.
 */
export const ReportSideEffectResponseSchema = z.object({
  reportId: IdSchema,
  headline: NonEmptyString,
  body: NonEmptyString,
  /** The label for a call button, when there is a number to call. */
  action: z.string().nullable(),
  doctorPhone: z.string().nullable(),
  chasingPaused: z.boolean(),
  dosesCancelled: z.number().int().min(0),
});
export type ReportSideEffectResponse = z.infer<typeof ReportSideEffectResponseSchema>;

/** One report, with the names joined on for display. */
export const SideEffectViewSchema = SideEffectReportSchema.extend({
  severityLabel: NonEmptyString,
  startedLabel: NonEmptyString,
  conditionName: z.string().nullable(),
  /** Null once the course has finished — the report outlives it. */
  courseStatus: z.string().nullable(),
  stillTaking: z.boolean(),
});
export type SideEffectView = z.infer<typeof SideEffectViewSchema>;

export const SideEffectsResponseSchema = z.object({
  open: z.array(SideEffectViewSchema),
  settled: z.array(SideEffectViewSchema),
  /**
   * One row per medicine ever reported against, so the next prescription for it
   * is not a surprise. This is the list a clinician actually wants.
   */
  byMedication: z.array(
    z.object({
      medicationName: NonEmptyString,
      reportCount: z.number().int().min(1),
      worstSeverity: SideEffectSeveritySchema,
      symptoms: z.array(NonEmptyString),
      lastReportedAt: DateSchema,
    }),
  ),
});
export type SideEffectsResponse = z.infer<typeof SideEffectsResponseSchema>;

export const ResolveSideEffectRequestSchema = z.object({
  /** "It settled down", or "I spoke to the doctor". */
  resolved: z.boolean().default(false),
  doctorInformed: z.boolean().default(false),
});
export type ResolveSideEffectRequest = z.infer<typeof ResolveSideEffectRequestSchema>;

/* ========================================================================== */
/* Readings — what the patient measured                                       */
/* ========================================================================== */

export const RecordReadingRequestSchema = z.object({
  patientId: IdSchema,
  metric: ReadingMetricSchema,
  takenAt: DateSchema,
  value: z.number(),
  secondValue: z.number().nullable().default(null),
  conditionId: IdSchema.nullable().default(null),
  note: z.string().trim().max(300).optional(),
});
export type RecordReadingRequest = z.infer<typeof RecordReadingRequestSchema>;

/** One point on a chart, pre-labelled so the chart holds no date logic. */
export const ReadingPointSchema = z.object({
  readingId: IdSchema,
  takenAt: DateSchema,
  dateLabel: NonEmptyString,
  timeLabel: NonEmptyString,
  value: z.number(),
  secondValue: z.number().nullable(),
  label: NonEmptyString,
  /** True for a nurse's measurement rather than the patient's own. */
  fromVisit: z.boolean(),
  note: z.string().nullable(),
});
export type ReadingPoint = z.infer<typeof ReadingPointSchema>;

/**
 * One metric's whole series.
 *
 * `changeLabel` is the only derived sentence here and it is deliberately
 * arithmetic rather than judgement: "2.1 kg less than a month ago" is a
 * subtraction the patient could do themselves. "Your weight is improving" would
 * not be.
 */
export const ReadingSeriesSchema = z.object({
  metric: ReadingMetricSchema,
  label: NonEmptyString,
  unit: NonEmptyString,
  /** Drawn behind the line, from the monitor's own leaflet. Never a verdict. */
  referenceBand: z.object({ from: z.number(), to: z.number() }).nullable(),
  hasPair: z.boolean(),
  decimals: z.number().int().min(0).max(2),
  points: z.array(ReadingPointSchema),
  latestLabel: z.string().nullable(),
  latestAtLabel: z.string().nullable(),
  changeLabel: z.string().nullable(),
  averageLabel: z.string().nullable(),
});
export type ReadingSeries = z.infer<typeof ReadingSeriesSchema>;

export const ReadingsResponseSchema = z.object({
  timeZone: NonEmptyString,
  /** Every metric, including the empty ones — they are the invitation to log. */
  series: z.array(ReadingSeriesSchema),
  /** Metrics with at least one reading, for the summary row. */
  trackedMetrics: z.array(ReadingMetricSchema),
});
export type ReadingsResponse = z.infer<typeof ReadingsResponseSchema>;

/* ========================================================================== */
/* Symptoms — how the patient actually feels                                  */
/* ========================================================================== */

export const RecordSymptomRequestSchema = z.object({
  patientId: IdSchema,
  conditionId: IdSchema,
  recordedAt: DateSchema,
  severity: z.number().int().min(0).max(10),
  note: z.string().trim().max(300).optional(),
});
export type RecordSymptomRequest = z.infer<typeof RecordSymptomRequestSchema>;

export const SymptomPointSchema = z.object({
  recordedAt: DateSchema,
  dateLabel: NonEmptyString,
  dayNumber: z.number().int().min(1).nullable(),
  severity: z.number().int().min(0).max(10),
  severityLabel: NonEmptyString,
  note: z.string().nullable(),
});
export type SymptomPoint = z.infer<typeof SymptomPointSchema>;

export const SymptomSeriesSchema = z.object({
  conditionId: IdSchema,
  conditionName: NonEmptyString,
  points: z.array(SymptomPointSchema),
  /** "Asked today" / "Not asked today" — drives the one-tap prompt. */
  recordedToday: z.boolean(),
  /**
   * The sentence that makes the record argue rather than archive: the day the
   * patient started feeling better, next to the day the doses stopped.
   */
  turningPointNote: z.string().nullable(),
});
export type SymptomSeries = z.infer<typeof SymptomSeriesSchema>;

/* ========================================================================== */
/* Appointments                                                               */
/* ========================================================================== */

export const CreateAppointmentRequestSchema = z.object({
  patientId: IdSchema,
  doctorId: IdSchema.nullable().default(null),
  /** Used when the appointment is with somebody not on the record. */
  withWhom: NonEmptyString.max(160).optional(),
  conditionId: IdSchema.nullable().default(null),
  scheduledFor: DateSchema,
  type: VisitTypeSchema.default('follow_up'),
  location: z.string().trim().max(240).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateAppointmentRequest = z.infer<typeof CreateAppointmentRequestSchema>;

export const AppointmentViewSchema = AppointmentSchema.extend({
  doctorName: z.string().nullable(),
  clinicName: z.string().nullable(),
  clinicPhone: z.string().nullable(),
  conditionName: z.string().nullable(),
  dateLabel: NonEmptyString,
  clockTime: NonEmptyString,
  /** "In 3 days", "Tomorrow", "Today", "4 days ago". */
  whenLabel: NonEmptyString,
  typeLabel: NonEmptyString,
  statusLabel: NonEmptyString,
  /** Negative once it is in the past. */
  daysAway: z.number().int(),
  /** Which rungs are still to come, so the card can say what will happen. */
  remindersPending: z.array(AppointmentReminderRungSchema),
});
export type AppointmentView = z.infer<typeof AppointmentViewSchema>;

export const AppointmentsResponseSchema = z.object({
  timeZone: NonEmptyString,
  upcoming: z.array(AppointmentViewSchema),
  past: z.array(AppointmentViewSchema),
  /**
   * Follow-up dates sitting on visits with no appointment made from them.
   *
   * These are the ones the app was told about and did nothing with for the
   * whole of its life so far. Offering them for one tap is the migration.
   */
  suggestedFromVisits: z.array(
    z.object({
      visitId: IdSchema,
      doctorId: IdSchema,
      doctorName: NonEmptyString,
      conditionId: IdSchema.nullable(),
      conditionName: z.string().nullable(),
      followUpDate: DateSchema,
      dateLabel: NonEmptyString,
      visitDateLabel: NonEmptyString,
    }),
  ),
  /** Jabs with a next-due date, which read as appointments to the patient. */
  immunisationsDue: z.array(
    z.object({
      immunisationId: IdSchema,
      name: NonEmptyString,
      dueAt: DateSchema,
      dateLabel: NonEmptyString,
      whenLabel: NonEmptyString,
    }),
  ),
});
export type AppointmentsResponse = z.infer<typeof AppointmentsResponseSchema>;

export const UpdateAppointmentStatusRequestSchema = z.object({
  status: AppointmentStatusSchema,
});
export type UpdateAppointmentStatusRequest = z.infer<
  typeof UpdateAppointmentStatusRequestSchema
>;

/* ========================================================================== */
/* Results and jabs                                                           */
/* ========================================================================== */

export const CreateLabResultRequestSchema = z.object({
  patientId: IdSchema,
  panelName: NonEmptyString.max(160),
  takenAt: DateSchema,
  doctorId: IdSchema.nullable().default(null),
  conditionId: IdSchema.nullable().default(null),
  notes: z.string().trim().max(2000).optional(),
  items: z
    .array(
      z.object({
        name: NonEmptyString.max(160),
        value: NonEmptyString.max(60),
        unit: z.string().trim().max(40).optional(),
        referenceRange: z.string().trim().max(80).optional(),
        flag: LabFlagSchema.default('unknown'),
      }),
    )
    .min(1, 'add at least one line from the report'),
});
export type CreateLabResultRequest = z.infer<typeof CreateLabResultRequestSchema>;

export const LabResultViewSchema = LabResultSchema.extend({
  doctorName: z.string().nullable(),
  conditionName: z.string().nullable(),
  dateLabel: NonEmptyString,
  /** How many lines the patient marked as outside the printed range. */
  flaggedCount: z.number().int().min(0),
});
export type LabResultView = z.infer<typeof LabResultViewSchema>;

/** One test measured more than once, as a line. */
export const LabTrendSchema = z.object({
  name: NonEmptyString,
  unit: z.string().nullable(),
  referenceRange: z.string().nullable(),
  points: z.array(
    z.object({
      takenAt: DateSchema,
      dateLabel: NonEmptyString,
      value: z.number(),
      display: NonEmptyString,
      flag: LabFlagSchema,
    }),
  ),
});
export type LabTrend = z.infer<typeof LabTrendSchema>;

export const CreateImmunisationRequestSchema = z.object({
  patientId: IdSchema,
  name: NonEmptyString.max(160),
  givenAt: DateSchema,
  doseLabel: z.string().trim().max(60).optional(),
  site: z.string().trim().max(60).optional(),
  batchNumber: z.string().trim().max(60).optional(),
  administeredBy: z.string().trim().max(160).optional(),
  nextDueAt: DateSchema.nullable().default(null),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateImmunisationRequest = z.infer<typeof CreateImmunisationRequestSchema>;

export const ImmunisationViewSchema = ImmunisationSchema.extend({
  dateLabel: NonEmptyString,
  nextDueLabel: z.string().nullable(),
  overdue: z.boolean(),
});
export type ImmunisationView = z.infer<typeof ImmunisationViewSchema>;

export const ResultsResponseSchema = z.object({
  labs: z.array(LabResultViewSchema),
  /** Only tests with two or more numeric values — one point is not a line. */
  trends: z.array(LabTrendSchema),
  immunisations: z.array(ImmunisationViewSchema),
  documents: z.array(
    HealthDocumentSummarySchema.extend({
      dateLabel: NonEmptyString,
      kindLabel: NonEmptyString,
      sizeLabel: NonEmptyString,
    }),
  ),
});
export type ResultsResponse = z.infer<typeof ResultsResponseSchema>;

/* ========================================================================== */
/* Documents                                                                  */
/* ========================================================================== */

export const UploadDocumentRequestSchema = z.object({
  patientId: IdSchema,
  kind: HealthDocumentKindSchema.default('other'),
  title: NonEmptyString.max(160),
  capturedAt: DateSchema,
  visitId: IdSchema.nullable().default(null),
  conditionId: IdSchema.nullable().default(null),
  mimeType: NonEmptyString.max(80),
  /** The file, base64-encoded, without a data: prefix. */
  dataBase64: NonEmptyString,
  notes: z.string().trim().max(1000).optional(),
});
export type UploadDocumentRequest = z.infer<typeof UploadDocumentRequestSchema>;

export const DocumentResponseSchema = z.object({
  document: HealthDocumentSummarySchema,
  /** A data: URL ready for an <img> or an <a download>. */
  dataUrl: NonEmptyString,
});
export type DocumentResponse = z.infer<typeof DocumentResponseSchema>;

/* ========================================================================== */
/* Self-care — the medicines nobody prescribed                                */
/* ========================================================================== */

/**
 * Something the patient takes because they decided to.
 *
 * Shaped like an intake line and deliberately not like an intake: there is no
 * doctor, no visit, no diagnosis and no read-back, because none of those
 * happened. Inventing a prescription for a vitamin would put a fabricated
 * document in the one part of the record that is meant to be a faithful copy of
 * the paper — and the honest answer to "who told you to take this?" is "nobody,
 * I bought it".
 *
 * It starts immediately. The prescription flow asks "do you have the medicine
 * yet?" because the gap between the surgery and the chemist is where a schedule
 * desynchronises from reality. Somebody adding the tub of cod liver oil already
 * in their kitchen cupboard has no such gap.
 */
export const SelfCareIntakeRequestSchema = z.object({
  patientId: IdSchema,
  medication: z
    .object({
      existingId: IdSchema.optional(),
      create: z
        .object({
          name: NonEmptyString.max(160),
          strength: z.string().trim().max(40).optional(),
          form: MedicationFormSchema.default('tablet'),
          kind: MedicationKindSchema.default('supplement'),
          /** "Keeps my vitamin D up" — the patient's reason, not a claim. */
          purpose: z.string().trim().max(300).optional(),
        })
        .optional(),
    })
    .superRefine((value, ctx) => {
      const hasExisting = value.existingId !== undefined;
      const hasNew = value.create !== undefined;
      if (hasExisting === hasNew) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'medication: send either existingId or create, not both and not neither',
        });
      }
    }),
  amountPerDose: z.number().positive().max(20).default(1),
  timesPerDay: z.number().int().min(1).max(6),
  foodRule: FoodRuleSchema.default('any'),
  /** Null for the usual case: something taken indefinitely. */
  durationDays: z.number().int().min(1).max(365).nullable().default(null),
  /** Attach it to an illness when the patient says it is for one. */
  conditionId: IdSchema.nullable().default(null),
  /** Off by default: nobody wants five alarms a day for a multivitamin. */
  remindMe: z.boolean().default(false),
  /** What is in the house now, for the running-out warning. */
  unitsInHand: z.number().int().min(0).max(1000).nullable().default(null),
  startedAt: DateSchema.optional(),
  notes: z.string().trim().max(400).optional(),
});
export type SelfCareIntakeRequest = z.infer<typeof SelfCareIntakeRequestSchema>;

export const SelfCareIntakeResponseSchema = z.object({
  courseId: IdSchema,
  medicationId: IdSchema,
  medicationCreated: z.boolean(),
  dosesScheduled: z.number().int().min(0),
  message: NonEmptyString,
  /**
   * Anything on the allergy list whose name appears in this medicine's name.
   *
   * A name match and nothing more — see `allergyFlagMessage`. The app does not
   * know what is in a supplement and never implies it does.
   */
  allergyFlags: z.array(NonEmptyString),
  /** Prescribed medicines this is timed apart from, if any rule applies. */
  spacingNote: z.string().nullable(),
});
export type SelfCareIntakeResponse = z.infer<typeof SelfCareIntakeResponseSchema>;


/* ========================================================================== */
/* Profile — who the patient is, and what must not be given to them           */
/* ========================================================================== */

export const ProfileResponseSchema = z.object({
  patient: PatientSchema,
  /** The record's own summary, so the screen can say what it is holding. */
  totals: z.object({
    conditions: z.number().int().min(0),
    visits: z.number().int().min(0),
    medicines: z.number().int().min(0),
    dosesTaken: z.number().int().min(0),
    readings: z.number().int().min(0),
    documents: z.number().int().min(0),
    spanLabel: NonEmptyString,
  }),
  /** The ladder's last rung, stated plainly. */
  escalationSummary: NonEmptyString,
});
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;

export const UpdateProfileRequestSchema = z.object({
  name: NonEmptyString.max(120).optional(),
  phone: z.string().trim().max(20).optional(),
  dateOfBirth: DateSchema.nullable().optional(),
  timezone: NonEmptyString.optional(),
  heightCm: z.number().min(50).max(250).nullable().optional(),
  mealtimes: MealtimesSchema.optional(),
  /** Sent whole, because the editor edits the whole list. */
  allergies: z.array(AllergySchema.omit({ id: true }).extend({ id: IdSchema.optional() })).max(40).optional(),
  familyContacts: z
    .array(FamilyContactSchema.omit({ id: true }).extend({ id: IdSchema.optional() }))
    .max(3)
    .optional(),
});
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

export const UpdateProfileResponseSchema = z.object({
  patient: PatientSchema,
  /** Changing mealtimes rewrites a running course; say how much. */
  movedDoses: z.number().int().min(0),
});
export type UpdateProfileResponse = z.infer<typeof UpdateProfileResponseSchema>;

/* ========================================================================== */
/* Insights — the app finally showing the patient what it knows               */
/* ========================================================================== */

/**
 * Everything the charts screen draws.
 *
 * The app has always held the data for all of this and shown none of it: the
 * scheduled time and the taken time of every dose, the anchor each one hangs
 * off, the drift it quietly learned, which rung of the ladder settled each
 * chase. A patient could see a progress bar and nothing else.
 *
 * It is one payload rather than six endpoints because it is one screen, and
 * because every number on it is derived from the same two queries — the doses
 * and the agent's own events. Splitting it would mean running those twice.
 *
 * Every label is computed server-side, in the patient's own timezone. A chart
 * component that does date arithmetic is a chart component that gets the
 * calendar-day boundary wrong for everyone west of Greenwich.
 */

/** Taken, missed and skipped around one mealtime. */
export const AnchorAdherenceSchema = z.object({
  anchor: DoseAnchorSchema,
  label: NonEmptyString,
  /** The time this anchor currently sits at, so the bar names a real moment. */
  clockTime: NonEmptyString,
  taken: z.number().int().min(0),
  late: z.number().int().min(0),
  missed: z.number().int().min(0),
  skipped: z.number().int().min(0),
  /** Doses whose time has passed. The only fair denominator. */
  settled: z.number().int().min(0),
  percent: z.number().min(0).max(100),
});
export type AnchorAdherence = z.infer<typeof AnchorAdherenceSchema>;

export const PunctualitySchema = z.object({
  /** Taken within the hour's grace, as a share of doses actually taken. */
  onTimePercent: z.number().min(0).max(100),
  medianMinutesLate: z.number().int().nullable(),
  /** What the agent has already taught itself from this, in minutes. */
  learnedDriftMinutes: z.number().int(),
  /** Null until the drift is big enough to have changed anything. */
  driftNote: z.string().nullable(),
  buckets: z.array(
    z.object({
      label: NonEmptyString,
      /** Inclusive lower bound in minutes; null for the open-ended first bucket. */
      fromMinutes: z.number().int().nullable(),
      toMinutes: z.number().int().nullable(),
      count: z.number().int().min(0),
    }),
  ),
  /** One dot per taken dose: when it was due, and how late it was. */
  points: z.array(
    z.object({
      doseId: IdSchema,
      /** Minutes past midnight in the patient's zone — the x axis. */
      scheduledMinuteOfDay: z.number().int().min(0).max(1439),
      minutesLate: z.number().int(),
      dateLabel: NonEmptyString,
      clockTime: NonEmptyString,
      medicationName: NonEmptyString,
    }),
  ),
});
export type Punctuality = z.infer<typeof PunctualitySchema>;

/** One cell of the dose grid: a single tablet, and what became of it. */
export const DoseCellSchema = z.object({
  doseId: IdSchema,
  doseNumber: z.number().int().min(1),
  status: DoseStatusSchema,
  statusLabel: NonEmptyString,
  clockTime: NonEmptyString,
  takenTimeLabel: z.string().nullable(),
  minutesLate: z.number().int().nullable(),
});
export type DoseCell = z.infer<typeof DoseCellSchema>;

/**
 * A course as a grid of days by doses.
 *
 * The existing `dayCells` collapses a whole day to one square, so a day where
 * two of three doses were missed looks exactly like a day where one was. At the
 * dose level the pattern that actually matters becomes visible — and the
 * pattern is almost always a column, not a scatter: it is the evening dose that
 * goes, every day.
 */
export const DoseGridSchema = z.object({
  courseId: IdSchema,
  medicationName: NonEmptyString,
  conditionName: z.string().nullable(),
  origin: CourseOriginSchema,
  timesPerDay: z.number().int().min(1).max(6),
  status: NonEmptyString,
  statusLabel: NonEmptyString,
  /**
   * False for an open-ended course — a long-term medicine with no last dose.
   *
   * It decides whether a burn-down is drawn at all. "Expected against actual"
   * needs an expectation, and a medicine taken indefinitely has none: the
   * planned line would simply climb for as long as the patient lives, which
   * tells them nothing and implies a finish line that does not exist.
   */
  hasFinishLine: z.boolean(),
  /** True when older days were dropped to keep the grid readable. */
  rowsTruncated: z.boolean().default(false),
  /** Column headings: the times of day the doses land on. */
  columns: z.array(z.object({ anchor: DoseAnchorSchema, label: NonEmptyString })),
  rows: z.array(
    z.object({
      day: z.number().int().min(1),
      dateLabel: NonEmptyString,
      isToday: z.boolean(),
      /** Null where a day has fewer doses than the widest day. */
      cells: z.array(DoseCellSchema.nullable()),
    }),
  ),
  /** Expected-versus-actual, for the burn-down line. */
  burnDown: z.array(
    z.object({
      day: z.number().int().min(1),
      dateLabel: NonEmptyString,
      expectedTaken: z.number().int().min(0),
      actualTaken: z.number().int().min(0),
      isProjection: z.boolean(),
    }),
  ),
  /** "On this showing you finish on 22 October — two days later than planned." */
  projectionNote: z.string().nullable(),
});
export type DoseGrid = z.infer<typeof DoseGridSchema>;

export const MonthlyAdherenceSchema = z.object({
  /** "2026-10", for a stable key. */
  month: NonEmptyString,
  label: NonEmptyString,
  taken: z.number().int().min(0),
  due: z.number().int().min(0),
  percent: z.number().min(0).max(100),
});
export type MonthlyAdherence = z.infer<typeof MonthlyAdherenceSchema>;

/**
 * How often each rung of the ladder was the one that worked.
 *
 * The agent's own case for existing. If nearly everything settles at the first
 * reminder it is a reminder app with extra machinery; if the later rungs are
 * carrying real weight, that is the thing worth knowing — and if family is
 * carrying it, that is a conversation the patient should get to have.
 */
export const EscalationUseSchema = z.object({
  nodeId: NonEmptyString,
  label: NonEmptyString,
  count: z.number().int().min(0),
  percent: z.number().min(0).max(100),
  /** True for the family rung, which is drawn differently. */
  isFamily: z.boolean(),
});
export type EscalationUse = z.infer<typeof EscalationUseSchema>;

/** One illness as a bar on a lifetime timeline. */
export const TimelineEpisodeSchema = z.object({
  conditionId: IdSchema,
  name: NonEmptyString,
  startedAt: DateSchema,
  /** Open-ended for something still running. */
  endedAt: DateSchema.nullable(),
  startLabel: NonEmptyString,
  endLabel: z.string().nullable(),
  durationDays: z.number().int().min(0),
  state: z.enum(['in_progress', 'cleared', 'stopped', 'ongoing']),
  percentComplete: z.number().min(0).max(100),
  /** Draws the arrow back to the illness this one is a return of. */
  recurrenceOfConditionId: IdSchema.nullable(),
  recurrenceNote: z.string().nullable(),
});
export type TimelineEpisode = z.infer<typeof TimelineEpisodeSchema>;

export const InsightsResponseSchema = z.object({
  patientName: NonEmptyString,
  timeZone: NonEmptyString,
  /**
   * One fixed-template sentence about the whole picture, or the honest
   * admission that there is not enough yet. A chart screen that draws three
   * dots and calls them a trend is worse than one that says "come back later".
   */
  headline: NonEmptyString,
  hasEnoughData: z.boolean(),
  settledDoses: z.number().int().min(0),
  overall: z.object({
    taken: z.number().int().min(0),
    late: z.number().int().min(0),
    missed: z.number().int().min(0),
    skipped: z.number().int().min(0),
    pending: z.number().int().min(0),
    percentOfElapsed: z.number().min(0).max(100),
    longestStreak: z.number().int().min(0),
    currentStreak: z.number().int().min(0),
    coursesCompleted: z.number().int().min(0),
    coursesStoppedEarly: z.number().int().min(0),
  }),
  byAnchor: z.array(AnchorAdherenceSchema),
  punctuality: PunctualitySchema,
  monthly: z.array(MonthlyAdherenceSchema),
  grids: z.array(DoseGridSchema),
  escalation: z.array(EscalationUseSchema),
  timeline: z.array(TimelineEpisodeSchema),
  symptoms: z.array(SymptomSeriesSchema),
  /** Trimmed to the metrics that actually have points, for the small charts. */
  readings: z.array(ReadingSeriesSchema),
  /** Open side-effect reports, because they explain the gaps in the grids. */
  openSideEffects: z.array(
    z.object({
      medicationName: NonEmptyString,
      symptom: NonEmptyString,
      severityLabel: NonEmptyString,
      startedLabel: NonEmptyString,
    }),
  ),
});
export type InsightsResponse = z.infer<typeof InsightsResponseSchema>;

/* ========================================================================== */
/* The shareable summary — one page for a clinician                           */
/* ========================================================================== */

/**
 * What to hand the person across the desk.
 *
 * The record is good and completely trapped: a clinician has ninety seconds and
 * is not going to tap through three screens of someone's phone. This is the
 * whole thing on one printable page, in the order it is actually asked for —
 * allergies first, then what they are taking right now, then what they are
 * being treated for, then the numbers.
 *
 * Self-managed medicines are in the same list as prescribed ones, marked but
 * not separated, because "what are you taking?" has one answer and a
 * supplements section at the bottom is a section that gets missed.
 */
export const ShareSummaryResponseSchema = z.object({
  generatedAt: DateSchema,
  generatedAtLabel: NonEmptyString,
  patient: z.object({
    name: NonEmptyString,
    dateOfBirthLabel: z.string().nullable(),
    ageLabel: z.string().nullable(),
    phone: NonEmptyString,
    timeZone: NonEmptyString,
  }),
  /** First, always, and loudly even when the list is empty. */
  allergies: z.array(
    z.object({
      substance: NonEmptyString,
      reaction: z.string().nullable(),
      severityLabel: NonEmptyString,
      severity: z.enum(['mild', 'severe', 'life_threatening']),
    }),
  ),
  currentMedicines: z.array(
    z.object({
      medicationName: NonEmptyString,
      strength: z.string().nullable(),
      instructionLine: NonEmptyString,
      kindLabel: NonEmptyString,
      /** True for anything the patient started themselves. */
      selfManaged: z.boolean(),
      prescribedBy: z.string().nullable(),
      forCondition: z.string().nullable(),
      startedLabel: z.string().nullable(),
      /** "17 of 21 taken" — the adherence a prescriber actually wants. */
      adherenceLabel: z.string().nullable(),
      paused: z.boolean(),
    }),
  ),
  conditions: z.array(
    z.object({
      name: NonEmptyString,
      statusLabel: NonEmptyString,
      startedLabel: NonEmptyString,
      resolvedLabel: z.string().nullable(),
      isChronic: z.boolean(),
      doctorNames: z.array(NonEmptyString),
    }),
  ),
  sideEffects: z.array(
    z.object({
      medicationName: NonEmptyString,
      symptom: NonEmptyString,
      severityLabel: NonEmptyString,
      startedLabel: NonEmptyString,
      ongoing: z.boolean(),
    }),
  ),
  recentReadings: z.array(
    z.object({
      label: NonEmptyString,
      latest: NonEmptyString,
      takenAtLabel: NonEmptyString,
      countLabel: NonEmptyString,
      averageLabel: z.string().nullable(),
    }),
  ),
  recentResults: z.array(
    z.object({
      panelName: NonEmptyString,
      dateLabel: NonEmptyString,
      lines: z.array(NonEmptyString),
    }),
  ),
  immunisations: z.array(
    z.object({ name: NonEmptyString, dateLabel: NonEmptyString, nextDueLabel: z.string().nullable() }),
  ),
  recentVisits: z.array(
    z.object({
      dateLabel: NonEmptyString,
      doctorName: NonEmptyString,
      reason: NonEmptyString,
      diagnosis: z.string().nullable(),
      vitalsLine: z.string().nullable(),
    }),
  ),
  upcomingAppointments: z.array(
    z.object({ dateLabel: NonEmptyString, withWhom: NonEmptyString, typeLabel: NonEmptyString }),
  ),
  /**
   * What this page is and is not, printed on it.
   *
   * It is a patient's own record of what they were told and what they took. It
   * is not a clinical document and nothing on it was reviewed by a clinician —
   * which is exactly what somebody reading it at a desk needs to know before
   * they rely on a number.
   */
  provenanceNote: NonEmptyString,
});
export type ShareSummaryResponse = z.infer<typeof ShareSummaryResponseSchema>;
