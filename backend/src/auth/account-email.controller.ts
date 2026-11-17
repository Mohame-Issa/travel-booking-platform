import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AllowPendingPasswordChange,
  CurrentUser,
  Public,
} from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { MessageResponseDto } from './dto/auth.dto.js';
import {
  EmailTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/account-email.dto.js';
import {
  FORGOT_PASSWORD_MESSAGE,
  PasswordResetService,
} from './password-reset.service.js';
import { EmailVerificationService } from './email-verification.service.js';

/** ACC-02 (bonus): email verification. ACC-07 (bonus): forgot password. */
@ApiTags('Auth')
@Controller('auth')
export class AccountEmailController {
  constructor(
    private readonly verification: EmailVerificationService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'ACC-07 (bonus): email me a password reset link (30 minutes, single use). Same answer whether or not the email exists.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  forgotPassword(@Body() dto: ForgotPasswordDto): MessageResponseDto {
    this.passwordReset.requestReset(dto.email);
    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'ACC-07 (bonus): set a new password with the token from the emailed link; logs out every session',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'INVALID_EMAIL_TOKEN or VALIDATION_FAILED (password rules)',
  })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<MessageResponseDto> {
    await this.passwordReset.reset(dto.token, dto.newPassword);
    return {
      message:
        'Your password has been changed. Please log in with the new password.',
    };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'ACC-02 (bonus): verify my email with the token from the emailed link',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'INVALID_EMAIL_TOKEN',
  })
  async verify(@Body() dto: EmailTokenDto): Promise<MessageResponseDto> {
    await this.verification.verify(dto.token);
    return { message: 'Your email address is verified. You can now book.' };
  }

  @Post('resend-verification')
  @HttpCode(200)
  @ApiCookieAuth()
  @AllowPendingPasswordChange()
  @ApiOperation({ summary: 'ACC-02 (bonus): email me a new verification link' })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'EMAIL_ALREADY_VERIFIED',
  })
  async resend(@CurrentUser('id') userId: string): Promise<MessageResponseDto> {
    await this.verification.resend(userId);
    return {
      message: 'A new verification link has been sent to your email address.',
    };
  }
}
