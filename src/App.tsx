import { useState, useCallback, useEffect } from 'react';
import Header from './components/Header';
import TimezoneList from './components/TimezoneList';
import CoreTimePanel from './components/CoreTimePanel';
import SettingsPanel from './components/SettingsPanel';
import CitySettingsPanel from './components/CitySettingsPanel';
import UndoToast from './components/UndoToast';
import { TimezoneInfo } from './components/Timezone';
import { saveAppData } from './core/model';
import { getSystemTimezone } from './core/tz';
import type { AppData, AppSettings, Entry } from './core/types';
import '@styles/_reset.css';
import '@styles/main.scss';

export type AddTimezoneResult = 'added' | 'duplicate' | 'limit';
export type HourFormat = '12' | '24';
export type ConvertPosition = number;

interface RemovedEntry {
  entry: Entry;
  index: number;
  token: number;
}

interface AppProps {
  initialData: AppData;
}

function App({ initialData }: AppProps) {
  const [addTimezoneFn, setAddTimezoneFn] = useState<
    ((timezone: TimezoneInfo) => AddTimezoneResult) | null
  >(null);
  const [isConvertModeOpen, setIsConvertModeOpen] = useState(false);
  const [convertPosition, setConvertPosition] = useState<ConvertPosition>(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>(initialData.entries);
  const [settings, setSettings] = useState<AppSettings>(initialData.settings);
  // The id stays set after closing so the panel can fade out on its content.
  const [citySettingsId, setCitySettingsId] = useState<string | null>(null);
  const [isCitySettingsOpen, setIsCitySettingsOpen] = useState(false);
  const [removed, setRemoved] = useState<RemovedEntry | null>(null);

  const hourFormat: HourFormat = settings.hour24 ? '24' : '12';
  const referenceTimezone = settings.referenceTimezone ?? getSystemTimezone();

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

  const openCitySettings = (id: string) => {
    setCitySettingsId(id);
    setIsCitySettingsOpen(true);
  };
  const closeCitySettings = useCallback(() => setIsCitySettingsOpen(false), []);

  const renameEntry = (id: string, label: string) => {
    setEntries((prev) => prev.map((entry) => (entry.id === id ? { ...entry, label } : entry)));
  };

  // No confirmation step — removal is immediate and the toast offers Undo.
  // Only the latest removal can be undone; a new one replaces it.
  const removeEntry = (id: string) => {
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
    setRemoved((prev) => ({ entry: entries[index], index, token: (prev?.token ?? 0) + 1 }));
  };

  const undoRemove = () => {
    if (!removed) return;
    const { entry, index } = removed;
    setEntries((prev) => {
      if (prev.some((e) => e.id === entry.id)) return prev;
      const next = [...prev];
      next.splice(Math.min(index, next.length), 0, entry);
      return next;
    });
    setRemoved(null);
  };
  const dismissRemoved = useCallback(() => setRemoved(null), []);

  const citySettingsEntry = entries.find((entry) => entry.id === citySettingsId) ?? null;

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
        entries={entries}
        settings={settings}
        setSettings={setSettings}
      />
      <div className="app-content">
        <TimezoneList
          entries={entries}
          setEntries={setEntries}
          onAddTimezone={registerAddTimezone}
          referenceTimezone={referenceTimezone}
          hourFormat={hourFormat}
          showSeconds={settings.showSeconds}
          isConvertModeOpen={isConvertModeOpen}
          convertPosition={convertPosition}
          onOpenCity={openCitySettings}
        />
      </div>
      <CoreTimePanel entries={entries} settings={settings} />
      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        setSettings={setSettings}
      />
      <CitySettingsPanel
        isOpen={isCitySettingsOpen && citySettingsEntry !== null}
        entry={citySettingsEntry}
        settings={settings}
        onClose={closeCitySettings}
        onRename={(label) => citySettingsId && renameEntry(citySettingsId, label)}
        onRemove={() => {
          if (citySettingsId) removeEntry(citySettingsId);
          closeCitySettings();
        }}
      />
      <UndoToast
        message={removed ? `Removed ${removed.entry.label}` : null}
        token={removed?.token ?? 0}
        onUndo={undoRemove}
        onDismiss={dismissRemoved}
      />
    </div>
  );
}

export default App;
