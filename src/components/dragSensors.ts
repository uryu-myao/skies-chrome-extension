import { KeyboardSensor, PointerSensor, type KeyboardSensorProps, type PointerSensorProps } from '@dnd-kit/core';

// dnd-kit's pointer and keyboard sensors cancel a drag on any window
// `resize`: a real resize moves everything under the pointer. Firefox's
// extension popup fires `resize` without changing size — after DOM changes it
// re-measures the document and sets the popup to the size it already has.
// A drag starting changes the DOM, so every drag in the popup was cancelled
// a few milliseconds after it began (seen in Firefox 140 and 158; a tab, or
// Chrome, never fires these). These sensors ignore a resize that leaves the
// window the size it was when the drag began. Everything else — Escape,
// pointercancel, visibilitychange, a resize that does change the size —
// cancels exactly as before.
//
// dnd-kit 6.3.1's typings mark handleCancel private. At runtime it is an
// ordinary prototype method that the constructor binds before attaching
// every cancelling listener, so overriding it on the prototype reaches them
// all. The lockfile pins the version; upgrading dnd-kit means checking this
// again (test/components/dragSensors.test.ts fails if handleCancel moves).

type Cancel = (this: object, event?: Event) => void;
interface Cancellable {
  handleCancel: Cancel;
}

export function windowSize(win: Window): string {
  return `${win.innerWidth}×${win.innerHeight}`;
}

// Whether `event` is a resize that changed nothing since the drag began.
export function isNoOpResize(sizeAtStart: string | undefined, event: Event | undefined, sizeNow: string): boolean {
  return event?.type === 'resize' && sizeAtStart !== undefined && sizeAtStart === sizeNow;
}

const sizesAtStart = new WeakMap<object, string>();

function ignoringNoOpResize(cancel: Cancel): Cancel {
  return function (this: object, event?: Event) {
    if (isNoOpResize(sizesAtStart.get(this), event, windowSize(window))) return;
    cancel.call(this, event);
  };
}

export class PopupSafePointerSensor extends PointerSensor {
  constructor(props: PointerSensorProps) {
    super(props);
    // Listeners are attached inside super(), but events only arrive later.
    sizesAtStart.set(this, windowSize(window));
  }
}

export class PopupSafeKeyboardSensor extends KeyboardSensor {
  constructor(props: KeyboardSensorProps) {
    super(props);
    sizesAtStart.set(this, windowSize(window));
  }
}

for (const [Sensor, Base] of [
  [PopupSafePointerSensor, PointerSensor],
  [PopupSafeKeyboardSensor, KeyboardSensor],
] as const) {
  const baseCancel = (Base.prototype as unknown as Cancellable).handleCancel;
  if (typeof baseCancel !== 'function') throw new Error(`dnd-kit ${Base.name} has no handleCancel to wrap`);
  (Sensor.prototype as unknown as Cancellable).handleCancel = ignoringNoOpResize(baseCancel);
}
