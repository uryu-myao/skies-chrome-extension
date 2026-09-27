import { useState, useEffect, useRef, useCallback } from 'react';
import '@styles/Searchbar.scss';
import type { AddTimezoneResult } from '../App';
import { MAX_CITIES } from '../core/model';

function getUtcOffset(zone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: zone,
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date());
  const offset = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  return offset.replace('GMT', 'UTC');
}

function highlightMatch(text: string, query: string) {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

interface SearchResult {
  id: string;
  city: string;
  zone: string;
  country?: string;
  countryCode?: string;
  region?: string;
  lat?: number;
  lon?: number;
}

interface SearchApiItem {
  city?: string;
  timezone?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  lat?: number;
  lon?: number;
}

interface OpenMeteoResultItem {
  name?: string;
  country?: string;
  country_code?: string;
  admin1?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
}

interface OpenMeteoSearchResponse {
  results?: OpenMeteoResultItem[];
}

const EMPTY_ZONES: string[] = [];

interface SearchbarProps {
  addTimezone: (timezone: SearchResult) => AddTimezoneResult;
  existingZones?: string[];
  onSelect?: () => void;
}

const Searchbar: React.FC<SearchbarProps> = ({
  addTimezone,
  existingZones = EMPTY_ZONES,
  onSelect,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showLimitTip, setShowLimitTip] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const activeRequestIdRef = useRef(0);

  const fetchCityTimezones = useCallback(
    async (query: string, signal?: AbortSignal): Promise<SearchResult[]> => {
      try {
        // Use free Open-Meteo geocoding directly to avoid local proxy dependency.
        const res = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
            query
          )}&count=8&language=en&format=json`,
          { signal }
        );
        const payload = (await res.json()) as OpenMeteoSearchResponse;
        const data: SearchApiItem[] = Array.isArray(payload.results)
          ? payload.results.map((item) => ({
              city: item.name,
              timezone: item.timezone,
              country: item.country,
              countryCode: item.country_code,
              region: item.admin1,
              lat: item.latitude,
              lon: item.longitude,
            }))
          : [];

        if (!Array.isArray(data)) return [];

        const mapped = data
          .filter(
            (item) =>
              item.city &&
              item.timezone &&
              !existingZones.includes(item.timezone)
          )
          .map((item) => ({
            id: `${String(item.city)
              .toLowerCase()
              .replace(/[^\w]/g, '-')}-${String(item.timezone)
              .toLowerCase()
              .replace(/[^\w/]/g, '-')}`,
            city: item.city as string,
            zone: item.timezone as string,
            country: item.country,
            countryCode: item.countryCode,
            region: item.region,
            lat: item.lat,
            lon: item.lon,
          }));

        // Open-Meteo may return duplicates with same city/timezone.
        const unique = new Map<string, SearchResult>();
        for (const item of mapped) {
          if (!unique.has(item.id)) {
            unique.set(item.id, item);
          }
        }
        return Array.from(unique.values());
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return [];
        }
        console.error('搜索城市时出错:', error);
        return [];
      }
    },
    [existingZones]
  ); // ✅ 把依赖列上

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchTerm(value);
    setShowResults(!!value.trim());
    setShowLimitTip(false);
    setActiveIndex(-1);
    if (value.trim()) setIsLoading(true);
  };

  const handleSelectCity = (result: SearchResult) => {
    const addResult = addTimezone(result);
    if (addResult === 'limit') {
      setShowLimitTip(true);
      return;
    }

    setShowLimitTip(false);
    setSearchTerm('');
    setShowResults(false);
    setResults([]);
    setActiveIndex(-1);
    onSelect?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showResults || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => {
        const next = Math.min(prev + 1, results.length - 1);
        scrollItemIntoView(next);
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => {
        const next = Math.max(prev - 1, 0);
        scrollItemIntoView(next);
        return next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < results.length) {
        handleSelectCity(results[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowResults(false);
      setActiveIndex(-1);
    }
  };

  const scrollItemIntoView = (index: number) => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[index] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchRef.current &&
        !searchRef.current.contains(event.target as Node)
      ) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!searchTerm.trim()) {
      setResults((prev) => (prev.length === 0 ? prev : []));
      setIsLoading((prev) => (prev ? false : prev));
      return;
    }

    const requestId = activeRequestIdRef.current + 1;
    activeRequestIdRef.current = requestId;
    const controller = new AbortController();

    const delaySearch = setTimeout(async () => {
      const searchResults = await fetchCityTimezones(
        searchTerm,
        controller.signal
      );
      // Ignore stale responses from previous requests.
      if (requestId !== activeRequestIdRef.current) {
        return;
      }
      setResults(searchResults);
      setIsLoading(false);
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(delaySearch);
    };
  }, [searchTerm, fetchCityTimezones]); // ✅ 正确标记依赖

  return (
    <div className="search-inner" ref={searchRef}>
      <div
        className={`search-input__container ${showLimitTip ? 'limit-reached' : ''}`}
        data-limit-tip={`You can add up to ${MAX_CITIES} cities`}>
        <input
          ref={inputRef}
          className="search-input__field"
          type="text"
          placeholder="Search cities..."
          value={searchTerm}
          onChange={handleSearch}
          onKeyDown={handleKeyDown}
          autoComplete="off"
        />
      </div>

      {showResults && (
        <div className="search-results">
          {isLoading ? (
            <div className="search-loading">
              <span className="search-loading__spinner" />
              Searching…
            </div>
          ) : results.length > 0 ? (
            <ul ref={listRef}>
              {results.map((result, index) => (
                <li
                  key={result.id}
                  onClick={() => handleSelectCity(result)}
                  className={`search-result__item${index === activeIndex ? ' search-result__item--active' : ''}`}>
                  <div className="search-result__info">
                    <span className="city-name">
                      {highlightMatch(result.city, searchTerm)}
                      {result.region ? `, ${result.region}` : ''}
                      {result.country ? `, ${result.country}` : ''}
                    </span>
                    <span className="timezone-name">
                      {getUtcOffset(result.zone)}
                    </span>
                  </div>
                  {result.countryCode && (
                    <img
                      className="country-flag"
                      src={`https://flagcdn.com/${result.countryCode.toLowerCase()}.svg`}
                      alt={result.country ?? result.countryCode}
                      loading="lazy"
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="search-no-results">No cities found</div>
          )}
        </div>
      )}
    </div>
  );
};

export default Searchbar;
