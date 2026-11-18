import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountEmailController } from './account-email.controller.js';
import { EmailTokensService } from './email-tokens.service.js';
import { EmailVerificationService } from './email-verification.service.js';
import { EmailVerifiedGuard } from './guards/email-verified.guard.js';
import { AuthModule } from './auth.module.js';
import { PasswordResetService } from './password-reset.service.js';
import { EmailToken, EmailTokenSchema } from './schemas/email-token.schema.js';

/**
 * ACC-02 / ACC-07 (bonus) by Youssef Khafagy, next to Mohamed Amr's auth.
 * Global so booking modules can use @RequireVerifiedEmail() (its guard needs
 * EmailVerificationService) and AuthController can send the link.
 */
@Global()
@Module({
  imports: [
    AuthModule, // password hashing and session revoke (ACC-07)
    MongooseModule.forFeature([
      { name: EmailToken.name, schema: EmailTokenSchema },
    ]),
  ],
  controllers: [AccountEmailController],
  providers: [
    EmailTokensService,
    EmailVerificationService,
    EmailVerifiedGuard,
    PasswordResetService,
  ],
  exports: [EmailTokensService, EmailVerificationService, EmailVerifiedGuard],
})
export class AccountEmailModule {}
