import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PaginationMetaDto,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto.js';

/** POST /api/hotel-bookings/:id/review (HTL-23). */
export class CreateReviewDto {
  @ApiProperty({ example: 4, minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({
    example: 'Great view of the Nile, friendly staff.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000) // HTL-23
  comment?: string;
}

/** PATCH /api/reviews/:id (HTL-23). */
export class UpdateReviewDto {
  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class ListReviewsQueryDto extends PaginationQueryDto {}

export class ReviewAuthorDto {
  @ApiProperty({
    example: 'Sara Ahmed',
    description: '"Deleted user" if the account is deactivated (ACC-12)',
  })
  name: string;
}

export class ReviewDto {
  @ApiProperty() id: string;
  @ApiProperty() hotelId: string;
  @ApiProperty() bookingId: string;
  @ApiProperty({ example: 4 }) rating: number;
  @ApiProperty() comment: string;
  @ApiProperty({ type: ReviewAuthorDto }) author: ReviewAuthorDto;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}

/** GET /api/hotels/:id/reviews (HTL-24). */
export class HotelReviewsDto {
  @ApiPropertyOptional({
    example: 4.33,
    nullable: true,
    description: 'null = no ratings yet',
  })
  averageRating: number | null;
  @ApiProperty({ example: 3 }) ratingCount: number;
  @ApiProperty({ type: [ReviewDto], description: 'Newest first' })
  items: ReviewDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}
