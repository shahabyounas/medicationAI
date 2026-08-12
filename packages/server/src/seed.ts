import { randomUUID } from 'node:crypto';
import {
  DEFAULT_MEALTIMES,
  type Dose,
  type PrescriptionItem,
} from '@medication-ai/shared';
import { closeDatabase, connectToDatabase } from './db/client.js';
import { ensureIndexes } from './db/indexes.js';
import { collections } from './db/collections.js';
import { createPrescription, startPrescription } from './services/prescriptionService.js';
import { logAgentEvent } from './services/agentEventService.js';

/**
 * Seeds the scenario from the design document.
 *
 * Nasreen is on day 4 of a 7-day chest infection course — the exact moment the
 * design is about, because day 3–4 is when people stop. Her record also carries
 * the two earlier conditions the design shows: a urine infection she completed,
 * and a throat infection she abandoned on day 4 that came back eleven days
 * later. That history is not decoration; it is what the recurrence detection
 * and the "this is the pattern the agent exists to break" copy read from.
 */

const TZ = 'Europe/London';
const DAY_MS = 24 * 60 * 60 * 1000;

async function clearAll(): Promise<void> {
  await Promise.all(Object.values(collections).map((repo) => repo.deleteMany({})));
}

function daysAgo(days: number, hour = 9): Date {
  const date = new Date(Date.now() - days * DAY_MS);
  date.setHours(hour, 0, 0, 0);
  return date;
}

function dateOf(year: number, month: number, day: number, hour = 9): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, 0, 0));
}

