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
  onToggleCoreTime: (entryId: string) => void;
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

const CoreTimePanel: React.FC<CoreTimePanelProps> = ({
  entries,
  settings,
  isEditMode,
  onToggleCoreTime,
}) => {
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

  // Every entry goes in: coreTime leaves the excluded ones out of the overlap
  // and the conclusion but still returns their rows, which stay visible
  // (dimmed) so the user can see who they excluded and tap them back in.
  const result = useMemo(
    () => coreTime({ entries, settings, referenceDate: new Date() }),
    // recalcToken isn't read, it only forces a fresh referenceDate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, settings, recalcToken]
  );

  const referenceTimezone = settings.referenceTimezone ?? getSystemTimezone();

  if (settings.coreTimePanel === 'hidden' || entries.length === 0) {
    return null;
  }

  const includedCount = result.rows.filter((row) => row.included).length;
  const entryOf = (entryId: string): Entry | undefined =>
    entries.find((entry) => entry.id === entryId);
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
        // The panel isn't rendered at all without entries, so here it means
        // every city was excluded (or closest's null fallback, see coretime).
        if (includedCount === 0) {
          return (
            <div className="core-time-panel__conclusion">
              <span className="core-time-panel__headline">No cities in core time</span>
              <span className="core-time-panel__muted-line">
                {showExpanded ? 'Tap a city to include it' : 'Expand to include a city'}
              </span>
            </div>
          );
        }
        return <span className="core-time-panel__headline">Add a city to compare</span>;

      case 'OVERLAP': {
        const [first, ...rest] = result.overlap;
        const range = `${formatSlotTime(result.axis, first.startSlot)}–${formatSlotTime(result.axis, first.endSlot)}`;
        const onlyIncluded = includedCount === 1 ? result.rows.find((row) => row.included) : undefined;
        const prefix = onlyIncluded ? labelOf(onlyIncluded.entryId) : 'Overlap';
        return (
          <span className="core-time-panel__headline">
            {prefix} <span className="core-time-panel__headline-range">{range}</span>
            {rest.length > 0 && <span className="core-time-panel__muted"> +{rest.length} more</span>}
          </span>
        );
      }

      case 'NO_OVERLAP_TODAY': {
        const { closest } = conclusion;
        const gap = formatHoursDiff(closest.gapMinutes);
        // The hint names the bottleneck — the entry furthest outside its own
        // day at the suggested time — not the reference zone. On a tie it
        // gives a count instead: naming one would suggest excluding it fixes
        // things, and it wouldn't.
        let directionText: string | null = null;
        if (closest.bottleneckEntryIds.length > 1) {
          directionText = `${closest.bottleneckEntryIds.length} cities are ${gap} outside their work hours`;
        } else {
          const [bottleneckId] = closest.bottleneckEntryIds;
          const bottleneck = closest.perEntry.find((p) => p.entryId === bottleneckId);
          const whose =
            entryOf(bottleneckId)?.timezone === referenceTimezone ? 'your' : `${labelOf(bottleneckId)}'s`;
          if (bottleneck?.direction === 'BEFORE_START') {
            directionText = `${gap} before ${whose} day starts`;
          } else if (bottleneck?.direction === 'AFTER_END') {
            directionText = `${gap} after ${whose} day ends`;
          }
        }

        return (
          <div className="core-time-panel__conclusion">
            <span className="core-time-panel__headline">No overlap today</span>
            {/* Only the reference time here; each city's own local time is on
                its band row when expanded, beside the marker. */}
            <span className="core-time-panel__detail">Closest — {closest.refTime} yours</span>
            {directionText && <span className="core-time-panel__muted-line">{directionText}</span>}
          </div>
        );
      }

      case 'PARTIAL_OVERLAP': {
        const [first, ...rest] = conclusion.overlap;
        const range = `${formatSlotTime(result.axis, first.startSlot)}–${formatSlotTime(result.axis, first.endSlot)}`;
        // "you" when the outlier is the reference city, as in closest's
        // "yours" / "your day" — the user shouldn't have to remember which
        // city is them.
        const isYou = entryOf(conclusion.excludedId)?.timezone === referenceTimezone;
        const excludedLabel = labelOf(conclusion.excludedId);
        return (
          <div className="core-time-panel__conclusion">
            <span className="core-time-panel__headline">
              All but {isYou ? 'you' : excludedLabel} overlap{' '}
              <span className="core-time-panel__headline-range">{range}</span>
              {rest.length > 0 && <span className="core-time-panel__muted"> +{rest.length} more</span>}
            </span>
            {/* The hint is itself the control — it has to work collapsed too,
                where there are no city names to tap. */}
            <button
              type="button"
              className="core-time-panel__muted-line core-time-panel__hint-action"
              onClick={() => onToggleCoreTime(conclusion.excludedId)}>
              {isYou
                ? "Your hours don't overlap — tap to exclude yourself"
                : `${excludedLabel} is outside its work hours — tap to exclude it`}
            </button>
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
        const workingCount = workingLabels.length;
        const verb = workingCount === 1 ? 'is' : 'are';
        // Names read fine up to two; past that a count keeps it one line.
        const who = workingCount >= 3 ? `${workingCount} cities` : joinLabels(workingLabels);
        const [first, ...rest] = conclusion.workingOverlap;
        return (
          <div className="core-time-panel__conclusion">
            <span className="core-time-panel__headline">
              Only {who} {verb} working today
            </span>
            {first && (
              <span className="core-time-panel__detail">
                {workingCount >= 3 ? `Those ${workingCount}` : 'They'} overlap{' '}
                {formatSlotTime(result.axis, first.startSlot)}–{formatSlotTime(result.axis, first.endSlot)}
                {rest.length > 0 && <span className="core-time-panel__muted"> +{rest.length} more</span>}
              </span>
            )}
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

  // Still expandable with every city excluded — the band is where they're
  // brought back.
  const canExpand = !isEditMode;
  const cityWord = entries.length === 1 ? 'city' : 'cities';
  const countText =
    includedCount === entries.length
      ? `${entries.length} ${cityWord}`
      : `${includedCount} of ${entries.length} ${cityWord}`;

  // PARTIAL_OVERLAP and PARTIAL_OFF outline the subset's overlap on the
  // subset's rows only; otherwise the full overlap (empty unless OVERLAP)
  // goes on every included row. Excluded rows never get it.
  const overlapOf = (entryId: string, included: boolean): CoreTimeOverlapRange[] => {
    const { conclusion } = result;
    if (!included) return [];
    if (conclusion.status === 'PARTIAL_OVERLAP') {
      return conclusion.includedIds.includes(entryId) ? conclusion.overlap : [];
    }
    if (conclusion.status === 'PARTIAL_OFF') {
      return conclusion.workingEntryIds.includes(entryId) ? conclusion.workingOverlap : [];
    }
    return result.overlap;
  };

  // NO_OVERLAP_TODAY: a marker at the closest slot runs through every row,
  // so who's inside their day and who isn't reads straight off the band;
  // a third column gives each city's local time there, the bottleneck's
  // emphasised. Same `closest` the collapsed line reads.
  const closest = result.conclusion.status === 'NO_OVERLAP_TODAY' ? result.conclusion.closest : null;
  const closestTimeOf = (entryId: string) => closest?.perEntry.find((p) => p.entryId === entryId);

  const rows = result.rows.map((row) => ({
    key: row.entryId,
    label: labelOf(row.entryId),
    blocks: row.blocks,
    overlap: overlapOf(row.entryId, row.included),
    included: row.included,
    isBaseline: entryOf(row.entryId)?.timezone === referenceTimezone,
    // From core, not from the blocks: the axis can graze another day's
    // working hours, which left a city that's off today without its tag.
    isOff: row.offToday,
    closestTime: closestTimeOf(row.entryId)?.localTime ?? null,
    isBottleneck: closest?.bottleneckEntryIds.includes(row.entryId) ?? false,
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
          today · {countText}
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
        <div className={`core-time-panel__band ${closest ? 'core-time-panel__band--closest' : ''}`}>
          {rows.map((row) => (
            <div
              className={`core-time-panel__row ${row.isOff ? 'core-time-panel__row--off' : ''} ${
                row.included ? '' : 'core-time-panel__row--excluded'
              }`}
              key={row.key}>
              <button
                type="button"
                className={`core-time-panel__row-label ${row.isBaseline ? 'core-time-panel__row-label--baseline' : ''}`}
                onClick={() => onToggleCoreTime(row.key)}
                aria-pressed={row.included}
                aria-label={`${row.label}: ${row.included ? 'included in' : 'excluded from'} core time`}>
                <span className="core-time-panel__row-name" title={row.label}>
                  {row.label}
                </span>
                {row.isBaseline && (
                  <span className="core-time-panel__row-baseline-tag">You</span>
                )}
                {row.isOff && (
                  <span className="core-time-panel__row-off-tag">Off</span>
                )}
              </button>
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
              {/* Always rendered in closest mode, empty for an excluded row:
                  rows are display:contents, so a missing cell would shift the
                  next row's label into this column. */}
              {closest && (
                <span
                  className={`core-time-panel__row-time ${
                    row.isBottleneck ? 'core-time-panel__row-time--bottleneck' : ''
                  }`}>
                  {row.closestTime}
                </span>
              )}
            </div>
          ))}
          <div className="core-time-panel__scale-row">
            <span aria-hidden="true" />
            <div className="core-time-panel__scale">
              {[0, 6, 12, 18, 24].map((hour) => (
                <span key={hour}>{hour}</span>
              ))}
            </div>
            {closest && <span aria-hidden="true" />}
          </div>
          {closest && (
            // One element spanning every track row, so the line is continuous
            // through the row gaps rather than a tick per row — a tick per row
            // would look like the overlap outline's edges. Centred in the slot:
            // at its start it would sit exactly on a block edge whenever a
            // city starts or stops there, and read as neither in nor out.
            <span
              className="core-time-panel__marker-layer"
              style={{ gridRow: `1 / span ${rows.length}` }}
              aria-hidden="true">
              <span
                className="core-time-panel__marker"
                style={{ left: `${((closest.slot + 0.5) / SLOTS_PER_DAY) * 100}%` }}
              />
            </span>
          )}
        </div>
      )}

      <div className="core-time-panel__conclusion-row">{renderConclusion()}</div>
    </div>
  );
};

export default CoreTimePanel;
