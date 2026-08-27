/*
 * Loads an image from an authenticated API route into something an <img> can
 * display.
 *
 * WHY
 * ---
 * Avatars and student documents are stored as binary in the database now, and
 * served by routes that require a bearer token. An <img src> issues its own
 * request without one, so pointing it at /api/users/42/avatar gets a 401 and
 * renders as a broken image.
 *
 * This fetches the bytes through the API client — token attached — and hands
 * back a blob: URL.
 *
 * THE LIFECYCLE IS THE WHOLE POINT
 * --------------------------------
 * An object URL keeps its blob alive until something revokes it. Created per
 * row in a directory and never released, that is a steady leak: page through
 * two hundred students and two hundred photographs stay resident for as long
 * as the tab is open. So the URL is revoked when the component unmounts and
 * when the source changes, and the in-flight request is aborted on the same
 * events — otherwise a fast navigation leaves a response arriving for a
 * component that is gone, creating a URL that nothing will ever revoke.
 *
 * USAGE
 *
 *   const { url, loading } = useAuthedImage(
 *     userId ? `/api/users/${userId}/avatar` : null,
 *   );
 *
 *   return url
 *     ? <img src={url} alt="" />
 *     : <Initials name={name} />;
 *
 * `url` is null both while loading and when there is no picture on record.
 * `loading` separates the two, for a screen that wants a skeleton rather than
 * initials flashing before the photograph arrives.
 */

import { useEffect, useState } from 'react';
import { fetchBlobUrl } from '../api/client';

export default function useAuthedImage(endpoint) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(!!endpoint);

  useEffect(() => {
    if (!endpoint) {
      setUrl(null);
      setLoading(false);
      return undefined;
    }

    // Tracked separately from the abort signal: an abort stops the fetch, but
    // the `.then` below can still be scheduled, and calling setState on an
    // unmounted component is what produces the "state update on unmounted"
    // warning here.
    let live = true;
    let objectUrl = null;

    const controller = new AbortController();

    setLoading(true);

    fetchBlobUrl(endpoint, { signal: controller.signal })
      .then((next) => {
        if (!live) {
          // Arrived after unmount. Nothing will render it, so it is revoked
          // here rather than left pinned in memory.
          if (next) URL.revokeObjectURL(next);
          return;
        }
        objectUrl = next;
        setUrl(next);
        setLoading(false);
      })
      .catch(() => {
        // An abort is the expected outcome of navigating away; anything else
        // is a missing image, which the caller renders as "no picture".
        if (live) {
          setUrl(null);
          setLoading(false);
        }
      });

    return () => {
      live = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [endpoint]);

  return { url, loading };
}
