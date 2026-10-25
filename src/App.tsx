import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Header from './components/Header';
import TimezoneList from './components/TimezoneList';
import CoreTimePanel from './components/CoreTimePanel';
import SettingsPanel from './components/SettingsPanel';
import CitySettingsPanel from './components/CitySettingsPanel';
import UndoToast from './components/UndoToast';
import DstBanner from './components/DstBanner';
import RatingPrompt from './components/RatingPrompt';
import { TimezoneInfo } from './components/Timezone';
import {
  hasRoomForCity,
  renameEntry,
  resetEntryLabel,
  saveAppData,
  toggleIncludeInCoreTime,
} from './core/model';
import { detectDstTransitions, dismissDstSwitches, pickDstBanner } from './core/dst';
import {
  answerRatingPrompt,
  recordDstAlertSeen,
  recordRatingPromptShown,
  saveRatingPrompt,
  shouldShowRatingPrompt,
  type RatingPromptAnswer,
  type RatingPromptState,
} from './core/ratingPrompt';
import type { KeyValueStore } from './core/store';
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
  // The persistent store main.tsx opened (spec §2.3).
  store: KeyValueStore;
  // The rating card's state with this open already counted, and when this
  // open began (spec §9.7).
  initialRatingPrompt: RatingPromptState;
  openedAt: Date;
}

// Development only: `?rating-prompt` shows the rating card whatever its
// state (spec §9.7). import.meta.env.DEV is false in every build, so this
// goes from the packages entirely.
const FORCE_RATING_PROMPT = import.meta.env.DEV && new URLSearchParams(window.location.search).has('rating-prompt');

