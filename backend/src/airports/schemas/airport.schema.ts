import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

// FLT-02, GEN-12: the official IATA identifier is the primary key.
@Schema({ collection: 'airports', timestamps: true })
export class Airport {
  @Prop({ type: String, required: true }) _id: string;
  @Prop({ required: true, unique: true, match: /^[A-Z]{3}$/ }) iataCode: string;
  @Prop({ required: true }) name: string;
  @Prop({ type: String, ref: 'City', required: true, index: true })
  cityId: string;
  @Prop({ type: String, ref: 'Country', required: true }) countryCode: string;
  @Prop({
    required: true,
    validate: {
      validator: (zone: string) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: zone });
          return zone.includes('/');
        } catch {
          return false;
        }
      },
      message: 'Use the official IANA airport time zone (FLT-02)',
    },
  })
  timeZone: string;
}
export type AirportDocument = HydratedDocument<Airport>;
export const AirportSchema = SchemaFactory.createForClass(Airport);
AirportSchema.pre('validate', function () {
  if (this._id !== this.iataCode)
    this.invalidate(
      'iataCode',
      'Airport primary key must equal its official IATA code (FLT-02)',
    );
});
