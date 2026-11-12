import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsBoolean, IsIn, IsMongoId } from 'class-validator';
import type { BookingType } from '../../common/interfaces/index.js';

/** Route params of /api/bookings/:type/:id/... */
export class BookingRefParamsDto {
  @ApiProperty({ enum: ['flight', 'hotel'], example: 'flight' })
  @IsIn(['flight', 'hotel'])
  type: BookingType;

  @ApiProperty({
    example: '64b0000000000000000000aa',
    description: 'Booking id',
  })
  @IsMongoId()
  id: string;
}

/** PAY-02: the acceptance checkbox. Must be ticked (true). */
export class AcceptPoliciesDto {
  @ApiProperty({ example: true, description: 'Must be true (checkbox ticked)' })
  @IsBoolean()
  @Equals(true, { message: 'You must accept the policies to continue' })
  accepted: boolean;
}

export class CancellationTierDto {
  @ApiProperty({ example: 7, description: 'Days before departure / check-in' })
  daysBefore: number;

  @ApiProperty({ example: 50, description: 'Refund percentage (0-100)' })
  refundPercentage: number;
}

/**
 * Named differently from Yassin Shawr's airlines BaggagePolicyDto: Swagger
 * needs unique schema names, otherwise one overwrites the other.
 */
export class PolicyBaggageSnapshotDto {
  @ApiProperty({ example: 1 }) freeBags: number;
  @ApiProperty({ example: 23 }) maxWeightKgPerBag: number;
  @ApiProperty({ example: 40, description: 'Price per extra bag' })
  extraBagPrice: number;
  @ApiProperty({ example: 2 }) maxExtraBags: number;
}

export class BookingPoliciesResponseDto {
  @ApiProperty({ enum: ['flight', 'hotel'] })
  bookingType: BookingType;

  @ApiProperty()
  bookingId: string;

  @ApiProperty({
    type: [CancellationTierDto],
    description:
      'FLT-09 / HTL-10. Refund = tier with the highest threshold not exceeding the days remaining; none applies -> 0%.',
  })
  cancellationTiers: CancellationTierDto[];

  @ApiPropertyOptional({
    type: PolicyBaggageSnapshotDto,
    nullable: true,
    description: 'Flights only',
  })
  baggagePolicy: PolicyBaggageSnapshotDto | null;

  @ApiPropertyOptional({
    example: '14:00',
    nullable: true,
    description: 'Hotels only',
  })
  checkInTime: string | null;

  @ApiPropertyOptional({
    example: '12:00',
    nullable: true,
    description: 'Hotels only',
  })
  checkOutTime: string | null;

  @ApiProperty({ description: 'True once the user accepted (PAY-02)' })
  accepted: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  acceptedAt: Date | null;
}
