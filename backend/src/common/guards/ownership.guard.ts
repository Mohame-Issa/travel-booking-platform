import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectConnection } from '@nestjs/mongoose';
import { type Connection, isValidObjectId } from 'mongoose';
import { ErrorCode } from '../constants/error-codes.js';
import { UserRole } from '../constants/roles.js';
import { ApiException } from '../exceptions/api.exception.js';
import type { AuthenticatedRequest } from '../types/authenticated-user.js';

export const OWNERSHIP_KEY = 'ownership';

export interface OwnershipOptions {
  /** Mongoose model name, i.e. the schema class name, e.g. 'Itinerary' or FlightBooking.name. */
  model: string;
  /** Route parameter holding the document id. Default: 'id'. */
  param?: string;
  /** Field on the document holding the owner's user id. Default: 'userId'. */
  ownerField?: string;
  /**
   * Roles that skip the owner check (e.g. [UserRole.ADMIN] for ACC-17).
   * Default: none, so only the owner passes.
   */
  bypassRoles?: UserRole[];
}

/**
 * ACC-11: only the owner may access the resource.
 *
 *   @Get(':id')
 *   @CheckOwnership({ model: Itinerary.name })
 *   findOne(@Param('id', ParseObjectIdPipe) id: string) { ... }
 *
 * Responds 404 if the document does not exist and 403 if it belongs to
 * someone else. For rules the guard cannot express (e.g. a moderator may
 * view bookings of their own hotel), check in your service instead.
 */
export function CheckOwnership(options: OwnershipOptions) {
  return applyDecorators(
    SetMetadata(OWNERSHIP_KEY, options),
    UseGuards(OwnershipGuard),
  );
}

@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<OwnershipOptions | undefined>(
      OWNERSHIP_KEY,
      context.getHandler(),
    );
    if (!options) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;
    if (!user) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.AUTH_REQUIRED,
        'Please log in',
      );
    }
    if (options.bypassRoles?.includes(user.role)) return true;

    const param = options.param ?? 'id';
    const ownerField = options.ownerField ?? 'userId';
    const id = req.params[param];
    if (typeof id !== 'string' || !isValidObjectId(id)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.INVALID_ID,
        `Invalid ${param}`,
      );
    }

    const doc = await this.connection
      .model(options.model)
      .findById(id)
      .select(ownerField)
      .lean<Record<string, unknown>>()
      .exec();
    if (!doc) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        `${options.model} not found`,
      );
    }
    const owner = doc[ownerField];
    if (
      owner == null ||
      (owner as { toString(): string }).toString() !== user.id
    ) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.NOT_RESOURCE_OWNER,
        'You do not have access to this resource',
      );
    }
    return true;
  }
}
