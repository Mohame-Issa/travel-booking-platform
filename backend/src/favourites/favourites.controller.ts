import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../common/constants/roles.js';
import { CurrentUser, Roles } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/dto/pagination.dto.js';
import {
  AddFavouriteDto,
  FavouriteDto,
  FavouriteParamsDto,
  ListFavouritesQueryDto,
} from './dto/favourite.dto.js';
import { FavouritesService } from './favourites.service.js';

/** BON-02 (bonus): my favourite hotels and public itineraries. */
@ApiTags('Favourites')
@ApiCookieAuth()
@Roles(UserRole.USER)
@Controller('favourites')
export class FavouritesController {
  constructor(private readonly favourites: FavouritesService) {}

  @Post()
  @ApiOperation({
    summary:
      'BON-02 (bonus): save an active hotel or a public itinerary (saving twice is fine)',
  })
  @ApiCreatedResponse({ type: FavouriteDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Hotel / public itinerary not found',
  })
  add(@CurrentUser('id') userId: string, @Body() dto: AddFavouriteDto) {
    return this.favourites.add(userId, dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'BON-02 (bonus): my favourites, newest first; ?type=hotel|itinerary',
  })
  @ApiPaginatedResponse(FavouriteDto)
  list(@CurrentUser('id') userId: string, @Query() q: ListFavouritesQueryDto) {
    return this.favourites.list(userId, q);
  }

  @Delete(':type/:targetId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'BON-02 (bonus): remove an item from my favourites',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Not in your favourites',
  })
  remove(@CurrentUser('id') userId: string, @Param() p: FavouriteParamsDto) {
    return this.favourites.remove(userId, p.type, p.targetId);
  }
}
