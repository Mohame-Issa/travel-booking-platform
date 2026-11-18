/** Every account has exactly one role. */
export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  AIRLINE_MODERATOR = 'airline_moderator',
  HOTEL_MODERATOR = 'hotel_moderator',
}

/**
 * Account status.
 * - active: normal account
 * - suspended: blocked by an admin (ACC-15, ACC-16); can be reactivated by an admin
 * - deactivated: closed by the user themselves (ACC-12); cannot log in
 */
export enum UserStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DEACTIVATED = 'deactivated',
}

/** The two kinds of provider a moderator can be assigned to. */
export enum ProviderType {
  AIRLINE = 'airline',
  HOTEL = 'hotel',
}

/** Which moderator role manages which provider type. */
export const MODERATOR_ROLE_FOR_PROVIDER: Record<ProviderType, UserRole> = {
  [ProviderType.AIRLINE]: UserRole.AIRLINE_MODERATOR,
  [ProviderType.HOTEL]: UserRole.HOTEL_MODERATOR,
};
