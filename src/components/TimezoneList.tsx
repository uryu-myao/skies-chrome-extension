import { useState, useEffect, useCallback } from 'react';
import Timezone, { TimezoneInfo } from './Timezone';
import { createEntry } from '../core/model';
import type { Entry, SortOrder } from '../core/types';
import type { AddTimezoneResult, ConvertPosition, HourFormat } from '../App';

const MAX_CITIES = 10;
const HINT_SHOWN_STORAGE_KEY = 'timemate.swipe-hint-shown.v1';

interface TimezoneListProps {
  entries: Entry[];
  setEntries: React.Dispatch<React.SetStateAction<Entry[]>>;
  onAddTimezone?: (
    timezone: (timezone: TimezoneInfo) => AddTimezoneResult
  ) => void;
  sortOrder: SortOrder;
  hourFormat: HourFormat;
  showSeconds: boolean;
  isConvertModeOpen: boolean;
  convertPosition: ConvertPosition;
}

const getDateTimeRankInZone = (zone: string): number => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date());

    const year = Number(parts.find((p) => p.type === 'year')?.value ?? 0);
    const month = Number(parts.find((p) => p.type === 'month')?.value ?? 0);
    const day = Number(parts.find((p) => p.type === 'day')?.value ?? 0);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    const second = Number(parts.find((p) => p.type === 'second')?.value ?? 0);

    // Compare by local date first, then local time (YYYYMMDDHHmmss).
    return (
      year * 10000000000 +
      month * 100000000 +
      day * 1000000 +
      hour * 10000 +
      minute * 100 +
      second
    );
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
};

const TimezoneList: React.FC<TimezoneListProps> = ({
  entries,
  setEntries,
  onAddTimezone,
  sortOrder,
  hourFormat,
  showSeconds,
  isConvertModeOpen,
  convertPosition,
}) => {
  const [activeSettingId, setActiveSettingId] = useState<string | null>(null);
  const [, setTimeSortTick] = useState(0);
  const [hintShown, setHintShown] = useState<boolean>(
    () => localStorage.getItem(HINT_SHOWN_STORAGE_KEY) === '1'
  );

  const markHintPlayed = () => {
    localStorage.setItem(HINT_SHOWN_STORAGE_KEY, '1');
    setHintShown(true);
  };

  // 切换设置状态
  const toggleSetting = (id: string) => {
    setActiveSettingId((prev) => (prev === id ? null : id));
  };

  // 删除时区
  const deleteTimezone = (id: string) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
    if (activeSettingId === id) {
      setActiveSettingId(null);
    }
  };

  // 固定时区
  const pinTimezone = (id: string) => {
    setEntries((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, pinned: true } : entry))
    );
    setActiveSettingId(null); // 取消 setting 状态
  };

  // 取消固定
  const unpinTimezone = (id: string) => {
    setEntries((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, pinned: false } : entry))
    );
    if (activeSettingId === id) {
      setActiveSettingId(null);
    }
  };

  // 使用useCallback包装addTimezone函数，避免不必要的重新创建
  const addTimezone = useCallback((newTimezone: TimezoneInfo): AddTimezoneResult => {
    let result: AddTimezoneResult = 'duplicate';

    // 允许相同时区的不同城市；仅阻止完全重复（同 city + zone）
    setEntries((prev) => {
      if (
        prev.some(
          (entry) =>
            entry.timezone === newTimezone.zone &&
            entry.label.toLowerCase() === newTimezone.city.toLowerCase()
        )
      ) {
        result = 'duplicate';
        return prev; // 如果已存在，返回原数组
      }

      if (prev.length >= MAX_CITIES) {
        result = 'limit';
        return prev;
      }

      result = 'added';
      return [
        ...prev,
        createEntry({
          timezone: newTimezone.zone,
          label: newTimezone.city,
          lat: newTimezone.lat,
          lon: newTimezone.lon,
        }),
      ];
    });

    return result;
  }, [setEntries]);

  // 使用useEffect在组件挂载后注册方法，而不是在渲染过程中
  useEffect(() => {
    if (onAddTimezone) {
      onAddTimezone(addTimezone);
    }
  }, [onAddTimezone, addTimezone]); // 正确添加所有依赖项

  useEffect(() => {
    if (sortOrder !== 'offset') return;

    const intervalId = setInterval(() => {
      setTimeSortTick((prev) => prev + 1);
    }, 30000);

    return () => clearInterval(intervalId);
  }, [sortOrder]);

  useEffect(() => {
    if (!activeSettingId) return;

    const handleClickOutsideActiveCard = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const card = target?.closest('[data-timezone-id]') as
        | HTMLElement
        | null;
      const clickedId = card?.dataset.timezoneId ?? null;

      if (clickedId !== activeSettingId) {
        setActiveSettingId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutsideActiveCard);
    return () => {
      document.removeEventListener('mousedown', handleClickOutsideActiveCard);
    };
  }, [activeSettingId]);

  const entryOrder = new Map(entries.map((entry, index) => [entry.id, index]));

  const compareByMode = (a: Entry, b: Entry): number => {
    if (sortOrder === 'name') {
      return a.label.localeCompare(b.label);
    }

    if (sortOrder === 'offset') {
      return getDateTimeRankInZone(a.timezone) - getDateTimeRankInZone(b.timezone);
    }

    // manual(default): recently added first
    const orderA = entryOrder.get(a.id) ?? 0;
    const orderB = entryOrder.get(b.id) ?? 0;
    return orderB - orderA;
  };

  // 置顶始终在前；同组内按排序命令排序。
  const sortedEntries = [...entries].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }

    return compareByMode(a, b);
  });

  return (
    <div className="timezone-list">
      {sortedEntries.length === 0 ? (
        <div className="timezone-list__empty">
          <p className="timezone-list__empty-text">
            Press <span className="timezone-list__empty-addicon"></span> to add
            your first city.
          </p>
        </div>
      ) : (
        sortedEntries.map((entry, index) => (
          <Timezone
            key={entry.id}
            id={entry.id}
            city={entry.label}
            zone={entry.timezone}
            lat={entry.lat}
            lon={entry.lon}
            hourFormat={hourFormat}
            showSeconds={showSeconds}
            isConvertModeOpen={isConvertModeOpen}
            convertPosition={convertPosition}
            setting={activeSettingId === entry.id}
            isPinned={entry.pinned}
            toggleSetting={() => toggleSetting(entry.id)}
            deleteTimezone={() => deleteTimezone(entry.id)}
            pinTimezone={() => pinTimezone(entry.id)}
            unpinTimezone={() => unpinTimezone(entry.id)}
            playHint={index === 0 && !hintShown}
            onHintPlayed={markHintPlayed}
          />
        ))
      )}
    </div>
  );
};

export default TimezoneList;
