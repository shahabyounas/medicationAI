import {
  ALLERGY_SEVERITY_LABELS,
  APPOINTMENT_STATUS_LABELS,
  CONDITION_STATUS_LABELS,
  MEDICATION_KIND_LABELS,
  SIDE_EFFECT_SEVERITY_LABELS,
  VISIT_TYPE_LABELS,
  describeBloodPressure,
  formatDayMonth,
  formatDayMonthSmart,
  isTaken,
  type ShareSummaryResponse,
  type Visit,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { instructionLineFor } from './viewService.js';
import { buildReadings } from './readingService.js';

/**
 * One page to hand the person across the desk.
 *
 * The record has always been good and completely trapped. A clinician has
 * ninety seconds and is not going to tap through three screens of somebody
 * else's phone, so in practice every appointment started with the patient
 * reciting from memory the exact facts the app was holding.
 *
 * The order is the order it is actually asked in — allergies, then what they
 * are taking right now, then what they are being treated for, then the numbers.
 * Self-managed medicines sit in the same list as prescribed ones, marked but
 * not separated: "what are you taking?" has one answer, and a supplements
 * section at the bottom of a page is a section that gets missed.
 *
 * `provenanceNote` is the last field and the most important one. This is a
 * patient's own record of what they were told and what they took; nothing on it
 * was reviewed by a clinician, and somebody reading it at a desk needs to know
 * that before they rely on a number.
 */
export async function buildShareSummary(
  patientId: string,
  now = new Date(),
): Promise<ShareSummaryResponse> {
  const patient = await collections.patients.requireById(patientId);
  const tz = patient.timezone;

  const [
    conditions,
    courses,
    doses,
    medications,
    prescriptions,
    doctors,
    visits,
    sideEffects,
    labs,
    immunisations,
    appointments,
    readings,
  ] = await Promise.all([
    collections.conditions.find({ patientId }, { sort: { startedAt: -1 } }),
    collections.courses.find({ patientId }),
    collections.doses.find({ patientId }),
    collections.medications.find({}),
    collections.prescriptions.find({ patientId }),
    collections.doctors.find({ patientId }),
    collections.visits.find({ patientId }, { sort: { visitDate: -1 } }),
    collections.sideEffects.find({ patientId }, { sort: { reportedAt: -1 } }),
    collections.labResults.find({ patientId }, { sort: { takenAt: -1 }, limit: 4 }),
    collections.immunisations.find({ patientId }, { sort: { givenAt: -1 } }),
    collections.appointments.find(
      { patientId, status: 'scheduled' },
      { sort: { scheduledFor: 1 } },
    ),
    buildReadings(patientId, now),
  ]);

  const medicationsById = new Map(medications.map((m) => [m._id, m]));
  const prescriptionsById = new Map(prescriptions.map((p) => [p._id, p]));
  const doctorsById = new Map(doctors.map((d) => [d._id, d]));
  const conditionsById = new Map(conditions.map((c) => [c._id, c]));

  /* --- What they are taking right now ----------------------------------- */

  const current = courses
    .filter((course) => course.status === 'active' || course.status === 'not_started')
    .sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0))
    .map((course) => {
      const medication = medicationsById.get(course.medicationId);
      const prescription = course.prescriptionId
        ? prescriptionsById.get(course.prescriptionId)
        : undefined;
      const doctor = prescription ? doctorsById.get(prescription.doctorId) : undefined;
      const condition = course.conditionId ? conditionsById.get(course.conditionId) : undefined;

      const theirDoses = doses.filter((dose) => dose.courseId === course._id);
      const taken = theirDoses.filter((dose) => isTaken(dose.status)).length;

      return {
        medicationName: course.medicationName,
        strength: medication?.strength ?? null,
        instructionLine: instructionLineFor(course, medication?.form ?? 'tablet'),
        kindLabel: MEDICATION_KIND_LABELS[medication?.kind ?? 'prescription'],
        selfManaged: course.origin === 'self',
        prescribedBy: doctor?.name ?? null,
        forCondition: condition?.name ?? null,
        startedLabel: course.startedAt ? formatDayMonthSmart(course.startedAt, tz, now) : null,
        // The number a prescriber actually wants, and the honest form of it:
        // taken out of planned, not a percentage that hides the denominator.
        adherenceLabel:
          course.totalDoses === null
            ? theirDoses.length === 0
              ? null
              : `${taken} taken so far`
            : `${taken} of ${course.totalDoses} taken`,
        paused: course.pausedAt !== null,
      };
    });

  /* --- Everything else --------------------------------------------------- */

  const conditionRows = conditions.map((condition) => {
    const theirVisits = visits.filter((visit) => visit.conditionId === condition._id);
    const doctorNames = [
      ...new Set(
        theirVisits
          .map((visit) => doctorsById.get(visit.doctorId)?.name)
          .filter((name): name is string => name !== undefined),
      ),
    ];

    return {
      name: condition.name,
      statusLabel: CONDITION_STATUS_LABELS[condition.status],
      startedLabel: formatDayMonthSmart(condition.startedAt, tz, now),
      resolvedLabel: condition.resolvedAt ? formatDayMonthSmart(condition.resolvedAt, tz, now) : null,
      isChronic: condition.isChronic,
      doctorNames,
    };
  });

  return {
    generatedAt: now,
    generatedAtLabel: `${formatDayMonth(now, tz)} ${new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
    }).format(now)}`,
    patient: {
      name: patient.name,
      dateOfBirthLabel: patient.dateOfBirth ? formatDayMonthYear(patient.dateOfBirth, tz) : null,
      ageLabel: patient.dateOfBirth ? `${ageFrom(patient.dateOfBirth, now)} years old` : null,
      phone: patient.phone,
      timeZone: tz,
    },
    // First, always, and the empty case says so out loud rather than printing
    // nothing: "none recorded" and "we never asked" look identical otherwise.
    allergies: patient.allergies.map((allergy) => ({
      substance: allergy.substance,
      reaction: allergy.reaction ?? null,
      severityLabel: ALLERGY_SEVERITY_LABELS[allergy.severity],
      severity: allergy.severity,
    })),
    currentMedicines: current,
    conditions: conditionRows,
    sideEffects: sideEffects.map((report) => ({
      medicationName: report.medicationName,
      symptom: report.symptom,
      severityLabel: SIDE_EFFECT_SEVERITY_LABELS[report.severity],
      startedLabel: formatDayMonthSmart(report.startedAt, tz, now),
      ongoing: report.resolvedAt === null,
    })),
    recentReadings: readings.series
      .filter((series) => series.points.length > 0)
      .map((series) => ({
        label: series.label,
        latest: series.latestLabel ?? '—',
        takenAtLabel: series.latestAtLabel ?? '',
        countLabel: `${series.points.length} recorded`,
        averageLabel: series.averageLabel,
      })),
    recentResults: labs.map((lab) => ({
      panelName: lab.panelName,
      dateLabel: formatDayMonthSmart(lab.takenAt, tz, now),
      lines: lab.items.map((item) => {
        const unit = item.unit ? ` ${item.unit}` : '';
        const range = item.referenceRange ? ` (ref ${item.referenceRange})` : '';
        const flag =
          item.flag === 'low' ? ' — L' : item.flag === 'high' ? ' — H' : item.flag === 'abnormal' ? ' — abnormal' : '';
        return `${item.name}: ${item.value}${unit}${range}${flag}`;
      }),
    })),
    immunisations: immunisations.map((jab) => ({
      name: jab.doseLabel ? `${jab.name} (${jab.doseLabel})` : jab.name,
      dateLabel: formatDayMonthSmart(jab.givenAt, tz, now),
      nextDueLabel: jab.nextDueAt ? formatDayMonthSmart(jab.nextDueAt, tz, now) : null,
    })),
    recentVisits: visits.slice(0, 6).map((visit) => ({
      dateLabel: formatDayMonthSmart(visit.visitDate, tz, now),
      doctorName: doctorsById.get(visit.doctorId)?.name ?? 'Unknown doctor',
      reason: visit.reason,
      diagnosis: visit.diagnosis ?? null,
      vitalsLine: vitalsLine(visit.vitals),
    })),
    upcomingAppointments: appointments.map((appointment) => ({
      dateLabel: `${formatDayMonth(appointment.scheduledFor, tz)}, ${new Intl.DateTimeFormat(
        'en-GB',
        { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
      ).format(appointment.scheduledFor)}`,
      withWhom: appointment.withWhom,
      typeLabel:
        appointment.status === 'scheduled'
          ? VISIT_TYPE_LABELS[appointment.type]
          : APPOINTMENT_STATUS_LABELS[appointment.status],
    })),
    provenanceNote:
      `Kept by ${patient.name} in the Medication Agent app. It records what they were told and ` +
      `what they took, including medicines they take without a prescription. It is not a ` +
      `clinical record, nothing on it has been reviewed by a clinician, and the adherence ` +
      `figures are what the app observed rather than what was swallowed.`,
  };
}

function vitalsLine(vitals: Visit['vitals']): string | null {
  if (!vitals) return null;
  const parts: string[] = [];
  const bp = describeBloodPressure(vitals);
  if (bp) parts.push(`BP ${bp}`);
  if (vitals.pulseBpm !== undefined) parts.push(`pulse ${vitals.pulseBpm}`);
  if (vitals.temperatureC !== undefined) parts.push(`temp ${vitals.temperatureC}°C`);
  if (vitals.weightKg !== undefined) parts.push(`weight ${vitals.weightKg} kg`);
  return parts.length === 0 ? null : parts.join(' · ');
}

function formatDayMonthYear(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(instant);
}

/** Years, in the patient's own zone — a birthday is a calendar date. */
function ageFrom(dateOfBirth: Date, now: Date): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const month = now.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (month < 0 || (month === 0 && now.getUTCDate() < dateOfBirth.getUTCDate())) age -= 1;
  return age;
}
