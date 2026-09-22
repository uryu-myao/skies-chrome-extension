import { useEffect } from 'react';
import '@styles/UndoToast.scss';

const VISIBLE_MS = 5000;

interface UndoToastProps {
  message: string | null;
  // Changes on every new message, so a second removal restarts the timer
  // even when its text happens to match the first.
  token: number;
  onUndo: () => void;
  onDismiss: () => void;
}

const UndoToast: React.FC<UndoToastProps> = ({ message, token, onUndo, onDismiss }) => {
  useEffect(() => {
    if (!message) return;
    const timeout = setTimeout(onDismiss, VISIBLE_MS);
    return () => clearTimeout(timeout);
  }, [message, token, onDismiss]);

  return (
    <div className={`undo-toast ${message ? 'undo-toast--open' : ''}`} role="status" aria-live="polite">
      {message && (
        <>
          <span className="undo-toast__message">{message}</span>
          <span className="undo-toast__sep" aria-hidden="true">
            ·
          </span>
          <button type="button" className="undo-toast__undo" onClick={onUndo}>
            Undo
          </button>
        </>
      )}
    </div>
  );
};

export default UndoToast;
