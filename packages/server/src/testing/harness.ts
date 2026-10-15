import { randomUUID } from 'node:crypto';
import {
  DEFAULT_MEALTIMES,
  type Doctor,
  type Medication,
  type Patient,
  type PrescriptionItem,
} from '@medication-ai/shared';
import { closeDatabase, connectToDatabase } from '../db/client.js';
import { collections } from '../db/collections.js';
import { ensureIndexes } from '../db/indexes.js';
import { deliveryChannel } from '../agent/channels.js';

/**
 * Test support for the integration tests.
 *
 * These run against a real MongoDB rather than a mock. The agent loop is
 * defined by what it does to persisted state across ticks — restart-safety,
 * idempotency, the `nextRunAt` query — and a mocked driver would verify the
 * calls this code makes while proving nothing about the behaviour that matters.
 */

const TEST_DB = process.env.TEST_MONGODB_DB ?? 'medication_ai_test';
const TEST_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018';

export async function connectTestDatabase(): Promise<void> {
  await connectToDatabase(TEST_URI, TEST_DB);
  await ensureIndexes();
}

export async function disconnectTestDatabase(): Promise<void> {
  await closeDatabase();
}

export async function resetDatabase(): Promise<void> {
  await Promise.all(Object.values(collections).map((repo) => repo.deleteMany({})));
  deliveryChannel.clear();
}

export interface TestScenario {
  patient: Patient;
  doctor: Doctor;
  amoxicillin: Medication;
  conditionId: string;
}

/** A patient, a doctor, a medicine and a condition — enough to prescribe. */
export async function createScenario(
  overrides: {
    notifyAfterConsecutiveMisses?: number;
    withFamily?: boolean;
    timezone?: string;
  } = {},
): Promise<TestScenario> {
  const withFamily = overrides.withFamily ?? true;

  const patient = await collections.patients.insert({
    name: 'Nasreen Ahmed',
    phone: '+447700900123',
    timezone: overrides.timezone ?? 'Europe/London',
    mealtimes: DEFAULT_MEALTIMES,
    allergies: [],
    familyContacts: withFamily
      ? [
          {
            id: randomUUID(),
            name: 'Bilal Ahmed',
            relation: 'son',
            phone: '+447700900456',
            notifyAfterMinutes: 180,
            notifyAfterConsecutiveMisses: overrides.notifyAfterConsecutiveMisses ?? 2,
          },
        ]
      : [],
  });

  const doctor = await collections.doctors.insert({
    patientId: patient._id,
    name: 'Dr. Farhan Iqbal',
    specialty: 'general_practice',
    clinic: { name: 'Ashworth Road Surgery' },
  });

  const amoxicillin = await collections.medications.insert({
    name: 'Amoxicillin',
    strength: '500mg',
    form: 'tablet',
    purpose: 'Clears the infection in your chest',
    kind: 'prescription',
    spacingRules: [],
    cautions: [],
  });

  const condition = await collections.conditions.insert({
    patientId: patient._id,
    name: 'Chest infection',
    status: 'active',
    startedAt: new Date(),
    resolvedAt: null,
    originVisitId: null,
    recurrenceOfConditionId: null,
    isChronic: false,
  });

  return { patient, doctor, amoxicillin, conditionId: condition._id };
}

/** A standard three-times-a-day, seven-day antibiotic line. */
export function amoxicillinItem(medicationId: string): Omit<PrescriptionItem, 'id'> {
  return {
    medicationId,
    medicationName: 'Amoxicillin',
    amountPerDose: 1,
    frequency: { timesPerDay: 3, foodRule: 'after_food' },
    durationDays: 7,
    totalUnits: 21,
  };
}

/** Minutes after an instant, as a Date — keeps the ladder tests readable. */
export function minutesAfter(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}
