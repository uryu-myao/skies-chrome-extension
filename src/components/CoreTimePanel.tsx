import { useEffect, useMemo, useRef, useState } from 'react';
import '@styles/CoreTimePanel.scss';
import { coreTime } from '../core/coretime';
import type { CoreTimeOverlapRange } from '../core/coretime';
import { getSystemTimezone, SLOTS_PER_DAY } from '../core/tz';
import type { AppSettings, Entry } from '../core/types';

interface CoreTimePanelProps {
  entries: Entry[];
  settings: AppSettings;
  isEditMode: boolean;
}

interface SlotRange {
  start: number;
  end: number;
}

const TRACK_DOT_HOURS = [3, 6, 9, 12, 15, 18, 21];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

// "4h" / "4.5h" for whole and half hours; quarter-hour zones (Kathmandu,
// Chatham) get exact minutes rather than a rounded "0.8h".
function formatHoursDiff(minutes: number): string {
  if (minutes % 30 === 0) {
    const hours = minutes / 60;
    return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
  }
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

const CoreTimePanel: React.FC<CoreTimePanelProps> = ({ entries, settings, isEditMode }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  // Bumped on leaving edit mode so the result is recomputed once for "now",
  // even if the edit didn't change the entries.
  const [recalcToken, setRecalcToken] = useState(0);

  // Collapsed while the list is being edited; expanded again on the way out,
  // so the rows' new order (which follows the list) is right there.
  const wasEditModeRef = useRef(isEditMode);
  useEffect(() => {
    if (wasEditModeRef.current && !isEditMode) {
      setIsExpanded(true);
      setRecalcToken((token) => token + 1);
    }
    wasEditModeRef.current = isEditMode;
  }, [isEditMode]);
  const showExpanded = isExpanded && !isEditMode;

  const filteredEntries = useMemo(
    () => entries.filter((entry) => entry.includeInCoreTime),
    [entries]
  );

  const result = useMemo(
    () => coreTime({ entries: filteredEntries, settings, referenceDate: new Date() }),
    // recalcToken isn't read, it only forces a fresh referenceDate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredEntries, settings, recalcToken]
  );

  const referenceTimezone = settings.referenceTimezone ?? getSystemTimezone();

  if (settings.coreTimePanel === 'hidden' || entries.length === 0) {
    return null;
  }

  const entryOf = (entryId: string): Entry | undefined =>
    filteredEntries.find((entry) => entry.id === entryId);
  const labelOf = (entryId: string): string => entryOf(entryId)?.label ?? '';

  const renderNextOverlap = (label: string, nextOverlap: { weekday: number; startSlot: number; endSlot: number } | null) => {
    if (!nextOverlap) return null;
    const range = `${formatSlotTime(result.axis, nextOverlap.startSlot)}–${formatSlotTime(result.axis, nextOverlap.endSlot)}`;
    return (
      <span className="core-time-panel__detail">
        {label} — {WEEKDAY_SHORT[nextOverlap.weekday]} {range}
      </span>
    );
  };

  const renderConclusion = () => {
    const { conclusion } = result;

    switch (conclusion.status) {
      case 'NO_ENTRIES':
        return <span className="core-time-panel__headline">Add a city to compare</span>;

      case 'OVERLAP': {
        const [first, ...rest] = result.overlap;
        const range = `${formatSlotTime(result.axis, first.startSlot)}–${formatSlotTime(result.axis, first.endSlot)}`;
        const prefix = filteredEntries.length === 1 ? labelOf(filteredEntries[0].id) : 'Overlap';
        return (
          <span className="core-time-panel__headline">
            {prefix} <span className="core-time-panel__headline-range">{range}</span>
            {rest.length > 0 && <span className="core-time-panel__muted"> +{rest.length} more</span>}
          </span>
        );
      }

      case 'NO_OVERLAP_TODAY': {
        const { closest } = conclusion;
        // The hint names the bottleneck — the entry furthest outside its own
        // day at the suggested time — not the reference zone.
        const bottleneck = closest.perEntry.find((p) => p.entryId === closest.bottleneckEntryId);
        const whose =
          entryOf(closest.bottleneckEntryId)?.timezone === referenceTimezone
            ? 'your'
            : `${labelOf(closest.bottleneckEntryId)}'s`;

        let directionText: string | null = null;
        if (bottleneck?.direction === 'BEFORE_START') {
          directionText = `${formatHoursDiff(closest.gapMinutes)} before ${whose} day starts`;
        } else if (bottleneck?.direction === 'AFTER_END') {
          directionText = `${formatHoursDiff(closest.gapMinutes)} after ${whose} day ends`;
        }

        return (
          <div className="core-time-panel__conclusion">
            <span className="core-time-panel__headline">No overlap today</span>
            <span className="core-time-panel__detail">
              Closest — {closest.refTime} yours
              {closest.perEntry.map((p) => (
                <span key={p.entryId}> / {p.localTime} {labelOf(p.entryId)}'s</span>
              ))}
            </span>
            {directionText && <span className="core-time-panel__muted-line">{directionText}</span>}
          </div>
        );
      }

      case 'PARTIAL_OVERLAP': {
        const [first, ...rest] = conclusion.overlap;
        const range = `${formatSlotTime(result.axis, first.startSlot)}–${formatSlotTime(result.axis, first.endSlot)}`;
        const excludedLabel = labelOf(conclusion.excludedId);
        return (
          <div className="core-time-panel__conclusion">
            <span className="core-time-panel__headline">
              All but {excludedLabel} overlap{' '}
              <span className="core-time-panel__headline-range">{range}</span>
              {rest.length > 0 && <span className="core-time-panel__muted"> +{rest.length} more</span>}
            </span>
            <span className="core-time-panel__muted-line">
              {excludedLabel} is outside its work hours — tap to exclude it
            </span>
          </div>
        );
      }

      case 'ALL_OFF':
        return (
          <div className="core-time-panel__conclusion">
            <span className="core-time-panel__headline">Everyone's off today</span>
            {renderNextOverlap('Next overlap', conclusion.nextOverlap)}
          </div>
        );

      case 'PARTIAL_OFF': {
        const workingLabels = conclusion.workingEntryIds.map(labelOf);
        const verb = workingLabels.length === 1 ? 'is' : 'are';
        return (
          <div className="core-time-panel__conclusion">
            <span className="core-time-panel__headline">
              Only {joinLabels(workingLabels)} {verb} working today
            </span>
            {renderNextOverlap('Next full overlap', conclusion.nextOverlap)}
          </div>
        );
      }

      default: {
        const unreachable: never = conclusion;
        return unreachable;
      }
    }
  };

  const canExpand = filteredEntries.length > 0 && !isEditMode;
  const cityWord = filteredEntries.length === 1 ? 'city' : 'cities';

  // PARTIAL_OVERLAP outlines the subset's overlap on the subset's rows only;
  // otherwise the full overlap (empty unless OVERLAP) goes on every row.
  const overlapOf = (entryId: string): CoreTimeOverlapRange[] => {
    const { conclusion } = result;
    if (conclusion.status !== 'PARTIAL_OVERLAP') return result.overlap;
    return conclusion.includedIds.includes(entryId) ? conclusion.overlap : [];
  };

  const rows = result.rows.map((row) => ({
    key: row.entryId,
    label: labelOf(row.entryId),
    blocks: row.blocks,
    overlap: overlapOf(row.entryId),
    isBaseline: entryOf(row.entryId)?.timezone === referenceTimezone,
    isOff: row.blocks.every((block) => !block),
  }));

  return (
    <div className={`core-time-panel ${showExpanded ? 'core-time-panel--expanded' : ''}`}>
      <button
        type="button"
        className="core-time-panel__header"
        onClick={() => canExpand && setIsExpanded((prev) => !prev)}
        aria-expanded={showExpanded}
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

      {showExpanded && canExpand && (
        <div className="core-time-panel__band">
          {rows.map((row) => (
            <div
              className={`core-time-panel__row ${row.isOff ? 'core-time-panel__row--off' : ''}`}
              key={row.key}>
              <span
                className={`core-time-panel__row-label ${row.isBaseline ? 'core-time-panel__row-label--baseline' : ''}`}>
                <span className="core-time-panel__row-name" title={row.label}>
                  {row.label}
                </span>
                {row.isBaseline && (
                  <span className="core-time-panel__row-baseline-tag">You</span>
                )}
                {row.isOff && (
                  <span className="core-time-panel__row-off-tag">Off</span>
                )}
              </span>
              <div
                className="core-time-panel__track"
                title={row.isOff ? 'Not a work day' : undefined}>
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
                {row.overlap.map((range, i) => (
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
