import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId } from 'class-validator';
import type { BookingType } from '../../common/interfaces/index.js';
import { PaymentStatus } from '../payments.constants.js';

/**
 * POST /api/payments body. There is deliberately NO amount field:
 * the server computes the amount from the booking (never trust the client).
 */
export class CreatePaymentDto {
  @ApiProperty({ enum: ['flight', 'hotel'], example: 'flight' })
  @IsIn(['flight', 'hotel'])
  bookingType: BookingType;

  @ApiProperty({ example: '64b0000000000000000000aa' })
  @IsMongoId()
  bookingId: string;
}

export class PaymentResponseDto {
  @ApiProperty({ example: '6730f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ enum: ['flight', 'hotel'] })
  bookingType: BookingType;

  @ApiProperty()
  bookingId: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.PENDING })
  status: PaymentStatus;

  @ApiProperty({ example: 250.5, description: 'Amount in major units' })
  amount: number;

  @ApiProperty({
    example: 25050,
    description: 'Amount in minor units (as sent to Stripe)',
  })
  amountMinor: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ example: 'pi_3Q...', description: 'Stripe PaymentIntent id' })
  stripePaymentIntentId: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Pay before this time (10-minute hold)',
  })
  holdExpiresAt: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  succeededAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiPropertyOptional({
    example: 'pi_3Q..._secret_...',
    description:
      'Only returned by create/retry. The frontend passes it to Stripe Elements to confirm the card. Never stored.',
  })
  clientSecret?: string;
}
