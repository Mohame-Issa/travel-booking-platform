import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '../../common/interfaces/index.js';

export class AdminBookingUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;
}

export class AdminBookingProviderDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({
    description: 'Airline code. Only present for flight bookings.',
    example: 'MS',
  })
  code?: string;
}

export class AdminBookingResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ['flight', 'hotel'] })
  type: 'flight' | 'hotel';

  @ApiPropertyOptional({ nullable: true })
  reference: string | null;

  @ApiProperty({ type: AdminBookingUserDto })
  user: AdminBookingUserDto;

  @ApiProperty({ type: AdminBookingProviderDto })
  provider: AdminBookingProviderDto;

  @ApiProperty({ type: Date })
  startDate: Date;

  @ApiProperty({ type: Date })
  endDate: Date;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  currency: string;

  @ApiProperty({ enum: BookingStatus, enumName: 'BookingStatus' })
  status: BookingStatus;

  @ApiProperty({ type: Date })
  createdAt: Date;
}