async function seed(): Promise<void> {
  await connectToDatabase();
  await ensureIndexes();
  await clearAll();

  // --- The patient ---------------------------------------------------------

  const patient = await collections.patients.insert({
    name: 'Nasreen Ahmed',
    phone: '+447700900123',
    dateOfBirth: dateOf(1954, 3, 17),
    timezone: TZ,
    mealtimes: DEFAULT_MEALTIMES,
    familyContacts: [
      {
        id: randomUUID(),
        name: 'Bilal Ahmed',
        relation: 'son',
        phone: '+447700900456',
        notifyAfterMinutes: 180,
        notifyAfterConsecutiveMisses: 2,
      },
    ],
  });

  // --- The doctors ---------------------------------------------------------

  const drIqbal = await collections.doctors.insert({
    patientId: patient._id,
    name: 'Dr. Farhan Iqbal',
    specialty: 'general_practice',
    clinic: {
      name: 'Ashworth Road Surgery',
      addressLine: '14 Ashworth Road, Manchester M14 5QT',
      phone: '+441612960100',
    },
    registrationNumber: 'GMC 4417820',
  });

  const drNoor = await collections.doctors.insert({
    patientId: patient._id,
    name: 'Dr. Saima Noor',
    specialty: 'urology',
    clinic: {
      name: 'Northfield Medical Centre',
      addressLine: '3 Northfield Way, Manchester M20 2RD',
      phone: '+441614480900',
    },
    registrationNumber: 'GMC 6031194',
  });

  const drKhan = await collections.doctors.insert({
    patientId: patient._id,
    name: 'Dr. Ayesha Khan',
    specialty: 'endocrinology',
    clinic: {
      name: 'Manchester Royal Diabetes Clinic',
      addressLine: 'Oxford Road, Manchester M13 9WL',
    },
    registrationNumber: 'GMC 5528471',
  });

  // --- The medicines -------------------------------------------------------

  const amoxicillin = await collections.medications.insert({
    name: 'Amoxicillin',
    strength: '500mg',
    form: 'capsule',
    purpose: 'Clears the infection in your chest',
    spacingRules: [
      {
        otherMedicationName: 'Pantoprazole',
        minimumMinutesApart: 30,
        reason: 'So the stomach tablet has time to work first.',
      },
    ],
    cautions: ['Finish the whole course, even once you feel better.'],
  });

  const pantoprazole = await collections.medications.insert({
    name: 'Pantoprazole',
    strength: '40mg',
    form: 'tablet',
    purpose: 'Protects your stomach from the antibiotic',
    spacingRules: [
      {
        otherMedicationName: 'Amoxicillin',
        minimumMinutesApart: 30,
        reason: 'So it has time to work before the antibiotic.',
      },
    ],
    cautions: [],
  });

  const metformin = await collections.medications.insert({
    name: 'Metformin',
    strength: '500mg',
    form: 'tablet',
    purpose: 'Keeps your blood sugar steady',
    spacingRules: [],
    cautions: ['Take with food to avoid an upset stomach.'],
  });

  const nitrofurantoin = await collections.medications.insert({
    name: 'Nitrofurantoin',
    strength: '100mg',
    form: 'capsule',
    purpose: 'Clears a urine infection',
    spacingRules: [],
    cautions: [],
  });

  const penicillin = await collections.medications.insert({
    name: 'Penicillin V',
    strength: '250mg',
    form: 'tablet',
    purpose: 'Clears a throat infection',
    spacingRules: [],
    cautions: [],
  });

  // --- History: the throat infection she stopped on day 4 ------------------

  const throat = await collections.conditions.insert({
    patientId: patient._id,
    name: 'Throat infection',
    plainDescription: 'A bacterial infection in your throat.',
    status: 'recurred',
    startedAt: dateOf(2026, 2, 11),
    resolvedAt: dateOf(2026, 2, 14),
    originVisitId: null,
    recurrenceOfConditionId: null,
    isChronic: false,
  });

  const throatVisit = await collections.visits.insert({
    patientId: patient._id,
    doctorId: drIqbal._id,
    visitDate: dateOf(2026, 2, 11),
    type: 'consultation',
    reason: 'Sore throat for four days, painful to swallow',
    diagnosis: 'Bacterial throat infection',
    conditionId: throat._id,
    notes: 'Tonsils inflamed. 7-day course of penicillin. Advised to complete the full course.',
    followUpDate: null,
    vitals: { temperatureC: 38.1, pulseBpm: 88 },
  });
  await collections.conditions.updateById(throat._id, { originVisitId: throatVisit._id });

  await seedHistoricCourse({
    patientId: patient._id,
    doctorId: drIqbal._id,
    visitId: throatVisit._id,
    conditionId: throat._id,
    medicationId: penicillin._id,
    medicationName: 'Penicillin V',
    issuedAt: dateOf(2026, 2, 11),
    startAt: dateOf(2026, 2, 11, 8),
    timesPerDay: 4,
    durationDays: 7,
    // She stopped on day 4: the first 13 doses taken, the rest never happened.
    takenThrough: 13,
    finalStatus: 'stopped_early',
  });

  // --- History: the urine infection she completed --------------------------

  const urine = await collections.conditions.insert({
    patientId: patient._id,
    name: 'Urine infection',
    plainDescription: 'An infection in your bladder.',
    status: 'resolved',
    startedAt: dateOf(2026, 5, 2),
    resolvedAt: dateOf(2026, 5, 7),
    originVisitId: null,
    recurrenceOfConditionId: null,
    isChronic: false,
  });

  const urineVisit = await collections.visits.insert({
    patientId: patient._id,
    doctorId: drNoor._id,
    visitDate: dateOf(2026, 5, 2),
    type: 'consultation',
    reason: 'Burning when passing water, going more often than usual',
    diagnosis: 'Lower urinary tract infection',
    conditionId: urine._id,
    notes: 'Dipstick positive for nitrites. 5-day course. Advised to drink plenty of water.',
    followUpDate: null,
    vitals: { temperatureC: 37.2, bloodPressure: '138/82' },
  });
  await collections.conditions.updateById(urine._id, { originVisitId: urineVisit._id });

  await seedHistoricCourse({
    patientId: patient._id,
    doctorId: drNoor._id,
    visitId: urineVisit._id,
    conditionId: urine._id,
    medicationId: nitrofurantoin._id,
    medicationName: 'Nitrofurantoin',
    issuedAt: dateOf(2026, 5, 2),
    startAt: dateOf(2026, 5, 2, 8),
    timesPerDay: 4,
    durationDays: 5,
    takenThrough: 20,
    finalStatus: 'completed',
  });

  // --- Ongoing: type 2 diabetes -------------------------------------------

  const diabetes = await collections.conditions.insert({
    patientId: patient._id,
    name: 'Type 2 diabetes',
    plainDescription: 'A long-term condition where your blood sugar runs high.',
    status: 'ongoing',
    startedAt: dateOf(2021, 9, 14),
    resolvedAt: null,
    originVisitId: null,
    recurrenceOfConditionId: null,
    isChronic: true,
  });

  const diabetesVisit = await collections.visits.insert({
    patientId: patient._id,
    doctorId: drKhan._id,
    visitDate: daysAgo(38),
    type: 'routine_check',
    reason: 'Six-monthly diabetes review',
    diagnosis: 'Type 2 diabetes, well controlled',
    conditionId: diabetes._id,
    notes: 'HbA1c 51 mmol/mol. Continue Metformin at current dose. Review in six months.',
    followUpDate: new Date(Date.now() + 142 * DAY_MS),
    vitals: { bloodPressure: '132/78', weightKg: 71.4, pulseBpm: 74 },
  });
  await collections.conditions.updateById(diabetes._id, { originVisitId: diabetesVisit._id });

  const metforminRx = await createPrescription({
    patientId: patient._id,
    doctorId: drKhan._id,
    visitId: diabetesVisit._id,
    conditionId: diabetes._id,
    issuedAt: daysAgo(38),
    source: 'clinic_sent',
    items: [
      {
        medicationId: metformin._id,
        medicationName: 'Metformin',
        amountPerDose: 1,
        frequency: { timesPerDay: 2, foodRule: 'with_food' },
        durationDays: null,
        totalUnits: 56,
        instructions: 'Morning and night, with food.',
      } satisfies Omit<PrescriptionItem, 'id'>,
    ],
  });
  const metforminStart = await startPrescription(metforminRx._id, daysAgo(30, 8));
  // She is reliable with this one — it is the antibiotic she struggles to finish.
  await settlePastDoses(metforminStart.doses, { missEvery: 9 });

  // --- The live course: chest infection, day 4 of 7 ------------------------

  const chest = await collections.conditions.insert({
    patientId: patient._id,
    name: 'Chest infection',
    plainDescription: 'A bacterial infection in your chest.',
    status: 'active',
    startedAt: daysAgo(3),
    resolvedAt: null,
    originVisitId: null,
    recurrenceOfConditionId: null,
    isChronic: false,
  });

  const chestVisit = await collections.visits.insert({
    patientId: patient._id,
    doctorId: drIqbal._id,
    visitDate: daysAgo(3),
    type: 'consultation',
    reason: 'Cough with green phlegm for a week, short of breath climbing stairs',
    diagnosis: 'Chest infection (community-acquired)',
    conditionId: chest._id,
    notes:
      'Crackles at the right base. 7-day course of amoxicillin with pantoprazole cover. ' +
      'Patient stopped an earlier antibiotic course early — reinforced the importance of finishing.',
    followUpDate: new Date(Date.now() + 4 * DAY_MS),
    vitals: { temperatureC: 38.4, bloodPressure: '141/86', pulseBpm: 96 },
  });
  await collections.conditions.updateById(chest._id, { originVisitId: chestVisit._id });

  const chestRx = await createPrescription({
    patientId: patient._id,
    doctorId: drIqbal._id,
    visitId: chestVisit._id,
    conditionId: chest._id,
    issuedAt: daysAgo(3),
    source: 'qr_code',
    items: [
      {
        medicationId: amoxicillin._id,
        medicationName: 'Amoxicillin',
        amountPerDose: 1,
        frequency: { timesPerDay: 3, foodRule: 'after_food' },
        durationDays: 7,
        totalUnits: 21,
        instructions: 'One tablet three times a day, after food.',
      },
      {
        medicationId: pantoprazole._id,
        medicationName: 'Pantoprazole',
        amountPerDose: 1,
        frequency: { timesPerDay: 1, foodRule: 'before_food' },
        durationDays: 7,
        totalUnits: 7,
        instructions: 'One tablet each morning, before breakfast.',
      },
    ],
    notes: 'Keep the two at least 30 minutes apart.',
  });

  const started = await startPrescription(chestRx._id, daysAgo(3, 7));

  // Play her first three days: mostly kept up, two doses lost yesterday —
  // which is exactly the state that makes day 4 the interesting one.
  await playHistory(started.doses, chest._id);

  // The note the agent leaves on a condition it has seen come back before.
  await logAgentEvent({
    patientId: patient._id,
    type: 'recurrence_detected',
    occurredAt: daysAgo(3, 7),
    doseId: null,
    courseId: null,
    conditionId: chest._id,
    channel: 'internal',
    summary:
      'You had a throat infection in February and stopped on day 4. It returned. ' +
      "I'll be more persistent this week.",
    message: null,
    escalationNodeId: null,
    visibleToFamily: true,
  });

  const counts = await Promise.all(
    Object.entries(collections).map(
      async ([name, repo]) => [name, await repo.count({})] as const,
    ),
  );

  console.log('\nSeeded the design scenario:\n');
  for (const [name, count] of counts) {
    console.log(`  ${name.padEnd(20)} ${count}`);
  }
  console.log(`\n  Patient id: ${patient._id}`);
  console.log(`  Chest infection condition id: ${chest._id}\n`);
}

