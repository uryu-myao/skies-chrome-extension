import { useState, useCallback, useEffect } from 'react';
import Header from './components/Header';
import TimezoneList from './components/TimezoneList';
import CoreTimePanel from './components/CoreTimePanel';
import { TimezoneInfo } from './components/Timezone';
import { loadAppData, saveAppData, DEFAULT_SETTINGS } from './core/model';
import type { AppSettings, Entry } from './core/types';
import '@styles/_reset.css';
import '@styles/main.scss';

export type SortMode = 'newest' | 'time' | 'alphabet';
export type AddTimezoneResult = 'added' | 'duplicate' | 'limit';
export type HourFormat = '12' | '24';
export type ConvertPosition = number;
const SORT_MODE_STORAGE_KEY = 'timemate.sort-mode.v1';
const HOUR_FORMAT_STORAGE_KEY = 'timemate.hour-format.v1';

function App() {
  const [addTimezoneFn, setAddTimezoneFn] = useState<
    ((timezone: TimezoneInfo) => AddTimezoneResult) | null
  >(null);
  const [isConvertModeOpen, setIsConvertModeOpen] = useState(false);
  const [convertPosition, setConvertPosition] = useState<ConvertPosition>(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const stored = localStorage.getItem(SORT_MODE_STORAGE_KEY);
    if (stored === 'newest' || stored === 'time' || stored === 'alphabet') {
      return stored;
    }
    return 'newest';
  });
  const [hourFormat, setHourFormat] = useState<HourFormat>(() => {
    const stored = localStorage.getItem(HOUR_FORMAT_STORAGE_KEY);
    if (stored === '12' || stored === '24') {
      return stored;
    }
    return '12';
  });
  const [entries, setEntries] = useState<Entry[]>(() => loadAppData()?.entries ?? []);
  const [settings] = useState<AppSettings>(() => loadAppData()?.settings ?? DEFAULT_SETTINGS);

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
    localStorage.setItem(SORT_MODE_STORAGE_KEY, sortMode);
  }, [sortMode]);

  useEffect(() => {
    localStorage.setItem(HOUR_FORMAT_STORAGE_KEY, hourFormat);
  }, [hourFormat]);

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
        sortMode={sortMode}
        onSortChange={setSortMode}
        hourFormat={hourFormat}
        onToggleHourFormat={() =>
          setHourFormat((prev) => (prev === '12' ? '24' : '12'))
        }
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
          sortMode={sortMode}
          hourFormat={hourFormat}
          isConvertModeOpen={isConvertModeOpen}
          convertPosition={convertPosition}
        />
      </div>
      <CoreTimePanel entries={entries} settings={settings} />
    </div>
  );
}

export default App;
