import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { IsValidPassword } from '../../auth/password.rules.js';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies.js';
import { UserResponseDto } from './user-response.dto.js';

/**
 * ACC-09: edit name, phone number and preferred currency.
 * Send only the fields you want to change. Send null for phone or
 * preferredCurrency to clear them. Name cannot be cleared.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Sara Ahmed' })
  @ValidateIf((o: UpdateProfileDto) => o.name !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Name is required' })
  @MinLength(2, { message: 'Name must be at least 2 characters long' })
  @MaxLength(100, { message: 'Name must be at most 100 characters long' })
  name?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '+201001234567',
    description:
      'Digits with an optional leading "+", 7 to 15 digits. Spaces and dashes are removed. null clears it.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/[\s-]/g, '') : value,
  )
  @IsString()
  @Matches(/^\+?\d{7,15}$/, {
    message: 'Please enter a valid phone number (7 to 15 digits)',
  })
  phone?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    enum: SUPPORTED_CURRENCIES,
    example: 'EGP',
    description: 'One of the currencies in Countries.csv. null clears it.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(SUPPORTED_CURRENCIES, {
    message: `Preferred currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`,
  })
  preferredCurrency?: string | null;
}

/** ACC-12: the user confirms deactivation by re-entering their password. */
export class DeactivateAccountDto {
  @ApiProperty({ example: 'Travel2026' })
  @IsString()
  @IsNotEmpty({ message: 'Password is required to deactivate your account' })
  @MaxLength(200)
  password: string;
}

/** ACC-07a */
export class AdminResetPasswordDto {
  @IsValidPassword()
  temporaryPassword: string;
}

export class AdminResetPasswordResponseDto {
  @ApiProperty({
    example:
      'Password reset. The account must set a new password at its next login.',
  })
  message: string;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;
}
