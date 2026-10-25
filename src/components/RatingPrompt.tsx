import '@styles/RatingPrompt.scss';
import { FEEDBACK_URL, STORE } from '../config/links';
import type { RatingPromptAnswer } from '../core/ratingPrompt';

interface RatingPromptProps {
  onAnswer: (answer: RatingPromptAnswer) => void;
}

// The rating card under the city list (spec §9.7). Whether it shows is
// decided in core (shouldShowRatingPrompt). Both links are there for
// everyone — no asking first and sending only the happy ones to the store.
const RatingPrompt: React.FC<RatingPromptProps> = ({ onAnswer }) => (
  <section className="rating-prompt" role="region" aria-label="Rate Skies">
    <p className="rating-prompt__title">Enjoying Skies?</p>
    <p className="rating-prompt__text">A quick rating helps other people find it.</p>
    <div className="rating-prompt__actions">
      <a
        className="rating-prompt__button rating-prompt__button--primary"
        href={STORE.rateUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onAnswer('rated')}>
        {STORE.rateLabel}
      </a>
      <a
        className="rating-prompt__button"
        href={FEEDBACK_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onAnswer('feedback')}>
        Send feedback
      </a>
      <button type="button" className="rating-prompt__dismiss" onClick={() => onAnswer('not-now')}>
        Not now
      </button>
    </div>
  </section>
);

export default RatingPrompt;
