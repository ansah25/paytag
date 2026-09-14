import { supabase } from '../config/supabase';
import { BadRequestError, NotFoundError } from '../utils/errors';
import { USER_COLUMNS, UserRecord } from './userService';
import { invalidateResolveCache } from './walletService';

export const PROFILE_LIMITS = { displayName: 40, bio: 120 } as const;

export interface ProfilePatch {
  /** `undefined` leaves the field unchanged; `null` clears it. */
  displayName?: string | null;
  bio?: string | null;
}

export const updateProfile = async (
  ownerWallet: string,
  patch: ProfilePatch,
): Promise<UserRecord> => {
  const update: { display_name?: string | null; bio?: string | null } = {};
  if (patch.displayName !== undefined) update.display_name = patch.displayName;
  if (patch.bio !== undefined) update.bio = patch.bio;

  if (Object.keys(update).length === 0) {
    throw new BadRequestError('Provide a display name or bio to update', 'EMPTY_UPDATE');
  }
  if ((update.display_name?.length ?? 0) > PROFILE_LIMITS.displayName) {
    throw new BadRequestError(
      `Display name must be ${PROFILE_LIMITS.displayName} characters or fewer`,
      'DISPLAY_NAME_TOO_LONG',
    );
  }
  if ((update.bio?.length ?? 0) > PROFILE_LIMITS.bio) {
    throw new BadRequestError(`Bio must be ${PROFILE_LIMITS.bio} characters or fewer`, 'BIO_TOO_LONG');
  }

  const { data, error } = await supabase
    .from('users')
    .update(update)
    .eq('owner_wallet', ownerWallet.toLowerCase())
    .select(USER_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update profile: ${error.message}`);
  }
  if (!data) {
    throw new NotFoundError('No registered username for this wallet', 'USER_NOT_FOUND');
  }

  const user = data as UserRecord;
  invalidateResolveCache(user.username);
  return user;
};
