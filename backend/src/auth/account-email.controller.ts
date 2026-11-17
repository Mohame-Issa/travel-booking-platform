import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
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
import { ApiException } from '../common/exceptions/api.exception.js';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { messagePage, resetPasswordForm } from './account-pages.js';
import { MessageResponseDto } from './dto/auth.dto.js';
import {
  EmailTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ResetPasswordFormDto,
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

  /**
   * The link in the email opens this page and verifies at once. Errors are
   * shown as a page too (not the JSON error format): a person clicked a link.
   */
  @Public()
  @Get('verify-email')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'ACC-02 (bonus): the emailed link; verifies the email and shows a page (HTML)',
  })
  async verifyPage(
    @Query('token') token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    try {
      await this.verification.verify(String(token ?? ''));
      return messagePage(
        'Email verified',
        'Thank you. Your email address is verified and you can now book flights and hotels.',
        true,
      );
    } catch (e) {
      if (!(e instanceof ApiException)) throw e;
      res.status(HttpStatus.BAD_REQUEST);
      return messagePage('Link not valid', e.message, false);
    }
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

  /** ACC-07: the emailed link opens this form (HTML). */
  @Public()
  @Get('reset-password')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'ACC-07 (bonus): the emailed link; shows the new-password form (HTML)',
  })
  async resetPasswordPage(
    @Query('token') token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    if (!token || !(await this.passwordReset.isUsable(token))) {
      res.status(HttpStatus.BAD_REQUEST);
      return invalidResetLink();
    }
    return resetPasswordForm(token);
  }

  /** ACC-07: the form posts here; errors are shown on the form again. */
  @Public()
  @Post('reset-password/form')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ACC-07 (bonus): submit of the new-password form (HTML)',
  })
  async resetPasswordFormSubmit(
    @Body() form: ResetPasswordFormDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    // Same rules as the JSON endpoint (ACC-01 password rules).
    const dto = plainToInstance(ResetPasswordDto, {
      token: form.token,
      newPassword: form.newPassword,
    });
    const errors = (await validate(dto))
      .filter((e) => e.property === 'newPassword')
      .flatMap((e) => Object.values(e.constraints ?? {}));
    if (form.newPassword !== form.confirmPassword)
      errors.push('The two passwords are not the same');
    if (errors.length) {
      res.status(HttpStatus.BAD_REQUEST);
      return resetPasswordForm(form.token, errors);
    }
    try {
      await this.passwordReset.reset(form.token, form.newPassword);
    } catch (e) {
      if (!(e instanceof ApiException)) throw e;
      res.status(HttpStatus.BAD_REQUEST);
      return invalidResetLink();
    }
    return messagePage(
      'Password changed',
      'Your password has been changed and you were logged out everywhere. Please log in with the new password.',
      true,
    );
  }
}

function invalidResetLink(): string {
  return messagePage(
    'Link not valid',
    'This link is invalid, has expired or was already used. Please request a new one.',
    false,
  );
}
