import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

// FLT-09 / HTL-10: the highest applicable daysBefore threshold wins.
@Schema({ _id: false })
export class CancellationTier {
  @Prop({ required: true, min: 0, validate: Number.isInteger })
  daysBefore: number;
  @Prop({ required: true, min: 0, max: 100 }) refundPercentage: number;
}
export const CancellationTierSchema =
  SchemaFactory.createForClass(CancellationTier);

export function uniqueTierThresholds(tiers: CancellationTier[]): boolean {
  return new Set(tiers.map((tier) => tier.daysBefore)).size === tiers.length;
}
