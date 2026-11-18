import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * ACC-01 password rules: at least 8 characters, at least one letter and one digit.
 * Max 72 because bcrypt ignores anything after 72 bytes.
 * Reused by register, change-password and admin reset (ACC-07a, ACC-08, ACC-13).
 */
export const PASSWORD_RULES_TEXT =
  'At least 8 characters, including at least one letter and one digit';

export function IsValidPassword() {
  return applyDecorators(
    ApiProperty({
      example: 'Travel2026',
      minLength: 8,
      maxLength: 72,
      description: PASSWORD_RULES_TEXT,
    }),
    IsString(),
    MinLength(8, { message: 'Password must be at least 8 characters long' }),
    MaxLength(72, { message: 'Password must be at most 72 characters long' }),
    Matches(/[A-Za-z]/, {
      message: 'Password must contain at least one letter',
    }),
    Matches(/\d/, { message: 'Password must contain at least one digit' }),
  );
}
