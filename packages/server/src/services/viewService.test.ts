import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  confirmPrescription,
  createPrescription,
  startPrescription,
} from '../services/prescriptionService.js';
import { getDatabase } from '../db/client.js';
import { buildToday } from './viewService.js';
import {
  amoxicillinItem,
  connectTestDatabase,
  createScenario,
  disconnectTestDatabase,
  resetDatabase,
  type TestScenario,
} from '../testing/harness.js';

/**
 * The Today screen's day.
 *
 * "Today" is a calendar day where the patient is standing, which is the one
 * thing a UTC clock cannot tell you. These tests pin the window to real
 * instants in two zones, because the failure they guard against is silent: the
 * screen renders perfectly, just with the wrong doses on it.
 */

beforeAll(async () => {
  await connectTestDatabase();
});

afterAll(async () => {
  await disconnectTestDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

/** A 3×-a-day, 7-day course started at `startAt`. */
async function startCourse(scenario: TestScenario, startAt: Date): Promise<void> {
  const prescription = await createPrescription({
    patientId: scenario.patient._id,
    doctorId: scenario.doctor._id,
    visitId: null,
    conditionId: scenario.conditionId,
    issuedAt: startAt,
    source: 'manual',
    items: [amoxicillinItem(scenario.amoxicillin._id)],
  });
  await startPrescription(prescription._id, startAt);
}

describe('the Today window', () => {
  it('runs from the patient’s midnight to the patient’s midnight', async () => {
    // New York is five hours behind UTC in August, so UTC midnight on the 12th
    // is 8pm on the 11th there. Taking that as the start of the day moved the
    // whole window five hours early and pushed the 8:30pm dose out of it.
    const scenario = await createScenario({ timezone: 'America/New_York' });
    await startCourse(scenario, new Date('2026-08-12T12:00:00Z')); // 8am EDT

    const today = await buildToday(
      scenario.patient._id,
      new Date('2026-08-12T16:00:00Z'), // noon EDT, the same day
    );

    expect(today.doses.map((dose) => dose.clockTime)).toEqual([
      '8:30 AM',
      '1:30 PM',
      '8:30 PM',
    ]);
  });

  it('shows the same three doses for a patient in London', async () => {
    const scenario = await createScenario();
    await startCourse(scenario, new Date('2026-08-12T07:00:00Z')); // 8am BST

    const today = await buildToday(scenario.patient._id, new Date('2026-08-12T11:00:00Z'));

    expect(today.doses.map((dose) => dose.clockTime)).toEqual([
      '8:30 AM',
      '1:30 PM',
      '8:30 PM',
    ]);
  });

  it('keeps a late-evening dose on the day it is actually taken', async () => {
    // 11pm in New York is 3am the next morning in UTC. A UTC day boundary files
    // that dose under tomorrow and leaves the patient's evening looking empty.
    const scenario = await createScenario({ timezone: 'America/New_York' });
    await startCourse(scenario, new Date('2026-08-12T12:00:00Z'));

    const lateEvening = new Date('2026-08-13T03:00:00Z'); // 11pm EDT on the 12th
    const today = await buildToday(scenario.patient._id, lateEvening);

    expect(today.doses).toHaveLength(3);
    expect(today.doses.at(-1)?.clockTime).toBe('8:30 PM');
  });
});

/**
 * The "not yet, I haven't collected it" answer.
 *
 * A confirmed prescription is one the patient has checked and the agent is
 * holding until the medicine is in the house. It used to be invisible: no
 * screen read that status, and the only button that could start it lived on the
 * read-back dialog that had just been dismissed — so answering "not yet" meant
 * the course could never begin at all. These tests pin it to the home screen.
 */
describe('a prescription waiting on the medicine', () => {
  /**
   * Saved and checked, but not started — the state "not yet" leaves behind.
   *
   * `createdAt` is stamped with the real clock on insert, and the waiting label
   * counts from it — because what the patient wants to know is how long this has
   * been sitting there, not the date the doctor wrote it. The repository treats
   * `createdAt` as immutable, quite rightly, so backdating goes through the
   * driver to set up a prescription that was entered days ago.
   */
  async function confirmWithoutStarting(scenario: TestScenario, addedAt: Date): Promise<string> {
    const prescription = await createPrescription({
      patientId: scenario.patient._id,
      doctorId: scenario.doctor._id,
      visitId: null,
      conditionId: scenario.conditionId,
      issuedAt: addedAt,
      source: 'manual',
      items: [amoxicillinItem(scenario.amoxicillin._id)],
    });
    await confirmPrescription(prescription._id);
    await getDatabase()
      .collection<{ _id: string; createdAt: Date }>('prescriptions')
      .updateOne({ _id: prescription._id }, { $set: { createdAt: addedAt } });
    return prescription._id;
  }

  it('shows it on the home screen, in plain words', async () => {
    const scenario = await createScenario();
    const now = new Date('2026-08-12T11:00:00Z');
    const prescriptionId = await confirmWithoutStarting(scenario, now);

    const today = await buildToday(scenario.patient._id, now);

    expect(today.waiting).toHaveLength(1);
    expect(today.waiting[0]?._id).toBe(prescriptionId);
    expect(today.waiting[0]?.conditionName).toBe('Chest infection');
    expect(today.waiting[0]?.doctorName).toBe('Dr. Farhan Iqbal');
    expect(today.waiting[0]?.addedLabel).toBe('Added today');
    // The total matters: it is what makes "21 tablets" real rather than "a
    // course". The unit comes from the medicine's own form.
    expect(today.waiting[0]?.lines).toEqual([
      'Amoxicillin — 1 tablet · 3 times a day · after food · 7 days (21 tablets in all)',
    ]);
  });

  it('leaves the rest of the screen empty, because nothing is scheduled yet', async () => {
    const scenario = await createScenario();
    const now = new Date('2026-08-12T11:00:00Z');
    await confirmWithoutStarting(scenario, now);

    const today = await buildToday(scenario.patient._id, now);

    expect(today.doses).toEqual([]);
    expect(today.nextDose).toBeNull();
    expect(today.courseGroups).toEqual([]);
  });

  it('stops waiting once the patient says they have it', async () => {
    const scenario = await createScenario();
    const now = new Date('2026-08-12T07:00:00Z');
    const prescriptionId = await confirmWithoutStarting(scenario, now);

    await startPrescription(prescriptionId, now);
    const today = await buildToday(scenario.patient._id, new Date('2026-08-12T11:00:00Z'));

    expect(today.waiting).toEqual([]);
    expect(today.doses).toHaveLength(3);
  });

  it('says how long it has been waiting', async () => {
    const scenario = await createScenario();
    await confirmWithoutStarting(scenario, new Date('2026-08-12T11:00:00Z'));

    // Two days on from when the record was written.
    const today = await buildToday(scenario.patient._id, new Date('2026-08-14T11:00:00Z'));

    expect(today.waiting[0]?.addedLabel).toBe('Added 2 days ago');
  });
});
