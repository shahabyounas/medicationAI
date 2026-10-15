import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collections } from '../db/collections.js';
import { createPrescription, startPrescription } from './prescriptionService.js';
import { reportSideEffect, resumeChasing } from './sideEffectService.js';
import { tick } from '../agent/runner.js';
import { deliveryChannel } from '../agent/channels.js';
import {
  amoxicillinItem,
  connectTestDatabase,
  createScenario,
  disconnectTestDatabase,
  minutesAfter,
  resetDatabase,
  type TestScenario,
} from '../testing/harness.js';

/**
 * Reporting a side effect.
 *
 * The behaviour under test is a promise made in words the patient reads: "I've
 * stopped reminding you about it." Settling the open ladders is the obvious
 * half and it is not enough — the loop's activation pass turns any dose whose
 * time has come into `due` and opens a *fresh* ladder, so without the course
 * being marked the app would say it had stopped and then chase the next dose
 * four hours later.
 *
 * These assert against the delivery channel rather than against internal state,
 * because what matters is whether a message actually went out.
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

/** 8am BST on 12 August: a 3×-a-day, 7-day course of amoxicillin. */
const STARTED_AT = new Date('2026-08-12T07:00:00Z');

async function startCourse(scenario: TestScenario): Promise<{ courseId: string }> {
  const prescription = await createPrescription({
    patientId: scenario.patient._id,
    doctorId: scenario.doctor._id,
    visitId: null,
    conditionId: scenario.conditionId,
    issuedAt: STARTED_AT,
    source: 'manual',
    items: [amoxicillinItem(scenario.amoxicillin._id)],
  });
  const started = await startPrescription(prescription._id, STARTED_AT);
  return { courseId: started.courses[0]!._id };
}

describe('reporting a side effect', () => {
  it('pauses the chasing for anything worse than mild', async () => {
    const scenario = await createScenario();
    const { courseId } = await startCourse(scenario);

    const result = await reportSideEffect(
      {
        patientId: scenario.patient._id,
        courseId,
        symptom: 'Rash on my arms',
        severity: 'moderate',
        startedAt: STARTED_AT,
        stoppedTaking: false,
      },
      minutesAfter(STARTED_AT, 60),
    );

    expect(result.chasingPaused).toBe(true);
    expect(result.dosesCancelled).toBeGreaterThan(0);

    const course = await collections.courses.requireById(courseId);
    expect(course.pausedAt).not.toBeNull();
  });

  it('leaves a mild report chasing, because stopping is the doctor’s call', async () => {
    const scenario = await createScenario();
    const { courseId } = await startCourse(scenario);

    const result = await reportSideEffect(
      {
        patientId: scenario.patient._id,
        courseId,
        symptom: 'Slightly dry mouth',
        severity: 'mild',
        startedAt: STARTED_AT,
        stoppedTaking: false,
      },
      minutesAfter(STARTED_AT, 60),
    );

    expect(result.chasingPaused).toBe(false);
    const course = await collections.courses.requireById(courseId);
    expect(course.pausedAt).toBeNull();
  });

  it('pauses on a mild report when the patient has already stopped taking it', async () => {
    const scenario = await createScenario();
    const { courseId } = await startCourse(scenario);

    const result = await reportSideEffect(
      {
        patientId: scenario.patient._id,
        courseId,
        symptom: 'Felt a bit sick',
        severity: 'mild',
        startedAt: STARTED_AT,
        stoppedTaking: true,
      },
      minutesAfter(STARTED_AT, 60),
    );

    expect(result.chasingPaused).toBe(true);
  });

  /**
   * The one that would have shipped broken.
   *
   * A paused course must stay silent across ticks that activate later doses.
   * Settling the ladders alone passes the previous test and fails this one.
   */
  it('sends nothing on later ticks while the course is paused', async () => {
    const scenario = await createScenario();
    const { courseId } = await startCourse(scenario);

    await reportSideEffect(
      {
        patientId: scenario.patient._id,
        courseId,
        symptom: 'Rash',
        severity: 'severe',
        startedAt: STARTED_AT,
        stoppedTaking: true,
      },
      minutesAfter(STARTED_AT, 10),
    );

    deliveryChannel.clear();

    // Walk forward through the lunchtime and evening doses.
    for (const minutes of [360, 420, 480, 780, 840]) {
      await tick(minutesAfter(STARTED_AT, minutes));
    }

    expect(deliveryChannel.recent()).toHaveLength(0);
  });

  it('still records the doses as due, because they are genuinely owed', async () => {
    const scenario = await createScenario();
    const { courseId } = await startCourse(scenario);

    await reportSideEffect(
      {
        patientId: scenario.patient._id,
        courseId,
        symptom: 'Rash',
        severity: 'severe',
        startedAt: STARTED_AT,
        stoppedTaking: true,
      },
      minutesAfter(STARTED_AT, 10),
    );

    await tick(minutesAfter(STARTED_AT, 360));

    const settled = await collections.doses.count({
      courseId,
      status: { $in: ['due', 'missed'] },
    });
    expect(settled).toBeGreaterThan(0);
  });

  it('resumes when the doctor says carry on', async () => {
    const scenario = await createScenario();
    const { courseId } = await startCourse(scenario);

    await reportSideEffect(
      {
        patientId: scenario.patient._id,
        courseId,
        symptom: 'Rash',
        severity: 'moderate',
        startedAt: STARTED_AT,
        stoppedTaking: false,
      },
      minutesAfter(STARTED_AT, 10),
    );
    await resumeChasing(courseId, minutesAfter(STARTED_AT, 20));

    const course = await collections.courses.requireById(courseId);
    expect(course.pausedAt).toBeNull();

    deliveryChannel.clear();
    // The next dose after the resume should be chased normally.
    await tick(minutesAfter(STARTED_AT, 400));
    await tick(minutesAfter(STARTED_AT, 401));

    expect(deliveryChannel.recent().length).toBeGreaterThan(0);
  });

  it('files the report against the medicine, so it outlives the course', async () => {
    const scenario = await createScenario();
    const { courseId } = await startCourse(scenario);

    await reportSideEffect(
      {
        patientId: scenario.patient._id,
        courseId,
        symptom: 'Upset stomach',
        severity: 'mild',
        startedAt: STARTED_AT,
        stoppedTaking: false,
      },
      STARTED_AT,
    );

    await collections.courses.deleteById(courseId);
    const reports = await collections.sideEffects.find({ patientId: scenario.patient._id });

    expect(reports).toHaveLength(1);
    expect(reports[0]!.medicationName).toBe('Amoxicillin');
  });
});
