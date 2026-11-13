import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';

export class AuditLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'user.password_reset' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ example: 'User' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  targetType?: string;

  @ApiPropertyOptional({ description: 'Admin who performed the action' })
  @IsOptional()
  @IsMongoId()
  actorId?: string;
}

export class AuditLogResponseDto {
  @ApiProperty() _id: string;
  @ApiProperty() actorId: string;
  @ApiProperty({ example: 'user.password_reset' }) action: string;
  @ApiProperty({ example: 'User' }) targetType: string;
  @ApiProperty({ type: String, nullable: true }) targetId: string | null;
  @ApiProperty({ type: Object, nullable: true }) details: Record<
    string,
    unknown
  > | null;
  @ApiProperty() createdAt: Date;
}
