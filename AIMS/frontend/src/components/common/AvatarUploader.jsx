import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera, Upload, Trash2, X, Check, Loader2, AlertCircle, ImageIcon, RefreshCw,
} from 'lucide-react';
import AvatarCropper from './AvatarCropper';
import './AvatarUploader.css';

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  The profile-picture picker
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT IT REPLACES
 * ----------------
 * A modal whose entire body was a vertical list of three rows — "Upload from
 * Device", "Open Camera", "Remove Photo" — each a title, a grey subtitle and a
 * chevron. Three problems, seen on screen with Playwright before it was
 * rewritten:
 *
 *   1. It is a MENU, not a picker. Nothing on it accepts a file. The one thing
 *      a person arrives wanting to do — drag a photograph onto it — does
 *      nothing at all, and the actual file dialog is two clicks away behind a
 *      row that reads like a settings entry.
 *   2. The current photo is a small circle above the list with the caption
 *      "Current Photo", so the thing being changed is the least prominent
 *      element on a dialog that exists to change it.
 *   3. "Remove Photo" sits in the same list as the two ways of adding one,
 *      styled identically apart from the icon tint. A destructive action given
 *      the same weight as the constructive ones is a mis-click waiting to
 *      happen.
 *
 * WHAT THIS DOES INSTEAD
 * ----------------------
 * The picture is the interface. A large circular target shows what is on
 * record now; dropping a file on it, or clicking it, replaces it. Drag-and-drop
 * works across the whole card, not just the target, because a person dragging a
 * file aims at the dialog, not at a 128px circle. The camera stays — it is the
 * only route for someone without a saved photograph — but as a secondary
 * control, and Remove is a quiet text action set apart from both.
 *
 * The confirm step is kept and is not optional: the preview is what stops a
 * misfired drag from replacing somebody's portrait with a screenshot.
 *
 * PORTABLE ON PURPOSE
 * -------------------
 * It is given the current image and two callbacks and knows nothing about
 * which portal it is in, so the student, faculty, parent and admin profiles can
 * all mount the same one. Its styles live beside it in AvatarUploader.css
 * rather than in any portal's stylesheet, for the same reason.
 *
 * THE CROP STEP
 * -------------
 * Choosing a file no longer uploads it. It opens the framing stage
 * (AvatarCropper), where the picture can be dragged and zoomed inside the
 * circle it will actually be shown in, and only the square that comes out of
 * that is sent.
 *
 * This is not decoration. Every avatar in this product is drawn in a circle
 * with `object-fit: cover`, so before this the BROWSER did the cropping — dead
 * centre, at display time, differently at each size the avatar appears in. A
 * portrait with the subject off to one side came out as an ear, and nobody had
 * any way to correct it. Doing it here means the bytes that are stored are the
 * picture that will be seen, everywhere, identically.
 *
 * It also settles the size of what is STORED. Whatever goes in, a 512x512 JPEG
 * comes out, 11-60 KB in practice. What goes IN is bounded separately, by the
 * 1 MB source check in `acceptFile` — see MAX_BYTES below for why the two are
 * different rules and not one.
 */

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/*
 * THE 1 MB RULE (task 5)
 * ----------------------
 * This is a limit on the SOURCE file, not on what gets stored. The cropper
 * re-encodes everything to a 512x512 JPEG, which lands at 11-60 KB, so the
 * stored bytes were never the problem.
 *
 * The problem is the step before it. `acceptFile` hands the file to
 * URL.createObjectURL and the cropper then decodes it into an <img>, which
 * means a 40 MP photograph is expanded to roughly width x height x 4 bytes of
 * live bitmap in the tab. Measured with Playwright before this check existed:
 * a 15.88 MB PNG was accepted without a word and sat in the cropper.
 *
 * So the file is measured first and refused before an object URL is ever
 * created. The server enforces the same 1 MB independently — see
 * backend/src/middlewares/upload.middleware.js — because a client-side check
 * is a courtesy to the person, not a control.
 */
