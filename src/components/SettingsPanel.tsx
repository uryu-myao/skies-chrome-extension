import type { Dispatch, SetStateAction } from 'react';
import { useEffect } from 'react';
import '@styles/SettingsPanel.scss';
import type { AppSettings, SortOrder } from '../core/types';
import SegmentedControl from './SegmentedControl';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: 'manual', label: 'Newest' },
  { value: 'offset', label: 'By time' },
  { value: 'name', label: 'Alphabet' },
];

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  settings,
  setSettings,
}) => {
  const update = (patch: Partial<AppSettings>) =>
    setSettings((prev) => ({ ...prev, ...patch }));

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
        <div className="settings-panel__body">
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
              <span className="settings-panel__label">Sort order</span>
              <SegmentedControl
                value={settings.sortOrder}
                onChange={(sortOrder) => update({ sortOrder })}
                options={SORT_OPTIONS}
              />
            </div>
          </section>

          <h3 className="settings-panel__section-title">Core time</h3>
          <section className="settings-panel__section">
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
        </div>
      </div>
    </>
  );
};

export default SettingsPanel;
