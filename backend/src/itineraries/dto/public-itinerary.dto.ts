import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { BudgetSummaryDto } from './budget.dto.js';
import { ItineraryDetailDto, ItinerarySummaryDto } from './itinerary.dto.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** GET /api/itineraries/public/search (ITN-21). */
export class SearchPublicItinerariesDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'egypt',
    description: 'Matches the title, a country or a city',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    example: 'EG',
    description: 'Only itineraries in this country',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter code' })
  country?: string;

  @ApiPropertyOptional({
    example: 'cairo',
    description: 'Only itineraries with a day in this city',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 3, description: 'Minimum number of days' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  minDays?: number;

  @ApiPropertyOptional({ example: 10, description: 'Maximum number of days' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  maxDays?: number;
}

export class AuthorDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'Sara Ahmed' }) name: string;
}

export class PublicItinerarySummaryDto extends ItinerarySummaryDto {
  @ApiProperty({ type: AuthorDto }) author: AuthorDto;
}

export class PublicItineraryDetailDto extends ItineraryDetailDto {
  @ApiProperty({ type: AuthorDto }) author: AuthorDto;
  @ApiPropertyOptional({
    type: BudgetSummaryDto,
    nullable: true,
    description:
      'Budget in ?currency (default EGP); null if exchange rates are unavailable',
  })
  budget: BudgetSummaryDto | null;
}
