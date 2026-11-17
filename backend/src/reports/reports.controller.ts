import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserRole } from '../common/constants/roles.js';
import { CurrentUser, Roles } from '../common/decorators/auth.decorators.js';
import {
  ApiPaginatedResponse,
  type Paginated,
} from '../common/dto/pagination.dto.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import {
  ContentParamsDto,
  CreateReportDto,
  ListReportsQueryDto,
  ReportDto,
  ResolveReportDto,
  SetHiddenDto,
} from './dto/report.dto.js';
import { ReportsService } from './reports.service.js';

const unauthorized = {
  type: ErrorResponseDto,
  description: 'AUTH_REQUIRED or SESSION_EXPIRED',
};
const forbidden = { type: ErrorResponseDto, description: 'INSUFFICIENT_ROLE' };

/** Users report content (GEN-09). */
@ApiTags('Reports')
@ApiCookieAuth()
@ApiUnauthorizedResponse(unauthorized)
@ApiForbiddenResponse(forbidden)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @Roles(UserRole.USER)
  @ApiOperation({
    summary: 'Report a post, comment, review or itinerary (GEN-09)',
    description:
      'Registered users, with a reason, at most once per item. Only content you can see can be reported ' +
      '(a published post, a comment on one, a public itinerary or a visible review).',
  })
  @ApiCreatedResponse({ type: ReportDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Content not found or not visible',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'ALREADY_REPORTED',
  })
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateReportDto,
  ): Promise<ReportDto> {
    return this.reports.create(userId, dto);
  }
}

/** Admin moderation (GEN-10). Every action is audit-logged (GEN-07). */
@ApiTags('Admin')
@ApiCookieAuth()
@ApiUnauthorizedResponse(unauthorized)
@ApiForbiddenResponse(forbidden)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminModerationController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports')
  @ApiOperation({
    summary: 'List reports (GEN-09, GEN-10)',
    description:
      'Open reports by default (oldest first, 10 per page), each with a preview of the reported content.',
  })
  @ApiPaginatedResponse(ReportDto)
  list(@Query() query: ListReportsQueryDto): Promise<Paginated<ReportDto>> {
    return this.reports.list(query.status, query.page);
  }

  @Patch('reports/:id')
  @ApiOperation({
    summary: 'Resolve a report (GEN-10)',
    description:
      'action: dismiss (content stays), hide (visible only to its author and admins) or delete. ' +
      'Hiding or deleting also resolves the other open reports on the same content.',
  })
  @ApiOkResponse({ type: ReportDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Report or content not found',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'REPORT_ALREADY_RESOLVED',
  })
  resolve(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ResolveReportDto,
    @CurrentUser('id') adminId: string,
  ): Promise<ReportDto> {
    return this.reports.resolve(id, dto.action, adminId);
  }

  @Patch('content/:type/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Hide or show a post, comment, review or itinerary directly (GEN-10)',
    description:
      'hidden: true hides it from everyone except its author and admins (and a hidden review stops counting in the ' +
      'hotel rating); false shows it again.',
  })
  @ApiNoContentResponse({ description: 'Done' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Content not found',
  })
  setHidden(
    @Param() params: ContentParamsDto,
    @Body() dto: SetHiddenDto,
    @CurrentUser('id') adminId: string,
  ): Promise<void> {
    return this.reports.setHidden(params.type, params.id, dto.hidden, adminId);
  }

  @Delete('content/:type/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a post, comment, review or itinerary (GEN-10)',
    description:
      'An itinerary goes with all its days, activities and budgets; a review updates the hotel rating.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Content not found',
  })
  remove(
    @Param() params: ContentParamsDto,
    @CurrentUser('id') adminId: string,
  ): Promise<void> {
    return this.reports.deleteContent(params.type, params.id, adminId);
  }
}
