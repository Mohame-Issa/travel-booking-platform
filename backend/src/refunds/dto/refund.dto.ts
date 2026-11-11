import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  BookingType,
  RefundReason,
  RefundStatus,
} from '../../common/interfaces/index.js';

export class RefundResponseDto {
  @ApiProperty({ example: '6730f1c2a1b2c3d4e5f60719' })
  id: string;

  @ApiProperty()
  paymentId: string;

  @ApiProperty({ enum: ['flight', 'hotel'] })
  bookingType: BookingType;

  @ApiProperty()
  bookingId: string;

  @ApiProperty({
    enum: [
      'user_cancellation',
      'provider_cancellation',
      'flight_cancelled',
      'late_payment',
    ],
  })
  reason: RefundReason | 'late_payment';

  @ApiProperty({ enum: ['pending', 'succeeded', 'failed'] })
  status: RefundStatus;

  @ApiProperty({
    enum: ['Pending', 'Refunded', 'Failed'],
    description: 'PAY-03 label to show on the booking details',
  })
  statusLabel: 'Pending' | 'Refunded' | 'Failed';

  @ApiProperty({
    example: 50,
    description: '0-100. Provider cancellations: 100 (PAY-03)',
  })
  refundPercentage: number;

  @ApiPropertyOptional({
    example: 10,
    nullable: true,
    description: 'Whole days before departure / check-in at cancellation',
  })
  daysBeforeStart: number | null;

  @ApiPropertyOptional({
    example: 7,
    nullable: true,
    description: 'Threshold of the tier applied (FLT-09 / HTL-10)',
  })
  appliedTierDaysBefore: number | null;

  @ApiProperty({ example: 125.25, description: 'Major units' })
  amount: number;

  @ApiProperty({ example: 12525, description: 'Minor units' })
  amountMinor: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiPropertyOptional({
    example: 're_3Q...',
    nullable: true,
    description: 'null when the amount is 0 (no Stripe refund needed)',
  })
  stripeRefundId: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}
