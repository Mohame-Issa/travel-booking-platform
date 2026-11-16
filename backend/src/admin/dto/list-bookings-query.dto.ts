import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { BookingStatus } from '../../common/interfaces/index.js';

export class ListBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['flight', 'hotel'],
    description: 'Filter bookings by type',
  })
  @IsOptional()
  @IsIn(['flight', 'hotel'])
  type?: 'flight' | 'hotel';

  @ApiPropertyOptional({
    enum: BookingStatus,
    description: 'Filter bookings by status',
  })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({
    example: '2026-11-01T00:00:00.000Z',
    description: 'Only include bookings on or after this date',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30T23:59:59.999Z',
    description: 'Only include bookings on or before this date',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
