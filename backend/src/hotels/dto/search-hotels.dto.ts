import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  Equals,
  IsInt,
  IsNumber,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PLATFORM_CURRENCY } from '../../common/constants/currencies.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { IsDateOnly, Optional } from '../../flights/catalogue-validation.js';
import { SortOrder } from '../../flights/dto/flight.dto.js';

export enum HotelSort {
  PRICE = 'price',
  RATING = 'rating',
}
export class SearchHotelsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'cairo',
    description:
      'At least cityId or countryCode is required; official reference IDs',
  })
  @Optional()
  @IsString()
  @MaxLength(100)
  cityId?: string;
  @ApiPropertyOptional({ example: 'EG' })
  @Optional()
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;
  @ApiProperty({
    example: '2026-12-01',
    description:
      'Calendar date. Current past-date validation uses UTC today; the required hotel-local boundary needs team clarification.',
  })
  @IsDateOnly()
  checkInDate: string;
  @ApiProperty({ example: '2026-12-03' }) @IsDateOnly() checkOutDate: string;
  @ApiProperty({ minimum: 1, example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  guests: number;
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Optional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rooms: number = 1;
  @ApiPropertyOptional({
    minimum: 0,
    description:
      'Inclusive cheapest qualifying room price per night in EGP (PAY-04). No FX conversion.',
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
  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @Optional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  minRating?: number;
  @ApiPropertyOptional({
    enum: [PLATFORM_CURRENCY],
    description:
      'Optional; only the shared EGP platform currency is accepted (PAY-04). Results always use EGP.',
  })
  @Optional()
  @Equals(PLATFORM_CURRENCY)
  currency?: string;
  @ApiPropertyOptional({ enum: HotelSort, default: HotelSort.PRICE })
  @Optional()
  @IsEnum(HotelSort)
  sortBy: HotelSort = HotelSort.PRICE;
  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.ASC })
  @Optional()
  @IsEnum(SortOrder)
  sortOrder: SortOrder = SortOrder.ASC;
}
export class HotelSearchItemDto {
  @ApiProperty() _id: string;
  @ApiProperty() name: string;
  @ApiProperty() address: string;
  @ApiProperty() cityId: string;
  @ApiProperty() countryCode: string;
  @ApiProperty() currency: string;
  @ApiProperty() description: string;
  @ApiProperty({ type: [String] }) photos: string[];
  @ApiProperty({ type: [String] }) amenities: string[];
  @ApiProperty() starClass: number;
  @ApiProperty({ type: Number, nullable: true }) averageRating: number | null;
  @ApiProperty() ratingCount: number;
  @ApiProperty() pricePerNight: number;
  @ApiProperty() availableRoomCount: number;
  @ApiProperty() nights: number;
  @ApiProperty() cheapestQualifyingRoomStayPrice: number;
}
