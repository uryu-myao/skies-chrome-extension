import { useMemo, useState } from 'react';
import '@styles/CoreTimePanel.scss';
import { coreTime } from '../core/coretime';
import type { AppSettings, Entry } from '../core/types';

interface CoreTimePanelProps {
  entries: Entry[];
  settings: AppSettings;
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

  if (settings.coreTimePanel === 'hidden' || entries.length === 0) {
    return null;
  }

  const labelOf = (entryId: string): string =>
    filteredEntries.find((entry) => entry.id === entryId)?.label ?? '';

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
        <span className="core-time-panel__conclusion">
          <span className="core-time-panel__headline">No shared work hours today</span>
          <span className="core-time-panel__detail">
            Closest — {result.closest.refTime} your time
            {result.closest.perEntry.map((p) => (
              <span key={p.entryId}> · {p.localTime} {labelOf(p.entryId)}'s</span>
            ))}
            {directionText && <span className="core-time-panel__muted"> · {directionText}</span>}
          </span>
        </span>
      );
    }

    return (
      <span className="core-time-panel__headline">No valid work hours to compare</span>
    );
  };

  const canExpand = filteredEntries.length > 0;

  return (
    <div className={`core-time-panel ${isExpanded ? 'core-time-panel--expanded' : ''}`}>
      <button
        type="button"
        className="core-time-panel__summary"
        onClick={() => canExpand && setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        disabled={!canExpand}>
        {renderConclusion()}
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
      </button>
      {isExpanded && canExpand && (
        <div className="core-time-panel__band">
          <div className="core-time-panel__scale">
            {[0, 6, 12, 18, 24].map((hour) => (
              <span key={hour}>{hour}</span>
            ))}
          </div>
          <div className="core-time-panel__rows">
            {result.rows.map((row) => (
              <div className="core-time-panel__row" key={row.entryId}>
                <span className="core-time-panel__row-label">{labelOf(row.entryId)}</span>
                <div className="core-time-panel__track">
                  {row.blocks.map((isWorking, slot) => (
                    <span
                      key={slot}
                      className={`core-time-panel__slot ${isWorking ? 'is-working' : ''}`}
                    />
                  ))}
                  {result.overlap.map((range, i) => (
                    <span
                      key={i}
                      className="core-time-panel__overlap"
                      style={{
                        left: `${(range.startSlot / 48) * 100}%`,
                        width: `${((range.endSlot - range.startSlot) / 48) * 100}%`,
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CoreTimePanel;
