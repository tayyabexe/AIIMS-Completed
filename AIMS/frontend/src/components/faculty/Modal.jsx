import { useEffect } from 'react';
import { X } from 'lucide-react';
import './Modal.css';

export default function Modal({ title, subtitle, onClose, children, footer, width }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={width ? { maxWidth: width } : undefined}>
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <div className="modal-subtitle">{subtitle}</div>}
          </div>
          <button className="modal-close" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
