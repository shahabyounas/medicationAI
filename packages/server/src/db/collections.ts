import {
  AgentEventSchema,
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
} as const;

export type Collections = typeof collections;
