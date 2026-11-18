import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** POST /api/itineraries/:id/days/:dayId/activities (ITN-10). */
export class CreateActivityDto {
  @ApiProperty({ example: 'Pyramids of Giza' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Guided tour, bring water' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: '09:30',
    description: 'Optional time, HH:mm (ITN-10)',
  })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'time must be HH:mm' })
  time?: string;

  @ApiPropertyOptional({
    example: 540,
    description: 'Optional cost, >= 0. Needs currency.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number;

  @ApiPropertyOptional({ example: 'EGP', enum: SUPPORTED_CURRENCIES })
  @IsOptional()
  @Transform(upper)
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;
}

/**
 * PATCH /api/activities/:id (ITN-10). Send only what changes.
 * time / cost may be null to remove them (cost and currency go together).
 */
export class UpdateActivityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '14:00', nullable: true })
  @IsOptional()
  @ValidateIf((o: UpdateActivityDto) => o.time !== null)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'time must be HH:mm' })
  time?: string | null;

  @ApiPropertyOptional({ example: 300, nullable: true })
  @IsOptional()
  @ValidateIf((o: UpdateActivityDto) => o.cost !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number | null;

  @ApiPropertyOptional({
    example: 'EGP',
    enum: SUPPORTED_CURRENCIES,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((o: UpdateActivityDto) => o.currency !== null)
  @Transform(upper)
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string | null;
}

/** POST /api/activities/:id/images: the id returned by POST /api/uploads (GEN-08). */
export class AttachImageDto {
  @ApiProperty({ description: 'Id from POST /api/uploads' })
  @IsMongoId()
  imageId: string;
}
