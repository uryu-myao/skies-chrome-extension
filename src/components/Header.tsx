import { useState, useEffect, useRef, useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import '@styles/Header.scss';
import Searchbar from '../components/Searchbar';
import { TimezoneInfo } from './Timezone';
import { getSystemTimezone, localHHMM, timeOfDay } from '../core/tz';
import type { AppSettings, Entry } from '../core/types';
import type { AddTimezoneResult, ConvertPosition } from '../App';

interface HeaderProps {
  addTimezone: (timezone: TimezoneInfo) => AddTimezoneResult;
  onOpenSettings: () => void;
  isConvertModeOpen: boolean;
  onConvertModeChange: (isOpen: boolean) => void;
  convertPosition: ConvertPosition;
  onConvertPositionChange: (position: ConvertPosition) => void;
  isSearchOpen: boolean;
  onSearchOpenChange: (isOpen: boolean) => void;
  entries: Entry[];
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
}

// "Asia/Tokyo" -> "Tokyo" — same convention as an entry's default label.
function friendlyZoneName(zone: string): string {
  const last = zone.split('/').pop() ?? zone;
  return last.replace(/_/g, ' ');
}

const Header: React.FC<HeaderProps> = ({
  addTimezone,
  onOpenSettings,
  isConvertModeOpen,
  onConvertModeChange,
  convertPosition,
  onConvertPositionChange,
  isSearchOpen,
  onSearchOpenChange,
  entries,
  settings,
  setSettings,
}) => {
  const convertStops = [0, 3, 6, 9, 12, 15, 18, 21, 24];

  // Search functionality ==============================
  const convertRef = useRef<HTMLDivElement>(null);
  const convertTrackRef = useRef<HTMLDivElement>(null);
  const convertDotRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [convertThumbX, setConvertThumbX] = useState(0);
  const [isDraggingConvert, setIsDraggingConvert] = useState(false);
  const [convertInitialPosition, setConvertInitialPosition] = useState(0);
  const toggleSearch = () => {
    onConvertModeChange(false);
    onSearchOpenChange(!isSearchOpen);
  };

  // Reference timezone chip ============================
  const [showTzMenu, setShowTzMenu] = useState(false);
  const [chipNow, setChipNow] = useState(() => new Date());
  const tzChipRef = useRef<HTMLDivElement>(null);
  const tzMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => setChipNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const effectiveTimezone = settings.referenceTimezone ?? getSystemTimezone();
  const chipEntry = entries.find((entry) => entry.timezone === effectiveTimezone);
  const chipCityLabel = chipEntry?.label ?? friendlyZoneName(effectiveTimezone);
  const chipTime = localHHMM(effectiveTimezone, chipNow);
  const chipSky = timeOfDay(effectiveTimezone, chipNow);

  const referenceOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: { timezone: string; label: string }[] = [];
    entries.forEach((entry) => {
      if (seen.has(entry.timezone)) return;
      seen.add(entry.timezone);
      options.push({ timezone: entry.timezone, label: entry.label });
    });
    return options;
  }, [entries]);

  const toggleTzMenu = () => {
    onSearchOpenChange(false);
    onConvertModeChange(false);
    setShowTzMenu((prev) => !prev);
  };

  const selectReferenceTimezone = (timezone: string | null) => {
    setSettings((prev) => ({ ...prev, referenceTimezone: timezone }));
    setShowTzMenu(false);
  };

  const getLocalConvertPosition = (): number => {
    const now = new Date();
    const totalHours =
      now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;

    // Each dot spans 3 hours across the 24-hour timeline.
    return totalHours / 3;
  };
  const toggleConvertMenu = () => {
    onSearchOpenChange(false);
    setShowTzMenu(false);
    if (!isConvertModeOpen) {
      const localPos = getLocalConvertPosition();
      onConvertPositionChange(localPos);
      setConvertInitialPosition(localPos);
    }
    onConvertModeChange(!isConvertModeOpen);
  };

  const handleResetConverter = () => {
    const localPos = getLocalConvertPosition();
    onConvertPositionChange(localPos);
    setConvertInitialPosition(localPos);
  };

  const getConvertMetrics = useCallback(() => {
    const track = convertTrackRef.current;
    if (!track) return null;

    const rect = track.getBoundingClientRect();
    const dotPositions = convertDotRefs.current
      .map((dot) => {
        if (!dot) return null;
        const dotRect = dot.getBoundingClientRect();
        return dotRect.left - rect.left + dotRect.width / 2;
      })
      .filter((position): position is number => position !== null);

    if (dotPositions.length === 0) return null;

    return {
      rect,
      minX: dotPositions[0],
      maxX: dotPositions[dotPositions.length - 1],
      dotPositions,
    };
  }, []);

  const updateConvertPosition = useCallback(
    (clientX: number) => {
      const metrics = getConvertMetrics();
      if (!metrics) return;

      const relativeX = clientX - metrics.rect.left;
      const clampedX = Math.min(
        Math.max(relativeX, metrics.minX),
        metrics.maxX
      );
      const nearestDot = metrics.dotPositions.reduce(
        (closest, dotX, index) => {
          const distance = Math.abs(dotX - clampedX);
          return distance < closest.distance ? { index, distance } : closest;
        },
        { index: 0, distance: Number.POSITIVE_INFINITY }
      );

      let nextX = clampedX;

      // Apply a soft magnetic pull near markers without forcing a full snap.
      if (nearestDot.distance <= 14) {
        const snapX = metrics.dotPositions[nearestDot.index];
        const pullStrength = (14 - nearestDot.distance) / 14;
        nextX = clampedX + (snapX - clampedX) * pullStrength * 0.45;
      }

      const progress =
        (nextX - metrics.minX) / (metrics.maxX - metrics.minX || 1);
      const rawIndex = progress * (convertStops.length - 1);
      onConvertPositionChange(rawIndex);
      setConvertThumbX(nextX);
    },
    [convertStops.length, getConvertMetrics, onConvertPositionChange]
  );

  const getThumbXForPosition = (
    dotPositions: number[],
    position: number
  ): number => {
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const lowerX = dotPositions[lowerIndex] ?? dotPositions[0] ?? 0;
    const upperX =
      dotPositions[upperIndex] ?? dotPositions[dotPositions.length - 1] ?? 0;

    if (lowerIndex === upperIndex) {
      return lowerX;
    }

    const progress = position - lowerIndex;
    return lowerX + (upperX - lowerX) * progress;
  };

  const handleConvertPointerDown = (
    event: React.PointerEvent<HTMLSpanElement>
  ) => {
    event.preventDefault();
    setIsDraggingConvert(true);
  };

  const handleConvertTrackPointerDown = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    updateConvertPosition(event.clientX);
    setIsDraggingConvert(true);
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (convertRef.current && !convertRef.current.contains(target)) {
        onConvertModeChange(false);
      }
      if (
        tzChipRef.current &&
        !tzChipRef.current.contains(target) &&
        tzMenuRef.current &&
        !tzMenuRef.current.contains(target)
      ) {
        setShowTzMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onConvertModeChange]);

  useEffect(() => {
    if (!isDraggingConvert) return;

    const handlePointerMove = (event: PointerEvent) => {
      updateConvertPosition(event.clientX);
    };

    const handlePointerUp = () => {
      setIsDraggingConvert(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [convertPosition, isDraggingConvert, updateConvertPosition]);

  useEffect(() => {
    if (!isConvertModeOpen) return;

    const syncThumbPosition = () => {
      const metrics = getConvertMetrics();
      if (!metrics) return;

      setConvertThumbX(
        getThumbXForPosition(metrics.dotPositions, convertPosition)
      );
    };

    syncThumbPosition();

    const resizeObserver = new ResizeObserver(syncThumbPosition);
    if (convertTrackRef.current) {
      resizeObserver.observe(convertTrackRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [convertPosition, getConvertMetrics, isConvertModeOpen]);

  return (
    <header
      className={`header ${
        isConvertModeOpen ? 'header--convert-open' : ''
      }`}>
      <div className="header-inner">
          <div className="header-tz-chip" ref={tzChipRef}>
            <button
              type="button"
              className={`header-tz-chip__button header-tz-chip__button--${chipSky}`}
              aria-label="Change reference timezone"
              aria-expanded={showTzMenu}
              onClick={toggleTzMenu}>
              <span className="header-tz-chip__logo" />
              <span className="header-tz-chip__city">{chipCityLabel}</span>
              <span className="header-tz-chip__time">{chipTime}</span>
              <svg
                className={`header-tz-chip__chevron ${
                  showTzMenu ? 'header-tz-chip__chevron--open' : ''
                }`}
                width="8"
                height="8"
                viewBox="0 0 10 10"
                fill="none"
                aria-hidden="true">
                <path
                  d="M2 3.5L5 6.5L8 3.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            {showTzMenu && (
              <div className="header-tz-chip__menu" ref={tzMenuRef}>
                <button
                  type="button"
                  className={`header-tz-chip__option ${
                    settings.referenceTimezone === null ? 'active' : ''
                  }`}
                  onClick={() => selectReferenceTimezone(null)}>
                  System timezone
                  <span className="header-tz-chip__option-sub">
                    {friendlyZoneName(getSystemTimezone())}
                  </span>
                </button>
                {referenceOptions.length > 0 && (
                  <div className="header-tz-chip__divider" />
                )}
                {referenceOptions.map((option) => (
                  <button
                    type="button"
                    key={option.timezone}
                    className={`header-tz-chip__option ${
                      settings.referenceTimezone === option.timezone ? 'active' : ''
                    }`}
                    onClick={() => selectReferenceTimezone(option.timezone)}>
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="header-btns">
            <div className="header-btns__inner">
              <div>
                <button
                  className="header-btn header-btn__plus"
                  aria-label="Toggle search"
                  onClick={toggleSearch}></button>
              </div>
              <div className="header-convert" ref={convertRef}>
                <button
                  className={`header-btn header-btn__convert ${
                    isConvertModeOpen ? 'active' : ''
                  }`}
                  aria-label="Toggle convert panel"
                  onClick={toggleConvertMenu}></button>
                {isConvertModeOpen && (
                  <div className="header-convert__menu">
                    {Math.abs(convertPosition - convertInitialPosition) >
                      0.05 && (
                      <button
                        className="header-convert__reset"
                        aria-label="Reset converter to current time"
                        onClick={handleResetConverter}
                      />
                    )}
                    <div className="header-convert__scale">
                      <span className="header-convert__scale-label">0</span>
                      <span className="header-convert__scale-label">6</span>
                      <span className="header-convert__scale-label">12</span>
                      <span className="header-convert__scale-label">18</span>
                      <span className="header-convert__scale-label">24</span>
                    </div>
                    <div
                      className="header-convert__track"
                      ref={convertTrackRef}
                      onPointerDown={handleConvertTrackPointerDown}>
                      {convertStops.map((hour, index) => (
                        <span
                          key={hour}
                          ref={(element) => {
                            convertDotRefs.current[index] = element;
                          }}
                          className={`header-convert__dot ${
                            index % 2 === 0 ? 'hour' : ''
                          }`}></span>
                      ))}
                      <span
                        className={`header-convert__thumb ${
                          isDraggingConvert ? 'dragging' : ''
                        }`}
                        style={{
                          left: `${convertThumbX - 18}px`,
                        }}
                        onPointerDown={handleConvertPointerDown}>
                        <span></span>
                        <span></span>
                        <span></span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="header-btns__inner">
              <div>
                <button
                  className="header-btn header-btn__settings"
                  aria-label="Open settings"
                  onClick={onOpenSettings}></button>
              </div>
            </div>
          </div>
        </div>
        {isSearchOpen && (
          <Searchbar
            addTimezone={addTimezone}
            onSelect={() => onSearchOpenChange(false)}
          />
        )}
    </header>
  );
};

export default Header;
