import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { ProviderStatus } from '../../flights/catalogue.constants.js';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies.js';

@Schema({ collection: 'airlines', timestamps: true })
export class Airline {
  // Stable optional fixture identity survives moderator profile edits.
  @Prop({ type: String, unique: true, sparse: true, immutable: true })
  seedKey?: string;
  @Prop({ required: true, trim: true, maxlength: 100 }) name: string;
  @Prop({ required: true, trim: true, uppercase: true, unique: true })
  code: string;
  // GEN-08: URL returned by the shared upload service; never binary data.
  @Prop({ type: String, default: null }) logoUrl: string | null;
  @Prop({ required: true, uppercase: true, enum: SUPPORTED_CURRENCIES })
  currency: string;
  @Prop({
    type: String,
    enum: Object.values(ProviderStatus),
    default: ProviderStatus.ACTIVE,
    required: true,
    index: true,
  })
  status: ProviderStatus;
}
export type AirlineDocument = HydratedDocument<Airline>;
export const AirlineSchema = SchemaFactory.createForClass(Airline);
