import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter } from 'node:events';
import { Model } from 'mongoose';
import { FlightEvent } from './schemas/flight-event.schema.js';

export const FLIGHT_CANCELLED = 'flight.cancelled';
export const FLIGHT_UPDATED = 'flight.updated';
export interface FlightEventPayload {
  eventId: string;
  flightId: string;
  airlineId: string;
  occurredAt: string;
  previousDepartureTime?: string;
  previousArrivalTime?: string;
  departureTime?: string;
  arrivalTime?: string;
}
export type FlightEventHandler = (
  payload: FlightEventPayload,
) => void | Promise<void>;

/** At-least-once, awaited local delivery backed by MongoDB. Consumers deduplicate eventId. */
@Injectable()
export class FlightEventsService
  extends EventEmitter
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(FlightEventsService.name);
  constructor(
    @InjectModel(FlightEvent.name) private readonly outbox: Model<FlightEvent>,
  ) {
    super();
  }
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.dispatchPending().catch(() =>
        this.logger.warn('Flight event dispatch deferred'),
      );
    }, 10_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async dispatchPending(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const topics = [FLIGHT_CANCELLED, FLIGHT_UPDATED].filter(
        (topic) => this.listenerCount(topic) > 0,
      );
      if (!topics.length) return; // Keep events until the real booking consumer is available.
      for (let i = 0; i < 100; i++) {
        const now = new Date();
        const event = await this.outbox
          .findOneAndUpdate(
            {
              topic: { $in: topics },
              deliveredAt: null,
              $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
            },
            {
              $set: { leaseUntil: new Date(+now + 60_000) },
              $inc: { attempts: 1 },
            },
            { sort: { createdAt: 1, _id: 1 }, returnDocument: 'after' },
          )
          .exec();
        if (!event) break;
        try {
          // Preserve EventEmitter once-wrapper removal and callback receiver semantics.
          const handlers = this.rawListeners(
            event.topic,
          ) as FlightEventHandler[];
          if (!handlers.length) {
            await this.outbox.updateOne(
              { _id: event._id },
              { $set: { leaseUntil: null } },
            );
            break;
          }
          const payload = {
            ...event.payload,
            eventId: String(event._id),
          } as unknown as FlightEventPayload;
          for (const handler of handlers) await handler.call(this, payload);
          await this.outbox.updateOne(
            { _id: event._id },
            { $set: { deliveredAt: new Date(), leaseUntil: null } },
          );
        } catch {
          this.logger.warn(
            'A flight event consumer failed; the persisted event will be retried',
          );
          break; // Lease makes retries bounded; do not undo the committed flight change.
        }
      }
    } finally {
      this.running = false;
    }
  }
}
