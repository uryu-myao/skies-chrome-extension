import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';
import '@styles/SettingsPanel.scss';
import type { AppSettings } from '../core/types';
import SegmentedControl from './SegmentedControl';
import { version as appVersion } from '../../package.json';

const SHARE_URL = 'https://chromewebstore.google.com/detail/gmjjpjccmmdnainbbgchlnkhmgckcmik';
const RATE_URL = `${SHARE_URL}/reviews`;
const FEEDBACK_URL = 'https://forms.gle/ncZLfTs8RKE59ETC9';

interface SettingsPanelProps {
  isOpen: boolean;
  // Scrolls that section into view and flashes it, for callers that send the
  // user here to change one specific thing.
  focusSection?: 'core-time' | null;
  onClose: () => void;
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  canEditList: boolean;
  onEditList: () => void;
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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
  canEditList,
  onEditList,
}) => {
  const [shareCopied, setShareCopied] = useState(false);
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

  const handleShare = () => {
    navigator.clipboard.writeText(SHARE_URL);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

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
              <div className="settings-panel__days">
                {WEEKDAY_LABELS.map((label, day) => (
                  <button
                    key={day}
                    className={`settings-panel__day ${
                      settings.defaultWorkDays.includes(day) ? 'active' : ''
                    }`}
                    onClick={() => toggleWorkDay(day)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <h3 className="settings-panel__section-title">About</h3>
          <section className="settings-panel__section">
            <button
              type="button"
              className="settings-panel__row settings-panel__row--link"
              onClick={handleShare}>
              <span className="settings-panel__label">
                {shareCopied ? 'Copied!' : 'Share Skies'}
              </span>
              <CopyIcon copied={shareCopied} />
            </button>

            <a
              className="settings-panel__row settings-panel__row--link"
              href={RATE_URL}
              target="_blank"
              rel="noopener noreferrer">
              <span className="settings-panel__label">Rate on Chrome Store</span>
              <ExternalIcon />
            </a>

            <a
              className="settings-panel__row settings-panel__row--link"
              href={FEEDBACK_URL}
              target="_blank"
              rel="noopener noreferrer">
              <span className="settings-panel__label">Send Feedback</span>
              <ExternalIcon />
            </a>

            <div className="settings-panel__row">
              <span className="settings-panel__label">Version</span>
              <span className="settings-panel__value">v{appVersion}</span>
            </div>
          </section>
        </div>
      </div>
    </>
  );
};

export default SettingsPanel;
