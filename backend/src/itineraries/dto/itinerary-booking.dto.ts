import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsMongoId } from 'class-validator';
import type { BookingType } from '../../common/interfaces/index.js';

/** POST /api/itineraries/:id/bookings (ITN-27, bonus). */
export class LinkBookingDto {
  @ApiProperty({ enum: ['flight', 'hotel'], example: 'hotel' })
  @IsIn(['flight', 'hotel'])
  bookingType: BookingType;

  @ApiProperty({ description: 'One of my Confirmed or Completed bookings' })
  @IsMongoId()
  bookingId: string;

  @ApiProperty({ description: 'Day of this itinerary to link it to' })
  @IsMongoId()
  dayId: string;
}

export class LinkedBookingDto {
  @ApiProperty({ description: 'Id of the link (used to unlink)' }) id: string;
  @ApiProperty() dayId: string;
  @ApiProperty({ enum: ['flight', 'hotel'] }) bookingType: BookingType;
  @ApiProperty() bookingId: string;
  @ApiProperty({ example: 'Confirmed', description: 'Current booking status' })
  status: string;
  @ApiProperty({ example: 3000 }) amount: number;
  @ApiProperty({ example: 'EGP' }) currency: string;
  @ApiProperty({
    description:
      'true while the booking is Confirmed or Completed: hotels count as accommodation, flights as intercity transport',
  })
  countsInBudget: boolean;
}