function App({ initialData, store, initialRatingPrompt, openedAt }: AppProps) {
  const [addTimezoneFn, setAddTimezoneFn] = useState<
    ((timezone: TimezoneInfo) => AddTimezoneResult) | null
  >(null);
  const [isConvertModeOpen, setIsConvertModeOpen] = useState(false);
  const [convertPosition, setConvertPosition] = useState<ConvertPosition>(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Set when Settings is opened from somewhere that points at one section.
  const [settingsFocus, setSettingsFocus] = useState<'core-time' | null>(null);
  const [entries, setEntries] = useState<Entry[]>(initialData.entries);
  const [settings, setSettings] = useState<AppSettings>(initialData.settings);
  // The id stays set after closing so the panel can fade out on its content.
  const [citySettingsId, setCitySettingsId] = useState<string | null>(null);
  const [isCitySettingsOpen, setIsCitySettingsOpen] = useState(false);
  const [removed, setRemoved] = useState<RemovedEntry | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [ratingPrompt, setRatingPrompt] = useState(initialRatingPrompt);
  // The latest state, for updates that follow each other before a re-render.
  const ratingPromptRef = useRef(initialRatingPrompt);
  // Answered (or Not now) during this open: gone until the next one.
  const [isRatingPromptClosed, setIsRatingPromptClosed] = useState(false);
  const ratingPromptShownRecorded = useRef(false);

  const hourFormat: HourFormat = settings.hour24 ? '24' : '12';
  const referenceTimezone = settings.referenceTimezone ?? getSystemTimezone();

  // DST alerts (spec §6): layers 1 and 2 are computed as the popup renders,
  // nothing scheduled. Each card gets its next gap change for the badge; the
  // banner shows the day pickDstBanner() chooses.
  const dst = useMemo(
    () => detectDstTransitions({ entries, settings, fromDate: new Date() }),
    [entries, settings]
  );
  const gapChanges = useMemo(
    // The badge looks ahead only: a change already in effect shows on the card itself.
    () => new Map(dst.entries.map(({ entryId, gapChanges }) => [entryId, gapChanges.find((c) => !c.inEffect) ?? null])),
    [dst]
  );
  const dstBanner = pickDstBanner(dst, settings);
  const isDstBannerShown = dstBanner !== null && !isEditMode;
  const cityOf = (entryId: string) => entries.find((entry) => entry.id === entryId)?.label ?? '';

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
    saveAppData(store, { version: 2, entries, groups: [], settings });
  }, [store, entries, settings]);

  // Written right away, not from an effect: the rating links open a tab,
  // and the popup can close before an effect would run.
  const updateRatingPrompt = useCallback(
    (update: (state: RatingPromptState) => RatingPromptState) => {
      const next = update(ratingPromptRef.current);
      if (next === ratingPromptRef.current) return;
      ratingPromptRef.current = next;
      saveRatingPrompt(store, next);
      setRatingPrompt(next);
    },
    [store]
  );

  // Judged on the counts this open started with, so recording the card as
  // shown doesn't take it away again; the status is the live one.
  const showRatingPrompt =
    !isRatingPromptClosed &&
    (FORCE_RATING_PROMPT ||
      shouldShowRatingPrompt({ ...initialRatingPrompt, status: ratingPrompt.status }, new Date(), {
        openedAt,
        isEditMode,
        isSettingsOpen,
        isCitySettingsOpen,
        isDstBannerShown,
      }));

  useEffect(() => {
    if (isDstBannerShown) updateRatingPrompt((prev) => recordDstAlertSeen(prev, new Date()));
  }, [isDstBannerShown, updateRatingPrompt]);

  // Once per open, however often Settings covers and uncovers it.
  useEffect(() => {
    if (!showRatingPrompt || ratingPromptShownRecorded.current) return;
    ratingPromptShownRecorded.current = true;
    updateRatingPrompt((prev) => recordRatingPromptShown(prev, new Date()));
  }, [showRatingPrompt, updateRatingPrompt]);

  const answerRating = (answer: RatingPromptAnswer) => {
    updateRatingPrompt((prev) => answerRatingPrompt(prev, answer));
    setIsRatingPromptClosed(true);
  };

  const openCitySettings = (id: string) => {
    setCitySettingsId(id);
    setIsCitySettingsOpen(true);
  };
  const closeCitySettings = useCallback(() => setIsCitySettingsOpen(false), []);

  const openWorkTimeSettings = () => {
    setIsCitySettingsOpen(false);
    setSettingsFocus('core-time');
    setIsSettingsOpen(true);
  };

  const updateEntry = (id: string, update: (entry: Entry) => Entry) => {
    setEntries((prev) => prev.map((entry) => (entry.id === id ? update(entry) : entry)));
  };

  // No confirmation step — removal is immediate and the toast offers Undo.
  // Only the latest removal can be undone; a new one replaces it.
  const removeEntry = (id: string) => {
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
    setRemoved((prev) => ({ entry: entries[index], index, token: (prev?.token ?? 0) + 1 }));
  };

  // Undo can't take the list past the city limit (spec §8): full again since
  // the removal — a city added within the toast's 5 seconds — and the toast
  // offers no Undo at all rather than a button that does nothing.
  const canUndo = hasRoomForCity(entries);
  const undoRemove = () => {
    if (!removed) return;
    const { entry, index } = removed;
    setEntries((prev) => {
      if (prev.some((e) => e.id === entry.id) || !hasRoomForCity(prev)) return prev;
      const next = [...prev];
      next.splice(Math.min(index, next.length), 0, entry);
      return next;
    });
    setRemoved(null);
  };
  const dismissRemoved = useCallback(() => setRemoved(null), []);

  const citySettingsEntry = entries.find((entry) => entry.id === citySettingsId) ?? null;

  const enterEditMode = () => {
    setIsSettingsOpen(false);
    setIsSearchOpen(false);
    setIsConvertModeOpen(false);
    setIsEditMode(true);
  };

  // Leaves edit mode on a press anywhere outside the list — blank space in
  // the content area, the Core Time panel — other than the edit bar (Done
  // does that) and the undo toast.
  useEffect(() => {
    if (!isEditMode) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.timezone-list, .edit-list-bar, .undo-toast')) return;
      setIsEditMode(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isEditMode]);

  // Nothing left to edit once the last city is removed (Undo still works).
  useEffect(() => {
    if (isEditMode && entries.length === 0) setIsEditMode(false);
  }, [isEditMode, entries.length]);

  return (
    <div
      className={`app ${isConvertModeOpen ? 'app--convert-open' : ''} ${
        isSearchOpen ? 'app--search-open' : ''
      }${isEditMode ? ' app--editing' : ''}`}>
      <Header
        addTimezone={handleAddTimezone}
        onOpenSettings={() => {
          setSettingsFocus(null);
          setIsSettingsOpen(true);
        }}
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
      {isEditMode && (
        <div className="edit-list-bar">
          <span className="edit-list-bar__title">Edit list</span>
          <button type="button" className="edit-list-bar__done" onClick={() => setIsEditMode(false)}>
            Done
          </button>
        </div>
      )}
      <div className="app-content">
        {dstBanner && !isEditMode && (
          <DstBanner
            day={dstBanner}
            cityOf={cityOf}
            onDismiss={() => setSettings((prev) => dismissDstSwitches(prev, dstBanner.switchKeys, new Date()))}
          />
        )}
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
          isEditMode={isEditMode}
          onRemoveCity={removeEntry}
          gapChanges={gapChanges}
        />
        {showRatingPrompt && <RatingPrompt onAnswer={answerRating} />}
      </div>
      <CoreTimePanel
        entries={entries}
        settings={settings}
        isEditMode={isEditMode}
        onToggleCoreTime={(id) => updateEntry(id, toggleIncludeInCoreTime)}
      />
      <SettingsPanel
        isOpen={isSettingsOpen}
        focusSection={settingsFocus}
        onClose={() => {
          setIsSettingsOpen(false);
          setSettingsFocus(null);
        }}
        settings={settings}
        setSettings={setSettings}
        canEditList={entries.length > 0}
        onEditList={enterEditMode}
        onRate={() => updateRatingPrompt((prev) => answerRatingPrompt(prev, 'rated'))}
      />
      <CitySettingsPanel
        isOpen={isCitySettingsOpen && citySettingsEntry !== null}
        entry={citySettingsEntry}
        settings={settings}
        onClose={closeCitySettings}
        onRename={(label) => citySettingsId && updateEntry(citySettingsId, (entry) => renameEntry(entry, label))}
        onResetLabel={() => citySettingsId && updateEntry(citySettingsId, resetEntryLabel)}
        onRemove={() => {
          if (citySettingsId) removeEntry(citySettingsId);
          closeCitySettings();
        }}
        onOpenWorkTimeSettings={openWorkTimeSettings}
      />
      <UndoToast
        message={removed ? `Removed ${removed.entry.label}` : null}
        token={removed?.token ?? 0}
        onUndo={canUndo ? undoRemove : null}
        onDismiss={dismissRemoved}
      />
    </div>
  );
}

export default App;
