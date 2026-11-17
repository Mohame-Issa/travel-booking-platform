import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { IsValidPassword } from '../password.rules.js';

/** The token part of an emailed link (ACC-02, ACC-07). */
export class EmailTokenDto {
  @ApiProperty({ description: 'The token from the link in the email' })
  @IsString()
  @Length(20, 200)
  token: string;
}

/** ACC-07: POST /api/auth/forgot-password */
export class ForgotPasswordDto {
  @ApiProperty({ example: 'sara@example.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(254)
  email: string;
}

/** ACC-07: POST /api/auth/reset-password */
export class ResetPasswordDto extends EmailTokenDto {
  @IsValidPassword()
  newPassword: string;
}

/**
 * ACC-07: the HTML form of the emailed link (application/x-www-form-urlencoded).
 * Only shape checks here; the password rules are checked by the controller
 * with ResetPasswordDto so the errors can be shown on the page.
 */
export class ResetPasswordFormDto {
  @ApiProperty() @IsString() token: string;
  @ApiProperty() @IsString() newPassword: string;
  @ApiProperty() @IsString() confirmPassword: string;
}
