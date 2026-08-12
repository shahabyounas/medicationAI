import {
  SPECIALTY_LABELS,
  type Doctor,
  type DoctorWithHistory,
  type Visit,
  type VisitDetail,
  type VisitsResponse,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';

/**
 * The medical record: which doctors the patient has seen, when, and what came
 * of it.
 *
 * The design's own history screen shows "Urine infection · 2–7 May · Dr. Noor"
 * — a line that only exists if doctors and visits are real records rather than
 * strings copied onto a prescription. These queries are what make that line,
 * and the recurrence detection that depends on it, possible.
 */

/** Every doctor for a patient, each with the history that makes them useful. */
export async function listDoctorsWithHistory(patientId: string): Promise<DoctorWithHistory[]> {
  const [doctors, visits, prescriptions, conditions] = await Promise.all([
    collections.doctors.find({ patientId }, { sort: { name: 1 } }),
    collections.visits.find({ patientId }),
    collections.prescriptions.find({ patientId }),
    collections.conditions.find({ patientId }),
  ]);

  const conditionNames = new Map(conditions.map((c) => [c._id, c.name]));

  return doctors.map((doctor) => {
    const theirVisits = visits.filter((v) => v.doctorId === doctor._id);
    const theirPrescriptions = prescriptions.filter((p) => p.doctorId === doctor._id);

    const treated = new Set<string>();
    for (const visit of theirVisits) {
      const name = visit.conditionId ? conditionNames.get(visit.conditionId) : null;
      if (name) treated.add(name);
      else if (visit.diagnosis) treated.add(visit.diagnosis);
    }
    for (const prescription of theirPrescriptions) {
      const name = prescription.conditionId ? conditionNames.get(prescription.conditionId) : null;
      if (name) treated.add(name);
    }

    const lastVisitAt = theirVisits.reduce<Date | null>(
      (latest, visit) =>
        latest === null || visit.visitDate.getTime() > latest.getTime() ? visit.visitDate : latest,
      null,
    );

    return {
      ...doctor,
      visitCount: theirVisits.length,
      prescriptionCount: theirPrescriptions.length,
      lastVisitAt,
      conditionsTreated: [...treated].sort(),
    };
  });
}

/** Every visit, newest first, joined to its doctor and what it produced. */
export async function listVisitDetails(patientId: string): Promise<VisitDetail[]> {
  const [visits, doctors, prescriptions, conditions] = await Promise.all([
    collections.visits.find({ patientId }, { sort: { visitDate: -1 } }),
    collections.doctors.find({ patientId }),
    collections.prescriptions.find({ patientId }),
    collections.conditions.find({ patientId }),
  ]);

  const doctorsById = new Map(doctors.map((d) => [d._id, d]));
  const conditionsById = new Map(conditions.map((c) => [c._id, c]));

  return visits.map((visit) => toVisitDetail(visit, doctorsById, conditionsById, prescriptions));
}

export async function getVisitDetail(visitId: string): Promise<VisitDetail> {
  const visit = await collections.visits.requireById(visitId);
  const [doctors, prescriptions, conditions] = await Promise.all([
    collections.doctors.find({ patientId: visit.patientId }),
    collections.prescriptions.find({ visitId }),
    collections.conditions.find({ patientId: visit.patientId }),
  ]);

  return toVisitDetail(
    visit,
    new Map(doctors.map((d) => [d._id, d])),
    new Map(conditions.map((c) => [c._id, c])),
    prescriptions,
  );
}

function toVisitDetail(
  visit: Visit,
  doctorsById: Map<string, Doctor>,
  conditionsById: Map<string, { name: string }>,
  allPrescriptions: readonly { _id: string; visitId: string | null; items: { medicationName: string }[] }[],
): VisitDetail {
  const doctor = doctorsById.get(visit.doctorId);
  const theirs = allPrescriptions.filter((p) => p.visitId === visit._id);

  const medicationNames = [
    ...new Set(theirs.flatMap((p) => p.items.map((item) => item.medicationName))),
  ];

  return {
    ...visit,
    // A visit should still read correctly if its doctor record was removed.
    doctorName: doctor?.name ?? 'Unknown doctor',
    doctorSpecialty: doctor ? SPECIALTY_LABELS[doctor.specialty] : 'Unknown',
    clinicName: doctor?.clinic.name ?? 'Unknown clinic',
    conditionName: visit.conditionId ? (conditionsById.get(visit.conditionId)?.name ?? null) : null,
    prescriptionIds: theirs.map((p) => p._id),
    medicationNames,
  };
}

export async function buildVisitsResponse(patientId: string): Promise<VisitsResponse> {
  const [doctors, visits] = await Promise.all([
    listDoctorsWithHistory(patientId),
    listVisitDetails(patientId),
  ]);
  return { doctors, visits };
}

/**
 * Detect a condition coming back after an earlier course was stopped early.
 *
 * This is the pattern the whole product exists to break — the design calls it
 * out by name on the throat-infection card. Finding it needs the full history
 * across doctors and visits, which is exactly what these records provide.
 */
export interface Recurrence {
  previousConditionId: string;
  previousStoppedAtDay: number;
  daysUntilReturn: number;
}

export async function detectRecurrence(
  patientId: string,
  conditionName: string,
  startedAt: Date,
): Promise<Recurrence | null> {
  const earlier = await collections.conditions.find(
    {
      patientId,
      name: conditionName,
      startedAt: { $lt: startedAt },
    },
    { sort: { startedAt: -1 }, limit: 1 },
  );

  const previous = earlier[0];
  if (!previous) return null;

  const courses = await collections.courses.find({ conditionId: previous._id });
  const stoppedEarly = courses.find((course) => course.status === 'stopped_early');
  if (!stoppedEarly) return null;

  const doses = await collections.doses.find(
    { courseId: stoppedEarly._id },
    { sort: { scheduledAt: 1 } },
  );
  const lastTaken = [...doses].reverse().find((d) => d.status === 'taken' || d.status === 'taken_late');

  const endedAt = stoppedEarly.completedAt ?? previous.resolvedAt ?? previous.startedAt;
  const daysUntilReturn = Math.max(
    0,
    Math.round((startedAt.getTime() - endedAt.getTime()) / (24 * 60 * 60 * 1000)),
  );

  return {
    previousConditionId: previous._id,
    previousStoppedAtDay: lastTaken?.dayNumber ?? 1,
    daysUntilReturn,
  };
}
