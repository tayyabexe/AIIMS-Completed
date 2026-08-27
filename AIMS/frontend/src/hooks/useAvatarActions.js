import { useCallback, useState } from 'react';
import { users as usersApi } from '../api/endpoints';
import { invalidateAvatar } from '../api/avatarCache';

/*
 * Upload and remove the signed-in account's profile picture.
 *
 * WHY IT IS A HOOK AND NOT FOUR COPIES
 * ------------------------------------
 * Four portals need the same two calls, and each one was on course to write
 * them itself — the student portal already had them inside
 * StudentProfileContext, and the admin Settings page had a second copy. That is
 * fine until you remember there is a cache in front of the images: the portal
 * that forgets `invalidateAvatar` keeps serving the OLD picture from memory
 * everywhere except the one component that happens to re-fetch, and the report
 * comes back as "it changed on my profile but not in the header".
 *
 * Both endpoints are `/me` routes — the account is taken from the token — so
 * this works unchanged for a student, a teacher, a parent or an admin.
 *
 * `userId` is needed only to evict the cache, and is optional: without it the
 * upload still succeeds, and the new picture appears wherever the caller
 * refreshes by itself.
 */
export default function useAvatarActions(userId, { onDone } = {}) {
  const [busy, setBusy] = useState(false);

  const upload = useCallback(async (file) => {
    setBusy(true);
    try {
      const res = await usersApi.uploadProfilePicture(file);

      /*
       * Evicted, not updated. The cache is keyed by user id plus a version, and
       * the version this component knows is the OLD one — so writing the new
       * bytes under it would be storing a fresh picture under a stale key.
       * Dropping the entry makes the next read fetch, which is exactly right
       * for something that happens once per upload.
       */
      if (userId) invalidateAvatar(userId);

      await onDone?.();
      return res;
    } finally {
      setBusy(false);
    }
  }, [userId, onDone]);

  const remove = useCallback(async () => {
    setBusy(true);
    try {
      await usersApi.deleteProfilePicture();
      if (userId) invalidateAvatar(userId);
      await onDone?.();
    } finally {
      setBusy(false);
    }
  }, [userId, onDone]);

  return { upload, remove, busy };
}
