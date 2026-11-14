import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CancellationTierDto } from '../../airlines/dto/airline.dto.js';
import {
  PLATFORM_CURRENCY,
  SUPPORTED_CURRENCIES,
} from '../../common/constants/currencies.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { BookingStatus } from '../../common/interfaces/index.js';
import { ProviderStatus } from '../../flights/catalogue.constants.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** HTL-01 */
export class CreateHotelDto {
  @ApiProperty({ example: 'Nile View Hotel' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) address: string;
  @ApiProperty({ description: 'Official city id (GEN-12)' })
  @IsString()
  @IsNotEmpty()
  cityId: string;
  @ApiProperty({ example: 'EG' }) @IsString() @IsNotEmpty() countryCode: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  starClass: number;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  amenities?: string[];
  @ApiPropertyOptional({
    default: PLATFORM_CURRENCY,
    enum: SUPPORTED_CURRENCIES,
  })
  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;
}

/** HTL-01: profile edits plus photos (GEN-08, max 5) via the shared upload service. */
export class UpdateHotelDto extends PartialType(
  OmitType(CreateHotelDto, ['currency'] as const),
) {
  @ApiPropertyOptional({
    type: [String],
    description: 'Asset ids from POST /api/uploads to add as photos',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsMongoId({ each: true })
  addPhotoAssetIds?: string[];
  @ApiPropertyOptional({ type: [String], description: 'Photo URLs to remove' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  removePhotoUrls?: string[];
}

/** HTL-03 */
export class CreateRoomDto {
  @ApiProperty({ example: '101' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  roomNumber: string;
  @ApiProperty({ example: 'Double' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  type: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(20) beds: number;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(50) maxOccupancy: number;
  @ApiProperty({ example: 1500, description: '> 0, in the hotel currency' })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  pricePerNight: number;
}

/** HTL-05 / HTL-06 */
export class UpdateRoomDto extends PartialType(CreateRoomDto) {
  @ApiPropertyOptional({
    enum: ProviderStatus,
    description: 'Deactivate or reactivate (HTL-06)',
  })
  @IsOptional()
  @IsEnum(ProviderStatus)
  status?: ProviderStatus;
}

export class DateRangeDto {
  @ApiProperty({ example: '2026-12-01' }) @Matches(DATE) startDate: string;
  @ApiProperty({ example: '2026-12-31', description: 'Exclusive' })
  @Matches(DATE)
  endDate: string;
}

export enum AvailabilityAction {
  BLOCK = 'block',
  UNBLOCK = 'unblock',
  REMOVE = 'remove',
}

/** HTL-05 (remove bookable dates) / HTL-06 (block, unblock). */
export class EditAvailabilityDto extends DateRangeDto {
  @ApiProperty({ enum: AvailabilityAction })
  @IsEnum(AvailabilityAction)
  action: AvailabilityAction;
}

export class StayQueryDto {
  @ApiProperty({ example: '2026-12-01' }) @Matches(DATE) checkInDate: string;
  @ApiProperty({ example: '2026-12-04' }) @Matches(DATE) checkOutDate: string;
}

export class OptionalStayQueryDto extends PartialType(StayQueryDto) {}

/** HTL-09 / HTL-10 */
export class HotelPoliciesDto {
  @ApiProperty({ example: '14:00' }) @Matches(TIME) checkInTime: string;
  @ApiProperty({ example: '12:00' }) @Matches(TIME) checkOutTime: string;
  @ApiProperty({
    type: [CancellationTierDto],
    description: 'Unique days-before-check-in thresholds (HTL-10)',
  })
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique((tier: CancellationTierDto | null) => tier?.daysBefore)
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  cancellationTiers: CancellationTierDto[];
}

/** HTL-22 */
export class ReservationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;
}
