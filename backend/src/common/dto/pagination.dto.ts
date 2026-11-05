import { applyDecorators, Type as ClassType } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { PAGE_SIZE } from '../constants/pagination.js';

/**
 * Query DTO for any paginated list. Extend it to add your own filters:
 *   export class SearchHotelsQueryDto extends PaginationQueryDto { ... }
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    description: `Page number. Page size is fixed at ${PAGE_SIZE} (GEN-05).`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: PAGE_SIZE })
  pageSize: number;

  @ApiProperty({ example: 42 })
  totalItems: number;

  @ApiProperty({ example: 5 })
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMetaDto;
}

/**
 * Swagger helper for paginated responses:
 *   @ApiPaginatedResponse(HotelResponseDto)
 */
export function ApiPaginatedResponse<T extends ClassType<unknown>>(model: T) {
  return applyDecorators(
    ApiExtraModels(PaginationMetaDto, model),
    ApiOkResponse({
      schema: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(PaginationMetaDto) },
        },
      },
    }),
  );
}
