import { useState, useEffect, useRef, useMemo } from 'react';
import '@styles/_reset.css';
import '@styles/Timezone.scss';
import {
  formatRelativeOffset,
  formatUtcOffset,
  localDayDelta,
  offsetMinutes,
  relativeOffsetMinutes,
  timeOfDay as computeTimeOfDay,
  type TimeOfDay,
} from '../core/tz';
import type { ConvertPosition, HourFormat } from '../App';

export interface TimezoneInfo {
  id: string;
  city: string;
  zone: string;
  lat?: number;
  lon?: number;
}

interface TimezoneProps extends TimezoneInfo {
  referenceTimezone: string;
  hourFormat: HourFormat;
  showSeconds: boolean;
  isConvertModeOpen: boolean;
  convertPosition: ConvertPosition;
  onOpen: () => void;
}

interface SunTimes {
  sunriseMinutes: number;
  sunsetMinutes: number;
  sunriseStr: string;
  sunsetStr: string;
  date: string;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function makeStars(id: string, count: number) {
  let s = hashStr(id);
  const rand = () => {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 0x100000000;
  };
  return Array.from({ length: count }, () => ({
    cx: rand() * 372 + 4,
    cy: rand() * 74 + 4,
    r: rand() * 0.5 + 0.5,
    o: rand() * 0.4 + 0.55,
  }));
}

const Timezone: React.FC<TimezoneProps> = ({
  id,
  city,
  zone,
  lat,
  lon,
  referenceTimezone,
  hourFormat,
  showSeconds,
  isConvertModeOpen,
  convertPosition,
  onOpen,
}) => {
  const stars = useMemo(() => makeStars(id, 20), [id]);

  const [timeData, setTimeData] = useState({
    relativeOffset: '',
    utcOffset: '',
    time: '',
    second: '',
    meridiem: '',
    week: '',
    date: '',
    month: '',
    dayDelta: 0,
  });
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('day');
  const sunTimesRef = useRef<SunTimes | null>(null);

  useEffect(() => {
    if (!lat || !lon) return;

    const fetchSunTimes = async () => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(
        new Date()
      );
      if (sunTimesRef.current?.date === today) return;

      const cacheKey = `timemate.sun.${zone}.${today}`;

      // Hit cache first — zero network latency on repeat opens
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const result = JSON.parse(cached) as SunTimes;
          sunTimesRef.current = result;
          setTimeOfDay(computeTimeOfDay(zone, new Date(), result));
          return;
        } catch {
          /* corrupt entry, fall through to fetch */
        }
      }

      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=sunrise,sunset&timezone=${encodeURIComponent(zone)}&forecast_days=1`
        );
        const data = (await res.json()) as {
          daily?: { sunrise?: string[]; sunset?: string[] };
        };
        const sunriseRaw = data.daily?.sunrise?.[0]?.split('T')[1] ?? '';
        const sunsetRaw = data.daily?.sunset?.[0]?.split('T')[1] ?? '';
        if (!sunriseRaw || !sunsetRaw) return;

        const [sh, sm] = sunriseRaw.split(':').map(Number);
        const [dh, dm] = sunsetRaw.split(':').map(Number);

        const result: SunTimes = {
          sunriseMinutes: sh * 60 + sm,
          sunsetMinutes: dh * 60 + dm,
          sunriseStr: sunriseRaw,
          sunsetStr: sunsetRaw,
          date: today,
        };
        sunTimesRef.current = result;
        localStorage.setItem(cacheKey, JSON.stringify(result));
        // Evict yesterday's entry to keep storage tidy
        const yesterday = new Intl.DateTimeFormat('en-CA', {
          timeZone: zone,
        }).format(new Date(Date.now() - 86400000));
        localStorage.removeItem(`timemate.sun.${zone}.${yesterday}`);
        setTimeOfDay(computeTimeOfDay(zone, new Date(), result));
      } catch {
        // silently ignore fetch errors
      }
    };

    fetchSunTimes();
    const interval = setInterval(fetchSunTimes, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [lat, lon, zone]);

  useEffect(() => {
    const updateTime = () => {
      const getTargetDateParts = (date: Date, timeZone: string) => {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          weekday: 'short',
          hour12: isConvertModeOpen ? false : hourFormat === '12',
        }).formatToParts(date);

        return {
          year: Number(parts.find((p) => p.type === 'year')?.value ?? 0),
          monthNumber: Number(
            parts.find((p) => p.type === 'month')?.value ?? 0
          ),
          dayNumber: Number(parts.find((p) => p.type === 'day')?.value ?? 0),
          hour: parts.find((p) => p.type === 'hour')?.value ?? '00',
          minute: parts.find((p) => p.type === 'minute')?.value ?? '00',
          second: parts.find((p) => p.type === 'second')?.value ?? '00',
          weekday:
            parts.find((p) => p.type === 'weekday')?.value.toLowerCase() ?? '',
          dayPeriod: parts.find((p) => p.type === 'dayPeriod')?.value ?? '',
          monthShort: date
            .toLocaleDateString('en-US', { timeZone, month: 'short' })
            .toLowerCase(),
        };
      };

      const now = new Date();
      const baseSourceDate = new Date(now);
      baseSourceDate.setHours(0, 0, 0, 0);
      const converterHours = convertPosition * 3;
      const roundedHalfHours = Math.round(converterHours * 2) / 2;
      const converterHour = Math.floor(roundedHalfHours);
      const converterMinute = roundedHalfHours % 1 === 0.5 ? 30 : 0;

      const sourceDate = new Date(now);
      if (isConvertModeOpen) {
        sourceDate.setHours(converterHour, converterMinute, 0, 0);
      }

      const targetParts = getTargetDateParts(sourceDate, zone);
      const sourceDateKey =
        baseSourceDate.getFullYear() * 10000 +
        (baseSourceDate.getMonth() + 1) * 100 +
        baseSourceDate.getDate();
      const targetDateKey =
        targetParts.year * 10000 +
        targetParts.monthNumber * 100 +
        targetParts.dayNumber;
      const dayOffset =
        targetDateKey > sourceDateKey
          ? 1
          : targetDateKey < sourceDateKey
            ? -1
            : 0;

      setTimeData((prev) => ({
        ...prev,
        time: `${targetParts.hour}:${targetParts.minute}`,
        second: isConvertModeOpen ? '' : targetParts.second.padStart(2, '0'),
        meridiem: isConvertModeOpen
          ? dayOffset > 0
            ? `+${dayOffset}`
            : dayOffset < 0
              ? `${dayOffset}`
              : ''
          : hourFormat === '12'
            ? targetParts.dayPeriod.toUpperCase()
            : '',
        week: targetParts.weekday,
        date: targetParts.dayNumber.toString(),
        month: targetParts.monthShort,
        // Both read at the instant the card is showing (the converter's
        // chosen time in convert mode), so a DST switch in between is honored.
        relativeOffset: formatRelativeOffset(
          relativeOffsetMinutes(zone, referenceTimezone, sourceDate)
        ),
        utcOffset: formatUtcOffset(offsetMinutes(zone, sourceDate)),
        dayDelta: localDayDelta(zone, referenceTimezone, sourceDate),
      }));

      setTimeOfDay(computeTimeOfDay(zone, sourceDate, sunTimesRef.current));
    };

    updateTime();
    if (isConvertModeOpen) {
      return;
    }

    const intervalId = setInterval(updateTime, 1000);
    return () => clearInterval(intervalId);
  }, [zone, referenceTimezone, hourFormat, isConvertModeOpen, convertPosition]);

  return (
    <div
      data-timezone-id={id}
      className={`timezone timezone--${timeOfDay}${isConvertModeOpen ? ' timezone--converting' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${city} settings`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}>
      <div className="timezone-inner">
        {timeOfDay === 'night' && !isConvertModeOpen && (
          <svg className="timezone-stars" aria-hidden="true">
            {stars.map((s, i) => (
              <circle
                key={i}
                cx={s.cx}
                cy={s.cy}
                r={s.r}
                fill="white"
                fillOpacity={s.o}
              />
            ))}
          </svg>
        )}
        <div className="timezone-data__location">{city}</div>
        <div className="timezone-data__time">{timeData.time}</div>
        {(isConvertModeOpen || hourFormat === '12') && timeData.meridiem && (
          <div
            className={`timezone-data__meridiem${timeData.meridiem === 'AM' ? ' timezone-data__meridiem--am' : ''}${isConvertModeOpen ? ' timezone-data__meridiem--convert' : ''}`}>
            {timeData.meridiem}
          </div>
        )}
        {showSeconds && !isConvertModeOpen && (
          <div className="timezone-data__second">{timeData.second}</div>
        )}
        <div className="timezone-footer">
          <p>
            <span className="timezone-data__relative">
              {zone === referenceTimezone ? 'Base' : timeData.relativeOffset}
            </span>
            <span className="timezone-data__offset">{timeData.utcOffset}</span>
          </p>
          <p
            className={
              timeData.dayDelta !== 0
                ? 'timezone-footer__day--shifted'
                : undefined
            }>
            {/* ±2 (across the date line) keeps the accent but has no one-word label. */}
            {Math.abs(timeData.dayDelta) === 1 && (
              <span className="timezone-data__day-relative">
                {timeData.dayDelta < 0 ? 'yesterday' : 'tomorrow'}
              </span>
            )}
            <span>
              <span className="timezone-data__week">{timeData.week}</span>
              <span>
                <span className="timezone-data__date">{timeData.date}</span>
                <span className="timezone-data__month">{timeData.month}</span>
              </span>
            </span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Timezone;
