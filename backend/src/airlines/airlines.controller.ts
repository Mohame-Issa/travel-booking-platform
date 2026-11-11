import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserRole } from '../common/constants/roles.js';
import {
  CurrentUser,
  Public,
  Roles,
} from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { AirlinesService } from './airlines.service.js';
import {
  AirlinePolicyResponseDto,
  AirlineResponseDto,
  BaggagePolicyDto,
  CancellationPolicyDto,
  CreateAirlineDto,
  UpdateAirlineDto,
} from './dto/airline.dto.js';

@ApiTags('Airlines')
@ApiCookieAuth()
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@Controller('airlines')
export class AirlinesController {
  constructor(private readonly airlines: AirlinesService) {}
  @Post()
  @Roles(UserRole.ADMIN)
  @ApiCreatedResponse({ type: AirlineResponseDto })
  @ApiOperation({ summary: 'Create an airline profile (FLT-01)' })
  create(@Body() dto: CreateAirlineDto) {
    return this.airlines.create(dto);
  }
  @Get(':id')
  @Public()
  @ApiOkResponse({ type: AirlineResponseDto })
  @ApiOperation({ summary: 'Read an airline profile (FLT-01)' })
  get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.airlines.get(id);
  }
  @Patch(':id')
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiOkResponse({ type: AirlineResponseDto })
  @ApiResponse({
    status: 501,
    type: ErrorResponseDto,
    description:
      'Only logo edits require the pending shared upload integration',
  })
  @ApiOperation({
    summary: 'Edit the assigned airline profile (FLT-01, GEN-08)',
  })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateAirlineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.airlines.update(id, dto, user);
  }
  @Put(':id/baggage-policy')
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiOkResponse({ type: AirlinePolicyResponseDto })
  @ApiOperation({
    summary: 'Set extra-bag prices and limits (FLT-08)',
    description:
      'Cabin allowances use the cabin endpoints (FLT-04). Extra bags have the cabin maximum weight.',
  })
  baggage(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: BaggagePolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.airlines.setBaggage(id, dto, user);
  }
  @Put(':id/cancellation-policy')
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiOkResponse({ type: AirlinePolicyResponseDto })
  @ApiOperation({ summary: 'Set cancellation tiers (FLT-09)' })
  cancellation(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CancellationPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.airlines.setCancellation(id, dto, user);
  }
}
