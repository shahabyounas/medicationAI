import { describe, expect, it } from 'vitest';
import {
  ESCALATION_ENTRY_NODE,
  ESCALATION_GRAPH,
  escalationPath,
  getNode,
  isTerminal,
  nextNode,
  scheduledRunAt,
  shouldShortCircuitToFamily,
} from './graph.js';
import { EscalationNodeIdSchema, type EscalationNodeId } from '../schemas/escalation.js';

describe('the escalation graph', () => {
  it('defines a node for every id in the schema, and no extras', () => {
    const schemaIds = [...EscalationNodeIdSchema.options].sort();
    const graphIds = Object.keys(ESCALATION_GRAPH).sort();
    expect(graphIds).toEqual(schemaIds);
  });

  it('gives every node an id matching its key', () => {
    for (const [key, node] of Object.entries(ESCALATION_GRAPH)) {
      expect(node.id).toBe(key);
    }
  });

  it('points every edge at a node that exists', () => {
    for (const node of Object.values(ESCALATION_GRAPH)) {
      if (node.next === null) continue;
      expect(ESCALATION_GRAPH[node.next]).toBeDefined();
    }
  });

  it('terminates: no node has an outgoing edge unless it is non-terminal', () => {
    for (const node of Object.values(ESCALATION_GRAPH)) {
      if (node.terminal) {
        expect(node.next).toBeNull();
        expect(node.offsetMinutes).toBeNull();
      } else {
        expect(node.next).not.toBeNull();
        expect(node.offsetMinutes).not.toBeNull();
      }
    }
  });

  it('reaches a terminal node from the entry point without looping', () => {
    const path = escalationPath();
    expect(path[0]!.id).toBe(ESCALATION_ENTRY_NODE);
    expect(path.at(-1)!.terminal).toBe(true);

    const ids = path.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('escalates strictly later at each rung', () => {
    const path = escalationPath().filter((n) => n.offsetMinutes !== null);
    for (let i = 1; i < path.length; i += 1) {
      expect(path[i]!.offsetMinutes!).toBeGreaterThan(path[i - 1]!.offsetMinutes!);
    }
  });

  it('follows the ladder the design specifies, in order', () => {
    expect(escalationPath().map((n) => n.id)).toEqual([
      'reminder_1',
      'reminder_2',
      'text_message',
      'check_in',
      'notify_family',
      'replan',
      'exhausted',
    ]);
  });

  it('reaches the family last, never first', () => {
    const ids = escalationPath().map((n) => n.id);
    const familyIndex = ids.indexOf('notify_family');

    expect(familyIndex).toBeGreaterThan(ids.indexOf('reminder_1'));
    expect(familyIndex).toBeGreaterThan(ids.indexOf('reminder_2'));
    expect(familyIndex).toBeGreaterThan(ids.indexOf('text_message'));
    expect(familyIndex).toBeGreaterThan(ids.indexOf('check_in'));
  });

  it('tries the patient directly on every rung before involving anyone else', () => {
    for (const node of escalationPath()) {
      if (node.id === 'notify_family') break;
      expect(node.channel).not.toBe('family');
    }
  });

  it('matches the timings on the design\'s escalation ladder', () => {
    expect(getNode('reminder_1').offsetMinutes).toBe(0);
    expect(getNode('reminder_2').offsetMinutes).toBe(15);
    expect(getNode('text_message').offsetMinutes).toBe(45);
    expect(getNode('check_in').offsetMinutes).toBe(120);
    expect(getNode('notify_family').offsetMinutes).toBe(180);
  });
});

describe('getNode', () => {
  it('throws on an unknown node rather than returning undefined', () => {
    expect(() => getNode('not_a_node' as EscalationNodeId)).toThrow(/unknown escalation node/);
  });
});

describe('nextNode', () => {
  it('walks forward one rung', () => {
    expect(nextNode('reminder_1')?.id).toBe('reminder_2');
    expect(nextNode('check_in')?.id).toBe('notify_family');
  });

  it('returns null at a terminal node', () => {
    expect(nextNode('resolved')).toBeNull();
    expect(nextNode('exhausted')).toBeNull();
  });
});

describe('isTerminal', () => {
  it('marks only resolved and exhausted as terminal', () => {
    expect(isTerminal('resolved')).toBe(true);
    expect(isTerminal('exhausted')).toBe(true);
    expect(isTerminal('reminder_1')).toBe(false);
    expect(isTerminal('notify_family')).toBe(false);
  });
});

describe('scheduledRunAt', () => {
  const dueAt = new Date('2026-08-04T13:00:00Z');

  it('fires the first reminder exactly on time', () => {
    expect(scheduledRunAt(dueAt, 'reminder_1')?.toISOString()).toBe('2026-08-04T13:00:00.000Z');
  });

  it('offsets each later rung from the dose time', () => {
    expect(scheduledRunAt(dueAt, 'reminder_2')?.toISOString()).toBe('2026-08-04T13:15:00.000Z');
    expect(scheduledRunAt(dueAt, 'text_message')?.toISOString()).toBe('2026-08-04T13:45:00.000Z');
    expect(scheduledRunAt(dueAt, 'check_in')?.toISOString()).toBe('2026-08-04T15:00:00.000Z');
    expect(scheduledRunAt(dueAt, 'notify_family')?.toISOString()).toBe('2026-08-04T16:00:00.000Z');
  });

  it('never schedules a terminal node', () => {
    expect(scheduledRunAt(dueAt, 'resolved')).toBeNull();
    expect(scheduledRunAt(dueAt, 'exhausted')).toBeNull();
  });
});

describe('shouldShortCircuitToFamily', () => {
  it('holds off while the patient is still keeping up', () => {
    expect(shouldShortCircuitToFamily(0, 2)).toBe(false);
    expect(shouldShortCircuitToFamily(1, 2)).toBe(false);
  });

  it('brings the family in once the run of misses hits the threshold', () => {
    expect(shouldShortCircuitToFamily(2, 2)).toBe(true);
    expect(shouldShortCircuitToFamily(5, 2)).toBe(true);
  });

  it('respects a contact who asked to be told sooner', () => {
    expect(shouldShortCircuitToFamily(1, 1)).toBe(true);
  });
});
