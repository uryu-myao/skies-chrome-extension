import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';
import '@styles/SettingsPanel.scss';
import { weekdayDisplayOrder, type DateFormatSetting, type WeekStart, type WeekStartSetting } from '../core/locale';
import type { AppSettings } from '../core/types';
import SegmentedControl from './SegmentedControl';
import { RECENT_UPDATES } from './recentUpdates';
import { version as appVersion } from '../../package.json';
import { CC_BY_URL, FEEDBACK_URL, GEONAMES_URL, STORE, WEBSITE_URL } from '../config/links';

interface SettingsPanelProps {
  isOpen: boolean;
  // Scrolls that section into view and flashes it, for callers that send the
  // user here to change one specific thing.
  focusSection?: 'core-time' | null;
  onClose: () => void;
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  // Week starts on, resolved (Auto → the browser's language): the order of
  // the work-days picker.
  weekStart: WeekStart;
  canEditList: boolean;
  onEditList: () => void;
  // Either rating link was followed (spec §9.7).
  onRate: () => void;
}

// Indexed by weekday value, 0=Sunday — not by position in the picker.
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DST_LEAD_DAYS = [14, 7, 3];

// Date format and Week starts on only arrange things (spec §9.4).
const DATE_FORMAT_OPTIONS: { value: DateFormatSetting; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'dayMonth', label: '24 SEP' },
  { value: 'monthDay', label: 'SEP 24' },
];
const WEEK_START_OPTIONS: { value: WeekStartSetting; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'sunday', label: 'Sun' },
  { value: 'monday', label: 'Mon' },
];

// Leaves the extension: arrow out of a frame.
const ExternalIcon = () => (
  <span className="settings-panel__row-icon" aria-hidden="true">
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path
        d="M7.6 2h3.4v3.4M10.6 2.4 6.2 6.8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.6 8.1v1.9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1h1.9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </span>
);

// Rate Skies, at the start of its row.
const StarIcon = () => (
  <span className="settings-panel__row-icon" aria-hidden="true">
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path
        d="M6.5 1.5 8 4.94l3.73.36-2.8 2.49.8 3.66L6.5 9.55l-3.23 1.9.8-3.66-2.8-2.49L5 4.94 6.5 1.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  </span>
);

