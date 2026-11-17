import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  PaginationMetaDto,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto.js';
import { PublicItinerarySummaryDto } from '../../itineraries/dto/public-itinerary.dto.js';
import { PostStatus } from '../schemas/post.schema.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** BLG-08: tags are case-insensitive, so they are stored trimmed and lower case. */
const normalizeTags = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.map((t) =>
            typeof t === 'string' ? t.trim().toLowerCase() : t,
          ),
        ),
      ]
    : value;

/** POST /api/posts (BLG-01, BLG-08). */
export class CreatePostDto {
  @ApiProperty({ example: 'Three days in Luxor' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'We started at Karnak at sunrise...' })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({
    example: ['egypt', 'history'],
    description: 'Up to 5 tags, max 30 characters each',
  })
  @IsOptional()
  @Transform(normalizeTags)
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];

  @ApiPropertyOptional({
    enum: PostStatus,
    default: PostStatus.DRAFT,
    description: 'Save as draft or publish',
  })
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;
}

/** PATCH /api/posts/:id (BLG-04, BLG-08). Send only what changes. */
export class UpdatePostDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  body?: string;

  @ApiPropertyOptional({ example: ['egypt'] })
  @IsOptional()
  @Transform(normalizeTags)
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ enum: PostStatus })
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;
}

/** GET /api/posts (BLG-02, BLG-09). */
export class ListPostsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'luxor',
    description:
      'Keyword in title, tags or author name. Ordered by likes + comments, newest first on ties.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    example: 'egypt',
    description: 'Only posts with this tag',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MaxLength(30)
  tag?: string;
}

export class PageQueryDto extends PaginationQueryDto {}

/** GET /api/authors/:id (BLG-12): separate pages for posts and itineraries. */
export class AuthorPageQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  postsPage: number = 1;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  itinerariesPage: number = 1;
}

/** POST /api/posts/:id/comments (BLG-05) and PATCH /api/comments/:id (BLG-07). */
export class CommentBodyDto {
  @ApiProperty({ example: 'Great tips, thanks!', maxLength: 500 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  body: string;
}

/** PATCH /api/posts/:id/itinerary (BLG-13): one of my itineraries, or null to remove it. */
export class AttachItineraryDto {
  @ApiProperty({
    nullable: true,
    description: 'Id of one of my itineraries, or null to detach',
  })
  @ValidateIf((o: AttachItineraryDto) => o.itineraryId !== null)
  @IsMongoId()
  itineraryId: string | null;
}

/** POST /api/posts/:id/images: the id from POST /api/uploads (GEN-08). */
export class AttachPostImageDto {
  @ApiProperty({ description: 'Id from POST /api/uploads' })
  @IsMongoId()
  imageId: string;
}

// ------------------------------------------------------------------ responses

export class PostAuthorDto {
  @ApiProperty() id: string;
  @ApiProperty({
    example: 'Sara Ahmed',
    description: '"Deleted user" if deactivated (ACC-12)',
  })
  name: string;
}

export class PostImageDto {
  @ApiProperty() imageId: string;
  @ApiProperty() url: string;
}

/** List row (BLG-02, BLG-03, BLG-09). */
export class PostSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty({ description: 'First 200 characters of the body (BLG-09)' })
  excerpt: string;
  @ApiProperty({ type: PostAuthorDto }) author: PostAuthorDto;
  @ApiProperty({ example: ['egypt'] }) tags: string[];
  @ApiProperty({ enum: PostStatus }) status: PostStatus;
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Null for drafts',
  })
  publishedAt: Date | null;
  @ApiProperty() likeCount: number;
  @ApiProperty() commentCount: number;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}

export class CommentDto {
  @ApiProperty() id: string;
  @ApiProperty() postId: string;
  @ApiProperty({ type: PostAuthorDto }) author: PostAuthorDto;
  @ApiProperty() body: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}

export class CommentPageDto {
  @ApiProperty({ type: [CommentDto], description: 'Chronological (BLG-05)' })
  items: CommentDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

/** Post page (BLG-02). */
export class PostDetailDto extends PostSummaryDto {
  @ApiProperty() body: string;
  @ApiProperty({ type: [PostImageDto] }) images: PostImageDto[];
  @ApiProperty({
    type: CommentPageDto,
    description: 'First 10 comments; more via GET /api/posts/:id/comments',
  })
  comments: CommentPageDto;
  @ApiPropertyOptional({
    type: PublicItinerarySummaryDto,
    nullable: true,
    description:
      'BLG-13: the attached itinerary. Readers only see it while it is public and not hidden; the author always sees it.',
  })
  itinerary: PublicItinerarySummaryDto | null;
}

export class LikeStateDto {
  @ApiProperty() liked: boolean;
  @ApiProperty({ example: 12 }) likeCount: number;
}

export class PostPageDto {
  @ApiProperty({ type: [PostSummaryDto] }) items: PostSummaryDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

export class ItineraryPageDto {
  @ApiProperty({ type: [PublicItinerarySummaryDto] })
  items: PublicItinerarySummaryDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

/** Author page (BLG-12). */
export class AuthorPageDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'Sara Ahmed' }) name: string;
  @ApiProperty({ type: String, format: 'date-time', description: 'Join date' })
  joinedAt: Date;
  @ApiProperty({
    type: PostPageDto,
    description: 'Published posts, newest first',
  })
  posts: PostPageDto;
  @ApiProperty({
    type: ItineraryPageDto,
    description: 'Public itineraries, newest updates first',
  })
  itineraries: ItineraryPageDto;
}
