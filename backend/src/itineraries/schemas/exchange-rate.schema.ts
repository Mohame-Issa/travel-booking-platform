import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';

/**
 * ITN-18: exchange rates fetched once per day from the configured public API
 * and cached here. If the API is unavailable, the latest cached day is used.
 * Collection: "exchangerates". One document per (base, rateDate).
 */
@Schema({ timestamps: true, collection: 'exchangerates' })
export class ExchangeRate {
  /** Base currency of `rates`, e.g. "EGP". */
  @Prop({ type: String, required: true, uppercase: true })
  base: string;

  /** Date the rates are for, "YYYY-MM-DD" (shown to the user, ITN-18). */
  @Prop({ type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  rateDate: string;

  /** 1 base = rates[code] code, for the supported currencies. */
  @Prop({ type: Map, of: Number, required: true })
  rates: Map<string, number>;

  createdAt: Date;
  updatedAt: Date;
}

export type ExchangeRateDocument = HydratedDocument<ExchangeRate>;
export const ExchangeRateSchema = SchemaFactory.createForClass(ExchangeRate);
ExchangeRateSchema.index({ base: 1, rateDate: 1 }, { unique: true });
