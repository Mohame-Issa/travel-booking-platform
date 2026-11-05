import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsString,
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
}

export class LoginResponseDto {
  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;

  @ApiProperty({
    description:
      'If true, the frontend must send the user to the change-password page; other endpoints return 403 PASSWORD_CHANGE_REQUIRED until then.',
  })
  mustChangePassword: boolean;
}

export class MessageResponseDto {
  @ApiProperty({ example: 'Logged out' })
  message: string;
}