/**
 * Settle the doses whose time has already passed.
 *
 * Anything left `scheduled` in the past would be picked up by the agent loop on
 * its first tick and escalated days late, so the seed has to take a position on
 * every historic dose.
 */
async function playHistory(doses: readonly Dose[], conditionId: string): Promise<void> {
  const now = Date.now();
  const past = doses
    .filter((dose) => dose.scheduledAt.getTime() < now)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  // The two she lost yesterday: the last afternoon and evening amoxicillin.
  const missedIds = new Set(
    past
      .filter((dose) => dose.medicationName === 'Amoxicillin')
      .slice(-3, -1)
      .map((dose) => dose._id),
  );

  for (const dose of past) {
    if (missedIds.has(dose._id)) {
      await collections.doses.updateById(dose._id, { status: 'missed' });
      await logAgentEvent({
        patientId: dose.patientId,
        type: 'dose_missed',
        occurredAt: dose.scheduledAt,
        doseId: dose._id,
        courseId: dose.courseId,
        conditionId,
        channel: 'internal',
        summary: `${dose.medicationName} — missed`,
        message: null,
        escalationNodeId: null,
        visibleToFamily: true,
      });
      continue;
    }

    // A realistic few minutes late, which also gives the drift learner
    // something honest to work from.
    const takenAt = new Date(dose.scheduledAt.getTime() + (5 + Math.random() * 20) * 60_000);
    await collections.doses.updateById(dose._id, {
      status: 'taken',
      takenAt,
      confirmedVia: 'app',
    });
    await collections.courses.updateById(dose.courseId, {});
  }

  // Bring the tablet counts in line with what was actually taken.
  const courseIds = [...new Set(past.map((dose) => dose.courseId))];
  for (const courseId of courseIds) {
    const course = await collections.courses.findById(courseId);
    if (!course || course.unitsRemaining === null) continue;
    const takenCount = await collections.doses.count({
      courseId,
      status: { $in: ['taken', 'taken_late'] },
    });
    await collections.courses.updateById(courseId, {
      unitsRemaining: Math.max(0, (course.totalDoses ?? takenCount) - takenCount),
    });
  }

  await logAgentEvent({
    patientId: past[0]?.patientId ?? '',
    type: 'family_notified',
    occurredAt: new Date(now - 14 * 60 * 60 * 1000),
    doseId: null,
    courseId: past[0]?.courseId ?? null,
    conditionId,
    channel: 'family',
    summary: 'Told Bilal after 2 missed doses',
    message:
      "Nasreen's 9:00 PM Amoxicillin is unanswered after three hours. This is day 3 of 7 — " +
      'the point most people stop. A phone call works better than another reminder.',
    escalationNodeId: 'notify_family',
    visibleToFamily: true,
  });
}

