import {
  AgentTickResponseSchema,
  ConditionHistorySchema,
  CourseReportSchema,
  HistoryResponseSchema,
  IntakeOptionsResponseSchema,
  IntakeResponseSchema,
  PrescriptionDetailSchema,
  PrescriptionSchema,
  DoseActionResponseSchema,
  FamilyResponseSchema,
  MedicinesResponseSchema,
  PatientSchema,
  TodayResponseSchema,
  VisitsResponseSchema,
  type AgentTickResponse,
  type ConditionHistory,
  type CourseReport,
  type HistoryResponse,
  type IntakeOptionsResponse,
  type IntakeRequest,
  type IntakeResponse,
  type PrescriptionDetail,
  type DoseActionResponse,
  type FamilyResponse,
  type Mealtimes,
  type MedicinesResponse,
  type Patient,
  type TodayResponse,
  type VisitsResponse,
} from '@medication-ai/shared';
import { z } from 'zod';

/**
 * The API client.
 *
 * Every response is parsed through the same Zod schema the server validated it
 * against on the way out. That is not belt-and-braces for its own sake: it
 * means a contract change shows up here, at the boundary, with the offending
 * field named — rather than as `undefined` rendering as "NaN%" three components
 * deep.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const ErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

/**
 * The generic is the schema, not the result type: schemas with `.default()`
 * have an input type that differs from their output, and inferring from the
 * result would collapse the two into a union of both.
 */
async function request<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<z.infer<S>> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    // Installed as an app, being offline is an ordinary state, not a fault —
    // and it needs different words from "the server is broken".
    throw navigator.onLine
      ? new ApiError(0, 'network', 'Could not reach the server. Is it running?')
      : new ApiError(
          0,
          'offline',
          "You're offline. Your doses are safe — I'll catch up when you're back.",
        );
  }

  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const parsed = ErrorBody.safeParse(body);
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error.code : 'unknown',
      parsed.success ? parsed.data.error.message : `Request failed (${response.status})`,
    );
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new ApiError(
      response.status,
      'contract_mismatch',
      `Unexpected response from ${path}: ${first?.path.join('.')} ${first?.message}`,
    );
  }
  return result.data;
}

export const api = {
  listPatients: (): Promise<Patient[]> =>
    request('/patients', z.object({ patients: z.array(PatientSchema) })).then((r) => r.patients),

  today: (patientId: string): Promise<TodayResponse> =>
    request(`/patients/${patientId}/today`, TodayResponseSchema),

  /** The lifetime record, newest first. */
  history: (patientId: string): Promise<HistoryResponse> =>
    request(`/patients/${patientId}/history`, HistoryResponseSchema),

  /** One illness in full, down to every dose and the time it was taken. */
  conditionHistory: (conditionId: string): Promise<ConditionHistory> =>
    request(`/conditions/${conditionId}/history`, ConditionHistorySchema),

  medicines: (patientId: string): Promise<MedicinesResponse> =>
    request(`/patients/${patientId}/medicines`, MedicinesResponseSchema),

  visits: (patientId: string): Promise<VisitsResponse> =>
    request(`/patients/${patientId}/visits`, VisitsResponseSchema),

  family: (patientId: string): Promise<FamilyResponse> =>
    request(`/patients/${patientId}/family`, FamilyResponseSchema),

  report: (conditionId: string): Promise<CourseReport> =>
    request(`/conditions/${conditionId}/report`, CourseReportSchema),

  takeDose: (doseId: string): Promise<DoseActionResponse> =>
    request(`/doses/${doseId}/take`, DoseActionResponseSchema, {
      method: 'POST',
      body: JSON.stringify({ via: 'app' }),
    }),

  snoozeDose: (doseId: string, minutes = 30): Promise<DoseActionResponse> =>
    request(`/doses/${doseId}/snooze`, DoseActionResponseSchema, {
      method: 'POST',
      body: JSON.stringify({ minutes }),
    }),

  skipDose: (doseId: string): Promise<DoseActionResponse> =>
    request(`/doses/${doseId}/skip`, DoseActionResponseSchema, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /* --- Intake: a prescription arriving --------------------------------- */

  intakeOptions: (patientId: string): Promise<IntakeOptionsResponse> =>
    request(`/intake/options?patientId=${patientId}`, IntakeOptionsResponseSchema),

  /** Creates the doctor (if new), the visit, the condition and the prescription. */
  intake: (body: IntakeRequest): Promise<IntakeResponse> =>
    request('/intake', IntakeResponseSchema, { method: 'POST', body: JSON.stringify(body) }),

  prescription: (prescriptionId: string): Promise<PrescriptionDetail> =>
    request(`/prescriptions/${prescriptionId}`, PrescriptionDetailSchema),

  confirmPrescription: (prescriptionId: string) =>
    request(`/prescriptions/${prescriptionId}/confirm`, PrescriptionSchema, { method: 'POST' }),

  /** "Yes, I have it" — plans every dose and starts the agent. */
  startPrescription: (prescriptionId: string) =>
    request(
      `/prescriptions/${prescriptionId}/start`,
      z.object({
        coursesCreated: z.number(),
        dosesScheduled: z.number(),
        firstDoseAt: z.coerce.date().nullable(),
      }),
      { method: 'POST', body: JSON.stringify({}) },
    ),

  /**
   * Correct the mealtimes the whole schedule hangs off.
   *
   * The reply says how many doses moved, because this silently rewrites a
   * running course and the patient is owed a straight answer about it.
   */
  updateMealtimes: (patientId: string, mealtimes: Mealtimes) =>
    request(
      `/patients/${patientId}`,
      PatientSchema.extend({ movedDoses: z.number() }),
      { method: 'PATCH', body: JSON.stringify({ mealtimes }) },
    ),

  /**
   * Advance the agent by one step.
   *
   * Deployed there is no timer and no cron, so this is what actually moves the
   * agent: see `agentClock.ts`. `now` is for driving a schedule by hand.
   */
  tick: (now?: Date): Promise<AgentTickResponse> =>
    request('/agent/tick', AgentTickResponseSchema, {
      method: 'POST',
      body: JSON.stringify(now ? { now: now.toISOString() } : {}),
    }),
};
