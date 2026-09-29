import { useState, useEffect, useRef, useMemo } from 'react';
import '@styles/Searchbar.scss';
import type { AddTimezoneResult } from '../App';
import { buildCityIndex, searchCities, type CityIndex } from '../core/citySearch';
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
  const [index, setIndex] = useState<CityIndex | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [showLimitTip, setShowLimitTip] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // The city library (GeoNames, src/data/cities.ts) is its own chunk, loaded
  // when the search opens rather than with the popup (spec §9.6).
  useEffect(() => {
    let active = true;
    import('../data/cities')
      .then((library) => {
        if (active) setIndex(buildCityIndex(library));
      })
      .catch((error) => console.error('[Skies] loading the city library failed', error));
    return () => {
      active = false;
    };
  }, []);

  // Searched locally on every keystroke — no request, so no debounce. Same
  // results as before, one per city + zone, cities in a zone the list
  // already has left out when the caller asks for it.
  const results = useMemo<SearchResult[]>(() => {
    if (!index || !searchTerm.trim()) return [];
    const unique = new Map<string, SearchResult>();
    for (const city of searchCities(index, searchTerm)) {
      if (existingZones.includes(city.zone)) continue;
      const id = `${city.city.toLowerCase().replace(/[^\w]/g, '-')}-${city.zone.toLowerCase().replace(/[^\w/]/g, '-')}`;
      if (unique.has(id)) continue;
      unique.set(id, {
        id,
        city: city.city,
        zone: city.zone,
        country: city.country,
        countryCode: city.countryCode,
        region: city.region,
        lat: city.lat,
        lon: city.lon,
      });
    }
    return [...unique.values()];
  }, [index, searchTerm, existingZones]);
  const isLoading = !!searchTerm.trim() && index === null;

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchTerm(value);
    setShowResults(!!value.trim());
    setShowLimitTip(false);
    setActiveIndex(-1);
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
                      // Bundled 80px PNGs (public/flags/, scripts/fetch-flags.mjs), shown 32px wide.
                      src={`/flags/${result.countryCode.toLowerCase()}.png`}
                      alt={result.country ?? result.countryCode}
                      loading="lazy"
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="search-no-results">
              No match. Try a nearby larger city — you can rename it after adding.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Searchbar;
