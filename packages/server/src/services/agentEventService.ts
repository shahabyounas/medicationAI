import type { AgentEvent, CreateAgentEvent } from '@medication-ai/shared';
import { collections } from '../db/collections.js';

/**
 * The agent's log.
 *
 * Every action goes through here, which is what makes "every escalation is
 * logged and visible to both of them" true by construction rather than by
 * remembering to call it.
 */
export async function logAgentEvent(event: CreateAgentEvent): Promise<AgentEvent> {
  return collections.agentEvents.insert(event);
}

export async function recentEvents(patientId: string, limit = 20): Promise<AgentEvent[]> {
  return collections.agentEvents.find({ patientId }, { sort: { occurredAt: -1 }, limit });
}

/** Events from today, oldest first — the "what your agent did today" feed. */
export async function eventsSince(
  patientId: string,
  since: Date,
  limit = 40,
): Promise<AgentEvent[]> {
  return collections.agentEvents.find(
    { patientId, occurredAt: { $gte: since } },
    { sort: { occurredAt: -1 }, limit },
  );
}

export async function familyVisibleEvents(patientId: string, limit = 20): Promise<AgentEvent[]> {
  return collections.agentEvents.find(
    { patientId, visibleToFamily: true },
    { sort: { occurredAt: -1 }, limit },
  );
}
