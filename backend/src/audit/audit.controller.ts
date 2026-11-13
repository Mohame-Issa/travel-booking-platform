import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserRole } from '../common/constants/roles.js';
import { Roles } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/dto/pagination.dto.js';
import { AuditLogService } from './audit.service.js';
import { AuditLogQueryDto, AuditLogResponseDto } from './dto/audit-log.dto.js';

@ApiTags('Admin')
@ApiCookieAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditLogService) {}

  @Get()
  @ApiOperation({
    summary: 'List audit log entries (GEN-07)',
    description:
      'Admin only. Newest first, page size 10. Filter by action, targetType or actorId.',
  })
  @ApiPaginatedResponse(AuditLogResponseDto)
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'AUTH_REQUIRED or SESSION_EXPIRED',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'INSUFFICIENT_ROLE',
  })
  list(@Query() query: AuditLogQueryDto) {
    return this.audit.list(query);
  }
}
