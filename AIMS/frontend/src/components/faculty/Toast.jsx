import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import './Toast.css';

const ToastContext = createContext(() => {});

/*
 * TONE, AND WHY IT WAS ADDED
 * --------------------------
 * Every toast in the portal rendered with a green tick, including the ones
 * that said a save had FAILED. A teacher pressing Save Draft on a sheet the
 * server rejected got a green tick and a message that was gone in 2.6 seconds
 * — the two signals that matter most (did it work, and what do I do now) both
 * pointed the wrong way.
 *
 * The tone picks the icon and the accent, and an error is given longer on
 * screen because it has to be read rather than merely noticed.
 */
const TONES = {
  success: { Icon: CheckCircle2, ms: 2600 },
  error: { Icon: AlertTriangle, ms: 5200 },
  info: { Icon: Info, ms: 3600 },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  // `tone` is optional: every existing caller passes a bare string and keeps
  // the success styling it already had.
  const showToast = useCallback((message, tone = 'success') => {
    const spec = TONES[tone] || TONES.success;
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, tone: TONES[tone] ? tone : 'success' }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, spec.ms);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {/* Announced to screen readers as well as shown: a save confirmation
          that only exists visually is no confirmation for a keyboard user. */}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => {
          const { Icon } = TONES[t.tone];
          return (
            <div className={`toast-item toast-${t.tone}`} key={t.id}>
              <Icon size={17} />
              <span>{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
