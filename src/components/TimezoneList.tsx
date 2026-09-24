import { useEffect, useCallback, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Timezone, { TimezoneInfo } from './Timezone';
import { createEntry } from '../core/model';
import type { Entry } from '../core/types';
import type { AddTimezoneResult, ConvertPosition, HourFormat } from '../App';
import '@styles/EditList.scss';

const MAX_CITIES = 10;

// A reorder only ever moves a row up or down.
const lockToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

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
  onOpenCity: (id: string) => void;
  isEditMode: boolean;
  onRemoveCity: (id: string) => void;
}

interface SortableRowProps {
  id: string;
  label: string;
  isEditMode: boolean;
  onRemove: () => void;
  children: ReactNode;
}

// Outside edit mode sorting is disabled and the row is a plain wrapper; the
// same element tree in both modes means toggling doesn't remount the cards.
const SortableRow: React.FC<SortableRowProps> = ({ id, label, isEditMode, onRemove, children }) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !isEditMode });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`timezone-row${isEditMode ? ' timezone-row--editing' : ''}${isDragging ? ' timezone-row--dragging' : ''}`}>
      {isEditMode && (
        <button
          type="button"
          className="timezone-row__remove"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
        />
      )}
      <div className="timezone-row__card">{children}</div>
      {isEditMode && (
        // The handle is the only drag activator — always visible, no long
        // press. Its attributes make it focusable: Space picks up, arrows
        // move, Space drops, Escape cancels.
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="timezone-row__handle"
          aria-label={`Reorder ${label}`}
          {...attributes}
          {...listeners}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M2 4h10M2 7h10M2 10h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
};

const TimezoneList: React.FC<TimezoneListProps> = ({
  entries,
  setEntries,
  onAddTimezone,
  referenceTimezone,
  hourFormat,
  showSeconds,
  isConvertModeOpen,
  convertPosition,
  onOpenCity,
  isEditMode,
  onRemoveCity,
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

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // The new order is written to entries right away; App persists it.
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setEntries((prev) => {
      const from = prev.findIndex((entry) => entry.id === active.id);
      const to = prev.findIndex((entry) => entry.id === over.id);
      return from < 0 || to < 0 ? prev : arrayMove(prev, from, to);
    });
  };

  // dnd-kit's default announcements read out the raw ids (UUIDs here).
  const labelOf = (id: UniqueIdentifier) => entries.find((entry) => entry.id === id)?.label ?? '';
  const positionOf = (id: UniqueIdentifier) => entries.findIndex((entry) => entry.id === id) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${labelOf(active.id)}, position ${positionOf(active.id)} of ${entries.length}.`,
    onDragOver: ({ active, over }) =>
      over ? `${labelOf(active.id)} moved to position ${positionOf(over.id)} of ${entries.length}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${labelOf(active.id)} dropped at position ${positionOf(over.id)} of ${entries.length}.`
        : `${labelOf(active.id)} dropped.`,
    onDragCancel: ({ active }) => `Reordering cancelled. ${labelOf(active.id)} returned to its place.`,
  };

  return (
    <div className={`timezone-list${isEditMode ? ' timezone-list--editing' : ''}`}>
      {entries.length === 0 ? (
        <div className="timezone-list__empty">
          <p className="timezone-list__empty-text">
            Press <span className="timezone-list__empty-addicon"></span> to add
            your first city.
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[lockToVerticalAxis]}
          onDragEnd={handleDragEnd}
          accessibility={{ announcements }}>
          <SortableContext items={entries.map((entry) => entry.id)} strategy={verticalListSortingStrategy}>
            {entries.map((entry) => (
              <SortableRow
                key={entry.id}
                id={entry.id}
                label={entry.label}
                isEditMode={isEditMode}
                onRemove={() => onRemoveCity(entry.id)}>
                <Timezone
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
                  onOpen={() => onOpenCity(entry.id)}
                  isCompact={isEditMode}
                />
              </SortableRow>
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
};

export default TimezoneList;
