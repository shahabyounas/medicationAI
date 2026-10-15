import { randomUUID } from 'node:crypto';
import {
  calendarDaysBetween,
  type Allergy,
  type FamilyContact,
  type ProfileResponse,
  type UpdateProfileRequest,
  type UpdateProfileResponse,
} from '@medication-ai/shared';
import { collections } from '../db/collections.js';
import { reanchorToMealtimes } from './doseService.js';

/**
 * Who the patient is, what must not be given to them, and who gets rung.
 *
 * There was no profile screen at all, which left two things stranded. The
 * allergy list is new and has to be editable by definition. The family contact
 * was not: it has been the last rung of the escalation ladder from the
 * beginning, and no screen in the app could add, change or remove the person
 * who gets the phone call. It was seed data or nothing.
 */
export async function buildProfile(
  patientId: string,
  now = new Date(),
): Promise<ProfileResponse> {
  const patient = await collections.patients.requireById(patientId);

  const [conditions, visits, courses, dosesTaken, readings, documents, firstCondition] =
    await Promise.all([
      collections.conditions.count({ patientId }),
      collections.visits.count({ patientId }),
      collections.courses.count({ patientId }),
      collections.doses.count({ patientId, status: { $in: ['taken', 'taken_late'] } }),
      collections.readings.count({ patientId }),
      collections.documents.count({ patientId }),
      collections.conditions.findOne({ patientId }, { sort: { startedAt: 1 } }),
    ]);

  const contact = patient.familyContacts[0];

  return {
    patient,
    totals: {
      conditions,
      visits,
      medicines: courses,
      dosesTaken,
      readings,
      documents,
      spanLabel: spanLabelFor(firstCondition?.startedAt ?? null, now, patient.timezone),
    },
    escalationSummary: contact
      ? `If I cannot reach you for ${Math.round(
          contact.notifyAfterMinutes / 60,
        )} hours, or you miss ${contact.notifyAfterConsecutiveMisses} doses in a row, I will text ${
          contact.name
        }. Never before that.`
      : 'Nobody is set up as a last resort. If I cannot reach you, the chasing simply stops.',
  };
}

/**
 * Save the profile, and move the doses if the mealtimes changed.
 *
 * The two lists are written whole rather than patched item by item, because the
 * editor edits them whole and a partial update of a three-element list is more
 * API surface than the problem deserves. Ids are preserved when the client
 * sends them back: regenerating them on every save — which is what
 * `PATCH /patients/:id` does to family contacts — would break any reference to
 * a contact from anywhere else, and makes "which one did I just edit?"
 * unanswerable.
 */
export async function updateProfile(
  patientId: string,
  input: UpdateProfileRequest,
  now = new Date(),
): Promise<UpdateProfileResponse> {
  const before = await collections.patients.requireById(patientId);
  const { allergies, familyContacts, dateOfBirth, heightCm, ...rest } = input;

  const patient = await collections.patients.updateById(patientId, {
    ...rest,
    ...(dateOfBirth !== undefined
      ? dateOfBirth === null
        ? { dateOfBirth: undefined }
        : { dateOfBirth }
      : {}),
    ...(heightCm !== undefined
      ? heightCm === null
        ? { heightCm: undefined }
        : { heightCm }
      : {}),
    ...(allergies
      ? {
          allergies: allergies.map(
            (allergy): Allergy => ({
              ...allergy,
              id: allergy.id ?? randomUUID(),
              recordedAt: allergy.recordedAt ?? now,
            }),
          ),
        }
      : {}),
    ...(familyContacts
      ? {
          familyContacts: familyContacts.map(
            (contact): FamilyContact => ({ ...contact, id: contact.id ?? randomUUID() }),
          ),
        }
      : {}),
  });

  // Mealtimes are not a preference that waits for the next prescription: the
  // running course is scheduled against them, so it moves too.
  const movedDoses = input.mealtimes
    ? await reanchorToMealtimes(patientId, before.mealtimes, patient.mealtimes, now)
    : 0;

  return { patient, movedDoses };
}

function spanLabelFor(firstAt: Date | null, now: Date, timeZone: string): string {
  if (!firstAt) return 'Nothing filed yet';
  const days = calendarDaysBetween(firstAt, now, timeZone);
  if (days < 31) return `${Math.max(1, days)} days of records`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} months of records`;
  return `${Math.round(days / 365)} years of records`;
}
