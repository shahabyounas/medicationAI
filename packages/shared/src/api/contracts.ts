import { z } from 'zod';
import {
  ChannelSchema,
  DateSchema,
  FoodRuleSchema,
  IdSchema,
  NonEmptyString,
} from '../schemas/common.js';
import { AgentEventSchema } from '../schemas/agentEvent.js';
import { ConditionSchema } from '../schemas/condition.js';
import { CourseProgressSchema, CourseSchema } from '../schemas/course.js';
import { DoctorSpecialtySchema, DoctorWithHistorySchema } from '../schemas/doctor.js';
import { DoseSchema } from '../schemas/dose.js';
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
