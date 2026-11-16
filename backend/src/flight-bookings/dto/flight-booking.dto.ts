import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BookingStatus,
  CabinClass,
  PaginationQueryDto,
} from '../flight-bookings.imports.js';

export const MAX_PASSENGERS = 9;

export class PassengerDto {
  @ApiProperty({ example: 'Omar Hisham' })
  @IsString()
  @Length(2, 100)
  fullName: string;
  @ApiProperty({ example: '2004-05-17' })
  @IsDateString({ strict: true })
  dateOfBirth: string;
  @ApiProperty({ example: 'A12345678' })
  @Matches(/^[A-Za-z0-9]{5,20}$/, {
    message: 'passportNumber must be 5-20 letters/digits',
  })
  passportNumber: string;
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  extraBags?: number;
}

/** Used by POST /flight-bookings (summary) and POST /flight-bookings/hold (reserve). */
export class BookingRequestDto {
  @ApiProperty() @IsMongoId() flightId: string;
  @ApiProperty({ enum: CabinClass }) @IsEnum(CabinClass) cabinClass: CabinClass;
  @ApiProperty({ type: [PassengerDto], description: 'One entry per seat' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PASSENGERS)
  @ValidateNested({ each: true })
  @Type(() => PassengerDto)
  passengers: PassengerDto[];
}

export class CancelBookingDto {
  @ApiProperty({
    description: 'Must be true to confirm the cancellation (GEN-03)',
  })
  @IsBoolean()
  @Equals(true, { message: 'confirm must be true' })
  confirm: boolean;
}

export class ListMyBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['upcoming', 'past', 'cancelled'] })
  @IsOptional()
  @IsIn(['upcoming', 'past', 'cancelled'])
  group?: 'upcoming' | 'past' | 'cancelled';
}

export class FlightBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
  })
  @IsOptional()
  @IsIn([BookingStatus.CONFIRMED, BookingStatus.CANCELLED])
  status?: BookingStatus;
}
