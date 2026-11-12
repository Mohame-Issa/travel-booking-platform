import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  FLIGHT_CANCELLED, FLIGHT_UPDATED, FlightEventsService, type FlightEventPayload,
} from './flight-bookings.imports.js';
import { FlightBookingsService } from './flight-bookings.service.js';

@Injectable()
export class FlightBookingEventsListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FlightBookingEventsListener.name);
  private timers: ReturnType<typeof setInterval>[] = [];
  private readonly done = new Set<string>(); // Yassin delivers at-least-once; skip repeats

  constructor(
    private readonly flightEvents: FlightEventsService,
    private readonly bookings: FlightBookingsService,
  ) {}

  onModuleInit() {
    this.flightEvents.on(FLIGHT_CANCELLED, (p: FlightEventPayload) =>
      this.once(p, () => this.bookings.handleFlightCancelled(p)));
    this.flightEvents.on(FLIGHT_UPDATED, (p: FlightEventPayload) =>
      this.once(p, () => this.bookings.handleFlightUpdated(p)));

    this.every(30_000, async () => {
      const n = await this.bookings.expireOverdueHolds();
      if (n) this.logger.log(`Released ${n} expired hold(s)`);
    });
    this.every(300_000, () => this.bookings.completeDeparted());
  }

  onModuleDestroy() { this.timers.forEach(clearInterval); }

  private async once(p: FlightEventPayload, work: () => Promise<void>) {
    if (this.done.has(p.eventId)) return;
    await work(); // if it throws, Yassin's outbox retries later
    this.done.add(p.eventId);
    if (this.done.size > 500) this.done.delete(this.done.values().next().value as string);
  }

  private every(ms: number, job: () => Promise<unknown>) {
    const t = setInterval(() => { job().catch((e: Error) => this.logger.error(e.message)); }, ms);
    t.unref();
    this.timers.push(t);
  }
}