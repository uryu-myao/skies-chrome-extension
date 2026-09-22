import { useEffect, useCallback } from 'react';
import Timezone, { TimezoneInfo } from './Timezone';
import { createEntry } from '../core/model';
import type { Entry } from '../core/types';
import type { AddTimezoneResult, ConvertPosition, HourFormat } from '../App';

const MAX_CITIES = 10;

interface TimezoneListProps {
  entries: Entry[];
  setEntries: React.Dispatch<React.SetStateAction<Entry[]>>;
  onAddTimezone?: (
    timezone: (timezone: TimezoneInfo) => AddTimezoneResult
  ) => void;
  referenceTimezone: string;
  hourFormat: HourFormat;
  showSeconds: boolean;
  isConvertModeOpen: boolean;
  convertPosition: ConvertPosition;
}

const TimezoneList: React.FC<TimezoneListProps> = ({
  entries,
  setEntries,
  onAddTimezone,
  referenceTimezone,
  hourFormat,
  showSeconds,
  isConvertModeOpen,
  convertPosition,
}) => {
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

      // The array order is the list order; a new city goes on top, where the
      // old newest-first default showed it.
      result = 'added';
      return [
        createEntry({
          timezone: newTimezone.zone,
          label: newTimezone.city,
          lat: newTimezone.lat,
          lon: newTimezone.lon,
        }),
        ...prev,
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

  return (
    <div className="timezone-list">
      {entries.length === 0 ? (
        <div className="timezone-list__empty">
          <p className="timezone-list__empty-text">
            Press <span className="timezone-list__empty-addicon"></span> to add
            your first city.
          </p>
        </div>
      ) : (
        entries.map((entry) => (
          <Timezone
            key={entry.id}
            id={entry.id}
            city={entry.label}
            zone={entry.timezone}
            lat={entry.lat}
            lon={entry.lon}
            referenceTimezone={referenceTimezone}
            hourFormat={hourFormat}
            showSeconds={showSeconds}
            isConvertModeOpen={isConvertModeOpen}
            convertPosition={convertPosition}
          />
        ))
      )}
    </div>
  );
};

export default TimezoneList;
