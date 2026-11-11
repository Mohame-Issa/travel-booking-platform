import { plainToInstance } from 'class-transformer';
import { IsEmail, validateSync } from 'class-validator';
import { IsValidPassword } from '../auth/password.rules.js';

export class SeedAccount {
  @IsEmail() email: string;
  @IsValidPassword() password: string;
}

export interface SeedOptions {
  admin?: SeedAccount;
  demo?: { airlineModerator: SeedAccount; hotelModerator: SeedAccount };
}

export function validateSeedOptions(options: SeedOptions): void {
  if (
    options.demo &&
    (!options.demo.airlineModerator || !options.demo.hotelModerator)
  )
    throw new Error('Both demo moderator accounts are required');
  const accounts = [
    options.admin,
    options.demo?.airlineModerator,
    options.demo?.hotelModerator,
  ].filter((account): account is SeedAccount => account !== undefined);
  const emails = new Set<string>();
  for (const account of accounts) {
    if (
      validateSync(plainToInstance(SeedAccount, account)).length ||
      Buffer.byteLength(account.password, 'utf8') > 72
    )
      throw new Error(
        'Seed account credentials do not meet the shared validation rules',
      );
    const email = account.email.trim().toLowerCase();
    if (emails.has(email))
      throw new Error('Seed accounts must use distinct email addresses');
    emails.add(email);
  }
}