const MAX_BYTES = 1024 * 1024;
const MAX_LABEL = '1 MB';

/*
 * "15.88 MB", "1.03 MB", "870 KB" — for telling somebody how far over they are.
 *
 * Two decimals, not one. A file of 1,079,752 bytes is 1.03 MB, and rounding it
 * to "1.0 MB" produced the sentence "That image is 1.0 MB. Choose one under
 * 1 MB." — which reads as a contradiction. Seen on screen during verification.
 */
const formatSize = (bytes) => (
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
);

const initialsOf = (name = '') => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/**
 * @param {boolean}  open
 * @param {function} onClose
 * @param {string}   [currentUrl]  the picture on record, for the preview target
 * @param {string}   [name]        for the initials fallback
 * @param {function} onUpload      async (File) => void; throw to show an error
 * @param {function} [onRemove]    async () => void; omit to hide Remove
 */
export default function AvatarUploader({
  open,
  onClose,
  currentUrl = null,
  name = '',
  onUpload,
  onRemove,
}) {
  const [preview, setPreview] = useState(null);   // object URL of the chosen file
  const [file, setFile] = useState(null);
  /*
   * `cropping` is the stage flag; `cropFn` is the function AvatarCropper hands
   * back, which turns the CURRENT framing into a File.
   *
   * The function is held in a ref-like state rather than the cropper pushing a
   * file up on every drag: producing the file means drawing a 512px canvas and
   * encoding a JPEG, and doing that per pointer move would make the drag
   * stutter. It is called once, when Save is pressed.
   */
  const [cropping, setCropping] = useState(false);
  const [cropFn, setCropFn] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  /* ── camera teardown ─────────────────────────────────────────────────────
     A getUserMedia stream holds the webcam light on until every track is
     stopped. Closing the dialog without this leaves the camera running for the
     life of the tab, which is both a privacy problem and the thing that makes
     a browser refuse the next request. */
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamera(false);
  }, []);

  const reset = useCallback(() => {
    // The object URL is revoked, not merely dropped: it pins the whole image in
    // memory until it is, and this dialog can be opened repeatedly.
    setPreview((url) => { if (url) URL.revokeObjectURL(url); return null; });
    setFile(null);
    setError('');
    setDone(false);
    setDragging(false);
    setCropping(false);
    setCropFn(null);
    stopCamera();
  }, [stopCamera]);

  useEffect(() => {
    if (!open) { reset(); return undefined; }

    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, reset]);

  // Unmounting mid-capture must not leave the webcam on.
  useEffect(() => stopCamera, [stopCamera]);

  /**
   * The one place a chosen file becomes a preview — whether it arrived from the
   * file dialog, from a drop, or from the camera. Task 5's size limit and crop
   * step both belong here, and nowhere else.
   */
  const acceptFile = useCallback((chosen) => {
    setError('');

    if (!chosen) return;

    if (!ACCEPTED.includes(chosen.type)) {
      setError('Choose a JPEG, PNG, WEBP or GIF image.');
      return;
    }

    /*
     * Size is checked here and not later, because everything later costs
     * memory: the object URL below pins the file, and the cropper decodes it.
     * The message names both the limit and the actual size, so the person can
     * see how far over they are rather than guessing.
     *
     * The camera path passes through this too. Its capture is a 640x640 PNG,
     * comfortably inside the limit, so the check never fires there — but it is
     * one gate for every route in, which is the point of this function.
     */
    if (chosen.size > MAX_BYTES) {
      setError(
        `That image is ${formatSize(chosen.size)}. Choose one under ${MAX_LABEL}.`
      );
      return;
    }

    setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(chosen); });
    setFile(chosen);
    stopCamera();

    /*
     * Straight into framing, rather than showing a finished-looking preview
     * first.
     *
     * A preview that already looks like the final avatar invites Save, and the
     * chance to reposition is then something you have to notice and go back
     * for. Opening in the cropper makes framing the default step and Save the
     * thing you do after it.
     */
    setCropFn(null);
    setCropping(true);
  }, [stopCamera]);

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    acceptFile(e.dataTransfer?.files?.[0]);
  };

  const startCamera = async () => {
    setError('');
    setCamera(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 640 },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setCamera(false);
      setError('The camera is not available. Check the browser permission and try again.');
    }
  };

  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    /*
     * Captured as a centred SQUARE rather than the camera's native 4:3.
     *
     * An avatar is drawn in a circle everywhere in this product, so a wide
     * frame would be cropped by CSS at display time — differently at every size
     * it appears in. Squaring it here means the stored bytes are the picture
     * that will actually be seen.
     */
    const side = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = side;
    canvas.height = side;

    canvas.getContext('2d').drawImage(
      video,
      (video.videoWidth - side) / 2,
      (video.videoHeight - side) / 2,
      side, side,
      0, 0, side, side,
    );

    canvas.toBlob((blob) => {
      if (!blob) { setError('The photo could not be captured. Try again.'); return; }
      acceptFile(new File([blob], 'camera.png', { type: 'image/png' }));
    }, 'image/png');
  };

  const save = async () => {
    if (!file) return;

    setBusy(true);
    setError('');

    try {
      /*
       * The cropped square is what gets uploaded. `cropFn` is absent only while
       * the source bitmap is still decoding, and Save is disabled until then —
       * the fallback to the original file is there so a future caller that
       * mounts this without the cropper cannot silently upload nothing.
       */
      const outgoing = cropFn ? await cropFn() : file;
      await onUpload(outgoing);
      setDone(true);
      setTimeout(() => { onClose(); }, 1100);
    } catch (err) {
      setError(err?.message || 'The picture could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');

    try {
      await onRemove();
      onClose();
    } catch (err) {
      setError(err?.message || 'The picture could not be removed.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const shown = preview || currentUrl;

  return (
    <div className="avu-backdrop" onClick={onClose} role="presentation">
      <div
        className="avu-card"
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => { e.preventDefault(); if (!camera) setDragging(true); }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
        onDrop={onDrop}
        role="dialog"
        aria-modal="true"
        aria-label="Profile picture"
      >
        <header className="avu-head">
          <div>
            <h3 className="avu-title">Profile picture</h3>
            <p className="avu-sub">
              {preview
                ? 'This is how you will appear across the portal.'
                : 'Drag a picture in, or choose one from your device.'}
            </p>
          </div>
          <button type="button" className="avu-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(',')}
          hidden
          onChange={(e) => { acceptFile(e.target.files?.[0]); e.target.value = ''; }}
        />
        <canvas ref={canvasRef} hidden />

        <div className="avu-body">
          {done ? (
            <div className="avu-done">
              <span className="avu-done-mark"><Check size={28} /></span>
              <p className="avu-done-title">Picture updated</p>
              <p className="avu-done-sub">It is now visible wherever you appear.</p>
            </div>
          ) : cropping && preview ? (
            <>
              <AvatarCropper
                src={preview}
                fileName={file?.name}
                /*
                   Wrapped in an updater function on purpose. `setState` treats a
                   bare function argument as a reducer and would CALL it — storing
                   the returned File instead of the function, on first render.
                */
                onReady={(fn) => setCropFn(() => fn)}
              />

              {error && (
                <p className="avu-error" role="alert">
                  <AlertCircle size={14} /> {error}
                </p>
              )}

              <div className="avu-actions">
                <button
                  type="button"
                  className="avu-ghost"
                  onClick={() => {
                    setPreview((u) => { if (u) URL.revokeObjectURL(u); return null; });
                    setFile(null);
                    setCropping(false);
                    setCropFn(null);
                  }}
                  disabled={busy}
                >
                  <RefreshCw size={15} /> Choose another
                </button>
                <button
                  type="button"
                  className="avu-primary"
                  onClick={save}
                  /* Disabled until the cropper reports the source is decoded.
                     Pressing Save before that would fall through to uploading
                     the ORIGINAL, uncropped file — the exact behaviour this
                     step exists to replace. */
                  disabled={busy || !cropFn}
                >
                  {busy ? <Loader2 size={15} className="avu-spin" /> : <Check size={15} />}
                  {busy ? 'Saving…' : 'Save picture'}
                </button>
              </div>
            </>
          ) : camera ? (
            <div className="avu-camera">
              {/* Squared in CSS as well as at capture, so what is framed on
                  screen is what is actually saved. */}
              <div className="avu-camera-frame">
                <video ref={videoRef} autoPlay playsInline muted className="avu-video" />
                <span className="avu-camera-guide" aria-hidden="true" />
              </div>
              <div className="avu-camera-actions">
                <button type="button" className="avu-ghost" onClick={stopCamera}>Cancel</button>
                <button type="button" className="avu-shutter" onClick={capture} aria-label="Take the photo">
                  <span />
                </button>
                <span className="avu-camera-spacer" aria-hidden="true" />
              </div>
            </div>
          ) : (
            <>
              {/*
                The picture IS the control. Clicking it opens the file dialog,
                dropping on it replaces it, and it is the largest thing on the
                card — which is the opposite of the list-menu it replaced,
                where the current photo was a 60px afterthought.
              */}
              <button
                type="button"
                className={`avu-target${dragging ? ' is-dragging' : ''}${shown ? ' has-image' : ''}`}
                onClick={() => inputRef.current?.click()}
                aria-label={shown ? 'Choose a different picture' : 'Choose a picture'}
              >
                {shown ? (
                  <img src={shown} alt="" className="avu-target-img" />
                ) : (
                  <span className="avu-target-initials">{initialsOf(name)}</span>
                )}

                <span className="avu-target-veil">
                  {dragging ? <ImageIcon size={26} /> : <Upload size={22} />}
                  <span className="avu-target-veil-text">
                    {dragging ? 'Drop to use' : shown ? 'Change' : 'Upload'}
                  </span>
                </span>
              </button>

              <p className="avu-hint">
                {dragging
                  ? 'Release anywhere on this card'
                  : `JPEG, PNG, WEBP or GIF · up to ${MAX_LABEL}`}
              </p>

              {error && (
                <p className="avu-error" role="alert">
                  <AlertCircle size={14} /> {error}
                </p>
              )}

              <div className="avu-actions">
                {preview ? (
                  <>
                    <button
                      type="button"
                      className="avu-ghost"
                      onClick={() => {
                        setPreview((u) => { if (u) URL.revokeObjectURL(u); return null; });
                        setFile(null);
                        setCropping(false);
                        setCropFn(null);
                      }}
                      disabled={busy}
                    >
                      <RefreshCw size={15} /> Choose another
                    </button>
                    <button type="button" className="avu-primary" onClick={save} disabled={busy}>
                      {busy ? <Loader2 size={15} className="avu-spin" /> : <Check size={15} />}
                      {busy ? 'Saving…' : 'Save picture'}
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="avu-ghost" onClick={startCamera} disabled={busy}>
                      <Camera size={15} /> Take a photo
                    </button>
                    <button
                      type="button"
                      className="avu-primary"
                      onClick={() => inputRef.current?.click()}
                      disabled={busy}
                    >
                      <Upload size={15} /> Choose a file
                    </button>
                  </>
                )}
              </div>

              {/*
                Set apart from the two constructive buttons above, and quiet.
                In the dialog this replaces, "Remove Photo" was the third row of
                a list and looked exactly like the two rows that ADD a picture.
              */}
              {onRemove && currentUrl && !preview && (
                <button type="button" className="avu-remove" onClick={remove} disabled={busy}>
                  <Trash2 size={13} /> Remove current picture
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
