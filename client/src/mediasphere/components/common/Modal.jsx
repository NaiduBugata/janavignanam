import { X } from 'lucide-react';
import { useEffect } from 'react';

export default function Modal({ isOpen, onClose, title, children, wide = false }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    const handleBack = (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleKey);
    window.addEventListener('janavignanam-back', handleBack);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('janavignanam-back', handleBack);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="absolute inset-0 bg-msbg/70 backdrop-blur-sm dark:bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`relative z-10 w-full ${wide ? 'max-w-3xl' : 'max-w-2xl'} max-h-[95vh] overflow-y-auto rounded-t-card sm:rounded-card bg-surface border border-msline shadow-lift`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-msline bg-surface/95 backdrop-blur px-5 py-4">
          <h2 id="modal-title" className="text-lg font-semibold text-app pr-4">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-control p-1.5 text-msmuted hover:bg-msbg hover:text-app transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
