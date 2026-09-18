import { useMemo, useState } from 'react';
import '@styles/CoreTimePanel.scss';
import { coreTime } from '../core/coretime';
import { getSystemTimezone, SLOTS_PER_DAY } from '../core/tz';
import type { AppSettings, Entry } from '../core/types';

interface CoreTimePanelProps {
  entries: Entry[];
  settings: AppSettings;
}

interface SlotRange {
  start: number;
  end: number;
}

const TRACK_DOT_HOURS = [3, 6, 9, 12, 15, 18, 21];

function blocksToRanges(blocks: boolean[]): SlotRange[] {
  const ranges: SlotRange[] = [];
  let start: number | null = null;
  for (let i = 0; i <= blocks.length; i++) {
    const on = i < blocks.length && blocks[i];
    if (on && start === null) {
      start = i;
    } else if (!on && start !== null) {
      ranges.push({ start, end: i });
      start = null;
    }
  }
  return ranges;
}

function formatSlotTime(axis: { slot: number; refTime: string }[], slot: number): string {
  return slot >= axis.length ? '24:00' : axis[slot].refTime;
}

function formatHoursDiff(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

const CoreTimePanel: React.FC<CoreTimePanelProps> = ({ entries, settings }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const filteredEntries = useMemo(
    () => entries.filter((entry) => entry.includeInCoreTime),
    [entries]
  );

  const result = useMemo(
    () => coreTime({ entries: filteredEntries, settings, referenceDate: new Date() }),
    [filteredEntries, settings]
  );

  const referenceTimezone = settings.referenceTimezone ?? getSystemTimezone();

  if (settings.coreTimePanel === 'hidden' || entries.length === 0) {
    return null;
  }

  const entryOf = (entryId: string): Entry | undefined =>
    filteredEntries.find((entry) => entry.id === entryId);
  const labelOf = (entryId: string): string => entryOf(entryId)?.label ?? '';

  const renderConclusion = () => {
    if (filteredEntries.length === 0) {
      return (
        <span className="core-time-panel__headline">
          No cities included in Core Time
        </span>
      );
    }

    if (result.overlap.length > 0) {
      const [first, ...rest] = result.overlap;
      const range = `${formatSlotTime(result.axis, first.startSlot)}–${formatSlotTime(result.axis, first.endSlot)}`;
      const prefix = filteredEntries.length === 1 ? labelOf(filteredEntries[0].id) : 'Overlap';
      return (
        <span className="core-time-panel__headline">
          {prefix} {range}
          {rest.length > 0 && <span className="core-time-panel__muted"> +{rest.length} more</span>}
        </span>
      );
    }

    if (result.closest) {
      const [rh, rm] = result.closest.refTime.split(':').map(Number);
      const refMinutes = rh * 60 + rm;
      const startMinutes = settings.defaultWorkHours.start * 60;
      const endMinutes = settings.defaultWorkHours.end * 60;

      let directionText: string | null = null;
      if (refMinutes < startMinutes) {
        directionText = `${formatHoursDiff(startMinutes - refMinutes)} before your day starts`;
      } else if (refMinutes >= endMinutes) {
        directionText = `${formatHoursDiff(refMinutes - endMinutes)} after your day ends`;
      }

      return (
        <div className="core-time-panel__conclusion">
          <span className="core-time-panel__headline">No shared work hours today</span>
          <span className="core-time-panel__detail">
            Closest — {result.closest.refTime} your time
            {result.closest.perEntry.map((p) => (
              <span key={p.entryId}> / {p.localTime} {labelOf(p.entryId)}'s</span>
            ))}
          </span>
          {directionText && <span className="core-time-panel__muted-line">{directionText}</span>}
        </div>
      );
    }

    return (
      <span className="core-time-panel__headline">No valid work hours to compare</span>
    );
  };

  const canExpand = filteredEntries.length > 0;
  const cityWord = filteredEntries.length === 1 ? 'city' : 'cities';

  const rows = result.rows.map((row) => ({
    key: row.entryId,
    label: labelOf(row.entryId),
    blocks: row.blocks,
    isBaseline: entryOf(row.entryId)?.timezone === referenceTimezone,
  }));

  return (
    <div className={`core-time-panel ${isExpanded ? 'core-time-panel--expanded' : ''}`}>
      <button
        type="button"
        className="core-time-panel__header"
        onClick={() => canExpand && setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        disabled={!canExpand}>
        <span className="core-time-panel__title">Core time</span>
        <span className="core-time-panel__meta">
          today · {filteredEntries.length} {cityWord}
          {canExpand && (
            <svg
              className="core-time-panel__chevron"
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              aria-hidden="true">
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </button>

      {isExpanded && canExpand && (
        <div className="core-time-panel__band">
          {rows.map((row) => (
            <div className="core-time-panel__row" key={row.key}>
              <span
                className={`core-time-panel__row-label ${row.isBaseline ? 'core-time-panel__row-label--baseline' : ''}`}
                title={row.label}>
                {row.label}
                {row.isBaseline && (
                  <span className="core-time-panel__row-baseline-tag">You</span>
                )}
              </span>
              <div className="core-time-panel__track">
                {TRACK_DOT_HOURS.map((hour) => (
                  <span
                    key={hour}
                    className={`core-time-panel__dot ${hour % 6 === 0 ? 'hour' : ''}`}
                    style={{ left: `${(hour / 24) * 100}%` }}
                  />
                ))}
                {blocksToRanges(row.blocks).map((range, i) => (
                  <span
                    key={i}
                    className="core-time-panel__segment"
                    style={{
                      left: `${(range.start / SLOTS_PER_DAY) * 100}%`,
                      width: `${((range.end - range.start) / SLOTS_PER_DAY) * 100}%`,
                    }}
                  />
                ))}
                {result.overlap.map((range, i) => (
                  <span
                    key={i}
                    className="core-time-panel__overlap"
                    style={{
                      left: `${(range.startSlot / SLOTS_PER_DAY) * 100}%`,
                      width: `${((range.endSlot - range.startSlot) / SLOTS_PER_DAY) * 100}%`,
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="core-time-panel__scale-row">
            <span aria-hidden="true" />
            <div className="core-time-panel__scale">
              {[0, 6, 12, 18, 24].map((hour) => (
                <span key={hour}>{hour}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="core-time-panel__conclusion-row">{renderConclusion()}</div>
    </div>
  );
};

export default CoreTimePanel;
