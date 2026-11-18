import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  Matches,
  ValidateNested,
} from 'class-validator';
import { CabinClass } from '../flight-bookings.imports.js';
import { SEAT_NUMBER_PATTERN } from '../seat-map.js';
import { MAX_PASSENGERS } from './flight-booking.dto.js';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class SeatMapQueryDto {
  @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
  @IsEnum(CabinClass)
  cabinClass: CabinClass;
}

export class SeatDto {
  @ApiProperty({ example: '12C' }) seatNumber: string;
  @ApiProperty() available: boolean;
}

export class SeatRowDto {
  @ApiProperty({ example: 12 }) row: number;
  @ApiProperty({ type: [SeatDto] }) seats: SeatDto[];
}

export class SeatMapDto {
  @ApiProperty() flightId: string;
  @ApiProperty({ enum: CabinClass }) cabinClass: CabinClass;
  @ApiProperty({ example: 6 }) seatsPerRow: number;
  @ApiProperty({
    description: 'Seats that can still be booked (FLT-22 counter)',
  })
  availableSeats: number;
  @ApiProperty({ type: [SeatRowDto] }) rows: SeatRowDto[];
}

/** FLT-28: one passenger -> one seat. */
export class SeatChoiceDto {
  @ApiProperty({ example: 'A12345678' })
  @Transform(upper)
  @Matches(/^[A-Z0-9]{5,20}$/, {
    message: 'passportNumber must be 5-20 letters/digits',
  })
  passportNumber: string;

  @ApiProperty({ example: '12C', description: 'Row number + letter A-F' })
  @Transform(upper)
  @Matches(SEAT_NUMBER_PATTERN, {
    message: 'seatNumber must look like 12C (row, then a letter A-F)',
  })
  seatNumber: string;
}

/** PATCH /api/flight-bookings/:id/seats */
export class ChangeSeatsDto {
  @ApiProperty({ type: [SeatChoiceDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PASSENGERS)
  @ValidateNested({ each: true })
  @Type(() => SeatChoiceDto)
  seats: SeatChoiceDto[];
}
