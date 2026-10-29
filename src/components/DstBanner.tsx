import '@styles/DstBanner.scss';
import type { DstBannerDay } from '../core/dst';
import type { DateOrder } from '../core/locale';
import { dstBannerCopy, type CopyLine } from './dstCopy';

interface DstBannerProps {
  day: DstBannerDay;
  cityOf: (entryId: string) => string;
  dateOrder: DateOrder;
  onDismiss: () => void;
}

// The top-of-popup DST alert (spec §6.3, layer 2): one banner for one day.
// Which day, and whether at all, is decided in core (pickDstBanner); closing
// it records that day's switches so they don't come back.
// City names and times set apart from the words around them (DstBanner.scss).
const Parts: React.FC<{ parts: CopyLine }> = ({ parts }) => (
  <>
    {parts.map((part, i) =>
      part.kind === 'plain' ? (
        part.text
      ) : (
        <span key={i} className={`dst-banner__${part.kind}`}>
          {part.text}
        </span>
      )
    )}
  </>
);

const DstBanner: React.FC<DstBannerProps> = ({ day, cityOf, dateOrder, onDismiss }) => {
  const { headline, detail } = dstBannerCopy(day, cityOf, dateOrder);
  return (
    <section
      className={`dst-banner${day.inEffect !== 'none' ? ' dst-banner--in-effect' : ''}`}
      aria-label="Time difference change">
      <span className="dst-banner__icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="5.6" stroke="currentColor" strokeWidth="1.3" />
          <path d="M7 4v3.2l2 1.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="dst-banner__text">
        <p className="dst-banner__headline">
          <Parts parts={headline} />
        </p>
        <p className="dst-banner__detail">
          <Parts parts={detail} />
        </p>
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
