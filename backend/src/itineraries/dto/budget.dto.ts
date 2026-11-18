import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies.js';
import { BudgetCategory } from '../schemas/budget-entry.schema.js';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const lowerTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// ------------------------------------------------------------ budget entries

/** POST /api/itineraries/:id/days/:dayId/budgets (ITN-14). */
export class CreateBudgetEntryDto {
  @ApiProperty({ enum: BudgetCategory, example: BudgetCategory.FOOD })
  @IsEnum(BudgetCategory)
  category: BudgetCategory;

  @ApiProperty({ example: 450, description: 'Non-negative (ITN-14)' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiProperty({ example: 'EGP', enum: SUPPORTED_CURRENCIES })
  @Transform(upper)
  @IsIn(SUPPORTED_CURRENCIES)
  currency: string;

  @ApiPropertyOptional({ example: 'Lunch and dinner' })
  @IsOptional()
  @IsString()
  note?: string;
}

/** PATCH /api/budgets/:id (ITN-14). */
export class UpdateBudgetEntryDto {
  @ApiPropertyOptional({ enum: BudgetCategory })
  @IsOptional()
  @IsEnum(BudgetCategory)
  category?: BudgetCategory;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ enum: SUPPORTED_CURRENCIES })
  @IsOptional()
  @Transform(upper)
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class BudgetEntryDto {
  @ApiProperty() id: string;
  @ApiProperty() dayId: string;
  @ApiProperty({ enum: BudgetCategory }) category: BudgetCategory;
  @ApiProperty({ example: 450 }) amount: number;
  @ApiProperty({ example: 'EGP' }) currency: string;
  @ApiProperty() note: string;
}

// ----------------------------------------------------------- transport costs

/** POST /api/itineraries/:id/transport-costs (ITN-16). */
export class CreateTransportCostDto {
  @ApiProperty({ description: 'Day of this itinerary the trip happens on' })
  @IsMongoId()
  dayId: string;

  @ApiProperty({ example: 'train' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  mode: string;

  @ApiProperty({ example: 'cairo' })
  @Transform(lowerTrim)
  @IsString()
  @IsNotEmpty()
  fromCityId: string;

  @ApiProperty({ example: 'luxor' })
  @Transform(lowerTrim)
  @IsString()
  @IsNotEmpty()
  toCityId: string;

  @ApiProperty({ example: 1200 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiProperty({ example: 'EGP', enum: SUPPORTED_CURRENCIES })
  @Transform(upper)
  @IsIn(SUPPORTED_CURRENCIES)
  currency: string;
}

/** PATCH /api/transport-costs/:id (ITN-16). */
export class UpdateTransportCostDto {
  @ApiPropertyOptional() @IsOptional() @IsMongoId() dayId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  mode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerTrim)
  @IsString()
  @IsNotEmpty()
  fromCityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerTrim)
  @IsString()
  @IsNotEmpty()
  toCityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ enum: SUPPORTED_CURRENCIES })
  @IsOptional()
  @Transform(upper)
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;
}

export class TransportCostDto {
  @ApiProperty() id: string;
  @ApiProperty() dayId: string;
  @ApiProperty({ example: 'train' }) mode: string;
  @ApiProperty({ example: 'cairo' }) fromCityId: string;
  @ApiProperty({ example: 'luxor' }) toCityId: string;
  @ApiProperty({ example: 1200 }) amount: number;
  @ApiProperty({ example: 'EGP' }) currency: string;
}

// ------------------------------------------------------------ budget summary

/** GET /api/itineraries/:id/budget-summary */
export class BudgetSummaryQueryDto {
  @ApiPropertyOptional({
    enum: SUPPORTED_CURRENCIES,
    description:
      "Display currency. Default: the user's preferred currency (ACC-09), else EGP.",
  })
  @IsOptional()
  @Transform(upper)
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;
}

export class CategoryTotalsDto {
  @ApiProperty() food: number;
  @ApiProperty() accommodation: number;
  @ApiProperty({ description: 'In-city transport' }) in_city_transport: number;
  @ApiProperty({ description: 'Budget entries + activity costs (ITN-10)' })
  activities: number;
  @ApiProperty({ description: 'Intercity transport entries (ITN-16)' })
  intercity_transport: number;
}

export class DayBudgetDto {
  @ApiProperty() dayNumber: number;
  @ApiProperty({ example: '2026-12-01' }) date: string;
  @ApiProperty({ example: 'cairo' }) cityId: string;
  @ApiProperty() total: number;
  @ApiProperty({ type: CategoryTotalsDto }) byCategory: CategoryTotalsDto;
}

export class GroupBudgetDto {
  @ApiProperty({ example: 'cairo' }) cityId: string;
  @ApiProperty() firstDayNumber: number;
  @ApiProperty() lastDayNumber: number;
  @ApiProperty() dayCount: number;
  @ApiProperty({ description: 'ITN-09 group subtotal' }) subtotal: number;
}

export class BudgetSummaryDto {
  @ApiProperty({
    example: 'EGP',
    description: 'All amounts below are in this currency',
  })
  currency: string;
  @ApiPropertyOptional({
    example: '2026-11-17',
    nullable: true,
    description:
      'Date of the exchange rates used (ITN-18); null when no conversion was needed',
  })
  rateDate: string | null;
  @ApiProperty({
    description:
      'false when FXRatesAPI was unavailable and older cached rates were used',
  })
  ratesAreLatest: boolean;
  @ApiProperty() total: number;
  @ApiProperty({ type: CategoryTotalsDto }) byCategory: CategoryTotalsDto;
  @ApiProperty({ type: [DayBudgetDto] }) byDay: DayBudgetDto[];
  @ApiProperty({ type: [GroupBudgetDto] }) byGroup: GroupBudgetDto[];
}
