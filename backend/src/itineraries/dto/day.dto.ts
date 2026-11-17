import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const lowerTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** POST /api/itineraries/:id/days (ITN-05). The day is added at the end. */
export class AddDayDto {
  @ApiProperty({
    example: 'cairo',
    description: 'City id from Cities.csv. Every day needs a city (ITN-09).',
  })
  @Transform(lowerTrim)
  @IsString()
  @IsNotEmpty()
  cityId: string;

  @ApiPropertyOptional({ example: 'Arrive, check in, evening walk' })
  @IsOptional()
  @IsString()
  notes?: string;
}

/** PATCH /api/itineraries/:id/days/:dayId (ITN-05). */
export class UpdateDayDto {
  @ApiPropertyOptional({ example: 'giza' })
  @IsOptional()
  @Transform(lowerTrim)
  @IsString()
  @IsNotEmpty()
  cityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

/** PATCH /api/itineraries/:id/days/reorder (ITN-08): move one day. */
export class ReorderDayDto {
  @ApiProperty({ description: 'The day to move' })
  @IsMongoId()
  dayId: string;

  @ApiProperty({ example: 1, description: 'Its new day number (1 = first)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60) // ITN-05: at most 60 days
  position: number;
}

export class ActivityImageDto {
  @ApiProperty() imageId: string;
  @ApiProperty({ example: '/api/uploads/files/0b8c...png' }) url: string;
}

export class ActivityDto {
  @ApiProperty() id: string;
  @ApiProperty() dayId: string;
  @ApiProperty({ example: 'Pyramids of Giza' }) name: string;
  @ApiProperty() description: string;
  @ApiPropertyOptional({ example: '09:30', nullable: true }) time:
    string | null;
  @ApiPropertyOptional({ example: 540, nullable: true }) cost: number | null;
  @ApiPropertyOptional({ example: 'EGP', nullable: true }) currency:
    string | null;
  @ApiProperty({ type: [ActivityImageDto] }) images: ActivityImageDto[];
}

/** ITN-09: consecutive days in the same city, shown as one group. */
export class CityGroupDto {
  @ApiProperty({ example: 'cairo' }) cityId: string;
  @ApiProperty({ example: 1 }) firstDayNumber: number;
  @ApiProperty({ example: 3 }) lastDayNumber: number;
  @ApiProperty({ example: 3 }) dayCount: number;
  @ApiProperty({ example: '2026-12-01', description: 'Date of the first day' })
  startDate: string;
  @ApiProperty({ example: '2026-12-03', description: 'Date of the last day' })
  endDate: string;
}
