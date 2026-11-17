import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { FavouriteType } from '../schemas/favourite.schema.js';

export class AddFavouriteDto {
  @ApiProperty({ enum: FavouriteType })
  @IsEnum(FavouriteType)
  targetType: FavouriteType;
  @ApiProperty({ description: 'Hotel id or public itinerary id' })
  @IsMongoId()
  targetId: string;
}

export class FavouriteParamsDto {
  @ApiProperty({ enum: FavouriteType })
  @IsEnum(FavouriteType)
  type: FavouriteType;
  @ApiProperty() @IsMongoId() targetId: string;
}

export class ListFavouritesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: FavouriteType,
    description: 'Only hotels or only itineraries',
  })
  @IsOptional()
  @IsEnum(FavouriteType)
  type?: FavouriteType;
}

export class FavouriteDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: FavouriteType }) targetType: FavouriteType;
  @ApiProperty() targetId: string;
  @ApiProperty({ example: 'Nile Hotel', nullable: true, type: String }) name:
    string | null;
  @ApiProperty({
    description:
      'false when the hotel was deactivated or deleted, or the itinerary is no longer public. The entry stays until the user removes it.',
  })
  available: boolean;
  @ApiPropertyOptional({
    description: 'Hotels: star class, average rating (null = unrated), city id',
  })
  hotel?: {
    starClass: number;
    averageRating: number | null;
    cityId: string;
  } | null;
  @ApiPropertyOptional({
    description: 'Itineraries: author name, countries, number of days',
  })
  itinerary?: {
    authorName: string;
    countries: string[];
    dayCount: number;
  } | null;
  @ApiProperty() savedAt: Date;
}
