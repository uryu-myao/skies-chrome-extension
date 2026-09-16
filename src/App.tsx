import { useState, useCallback, useEffect } from 'react';
import Header from './components/Header';
import TimezoneList from './components/TimezoneList';
import CoreTimePanel from './components/CoreTimePanel';
import SettingsPanel from './components/SettingsPanel';
import { TimezoneInfo } from './components/Timezone';
import { loadAppData, saveAppData, DEFAULT_SETTINGS } from './core/model';
import type { AppSettings, Entry } from './core/types';
import '@styles/_reset.css';
import '@styles/main.scss';

export type AddTimezoneResult = 'added' | 'duplicate' | 'limit';
export type HourFormat = '12' | '24';
export type ConvertPosition = number;

function App() {
  const [addTimezoneFn, setAddTimezoneFn] = useState<
    ((timezone: TimezoneInfo) => AddTimezoneResult) | null
  >(null);
  const [isConvertModeOpen, setIsConvertModeOpen] = useState(false);
  const [convertPosition, setConvertPosition] = useState<ConvertPosition>(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>(() => loadAppData()?.entries ?? []);
  const [settings, setSettings] = useState<AppSettings>(
    () => loadAppData()?.settings ?? DEFAULT_SETTINGS
  );

  const hourFormat: HourFormat = settings.hour24 ? '24' : '12';

  const registerAddTimezone = useCallback(
    (fn: (timezone: TimezoneInfo) => AddTimezoneResult) => {
      setAddTimezoneFn(() => fn);
    },
    []
  );

  const handleAddTimezone = (timezone: TimezoneInfo): AddTimezoneResult => {
    if (addTimezoneFn) {
      return addTimezoneFn(timezone);
    }
    return 'duplicate';
  };

  useEffect(() => {
    saveAppData({ version: 2, entries, groups: [], settings });
  }, [entries, settings]);

  return (
    <div
      className={`app ${isConvertModeOpen ? 'app--convert-open' : ''} ${
        isSearchOpen ? 'app--search-open' : ''
      }`}>
      <Header
        addTimezone={handleAddTimezone}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isConvertModeOpen={isConvertModeOpen}
        onConvertModeChange={setIsConvertModeOpen}
        convertPosition={convertPosition}
        onConvertPositionChange={setConvertPosition}
        isSearchOpen={isSearchOpen}
        onSearchOpenChange={setIsSearchOpen}
      />
      <div className="app-content">
        <TimezoneList
          entries={entries}
          setEntries={setEntries}
          onAddTimezone={registerAddTimezone}
          sortOrder={settings.sortOrder}
          hourFormat={hourFormat}
          showSeconds={settings.showSeconds}
          isConvertModeOpen={isConvertModeOpen}
          convertPosition={convertPosition}
        />
      </div>
      <CoreTimePanel entries={entries} settings={settings} />
      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        setSettings={setSettings}
      />
    </div>
  );
}

export default App;
