import { useState, useEffect, useRef, useCallback } from 'react';
import '@styles/Header.scss';
import Searchbar from '../components/Searchbar';
import { TimezoneInfo } from './Timezone';
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
  const [showLogoMenu, setShowLogoMenu] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const logoRef = useRef<HTMLDivElement>(null);
  const logoMenuRef = useRef<HTMLDivElement>(null);
  const getLocalConvertPosition = (): number => {
    const now = new Date();
    const totalHours =
      now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;

    // Each dot spans 3 hours across the 24-hour timeline.
    return totalHours / 3;
  };
  const toggleConvertMenu = () => {
    onSearchOpenChange(false);
    setShowLogoMenu(false);
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
  const toggleLogoMenu = () => {
    onSearchOpenChange(false);
    onConvertModeChange(false);
    setShowLogoMenu((prev) => !prev);
  };

  const handleShare = () => {
    navigator.clipboard.writeText(
      'https://chromewebstore.google.com/detail/gmjjpjccmmdnainbbgchlnkhmgckcmik'
    );
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
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
        logoRef.current &&
        !logoRef.current.contains(target) &&
        logoMenuRef.current &&
        !logoMenuRef.current.contains(target)
      ) {
        setShowLogoMenu(false);
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
    <>
      <header
        className={`header ${
          isConvertModeOpen ? 'header--convert-open' : ''
        }`}>
        <div className="header-inner">
          <div className="header-logo-menu" ref={logoRef}>
            <button
              className="header-logo"
              aria-label="Open logo menu"
              onClick={toggleLogoMenu}></button>
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
      <div
        className={`header-logo-menu__overlay ${
          showLogoMenu ? 'header-logo-menu__overlay--open' : ''
        }`}
        onClick={() => setShowLogoMenu(false)}
        aria-hidden="true"
      />
      <div
        className={`header-logo-menu__menu ${
          showLogoMenu ? 'header-logo-menu__menu--open' : ''
        }`}
        ref={logoMenuRef}>
        <button
          className="header-logo-menu__item header-logo-menu__item--share"
          onClick={handleShare}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true">
            <path
              d="M7 8.5V1.5M7 1.5L4.5 4M7 1.5L9.5 4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2 9.5V12H12V9.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {shareCopied ? 'Copied!' : 'Share TimeMate'}
        </button>
        <button className="header-logo-menu__item">
          <a
            href=" https://chromewebstore.google.com/detail/gmjjpjccmmdnainbbgchlnkhmgckcmik/reviews"
            target="_blank"
            rel="noopener noreferrer">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="currentColor"
              aria-hidden="true">
              <path d="M7 1l1.545 3.13L12 4.636l-2.5 2.435.59 3.44L7 8.886l-3.09 1.625.59-3.44L2 4.636l3.455-.505L7 1z" />
            </svg>
            Back Me with 5 Stars
          </a>
        </button>
        <button className="header-logo-menu__item">
          <a
            href="https://forms.gle/ncZLfTs8RKE59ETC9"
            target="_blank"
            rel="noopener noreferrer">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true">
              <path
                d="M1.5 2.5a1 1 0 011-1h9a1 1 0 011 1v6a1 1 0 01-1 1H5l-3.5 2.5V2.5z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            Send Feedback
          </a>
        </button>
      </div>
    </>
  );
};

export default Header;
