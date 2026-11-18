import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { CabinClass } from '../../flights/catalogue.constants.js';
import { FlightSort, TripType } from '../../flights/dto/flight.dto.js';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** GET /api/itineraries/:id/hotels (ITN-25). */
export class ItineraryHotelSearchDto extends PaginationQueryDto {
  @ApiProperty({
    example: 1,
    description:
      'Which city group (1 = first), as listed in the itinerary groups',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  group: number;

  @ApiProperty({ example: 2, description: 'Number of guests' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  guests: number;

  @ApiPropertyOptional({
    example: 1,
    default: 1,
    description: 'Number of rooms',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rooms: number = 1;
}

/** GET /api/itineraries/:id/flights (ITN-26). */
export class ItineraryFlightSearchDto extends PaginationQueryDto {
  @ApiProperty({ example: 'DXB', description: 'Origin airport (IATA code)' })
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, {
    message: 'departureAirport must be a 3-letter IATA code',
  })
  departureAirport: string;

  @ApiPropertyOptional({
    example: 'CAI',
    description:
      "Needed only if the first day's city has more than one airport",
  })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, {
    message: 'arrivalAirport must be a 3-letter IATA code',
  })
  arrivalAirport?: string;

  @ApiPropertyOptional({ enum: TripType, default: TripType.ONE_WAY })
  @IsOptional()
  @IsEnum(TripType)
  tripType: TripType = TripType.ONE_WAY;

  @ApiPropertyOptional({
    example: '2026-12-01',
    description: 'Default: the itinerary start date',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  departureDate?: string;

  @ApiPropertyOptional({
    example: '2026-12-07',
    description: "Round trip only. Default: the last day's date",
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  returnDate?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  adults: number = 1;
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  children: number = 0;
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  infants: number = 0;

  @ApiPropertyOptional({ enum: CabinClass })
  @IsOptional()
  @IsEnum(CabinClass)
  cabinClass?: CabinClass;

  @ApiPropertyOptional({ enum: FlightSort, default: FlightSort.PRICE })
  @IsOptional()
  @IsEnum(FlightSort)
  sortBy: FlightSort = FlightSort.PRICE;
}
