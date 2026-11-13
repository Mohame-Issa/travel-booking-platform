import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';

export class NotificationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    default: false,
    description: 'Only unread notifications',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  unreadOnly?: boolean;
}

export class NotificationResponseDto {
  @ApiProperty() _id: string;
  @ApiProperty({ example: 'refund_issued' }) type: string;
  @ApiProperty() title: string;
  @ApiProperty() message: string;
  @ApiProperty({
    type: Object,
    nullable: true,
    description: 'Ids to link to, e.g. bookingId',
  })
  data: Record<string, unknown> | null;
  @ApiProperty({ type: Date, nullable: true }) readAt: Date | null;
  @ApiProperty() createdAt: Date;
}

export class MarkAllReadResponseDto {
  @ApiProperty({ example: 3 }) updated: number;
}
