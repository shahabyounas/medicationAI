import {
  SPECIALTY_LABELS,
  type IntakeOptionsResponse,
  type IntakeRequest,
  type IntakeResponse,
  type PrescriptionItem,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { BadRequestError } from '../http/errors.js';
import { flagAllergies } from './selfCareService.js';
import { createPrescription } from './prescriptionService.js';
import { detectRecurrence } from './recordService.js';
import { logAgentEvent } from './agentEventService.js';

/**
 * A prescription arriving.
 *
 * One request creates, in order, whatever does not already exist: the doctor,
 * the condition, the visit, the medicines, and finally the prescription itself.
 * The client sends it as one act because that is what it is — "I saw Dr. Iqbal
 * today and he gave me these" — and splitting it into four dependent POSTs
 * would leave a half-written record behind whenever one of them failed.
 *
 * The doctor rule the product cares about: seeing a doctor already on the
 * record adds a visit to them, it does not create a second "Dr. Iqbal".
 */
export async function recordIntake(input: IntakeRequest): Promise<IntakeResponse> {
  const patient = await collections.patients.requireById(input.patientId);

  // --- The doctor ----------------------------------------------------------
  let doctorId: string;
  let doctorWasCreated = false;

  if (input.doctor.existingId) {
    const existing = await collections.doctors.requireById(input.doctor.existingId);
    if (existing.patientId !== patient._id) {
      throw new BadRequestError('That doctor belongs to a different patient');
    }
    doctorId = existing._id;
  } else {
    const create = input.doctor.create;
    if (!create) throw new BadRequestError('doctor: nothing to create');

    // Guard against the same doctor being typed in twice under slightly
    // different capitalisation — the record is only useful if it collapses.
    const duplicate = await collections.doctors.findOne({
      patientId: patient._id,
      name: { $regex: `^${escapeRegex(create.name)}$`, $options: 'i' },
    });

    if (duplicate) {
      doctorId = duplicate._id;
    } else {
      const doctor = await collections.doctors.insert({
        patientId: patient._id,
        name: create.name,
        specialty: create.specialty,
        clinic: {
          name: create.clinicName,
          ...(create.clinicAddressLine ? { addressLine: create.clinicAddressLine } : {}),
          ...(create.clinicPhone ? { phone: create.clinicPhone } : {}),
        },
        ...(create.registrationNumber ? { registrationNumber: create.registrationNumber } : {}),
      });
      doctorId = doctor._id;
      doctorWasCreated = true;
    }
  }

  // --- The condition -------------------------------------------------------
  let conditionId: string | null = null;
  let recurrenceNote: string | null = null;

  if (input.condition) {
    if (input.condition.existingId) {
      const existing = await collections.conditions.requireById(input.condition.existingId);
      if (existing.patientId !== patient._id) {
        throw new BadRequestError('That condition belongs to a different patient');
      }
      conditionId = existing._id;
    } else if (input.condition.create) {
      const create = input.condition.create;

      // Before opening a new condition, check whether this is the same illness
      // returning after a course was abandoned — the pattern the agent exists
      // to break, and the reason the visit history is worth keeping.
      const recurrence = await detectRecurrence(patient._id, create.name, input.visit.visitDate);

      const condition = await collections.conditions.insert({
        patientId: patient._id,
        name: create.name,
        ...(create.plainDescription ? { plainDescription: create.plainDescription } : {}),
        status: create.isChronic ? 'ongoing' : 'active',
        startedAt: input.visit.visitDate,
        resolvedAt: null,
        originVisitId: null,
        recurrenceOfConditionId: recurrence?.previousConditionId ?? null,
        isChronic: create.isChronic,
      });
      conditionId = condition._id;

      if (recurrence) {
        recurrenceNote =
          `You had ${create.name.toLowerCase()} before and stopped on day ` +
          `${recurrence.previousStoppedAtDay}. It returned ${recurrence.daysUntilReturn} days ` +
          `later. I'll be more persistent this time.`;
      }
    }
  }

  // --- The visit -----------------------------------------------------------
  const visit = await collections.visits.insert({
    patientId: patient._id,
    doctorId,
    visitDate: input.visit.visitDate,
    type: input.visit.type,
    reason: input.visit.reason,
    ...(input.visit.diagnosis ? { diagnosis: input.visit.diagnosis } : {}),
    conditionId,
    ...(input.visit.notes ? { notes: input.visit.notes } : {}),
    followUpDate: input.visit.followUpDate,
  });

  if (conditionId) {
    const condition = await collections.conditions.requireById(conditionId);
    if (condition.originVisitId === null) {
      await collections.conditions.updateById(conditionId, { originVisitId: visit._id });
    }
  }

  // --- The medicines -------------------------------------------------------
  const medicationsCreated: string[] = [];
  const items: Omit<PrescriptionItem, 'id'>[] = [];

  for (const item of input.items) {
    let medicationId: string;
    let medicationName: string;

    if (item.medication.existingId) {
      const medication = await collections.medications.requireById(item.medication.existingId);
      medicationId = medication._id;
      medicationName = medication.name;
    } else {
      const create = item.medication.create;
      if (!create) throw new BadRequestError('medication: nothing to create');

      // The catalogue is shared across patients and unique on name, so reuse
      // rather than colliding on the index.
      const existing = await collections.medications.findOne({
        name: { $regex: `^${escapeRegex(create.name)}$`, $options: 'i' },
      });

      if (existing) {
        medicationId = existing._id;
        medicationName = existing.name;
      } else {
        const medication = await collections.medications.insert({
          name: create.name,
          ...(create.strength ? { strength: create.strength } : {}),
          form: create.form,
          ...(create.purpose ? { purpose: create.purpose } : {}),
          kind: 'prescription',
          spacingRules: [],
          cautions: [],
        });
        medicationId = medication._id;
        medicationName = medication.name;
        medicationsCreated.push(medication.name);
      }
    }

    items.push({
      medicationId,
      medicationName,
      amountPerDose: item.amountPerDose,
      frequency: { timesPerDay: item.timesPerDay, foodRule: item.foodRule },
      durationDays: item.durationDays,
      totalUnits:
        item.durationDays === null
          ? null
          : Math.round(item.timesPerDay * item.durationDays * item.amountPerDose),
      ...(item.instructions ? { instructions: item.instructions } : {}),
    });
  }

  // --- The prescription ----------------------------------------------------
  const prescription = await createPrescription({
    patientId: patient._id,
    doctorId,
    visitId: visit._id,
    conditionId,
    issuedAt: input.visit.visitDate,
    source: input.source,
    items,
  });

  /**
   * The allergy check, after the medicines are known and before anything is
   * taken.
   *
   * Deliberately not a refusal. The app matches a name against a name — it does
   * not know what amoxicillin contains and would be wrong to block a
   * prescription a doctor has written on the strength of a substring. So it
   * raises the fact, in front of the patient, before the read-back's "yes, I
   * have it" starts the clock. Saying nothing was the actual bug: the form would
   * take penicillin for a patient whose own record says penicillin gave them a
   * rash.
   */
  const allergyFlags = [
    ...new Set(items.flatMap((item) => flagAllergies(patient, item.medicationName))),
  ];

  if (allergyFlags.length > 0) {
    await logAgentEvent({
      patientId: patient._id,
      type: 'allergy_flagged',
      occurredAt: new Date(),
      doseId: null,
      courseId: null,
      conditionId,
      channel: 'internal',
      summary: `Checked this prescription against your allergy list — ${allergyFlags.length} to look at before you start`,
      message: allergyFlags.join(' '),
      escalationNodeId: null,
      visibleToFamily: true,
    });
  }

  if (recurrenceNote && conditionId) {
    await logAgentEvent({
      patientId: patient._id,
      type: 'recurrence_detected',
      occurredAt: new Date(),
      doseId: null,
      courseId: null,
      conditionId,
      channel: 'internal',
      summary: recurrenceNote,
      message: null,
      escalationNodeId: null,
      visibleToFamily: true,
    });
  }

  return {
    prescriptionId: prescription._id,
    doctorId,
    visitId: visit._id,
    conditionId,
    doctorWasCreated,
    medicationsCreated,
    allergyFlags,
  };
}

/** Everything the intake form offers as an existing choice. */
export async function intakeOptions(patientId: string): Promise<IntakeOptionsResponse> {
  await collections.patients.requireById(patientId);

  const [doctors, conditions, medications, visits] = await Promise.all([
    collections.doctors.find({ patientId }, { sort: { name: 1 } }),
    collections.conditions.find({ patientId }, { sort: { startedAt: -1 } }),
    collections.medications.find({}, { sort: { name: 1 } }),
    collections.visits.find({ patientId }),
  ]);

  return {
    doctors: doctors.map((doctor) => {
      const theirs = visits.filter((v) => v.doctorId === doctor._id);
      const lastVisitAt = theirs.reduce<Date | null>(
        (latest, visit) =>
          latest === null || visit.visitDate.getTime() > latest.getTime() ? visit.visitDate : latest,
        null,
      );
      return {
        id: doctor._id,
        name: doctor.name,
        specialty: SPECIALTY_LABELS[doctor.specialty],
        clinicName: doctor.clinic.name,
        lastVisitAt,
        visitCount: theirs.length,
      };
    }),
    // Only conditions still worth adding a medicine to.
    conditions: conditions
      .filter((c) => c.status === 'active' || c.status === 'ongoing')
      .map((c) => ({
        id: c._id,
        name: c.name,
        status: c.status,
        isChronic: c.isChronic,
      })),
    medications: medications.map((m) => ({
      id: m._id,
      name: m.name,
      strength: m.strength ?? null,
      form: m.form,
      purpose: m.purpose ?? null,
    })),
  };
}

/** Escape a user-supplied string for safe use inside a Mongo `$regex`. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
