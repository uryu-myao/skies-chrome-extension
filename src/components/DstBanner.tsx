import '@styles/DstBanner.scss';
import type { GapChange } from '../core/dst';
import { dstBannerCopy } from './dstCopy';

interface DstBannerProps {
  change: GapChange;
  city: string;
  onDismiss: () => void;
}

// The top-of-popup DST alert (spec §6.3, layer 2). Which change it shows,
// and whether at all, is decided in core (pickDstBanner); closing it records
// the switch so the same one doesn't come back.
const DstBanner: React.FC<DstBannerProps> = ({ change, city, onDismiss }) => {
  const { headline, detail } = dstBannerCopy(change, city);
  return (
    <section className="dst-banner" aria-label="Time difference change">
      <span className="dst-banner__icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="5.6" stroke="currentColor" strokeWidth="1.3" />
          <path d="M7 4v3.2l2 1.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="dst-banner__text">
        <p className="dst-banner__headline">{headline}</p>
        <p className="dst-banner__detail">{detail}</p>
      </div>
      <button type="button" className="dst-banner__close" onClick={onDismiss} aria-label="Dismiss">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </section>
  );
};

export default DstBanner;