/**
 * Settle every past dose of a course as taken, with the odd miss.
 *
 * Any dose left `scheduled` in the past is a live instruction to the agent, so
 * the seed must take a position on all of them or the first tick will chase a
 * month of history at once.
 */
async function settlePastDoses(
  doses: readonly Dose[],
  options: { missEvery: number },
): Promise<void> {
  const now = Date.now();
  const past = doses
    .filter((dose) => dose.scheduledAt.getTime() < now)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  for (const [index, dose] of past.entries()) {
    if (options.missEvery > 0 && index > 0 && index % options.missEvery === 0) {
      await collections.doses.updateById(dose._id, { status: 'missed' });
      continue;
    }
    await collections.doses.updateById(dose._id, {
      status: 'taken',
      takenAt: new Date(dose.scheduledAt.getTime() + (3 + Math.random() * 12) * 60_000),
      confirmedVia: 'app',
    });
  }
}

/** A course that ran and ended before today, with its doses already settled. */
async function seedHistoricCourse(input: {
  patientId: string;
  doctorId: string;
  visitId: string;
  conditionId: string;
  medicationId: string;
  medicationName: string;
  issuedAt: Date;
  startAt: Date;
  timesPerDay: number;
  durationDays: number;
  takenThrough: number;
  finalStatus: 'completed' | 'stopped_early';
}): Promise<void> {
  const prescription = await createPrescription({
    patientId: input.patientId,
    doctorId: input.doctorId,
    visitId: input.visitId,
    conditionId: input.conditionId,
    issuedAt: input.issuedAt,
    source: 'photo',
    items: [
      {
        medicationId: input.medicationId,
        medicationName: input.medicationName,
        amountPerDose: 1,
        frequency: { timesPerDay: input.timesPerDay, foodRule: 'after_food' },
        durationDays: input.durationDays,
        totalUnits: input.timesPerDay * input.durationDays,
      },
    ],
  });

  const { courses, doses } = await startPrescription(prescription._id, input.startAt);
  const course = courses[0];
  if (!course) return;

  const ordered = [...doses].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  for (const [index, dose] of ordered.entries()) {
    if (index < input.takenThrough) {
      await collections.doses.updateById(dose._id, {
        status: 'taken',
        takenAt: new Date(dose.scheduledAt.getTime() + 8 * 60_000),
        confirmedVia: 'app',
      });
    } else {
      await collections.doses.updateById(dose._id, { status: 'missed' });
    }
  }

  const endedAt = ordered[Math.min(input.takenThrough, ordered.length - 1)]?.scheduledAt ?? null;
  await collections.courses.updateById(course._id, {
    status: input.finalStatus,
    completedAt: endedAt,
    unitsRemaining: Math.max(0, (course.totalDoses ?? 0) - input.takenThrough),
  });
  await collections.prescriptions.updateById(prescription._id, {
    status: input.finalStatus === 'completed' ? 'completed' : 'stopped',
  });
}

seed()
  .then(() => closeDatabase())
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
