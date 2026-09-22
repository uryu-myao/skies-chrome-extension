import { useEffect, useRef, useState } from 'react';
import '@styles/SettingsPanel.scss';
import '@styles/CitySettingsPanel.scss';
import { resolveWorkDays, resolveWorkHours } from '../core/model';
import type { AppSettings, Entry, WorkDays } from '../core/types';

interface CitySettingsPanelProps {
  isOpen: boolean;
  entry: Entry | null;
  settings: AppSettings;
  onClose: () => void;
  onRename: (label: string) => void;
  onRemove: () => void;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_LABEL_LENGTH = 32;

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

// [1,2,3,4,5] -> "Mon–Fri"; runs of 3+ consecutive days collapse to a range.
function formatWorkDays(days: WorkDays): string {
  if (days.length === 0) return 'None';
  const sorted = [...days].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const day of sorted) {
    const run = runs[runs.length - 1];
    if (run && day === run[run.length - 1] + 1) run.push(day);
    else runs.push([day]);
  }
  return runs
    .flatMap((run) =>
      run.length >= 3
        ? [`${WEEKDAY_SHORT[run[0]]}–${WEEKDAY_SHORT[run[run.length - 1]]}`]
        : run.map((day) => WEEKDAY_SHORT[day])
    )
    .join(', ');
}

const CitySettingsPanel: React.FC<CitySettingsPanelProps> = ({
  isOpen,
  entry,
  settings,
  onClose,
  onRename,
  onRemove,
}) => {
  // Keeps showing the last city while the panel fades out — after "Remove"
  // the entry is already gone from the list by the time the panel closes.
  const lastEntryRef = useRef<Entry | null>(entry);
  if (entry) lastEntryRef.current = entry;
  const shown = entry ?? lastEntryRef.current;

  const [draftLabel, setDraftLabel] = useState(shown?.label ?? '');
  const [showProHint, setShowProHint] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDraftLabel(entry?.label ?? '');
    setShowProHint(false);
    // Only on open / switching cities — not on every rename keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, entry?.id]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const hours = shown ? resolveWorkHours(shown, settings) : null;
  const days = shown ? resolveWorkDays(shown, settings) : null;

  // Saved as you type; an empty (or all-space) name is never saved, and
  // leaving the field puts back whatever was last saved.
  const handleLabelChange = (value: string) => {
    setDraftLabel(value);
    const trimmed = value.trim();
    if (trimmed) onRename(trimmed);
  };

  return (
    <>
      <div
        className={`settings-overlay ${isOpen ? 'settings-overlay--open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`settings-panel city-settings ${isOpen ? 'settings-panel--open' : ''}`}
        role="dialog"
        aria-label={shown ? `${shown.label} settings` : 'City settings'}
        aria-hidden={!isOpen}>
        <div className="settings-panel__header">
          <span className="settings-panel__title">{shown?.label}</span>
          <button className="settings-panel__close" onClick={onClose} aria-label="Close city settings">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {shown && hours && days && (
          <div className="settings-panel__body">
            <section className="settings-panel__section">
              <label className="settings-panel__row">
                <span className="settings-panel__label">City name</span>
                <input
                  className="city-settings__name"
                  type="text"
                  value={draftLabel}
                  maxLength={MAX_LABEL_LENGTH}
                  spellCheck={false}
                  onChange={(event) => handleLabelChange(event.target.value)}
                  onBlur={() => setDraftLabel(shown.label)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
              </label>
            </section>

            <h3 className="settings-panel__section-title">
              Work time <span className="city-settings__pro-tag">PRO</span>
            </h3>
            <section className="settings-panel__section">
              <button
                type="button"
                className="settings-panel__row settings-panel__row--link"
                onClick={() => setShowProHint(true)}>
                <span className="settings-panel__label">Work hours</span>
                <span className="settings-panel__value">
                  {formatHour(hours.start)}–{formatHour(hours.end)}
                  {hours.isDefault && <span className="city-settings__default"> · default</span>}
                </span>
              </button>
              <button
                type="button"
                className="settings-panel__row settings-panel__row--link"
                onClick={() => setShowProHint(true)}>
                <span className="settings-panel__label">Work days</span>
                <span className="settings-panel__value">
                  {formatWorkDays(days.days)}
                  {days.isDefault && <span className="city-settings__default"> · default</span>}
                </span>
              </button>
            </section>
            {showProHint && (
              <p className="city-settings__pro-hint" role="status">
                Custom work hours and days for each city are a TimeMate Pro feature. Until then,
                every city uses the defaults in Settings.
              </p>
            )}

            <section className="settings-panel__section">
              <button
                type="button"
                className="settings-panel__row settings-panel__row--link city-settings__remove"
                onClick={onRemove}>
                Remove this city
              </button>
            </section>
          </div>
        )}
      </div>
    </>
  );
};

export default CitySettingsPanel;
