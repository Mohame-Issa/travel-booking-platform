import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Equals,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsMongoId,
  IsNumber,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { PLATFORM_CURRENCY } from '../../common/constants/currencies.js';
import {
  PaginationMetaDto,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto.js';
import {
  AirlineResponseDto,
  AirlinePolicyResponseDto,
} from '../../airlines/dto/airline.dto.js';
import { AirportResponseDto } from '../../airports/dto/airport.dto.js';
import { CabinClass, FlightStatus } from '../catalogue.constants.js';
import {
  IsDateOnly,
  IsLocalDateTime,
  Optional,
} from '../catalogue-validation.js';

export class CreateFlightDto {
  @ApiProperty() @IsMongoId() airlineId: string;
  @ApiProperty({ example: 'EA123' })
  @IsString()
  @IsNotEmpty()
  flightNumber: string;
  @ApiProperty({ example: 'CAI' })
  @Matches(/^[A-Z]{3}$/)
  departureAirport: string;
  @ApiProperty({ example: 'DXB' })
  @Matches(/^[A-Z]{3}$/)
  arrivalAirport: string;
  @ApiProperty({
    example: '2026-12-01T10:00',
    description:
      'Local time at departure airport; optional matching UTC offset disambiguates repeated DST times. Z and nonexistent local times are rejected.',
  })
  @IsLocalDateTime()
  departureLocal: string;
  @ApiProperty({
    example: '2026-12-01T15:00',
    description:
      'Local time at arrival airport; optional matching UTC offset, no Z',
  })
  @IsLocalDateTime()
  arrivalLocal: string;
}
export class UpdateFlightDto extends PartialType(
  OmitType(CreateFlightDto, ['airlineId', 'flightNumber'] as const),
  { skipNullProperties: false },
) {}
export class CreateCabinDto {
  @ApiProperty({ enum: CabinClass }) @IsEnum(CabinClass) cabinClass: CabinClass;
  @ApiProperty({ minimum: 1, example: 120 }) @IsInt() @Min(1) seatCount: number;
  @ApiProperty({ exclusiveMinimum: true, minimum: 0, example: 4000 })
  @IsNumber()
  @Min(Number.MIN_VALUE)
  price: number;
  @ApiProperty({ minimum: 0, example: 1 }) @IsInt() @Min(0) freeBaggage: number;
  @ApiProperty({ exclusiveMinimum: true, minimum: 0, example: 23 })
  @IsNumber()
  @Min(Number.MIN_VALUE)
  maxBagWeightKg: number;
}
export class UpdateCabinDto extends PartialType(
  OmitType(CreateCabinDto, ['cabinClass'] as const),
  { skipNullProperties: false },
) {}
export class CancelFlightDto {
  @ApiProperty({
    enum: [true],
    description: 'Explicit cancellation confirmation (GEN-03)',
  })
  @Equals(true)
  confirmed: boolean;
}
export enum FlightSort {
  PRICE = 'price',
  DURATION = 'duration',
  DEPARTURE = 'departureTime',
}
export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}
export enum TripType {
  ONE_WAY = 'one-way',
  ROUND_TRIP = 'round-trip',
}
export class SearchFlightsQueryDto extends PaginationQueryDto {
  @ApiProperty({ example: 'CAI' })
  @Matches(/^[A-Z]{3}$/)
  departureAirport: string;
  @ApiProperty({ example: 'DXB' })
  @Matches(/^[A-Z]{3}$/)
  arrivalAirport: string;
  @ApiProperty({
    example: '2026-12-01',
    description: 'Local calendar date at origin',
  })
  @IsDateOnly()
  departureDate: string;
  @ApiPropertyOptional({ enum: TripType, default: TripType.ONE_WAY })
  @Optional()
  @IsEnum(TripType)
  tripType: TripType = TripType.ONE_WAY;
  @ApiPropertyOptional({
    example: '2026-12-10',
    description:
      'Required for round-trip; local calendar date at the return origin',
  })
  @Optional()
  @IsDateOnly()
  returnDate?: string;
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Optional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  adults: number = 1;
  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @Optional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  children: number = 0;
  @ApiPropertyOptional({
    minimum: 0,
    default: 0,
    description:
      'Infants occupy no seat, pay 10%, and cannot exceed adults (FLT-12)',
  })
  @Optional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  infants: number = 0;
  @ApiPropertyOptional({ enum: CabinClass })
  @Optional()
  @IsEnum(CabinClass)
  cabinClass?: CabinClass;
  @ApiPropertyOptional({
    minimum: 0,
    description:
      'Inclusive EGP fare per seated passenger (PAY-04); totalPrice is the party quote. No FX conversion.',
  })
  @Optional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;
  @ApiPropertyOptional({ minimum: 0 })
  @Optional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;
  @ApiPropertyOptional({
    enum: [PLATFORM_CURRENCY],
    description:
      'Optional; only the shared EGP platform currency is accepted (PAY-04). Results always use EGP.',
  })
  @Optional()
  @Equals(PLATFORM_CURRENCY)
  currency?: string;
  @ApiPropertyOptional({ enum: FlightSort, default: FlightSort.PRICE })
  @Optional()
  @IsEnum(FlightSort)
  sortBy: FlightSort = FlightSort.PRICE;
  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.ASC })
  @Optional()
  @IsEnum(SortOrder)
  sortOrder: SortOrder = SortOrder.ASC;
}
export class FlightResponseDto {
  @ApiProperty() _id: string;
  @ApiProperty() airlineId: string;
  @ApiProperty() flightNumber: string;
  @ApiProperty() departureAirport: string;
  @ApiProperty() arrivalAirport: string;
  @ApiProperty({ format: 'date-time' }) departureTime: Date;
  @ApiProperty({ format: 'date-time' }) arrivalTime: Date;
  @ApiProperty({ format: 'date' }) departureDate: string;
  @ApiProperty({ enum: FlightStatus }) status: FlightStatus;
}
export class CabinResponseDto {
  @ApiProperty() _id: string;
  @ApiProperty() flightId: string;
  @ApiProperty({ enum: CabinClass }) cabinClass: CabinClass;
  @ApiProperty() seatCount: number;
  @ApiProperty() bookedSeats: number;
  @ApiProperty() heldSeats: number;
  @ApiProperty() price: number;
  @ApiProperty() freeBaggage: number;
  @ApiProperty() maxBagWeightKg: number;
  @ApiPropertyOptional() seatsRemaining?: number;
}
export class FlightDetailsResponseDto extends FlightResponseDto {
  @ApiProperty({ type: AirlineResponseDto }) airline: AirlineResponseDto;
  @ApiProperty({ type: AirportResponseDto }) origin: AirportResponseDto;
  @ApiProperty({ type: AirportResponseDto }) destination: AirportResponseDto;
  @ApiProperty() departureLocal: string;
  @ApiProperty() arrivalLocal: string;
  @ApiProperty() durationMinutes: number;
  @ApiProperty({ type: [CabinResponseDto] }) cabins: CabinResponseDto[];
  @ApiProperty({ type: AirlinePolicyResponseDto, nullable: true })
  policy: AirlinePolicyResponseDto | null;
}
export class FlightOptionResponseDto {
  @ApiProperty() flightId: string;
  @ApiProperty() cabinId: string;
  @ApiProperty() flightNumber: string;
  @ApiProperty({ type: AirlineResponseDto }) airline: AirlineResponseDto;
  @ApiProperty({ type: AirportResponseDto }) origin: AirportResponseDto;
  @ApiProperty({ type: AirportResponseDto }) destination: AirportResponseDto;
  @ApiProperty() departureTime: Date;
  @ApiProperty() arrivalTime: Date;
  @ApiProperty() departureLocal: string;
  @ApiProperty() arrivalLocal: string;
  @ApiProperty() durationMinutes: number;
  @ApiProperty({ enum: CabinClass }) cabinClass: CabinClass;
  @ApiProperty() seatsRemaining: number;
  @ApiProperty() price: number;
  @ApiProperty() totalPrice: number;
  @ApiProperty() currency: string;
  @ApiProperty() freeBaggage: number;
  @ApiProperty() maxBagWeightKg: number;
}
export class FlightOptionsPageDto {
  @ApiProperty({ type: [FlightOptionResponseDto] })
  items: FlightOptionResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
  @ApiPropertyOptional() message?: string;
}
export class FlightSearchResponseDto {
  @ApiProperty({ enum: TripType }) tripType: TripType;
  @ApiProperty({
    type: Object,
    example: { adults: 1, children: 0, infants: 0, seatsRequired: 1 },
  })
  passengers: object;
  @ApiProperty({ type: FlightOptionsPageDto }) outbound: FlightOptionsPageDto;
  @ApiPropertyOptional({ type: FlightOptionsPageDto })
  return?: FlightOptionsPageDto;
}
