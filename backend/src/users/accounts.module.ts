import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccountService } from './account.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { UsersController } from './users.controller.js';

/**
 * Account endpoints (ACC-07a, ACC-09, ACC-11, ACC-12).
 * Kept separate from the global UsersModule because it needs AuthModule
 * (password hashing, sessions), and AuthModule itself relies on UsersModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [UsersController, AdminUsersController],
  providers: [AccountService],
})
export class AccountsModule {}
