import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserRole } from '../common/constants/roles.js';
import { Roles } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { CheckOwnership } from '../common/guards/ownership.guard.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import { BudgetsService } from './budgets.service.js';
import {
  BudgetEntryDto,
  TransportCostDto,
  UpdateBudgetEntryDto,
  UpdateTransportCostDto,
} from './dto/budget.dto.js';
import { BudgetEntry } from './schemas/budget-entry.schema.js';
import { TransportCost } from './schemas/transport-cost.schema.js';

/** PATCH / DELETE /api/budgets/:id (ITN-14). Owner only (ACC-11). */
@ApiTags('Itineraries')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'AUTH_REQUIRED or SESSION_EXPIRED',
})
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'INSUFFICIENT_ROLE or NOT_RESOURCE_OWNER',
})
@ApiNotFoundResponse({
  type: ErrorResponseDto,
  description: 'Budget entry not found',
})
@Roles(UserRole.USER)
@Controller('budgets/:id')
export class BudgetEntriesController {
  constructor(private readonly budgets: BudgetsService) {}

  @Patch()
  @CheckOwnership({ model: BudgetEntry.name })
  @ApiOperation({
    summary: 'Edit a budget entry (ITN-14)',
    description: 'Amount >= 0, currency from the supported list.',
  })
  @ApiOkResponse({ type: BudgetEntryDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED',
  })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateBudgetEntryDto,
  ): Promise<BudgetEntryDto> {
    return this.budgets.updateEntry(id, dto);
  }

  @Delete()
  @CheckOwnership({ model: BudgetEntry.name })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a budget entry (ITN-14)' })
  @ApiNoContentResponse({ description: 'Deleted' })
  remove(@Param('id', ParseObjectIdPipe) id: string): Promise<void> {
    return this.budgets.removeEntry(id);
  }
}

/** PATCH / DELETE /api/transport-costs/:id (ITN-16). Owner only (ACC-11). */
@ApiTags('Itineraries')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'AUTH_REQUIRED or SESSION_EXPIRED',
})
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'INSUFFICIENT_ROLE or NOT_RESOURCE_OWNER',
})
@ApiNotFoundResponse({
  type: ErrorResponseDto,
  description: 'Transport cost not found',
})
@Roles(UserRole.USER)
@Controller('transport-costs/:id')
export class TransportCostsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Patch()
  @CheckOwnership({ model: TransportCost.name })
  @ApiOperation({ summary: 'Edit a transport cost (ITN-16)' })
  @ApiOkResponse({ type: TransportCostDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED or UNKNOWN_CITY',
  })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTransportCostDto,
  ): Promise<TransportCostDto> {
    return this.budgets.updateTransport(id, dto);
  }

  @Delete()
  @CheckOwnership({ model: TransportCost.name })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a transport cost (ITN-16)' })
  @ApiNoContentResponse({ description: 'Deleted' })
  remove(@Param('id', ParseObjectIdPipe) id: string): Promise<void> {
    return this.budgets.removeTransport(id);
  }
}
