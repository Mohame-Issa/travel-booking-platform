import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { ItineraryVisibility } from '../schemas/itinerary.schema.js';
import { BudgetEntryDto, TransportCostDto } from './budget.dto.js';
import { LinkedBookingDto } from './itinerary-booking.dto.js';
import { ActivityDto, CityGroupDto } from './day.dto.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upperAll = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v))
    : value;

export class CreateItineraryDto {
  @ApiProperty({ example: 'Two weeks in Egypt', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100) // ITN-01
  title: string;

  @ApiProperty({
    example: ['EG'],
    description: 'One or more country codes from Countries.csv (ITN-01)',
  })
  @Transform(upperAll)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[A-Z]{2}$/, {
    each: true,
    message: 'each country must be a 2-letter code',
  })
  countries: string[];

  @ApiProperty({
    example: '2026-12-01',
    description: 'YYYY-MM-DD; day 1 is on this date',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be YYYY-MM-DD' })
  startDate: string;
}

/** PATCH /api/itineraries/:id: edit (ITN-01) and set visibility (ITN-20). */
export class UpdateItineraryDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({ example: ['EG', 'AE'] })
  @IsOptional()
  @Transform(upperAll)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[A-Z]{2}$/, {
    each: true,
    message: 'each country must be a 2-letter code',
  })
  countries?: string[];

  @ApiPropertyOptional({ example: '2026-12-05' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be YYYY-MM-DD' })
  startDate?: string;

  @ApiPropertyOptional({
    enum: ItineraryVisibility,
    description: 'ITN-20: public = in shared search and read-only to others',
  })
  @IsOptional()
  @IsEnum(ItineraryVisibility)
  visibility?: ItineraryVisibility;
}

export class ListItinerariesQueryDto extends PaginationQueryDto {}

export class ClonedFromDto {
  @ApiProperty() itineraryId: string;
  @ApiProperty({ description: 'Original author (ITN-21)' }) authorId: string;
  @ApiPropertyOptional({
    example: 'Sara Ahmed',
    description:
      'Original author\'s name ("Deleted user" if deactivated, ACC-12); only in details',
  })
  authorName?: string;
}

/** ITN-03 list row. */
export class ItinerarySummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty({ example: ['EG'] }) countries: string[];
  @ApiProperty({ example: '2026-12-01' }) startDate: string;
  @ApiPropertyOptional({
    example: '2026-12-07',
    nullable: true,
    description: 'Date of the last day; null without days',
  })
  endDate: string | null;
  @ApiProperty({ example: 7 }) dayCount: number;
  @ApiProperty({ enum: ItineraryVisibility }) visibility: ItineraryVisibility;
  @ApiPropertyOptional({ type: ClonedFromDto, nullable: true })
  clonedFrom: ClonedFromDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}

export class ItineraryDayDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 1 }) dayNumber: number;
  @ApiProperty({
    example: '2026-12-01',
    description: 'startDate + (dayNumber - 1)',
  })
  date: string;
  @ApiProperty({ example: 'cairo' }) cityId: string;
  @ApiProperty() notes: string;
  @ApiProperty({
    type: [ActivityDto],
    description: 'ITN-10, ordered by time (activities without a time last)',
  })
  activities: ActivityDto[];
  @ApiProperty({ type: [BudgetEntryDto], description: 'ITN-14' })
  budgetEntries: BudgetEntryDto[];
  @ApiProperty({ type: [TransportCostDto], description: 'ITN-16' })
  transportCosts: TransportCostDto[];
  @ApiProperty({
    type: [LinkedBookingDto],
    description: 'ITN-27 (bonus): booked flights / hotels linked to this day',
  })
  linkedBookings: LinkedBookingDto[];
}

/** ITN-03 full details (days, activities and budgets are added by later steps). */
/** ITN-03 full details: days with their activities, plus city groups (ITN-09). */
export class ItineraryDetailDto extends ItinerarySummaryDto {
  @ApiProperty({ type: [ItineraryDayDto] }) days: ItineraryDayDto[];
  @ApiProperty({
    type: [CityGroupDto],
    description: 'ITN-09: consecutive days in the same city',
  })
  groups: CityGroupDto[];
}
