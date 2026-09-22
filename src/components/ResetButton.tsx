import '@styles/ResetButton.scss';

interface ResetButtonProps {
  label: string;
  onClick: () => void;
  title?: string;
  // Positions it for its context; the look lives in .reset-button.
  className?: string;
  // Lets a caller keep focus where it is (e.g. in a text field) on click.
  keepFocus?: boolean;
}

// Small round ↺ button, shared by the city-name field and the converter.
const ResetButton: React.FC<ResetButtonProps> = ({ label, onClick, title, className, keepFocus }) => (
  <button
    type="button"
    className={`reset-button${className ? ` ${className}` : ''}`}
    aria-label={label}
    title={title}
    onMouseDown={keepFocus ? (event) => event.preventDefault() : undefined}
    onClick={onClick}>
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.2 4.6A4 4 0 1 1 2 6.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M1.8 1.8v3h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </button>
);

export default ResetButton;
