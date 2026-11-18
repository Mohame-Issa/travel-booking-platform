import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { ReportStatus, ReportTargetType } from '../schemas/report.schema.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** POST /api/reports (GEN-09). */
export class CreateReportDto {
  @ApiProperty({ enum: ReportTargetType, example: ReportTargetType.REVIEW })
  @IsEnum(ReportTargetType)
  targetType: ReportTargetType;

  @ApiProperty({ description: 'Id of the review or itinerary' })
  @IsMongoId()
  targetId: string;

  @ApiProperty({ example: 'Offensive language' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  reason: string;
}

/** GET /api/admin/reports (GEN-10). */
export class ListReportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReportStatus, default: ReportStatus.OPEN })
  @IsOptional()
  @IsEnum(ReportStatus)
  status: ReportStatus = ReportStatus.OPEN;
}

export const REPORT_ACTIONS = ['dismiss', 'hide', 'delete'] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

/** PATCH /api/admin/reports/:id (GEN-10). */
export class ResolveReportDto {
  @ApiProperty({
    enum: REPORT_ACTIONS,
    description: 'dismiss the report, hide the content, or delete the content',
  })
  @IsIn(REPORT_ACTIONS)
  action: ReportAction;
}

/** PATCH /api/admin/content/:type/:id (GEN-10: hide or unhide directly). */
export class SetHiddenDto {
  @ApiProperty({
    example: true,
    description: 'true = hide, false = show again',
  })
  @IsBoolean()
  hidden: boolean;
}

export class ContentParamsDto {
  @ApiProperty({ enum: ReportTargetType })
  @IsEnum(ReportTargetType)
  type: ReportTargetType;

  @ApiProperty()
  @IsMongoId()
  id: string;
}

export class ReportTargetDto {
  @ApiProperty({ enum: ReportTargetType }) type: ReportTargetType;
  @ApiProperty() id: string;
  @ApiProperty({ description: 'false if the content was deleted' })
  exists: boolean;
  @ApiProperty() hidden: boolean;
  @ApiPropertyOptional({
    example: 'Nile trip',
    nullable: true,
    description: 'Itinerary title or review text',
  })
  preview: string | null;
  @ApiPropertyOptional({ nullable: true }) authorId: string | null;
}

export class ReportDto {
  @ApiProperty() id: string;
  @ApiProperty() reporterId: string;
  @ApiProperty() reason: string;
  @ApiProperty({ enum: ReportStatus }) status: ReportStatus;
  @ApiProperty({ type: ReportTargetDto }) target: ReportTargetDto;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  resolvedAt: Date | null;
}
