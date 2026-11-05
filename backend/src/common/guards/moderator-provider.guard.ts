import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProviderType } from '../constants/roles.js';
import type { AuthenticatedRequest } from '../types/authenticated-user.js';
import { ModeratorAssignmentsService } from '../../users/moderator-assignments.service.js';

export const MODERATOR_PROVIDER_KEY = 'moderatorProvider';

interface ModeratorProviderOptions {
  type: ProviderType;
  /** Route parameter holding the airline/hotel id. Default: 'id'. */
  param: string;
}

/**
 * Limits moderators to their one assigned provider. Use on routes whose URL
 * contains the airline or hotel id:
 *
 *   @Patch(':id')                                        // /api/hotels/:id
 *   @Roles(UserRole.HOTEL_MODERATOR, UserRole.ADMIN)
 *   @ModeratorOfProvider(ProviderType.HOTEL)             // param defaults to 'id'
 *
 *   @Post(':hotelId/rooms')
 *   @ModeratorOfProvider(ProviderType.HOTEL, 'hotelId')
 *
 * Admins always pass (combine with @Roles to decide whether admins may call
 * the route at all). Any other role gets 403.
 *
 * When the provider id is NOT in the URL (e.g. PATCH /api/flights/:id, where
 * :id is a flight), load the resource in your service and call
 * ModeratorAssignmentsService.assertCanManage(user, ProviderType.AIRLINE, flight.airlineId).
 */
export function ModeratorOfProvider(type: ProviderType, param = 'id') {
  return applyDecorators(
    SetMetadata(MODERATOR_PROVIDER_KEY, {
      type,
      param,
    } satisfies ModeratorProviderOptions),
    UseGuards(ModeratorProviderGuard),
  );
}

@Injectable()
export class ModeratorProviderGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly assignments: ModeratorAssignmentsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<ModeratorProviderOptions | undefined>(
      MODERATOR_PROVIDER_KEY,
      context.getHandler(),
    );
    if (!options) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const providerId = req.params[options.param];
    await this.assignments.assertCanManage(
      req.user,
      options.type,
      typeof providerId === 'string' ? providerId : '',
    );
    return true;
  }
}
