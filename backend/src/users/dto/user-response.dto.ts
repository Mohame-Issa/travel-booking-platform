import { ApiProperty } from '@nestjs/swagger';
import { UserRole, UserStatus } from '../../common/constants/roles.js';
import type { User } from '../schemas/user.schema.js';

/** Safe public view of a user. Never includes the password hash or lockout data. */
export class UserResponseDto {
  @ApiProperty({ example: '6730f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: 'Sara Ahmed' })
  name: string;

  @ApiProperty({ example: 'sara@example.com' })
  email: string;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiProperty({ type: String, nullable: true, example: '+201001234567' })
  phone: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'EGP' })
  preferredCurrency: string | null;

  @ApiProperty({
    description:
      'True when the account must change its password before doing anything else.',
  })
  mustChangePassword: boolean;

  @ApiProperty()
  createdAt: Date;
}

export function toPublicUser(user: User & { _id: unknown }): UserResponseDto {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    phone: user.phone ?? null,
    preferredCurrency: user.preferredCurrency ?? null,
    mustChangePassword: user.mustChangePassword ?? false,
    createdAt: user.createdAt,
  };
}
