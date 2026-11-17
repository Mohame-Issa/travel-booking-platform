import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsMongoId,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { MAX_PASSENGERS } from './flight-booking.dto.js';
import { SeatChoiceDto } from './seat.dto.js';

export class ChangeQuoteQueryDto {
  @ApiProperty({ description: 'Another Scheduled flight on the same route' })
  @IsMongoId()
  newFlightId: string;
}

/** POST /api/flight-bookings/:id/change */
export class ChangeFlightDto {
  @ApiProperty({ description: 'Another Scheduled flight on the same route' })
  @IsMongoId()
  newFlightId: string;

  @ApiPropertyOptional({
    type: [SeatChoiceDto],
    description:
      'FLT-28: seats on the new flight. Passengers left out get the first free seat.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PASSENGERS)
  @ValidateNested({ each: true })
  @Type(() => SeatChoiceDto)
  seats?: SeatChoiceDto[];
}
