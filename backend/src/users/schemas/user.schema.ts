import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { UserRole, UserStatus } from '../../common/constants/roles.js';

/**
 * User account (all roles). Collection: "users".
 *
 * passwordHash is excluded from queries by default (select: false). Never
 * return a User document directly from a controller; use toPublicUser().
 */
@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, trim: true, maxlength: 100 })
  name: string;

  /** Stored lowercase; unique across all accounts (ACC-01). */
  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 254,
  })
  email: string;

  /** bcrypt salted hash (GEN-13). */
  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({
    type: String,
    enum: Object.values(UserRole),
    default: UserRole.USER,
    index: true,
  })
  role: UserRole;

  @Prop({
    type: String,
    enum: Object.values(UserStatus),
    default: UserStatus.ACTIVE,
    index: true,
  })
  status: UserStatus;

  /** ACC-09 */
  @Prop({ type: String, trim: true, default: null })
  phone: string | null;

  /** ACC-09: ISO 4217 code from Countries.csv, e.g. "EGP". */
  @Prop({ type: String, uppercase: true, default: null })
  preferredCurrency: string | null;

  /** ACC-01: when the guest ticked the terms-and-privacy checkbox. Null for seeded/admin-created accounts. */
  @Prop({ type: Date, default: null })
  termsAcceptedAt: Date | null;

  /**
   * ACC-02 (bonus): false until the emailed link is used. Only accounts
   * registered after ACC-02 have it; older, seeded and admin-created
   * accounts have no value and count as verified.
   */
  @Prop({ type: Boolean })
  emailVerified?: boolean;

  /** ACC-05: consecutive failed logins since the last success or lock. */
  @Prop({ default: 0 })
  failedLoginAttempts: number;

  /** ACC-05: login is refused until this time. */
  @Prop({ type: Date, default: null })
  lockUntil: Date | null;

  /** ACC-07a / ACC-13: the account must set a new password before doing anything else. */
  @Prop({ default: false })
  mustChangePassword: boolean;

  @Prop({ type: Date, default: null })
  passwordChangedAt: Date | null;

  @Prop({ type: Date, default: null })
  lastLoginAt: Date | null;

  /** ACC-12 */
  @Prop({ type: Date, default: null })
  deactivatedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
