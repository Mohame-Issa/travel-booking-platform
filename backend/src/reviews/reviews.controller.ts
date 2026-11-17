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
import { Public, Roles } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { CheckOwnership } from '../common/guards/ownership.guard.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema.js';
import {
  CreateReviewDto,
  HotelReviewsDto,
  ListReviewsQueryDto,
  ReviewDto,
  UpdateReviewDto,
} from './dto/review.dto.js';
import { ReviewsService } from './reviews.service.js';
import { Review } from './schemas/review.schema.js';

const unauthorized = {
  type: ErrorResponseDto,
  description: 'AUTH_REQUIRED or SESSION_EXPIRED',
};
const forbidden = {
  type: ErrorResponseDto,
  description: 'INSUFFICIENT_ROLE or NOT_RESOURCE_OWNER',
};

/** Hotel reviews (HTL-23, HTL-24). */
@ApiTags('Reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('hotel-bookings/:id/review')
  @Roles(UserRole.USER)
  @CheckOwnership({ model: HotelBooking.name })
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Review a completed stay (HTL-23)',
    description:
      'Only the reservation owner, only after the check-out date. One rating (1-5) and an optional review ' +
      '(max 1000 characters) per reservation, whatever the number of rooms. Updates the hotel average rating.',
  })
  @ApiCreatedResponse({ type: ReviewDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED',
  })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Reservation not found',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'STAY_NOT_COMPLETED or REVIEW_ALREADY_EXISTS',
  })
  create(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewDto> {
    return this.reviews.create(id, dto);
  }

  @Patch('reviews/:id')
  @Roles(UserRole.USER)
  @CheckOwnership({ model: Review.name })
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Edit my review (HTL-23)',
    description: 'Recalculates the hotel average rating.',
  })
  @ApiOkResponse({ type: ReviewDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED',
  })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Review not found',
  })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateReviewDto,
  ): Promise<ReviewDto> {
    return this.reviews.update(id, dto);
  }

  @Delete('reviews/:id')
  @Roles(UserRole.USER)
  @CheckOwnership({ model: Review.name })
  @ApiCookieAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete my review (HTL-23)',
    description:
      'Recalculates the hotel average rating. The frontend asks for confirmation first (GEN-03).',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Review not found',
  })
  remove(@Param('id', ParseObjectIdPipe) id: string): Promise<void> {
    return this.reviews.remove(id);
  }

  @Get('hotels/:id/reviews')
  @Public()
  @ApiOperation({
    summary: "A hotel's rating and reviews (HTL-24)",
    description:
      'Guests and users. Average rating, number of ratings, and reviews newest first, 10 per page. ' +
      'Reviews hidden by an admin are not shown (GEN-10); deactivated authors show as "Deleted user" (ACC-12).',
  })
  @ApiOkResponse({ type: HotelReviewsDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Hotel not found',
  })
  list(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ListReviewsQueryDto,
  ): Promise<HotelReviewsDto> {
    return this.reviews.listForHotel(id, query.page);
  }
}