// Copies to the clipboard rather than going anywhere: two sheets, and a
// tick while the row reads "Copied!".
const CopyIcon = ({ copied }: { copied: boolean }) => (
  <span className="settings-panel__row-icon" aria-hidden="true">
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      {copied ? (
        <path
          d="M2.6 6.9 5.2 9.5l5.2-6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <>
          <rect
            x="4.6"
            y="4.6"
            width="6.9"
            height="6.9"
            rx="1.7"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path
            d="M8.4 2.9a1.4 1.4 0 0 0-1.4-1.4H3.2a1.7 1.7 0 0 0-1.7 1.7V7a1.4 1.4 0 0 0 1.4 1.4"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  </span>
);

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  focusSection,
  onClose,
  settings,
  setSettings,
  weekStart,
  canEditList,
  onEditList,
  onRate,
}) => {
  // Share's label for a moment after a click: whether the copy worked.
  const [shareResult, setShareResult] = useState<'copied' | 'failed' | null>(null);
  const shareResultTimer = useRef<ReturnType<typeof setTimeout>>();
  const bodyRef = useRef<HTMLDivElement>(null);
  const coreTimeRef = useRef<HTMLHeadingElement>(null);
  const [flashCoreTime, setFlashCoreTime] = useState(false);

  useEffect(() => {
    if (!isOpen || focusSection !== 'core-time') {
      setFlashCoreTime(false);
      // The panel stays mounted, so an ordinary open would otherwise resume
      // wherever a previous deep link left it.
      if (isOpen && bodyRef.current) bodyRef.current.scrollTop = 0;
      return;
    }
    // A timeout, not requestAnimationFrame: rAF never fires while the page is
    // hidden, and this should still be in place whenever the popup is shown.
    const timeout = setTimeout(() => {
      const body = bodyRef.current;
      const target = coreTimeRef.current;
      // Layout offsets, not getBoundingClientRect: the panel is mid pop-in
      // (and scaled) when this runs, and both elements share an offsetParent.
      // The jump is instant because smooth scrolling is ignored in this
      // panel — it happens while the panel is still appearing.
      if (body && target) {
        body.scrollTop = Math.max(0, target.offsetTop - body.offsetTop - 8);
      }
      setFlashCoreTime(true);
    }, 0);
    return () => clearTimeout(timeout);
  }, [isOpen, focusSection]);

  const update = (patch: Partial<AppSettings>) =>
    setSettings((prev) => ({ ...prev, ...patch }));

  // "Copied!" only once the clipboard has taken the link; if it refuses (no
  // clipboard, permission denied, the popup lost focus), "Couldn't copy" for
  // the same 2 seconds — never a false "Copied!".
  const handleShare = () => {
    const show = (result: 'copied' | 'failed') => {
      clearTimeout(shareResultTimer.current);
      setShareResult(result);
      shareResultTimer.current = setTimeout(() => setShareResult(null), 2000);
    };
    // Called right in the click, where the browser counts it as the user's
    // doing; a missing navigator.clipboard throws here and ends up in the
    // same failure branch as a rejected write.
    let write: Promise<void>;
    try {
      write = navigator.clipboard.writeText(STORE.listingUrl);
    } catch (error) {
      write = Promise.reject(error);
    }
    write.then(
      () => show('copied'),
      () => show('failed')
    );
  };

  useEffect(() => () => clearTimeout(shareResultTimer.current), []);

  const setStartHour = (start: number) => {
    setSettings((prev) => ({
      ...prev,
      defaultWorkHours: {
        start,
        end:
          prev.defaultWorkHours.end > start
            ? prev.defaultWorkHours.end
            : Math.min(start + 1, 23),
      },
    }));
  };

  const setEndHour = (end: number) => {
    setSettings((prev) => ({
      ...prev,
      defaultWorkHours: { ...prev.defaultWorkHours, end },
    }));
  };

  const toggleWorkDay = (day: number) => {
    setSettings((prev) => {
      const days = prev.defaultWorkDays.includes(day)
        ? prev.defaultWorkDays.filter((d) => d !== day)
        : [...prev.defaultWorkDays, day].sort((a, b) => a - b);
      return { ...prev, defaultWorkDays: days };
    });
  };

  const startHourOptions = Array.from({ length: 23 }, (_, h) => h);
  const endHourOptions = Array.from(
    { length: 23 - settings.defaultWorkHours.start },
    (_, i) => settings.defaultWorkHours.start + 1 + i
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <>
      <div
        className={`settings-overlay ${isOpen ? 'settings-overlay--open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div className={`settings-panel ${isOpen ? 'settings-panel--open' : ''}`}>
        <div className="settings-panel__header">
          <span className="settings-panel__title">Settings</span>
          <button
            className="settings-panel__close"
            onClick={onClose}
            aria-label="Close settings">
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true">
              <path
                d="M2.5 2.5l7 7M9.5 2.5l-7 7"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="settings-panel__body" ref={bodyRef}>
          <h3 className="settings-panel__section-title">Display</h3>
          <section className="settings-panel__section">
            <div className="settings-panel__row">
              <span className="settings-panel__label">Hour format</span>
              <SegmentedControl
                value={settings.hour24}
                onChange={(hour24) => update({ hour24 })}
                options={[
                  { value: false, label: '12h' },
                  { value: true, label: '24h' },
                ]}
              />
            </div>

            <div className="settings-panel__row">
              <span className="settings-panel__label">Show seconds</span>
              <SegmentedControl
                value={settings.showSeconds}
                onChange={(showSeconds) => update({ showSeconds })}
                options={[
                  { value: false, label: 'Off' },
                  { value: true, label: 'On' },
                ]}
              />
            </div>

            <div className="settings-panel__row">
              <span className="settings-panel__label">Date format</span>
              <SegmentedControl
                value={settings.dateFormat ?? 'auto'}
                onChange={(dateFormat) => update({ dateFormat })}
                options={DATE_FORMAT_OPTIONS}
              />
            </div>

            <div className="settings-panel__row">
              <span className="settings-panel__label">Week starts on</span>
              <SegmentedControl
                value={settings.weekStart ?? 'auto'}
                onChange={(weekStart) => update({ weekStart })}
                options={WEEK_START_OPTIONS}
              />
            </div>

            <button
              type="button"
              className="settings-panel__row settings-panel__row--link"
              onClick={onEditList}
              disabled={!canEditList}>
              <span className="settings-panel__label">Edit city list</span>
              <span className="settings-panel__chevron">›</span>
            </button>
          </section>

          <h3 className="settings-panel__section-title" ref={coreTimeRef}>
            Core time
          </h3>
          <section
            className={`settings-panel__section${flashCoreTime ? ' settings-panel__section--flash' : ''}`}
            onAnimationEnd={() => setFlashCoreTime(false)}>
            <div className="settings-panel__row">
              <span className="settings-panel__label">Core Time panel</span>
              <SegmentedControl
                value={settings.coreTimePanel === 'hidden'}
                onChange={(hidden) =>
                  update({ coreTimePanel: hidden ? 'hidden' : 'always' })
                }
                options={[
                  { value: true, label: 'Hide' },
                  { value: false, label: 'Show' },
                ]}
              />
            </div>

            <div className="settings-panel__row">
              <span className="settings-panel__label">Default work hours</span>
              <div className="settings-panel__hours">
                <select
                  value={settings.defaultWorkHours.start}
                  onChange={(event) => setStartHour(Number(event.target.value))}>
                  {startHourOptions.map((h) => (
                    <option key={h} value={h}>
                      {formatHour(h)}
                    </option>
                  ))}
                </select>
                <span className="settings-panel__hours-sep">–</span>
                <select
                  value={settings.defaultWorkHours.end}
                  onChange={(event) => setEndHour(Number(event.target.value))}>
                  {endHourOptions.map((h) => (
                    <option key={h} value={h}>
                      {formatHour(h)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="settings-panel__row">
              <span className="settings-panel__label">Default work days</span>
              {/* Shown from the day the week starts on; each button is its
                  weekday's value, so the stored days never change order
                  (spec §2.2). */}
              <div className="settings-panel__days">
                {weekdayDisplayOrder(weekStart).map((day) => (
                  <button
                    key={day}
                    className={`settings-panel__day ${
                      settings.defaultWorkDays.includes(day) ? 'active' : ''
                    }`}
                    aria-label={WEEKDAY_NAMES[day]}
                    aria-pressed={settings.defaultWorkDays.includes(day)}
                    onClick={() => toggleWorkDay(day)}>
                    {WEEKDAY_LABELS[day]}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Free for everyone, so no PRO tag (spec §8). Lead time sets the
              window for the card badges as well as the banner. */}
          <h3 className="settings-panel__section-title">DST alerts</h3>
          <section className="settings-panel__section">
            <div className="settings-panel__row">
              <span className="settings-panel__label">Show banner</span>
              <SegmentedControl
                value={settings.dstBannerEnabled}
                onChange={(dstBannerEnabled) => update({ dstBannerEnabled })}
                options={[
                  { value: false, label: 'Off' },
                  { value: true, label: 'On' },
                ]}
              />
            </div>

            <div className="settings-panel__row">
              <span className="settings-panel__label">Lead time</span>
              <SegmentedControl
                value={settings.dstLeadDays}
                onChange={(dstLeadDays) => update({ dstLeadDays })}
                options={DST_LEAD_DAYS.map((days) => ({ value: days, label: `${days} days` }))}
              />
            </div>
          </section>

          <h3 className="settings-panel__section-title">About</h3>
          <section className="settings-panel__section">
            <a
              className="settings-panel__row settings-panel__row--link"
              href={STORE.rateUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onRate}>
              <span className="settings-panel__row-start">
                <StarIcon />
                <span className="settings-panel__label">Rate Skies</span>
              </span>
              <ExternalIcon />
            </a>

            <button
              type="button"
              className="settings-panel__row settings-panel__row--link"
              onClick={handleShare}>
              <span className="settings-panel__label">
                {shareResult === 'copied' ? 'Copied!' : shareResult === 'failed' ? "Couldn't copy" : 'Share Skies'}
              </span>
              <CopyIcon copied={shareResult === 'copied'} />
            </button>

            <a
              className="settings-panel__row settings-panel__row--link"
              href={FEEDBACK_URL}
              target="_blank"
              rel="noopener noreferrer">
              <span className="settings-panel__label">Send Feedback</span>
              <ExternalIcon />
            </a>

            <a
              className="settings-panel__row settings-panel__row--link"
              href={WEBSITE_URL}
              target="_blank"
              rel="noopener noreferrer">
              <span className="settings-panel__label">Website</span>
              <span className="settings-panel__row-end">
                <span className="settings-panel__value">useskies.com</span>
                <ExternalIcon />
              </span>
            </a>

            <div className="settings-panel__row">
              <span className="settings-panel__label">Version</span>
              <span className="settings-panel__value">v{appVersion}</span>
            </div>

            {/* What this version changed — a record, not an announcement:
                static, smaller and dimmer than the rows (spec §9.4). */}
            <div className="settings-panel__updates">
              <h4 className="settings-panel__updates-title" id="settings-recent-updates">
                Recent updates
              </h4>
              <ul className="settings-panel__updates-list" aria-labelledby="settings-recent-updates">
                {RECENT_UPDATES.map((update) => (
                  <li key={update}>{update}</li>
                ))}
              </ul>
              <p className="settings-panel__updates-note">
                If these updates help,{' '}
                <a
                  className="settings-panel__updates-link"
                  href={STORE.rateUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onRate}>
                  a rating
                </a>{' '}
                goes a long way.
              </p>
            </div>

            {/* The city search's data is GeoNames', CC BY 4.0: the credit and
                the license, each its own link — the section's last row
                (spec §9.4, ATTRIBUTION.md). */}
            <div className="settings-panel__row">
              <span className="settings-panel__label">City data</span>
              <span className="settings-panel__row-end">
                <span className="settings-panel__value">
                  <a className="settings-panel__credit-link" href={GEONAMES_URL} target="_blank" rel="noopener noreferrer">
                    GeoNames
                  </a>{' '}
                  (
                  <a className="settings-panel__credit-link" href={CC_BY_URL} target="_blank" rel="noopener noreferrer">
                    CC BY 4.0
                  </a>
                  )
                </span>
                <ExternalIcon />
              </span>
            </div>
          </section>
        </div>
      </div>
    </>
  );
};

export default SettingsPanel;
