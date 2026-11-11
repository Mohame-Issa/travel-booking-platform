import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
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
import { RefundResponseDto } from './dto/refund.dto.js';
import { RefundsService } from './refunds.service.js';
import { Refund } from './schemas/refund.schema.js';

@ApiTags('Refunds')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'AUTH_REQUIRED or SESSION_EXPIRED',
})
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'NOT_RESOURCE_OWNER or INSUFFICIENT_ROLE',
})
@Roles(UserRole.USER)
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get(':id')
  @CheckOwnership({ model: Refund.name })
  @ApiOperation({
    summary: 'Get a refund and its status (PAY-03)',
    description:
      'Only the owner. Status Pending, Refunded or Failed, with the amount, the percentage and ' +
      'the cancellation tier applied (FLT-09 / HTL-10; provider cancellations are 100%). ' +
      'Refunds are created by the cancellation endpoints, not here.',
  })
  @ApiOkResponse({ type: RefundResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'INVALID_ID' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Refund not found',
  })
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<RefundResponseDto> {
    return this.refunds.getRefund(id);
  }
}
