import type { Dispatch, SetStateAction } from 'react';
import '@styles/SettingsPanel.scss';
import type { AppSettings, SortOrder } from '../core/types';

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
        end: prev.defaultWorkHours.end > start ? prev.defaultWorkHours.end : Math.min(start + 1, 23),
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

  return (
    <div className={`settings-panel ${isOpen ? 'settings-panel--open' : ''}`}>
      <div className="settings-panel__header">
        <button className="settings-panel__back" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Settings
        </button>
      </div>
      <div className="settings-panel__body">
        <section className="settings-panel__section">
          <h3 className="settings-panel__section-title">Display</h3>

          <div className="settings-panel__row">
            <span className="settings-panel__label">Hour format</span>
            <div className="settings-panel__segmented">
              <button
                className={!settings.hour24 ? 'active' : ''}
                onClick={() => update({ hour24: false })}>
                12h
              </button>
              <button
                className={settings.hour24 ? 'active' : ''}
                onClick={() => update({ hour24: true })}>
                24h
              </button>
            </div>
          </div>

          <div className="settings-panel__row">
            <span className="settings-panel__label">Show seconds</span>
            <div className="settings-panel__segmented">
              <button
                className={!settings.showSeconds ? 'active' : ''}
                onClick={() => update({ showSeconds: false })}>
                Off
              </button>
              <button
                className={settings.showSeconds ? 'active' : ''}
                onClick={() => update({ showSeconds: true })}>
                On
              </button>
            </div>
          </div>

          <div className="settings-panel__row">
            <span className="settings-panel__label">Sort order</span>
            <div className="settings-panel__segmented">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={settings.sortOrder === option.value ? 'active' : ''}
                  onClick={() => update({ sortOrder: option.value })}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-panel__row">
            <span className="settings-panel__label">Core Time panel</span>
            <div className="settings-panel__segmented">
              <button
                className={settings.coreTimePanel === 'hidden' ? 'active' : ''}
                onClick={() => update({ coreTimePanel: 'hidden' })}>
                Hide
              </button>
              <button
                className={settings.coreTimePanel !== 'hidden' ? 'active' : ''}
                onClick={() => update({ coreTimePanel: 'always' })}>
                Show
              </button>
            </div>
          </div>
        </section>

        <section className="settings-panel__section">
          <h3 className="settings-panel__section-title">Core time</h3>

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

          <div className="settings-panel__row settings-panel__row--wrap">
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
  );
};

export default SettingsPanel;
