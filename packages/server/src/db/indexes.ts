import { getDatabase } from './client.js';

/**
 * Indexes, created at boot.
 *
 * The one that matters most is `escalation_states.nextRunAt`: the agent loop
 * queries it on every tick, and without an index that becomes a full collection
 * scan several times a minute for the life of the process.
 */
export async function ensureIndexes(): Promise<void> {
  const db = getDatabase();

  await Promise.all([
    db.collection('doctors').createIndex({ patientId: 1, name: 1 }),
    db.collection('visits').createIndex({ patientId: 1, visitDate: -1 }),
    db.collection('visits').createIndex({ doctorId: 1, visitDate: -1 }),
    db.collection('conditions').createIndex({ patientId: 1, status: 1, startedAt: -1 }),
    db.collection('conditions').createIndex({ patientId: 1, name: 1 }),
    db.collection('medications').createIndex({ name: 1 }, { unique: true }),
    db.collection('prescriptions').createIndex({ patientId: 1, issuedAt: -1 }),
    db.collection('prescriptions').createIndex({ visitId: 1 }),
    db.collection('courses').createIndex({ patientId: 1, status: 1 }),
    db.collection('courses').createIndex({ prescriptionId: 1 }),
    db.collection('courses').createIndex({ conditionId: 1 }),
    db.collection('doses').createIndex({ courseId: 1, doseNumber: 1 }),
    db.collection('doses').createIndex({ patientId: 1, scheduledAt: 1 }),
    db.collection('doses').createIndex({ patientId: 1, status: 1, scheduledAt: 1 }),
    db.collection('agent_events').createIndex({ patientId: 1, occurredAt: -1 }),
    db.collection('agent_events').createIndex({ doseId: 1 }),
    // The agent loop's hot path.
    db.collection('escalation_states').createIndex({ nextRunAt: 1 }),
    db.collection('escalation_states').createIndex({ doseId: 1 }, { unique: true }),
    // One row per browser install; re-subscribing must update, not duplicate.
    db.collection('push_subscriptions').createIndex({ endpoint: 1 }, { unique: true }),
    db.collection('push_subscriptions').createIndex({ patientId: 1 }),
    // A reading is only ever read as a series: one metric, in time order.
    db.collection('readings').createIndex({ patientId: 1, metric: 1, takenAt: -1 }),
    db.collection('side_effects').createIndex({ patientId: 1, reportedAt: -1 }),
    db.collection('side_effects').createIndex({ courseId: 1 }),
    // One entry per condition per day, which is also what makes the one-tap
    // prompt idempotent: asking twice must not produce two rows.
    db.collection('symptom_entries').createIndex({ patientId: 1, conditionId: 1, recordedAt: -1 }),
    // The appointment reminder's hot path, mirroring escalation_states.nextRunAt.
    db.collection('appointments').createIndex({ status: 1, scheduledFor: 1 }),
    db.collection('appointments').createIndex({ patientId: 1, scheduledFor: -1 }),
    db.collection('appointments').createIndex({ originVisitId: 1 }),
    db.collection('lab_results').createIndex({ patientId: 1, takenAt: -1 }),
    db.collection('immunisations').createIndex({ patientId: 1, givenAt: -1 }),
    db.collection('health_documents').createIndex({ patientId: 1, capturedAt: -1 }),
  ]);
}
