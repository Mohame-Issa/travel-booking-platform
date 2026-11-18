import { Controller, Get, Param, HttpStatus } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../common/constants/roles.js';
import { Roles } from '../common/decorators/auth.decorators.js';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiErrors } from '../payments/api-errors.decorator.js';
import { CheckOwnership } from '../common/guards/ownership.guard.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import { RefundResponseDto } from './dto/refund.dto.js';
import { RefundsService } from './refunds.service.js';
import { Refund } from './schemas/refund.schema.js';

@ApiTags('Refunds')
@ApiCookieAuth()
@ApiErrors(
  HttpStatus.UNAUTHORIZED,
  ErrorCode.AUTH_REQUIRED,
  ErrorCode.SESSION_EXPIRED,
)
@ApiErrors(
  HttpStatus.FORBIDDEN,
  ErrorCode.NOT_RESOURCE_OWNER,
  ErrorCode.INSUFFICIENT_ROLE,
)
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
  @ApiErrors(HttpStatus.BAD_REQUEST, ErrorCode.INVALID_ID)
  @ApiErrors(HttpStatus.NOT_FOUND, {
    code: ErrorCode.NOT_FOUND,
    message: 'Refund not found',
  })
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<RefundResponseDto> {
    return this.refunds.getRefund(id);
  }
}
