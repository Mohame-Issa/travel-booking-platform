import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserResponseDto } from '../../users/dto/user-response.dto.js';
import { IsValidPassword } from '../password.rules.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** ACC-01 */
export class RegisterDto {
  @ApiProperty({ example: 'Sara Ahmed' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters long' })
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'sara@example.com' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(254)
  email: string;

  @IsValidPassword()
  password: string;

  @ApiProperty({
    example: true,
    description: 'Terms-and-privacy consent. Must be true.',
  })
  @IsBoolean()
  @Equals(true, { message: 'You must accept the terms and privacy policy' })
  acceptTerms: boolean;
}

/** ACC-04 */
export class LoginDto {
  @ApiProperty({ example: 'sara@example.com' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Please enter a valid email address' })
  email: string;

  @ApiProperty({ example: 'Travel2026' })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MaxLength(200)
  password: string;

  /**
   * ACC-10: the page the guest was on when a restricted action sent them to
   * login. Must be a path on our own site ("/hotels/123/book"); full URLs and
   * "//evil.com" are rejected, so this cannot be abused as an open redirect.
   */
  @ApiPropertyOptional({
    example: '/hotels/6730f1c2a1b2c3d4e5f60718/book',
    description:
      'ACC-10: relative path to return to after login. Echoed back in the response.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Matches(/^\/(?![/\\])[^\s]*$/, {
    message: 'returnTo must be a relative path starting with a single "/"',
  })
  returnTo?: string;
}

/** ACC-08 */
export class ChangePasswordDto {
  @ApiProperty({ example: 'Travel2026' })
  @IsString()
  @IsNotEmpty({ message: 'Current password is required' })
  @MaxLength(200)
  currentPassword: string;

  @IsValidPassword()
  newPassword: string;
}

export class LoginResponseDto {
  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;

  @ApiProperty({
    description:
      'If true, the frontend must send the user to the change-password page; other endpoints return 403 PASSWORD_CHANGE_REQUIRED until then.',
  })
  mustChangePassword: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'ACC-10: where the frontend should send the user next (the returnTo sent at login), or null for the role home page.',
  })
  returnTo: string | null;
}

export class MessageResponseDto {
  @ApiProperty({ example: 'Logged out' })
  message: string;
}
