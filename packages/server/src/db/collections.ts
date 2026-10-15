import {
  AgentEventSchema,
  AppointmentSchema,
  HealthDocumentSchema,
  ImmunisationSchema,
  LabResultSchema,
  ReadingSchema,
  SideEffectReportSchema,
  SymptomEntrySchema,
  ConditionSchema,
  CourseSchema,
  DoctorSchema,
  DoseSchema,
  EscalationStateSchema,
  MedicationSchema,
  PatientSchema,
  PrescriptionSchema,
  PushSubscriptionSchema,
  VisitSchema,
  type AgentEvent,
  type Appointment,
  type HealthDocument,
  type Immunisation,
  type LabResult,
  type Reading,
  type SideEffectReport,
  type SymptomEntry,
  type Condition,
  type Course,
  type Doctor,
  type Dose,
  type EscalationState,
  type Medication,
  type Patient,
  type Prescription,
  type PushSubscription,
  type Visit,
} from '@medication-ai/shared';
import { Repository } from './repository.js';

/**
 * Every collection in one place, each bound to the Zod schema that defines it.
 */
export const collections = {
  patients: new Repository<Patient>('patients', PatientSchema),
  doctors: new Repository<Doctor>('doctors', DoctorSchema),
  visits: new Repository<Visit>('visits', VisitSchema),
  conditions: new Repository<Condition>('conditions', ConditionSchema),
  medications: new Repository<Medication>('medications', MedicationSchema),
  prescriptions: new Repository<Prescription>('prescriptions', PrescriptionSchema),
  courses: new Repository<Course>('courses', CourseSchema),
  doses: new Repository<Dose>('doses', DoseSchema),
  agentEvents: new Repository<AgentEvent>('agent_events', AgentEventSchema),
  escalationStates: new Repository<EscalationState>('escalation_states', EscalationStateSchema),
  pushSubscriptions: new Repository<PushSubscription>(
    'push_subscriptions',
    PushSubscriptionSchema,
  ),
  // The outcome side of the record: what the patient measured, reported and
  // was given, as distinct from what a doctor wrote and what they swallowed.
  readings: new Repository<Reading>('readings', ReadingSchema),
  sideEffects: new Repository<SideEffectReport>('side_effects', SideEffectReportSchema),
  symptoms: new Repository<SymptomEntry>('symptom_entries', SymptomEntrySchema),
  appointments: new Repository<Appointment>('appointments', AppointmentSchema),
  labResults: new Repository<LabResult>('lab_results', LabResultSchema),
  immunisations: new Repository<Immunisation>('immunisations', ImmunisationSchema),
  documents: new Repository<HealthDocument>('health_documents', HealthDocumentSchema),
} as const;

export type Collections = typeof collections;
