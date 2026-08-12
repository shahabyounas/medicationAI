import { PushPayloadSchema, type Channel } from '@medication-ai/shared';
import { isPushConfigured } from '../push/vapid.js';
import { sendToPatient } from '../services/pushService.js';

/**
 * How the agent actually reaches someone.
 *
 * The escalation graph decides *that* a message should go out over a given
 * channel; this decides *how*. Keeping them apart means a real provider is one
 * implementation here and no change to the ladder.
 *
 * Only `push` has a real transport today. Everything else is recorded and
 * logged — which is the honest behaviour for a system with no SMS account
 * attached. Nothing is ever reported as delivered that was not.
 */

export interface Delivery {
  channel: Channel;
  to: string;
  recipientName: string;
  message: string;
  sentAt: Date;
  /** How it actually went out: a real transport, or `logged` for a stand-in. */
  transport: string;
}

/** Extra context a push notification needs to be actionable. */
export interface PushContext {
  patientId: string;
  doseId: string | null;
  title: string;
  /** Collapses repeat reminders for the same dose into one notification. */
  tag: string;
  /** Show "I took it" / "Not yet" buttons. */
  actionable: boolean;
  urgent: boolean;
  escalationNodeId: string | null;
}

export interface DeliveryRequest {
  channel: Channel;
  to: string;
  recipientName: string;
  message: string;
  push?: PushContext;
}

export interface DeliveryChannel {
  readonly name: string;
  send(request: DeliveryRequest): Promise<Delivery>;
}

/**
 * Records every attempt and prints it.
 *
 * `recent()` is what the dev UI and the tests read to assert the agent said
 * what it should have said, to whom.
 */
export class DeliveryRecorder {
  private readonly log: Delivery[] = [];

  constructor(
    private readonly maxRetained = 200,
    /** Tests assert on `recent()`; printing every reminder just buries them. */
    private readonly quiet = Boolean(process.env.VITEST),
  ) {}

  record(request: DeliveryRequest, transport: string): Delivery {
    const delivery: Delivery = {
      channel: request.channel,
      to: request.to,
      recipientName: request.recipientName,
      message: request.message,
      sentAt: new Date(),
      transport,
    };
    this.log.push(delivery);
    if (this.log.length > this.maxRetained) this.log.shift();

    if (!this.quiet) {
      const label = `${request.channel.toUpperCase()} → ${request.recipientName} <${request.to}>`;
      console.log(`[agent] ${label} (${transport}): ${request.message}`);
    }
    return delivery;
  }

  recent(limit = 50): Delivery[] {
    return this.log.slice(-limit).reverse();
  }

  clear(): void {
    this.log.length = 0;
  }
}

/**
 * Routes each channel to its transport.
 *
 * A push that reaches no device is reported as such rather than as a success —
 * "sent to nobody" and "sent" must not look the same in the log, or the
 * escalation ladder will appear to be working when it is shouting into a void.
 */
export class DeliveryRouter implements DeliveryChannel {
  readonly name = 'router';
  private readonly recorder = new DeliveryRecorder();

  async send(request: DeliveryRequest): Promise<Delivery> {
    let transport = 'logged';

    if (request.channel === 'push' && request.push) {
      if (!isPushConfigured()) {
        transport = 'logged (push not configured)';
      } else {
        const payload = PushPayloadSchema.parse({
          title: request.push.title,
          body: request.message,
          tag: request.push.tag,
          doseId: request.push.doseId,
          patientId: request.push.patientId,
          escalationNodeId: request.push.escalationNodeId,
          actionable: request.push.actionable,
          url: '/#today',
          urgent: request.push.urgent,
        });

        try {
          const result = await sendToPatient(request.push.patientId, payload);
          transport =
            result.delivered > 0
              ? `web-push → ${result.delivered} device${result.delivered === 1 ? '' : 's'}`
              : 'push (no registered devices)';
        } catch (error) {
          // A push failure must not stop the ladder; the next rung still runs.
          transport = `push failed: ${error instanceof Error ? error.message : 'unknown'}`;
        }
      }
    }

    return this.recorder.record(request, transport);
  }

  recent(limit = 50): Delivery[] {
    return this.recorder.recent(limit);
  }

  clear(): void {
    this.recorder.clear();
  }
}

/** The channel the running server uses. */
export const deliveryChannel = new DeliveryRouter();
