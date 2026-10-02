import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyboardSensor, PointerSensor } from '@dnd-kit/core';
import {
  isNoOpResize,
  PopupSafeKeyboardSensor,
  PopupSafePointerSensor,
  windowSize,
} from '../../src/components/dragSensors';

// Firefox's extension popup fires `resize` without changing size after DOM
// changes; dnd-kit's sensors cancelled every drag on it (dragSensors.ts).

const event = (type: string) => ({ type, preventDefault: vi.fn() }) as unknown as Event;

describe('isNoOpResize', () => {
  it('a resize that leaves the size as it was: ignored', () => {
    expect(isNoOpResize('420×540', event('resize'), '420×540')).toBe(true);
  });

  it('a resize that changes the size: cancels, as before', () => {
    expect(isNoOpResize('420×540', event('resize'), '420×560')).toBe(false);
  });

  it.each(['keydown', 'pointercancel', 'visibilitychange'])('%s: cancels, as before', (type) => {
    expect(isNoOpResize('420×540', event(type), '420×540')).toBe(false);
  });

  it('Escape in the pointer sensor (no event): cancels, as before', () => {
    expect(isNoOpResize('420×540', undefined, '420×540')).toBe(false);
  });

  it('no size recorded: cancels', () => {
    expect(isNoOpResize(undefined, event('resize'), '420×540')).toBe(false);
  });
});

describe('the sensors', () => {
  type Cancellable = { handleCancel: (this: object, event?: Event) => void };

  // dnd-kit 6.3.1 keeps handleCancel on the prototype; if an upgrade moves it,
  // the wrapping silently stops working — this catches that.
  it.each([
    ['pointer', PopupSafePointerSensor, PointerSensor],
    ['keyboard', PopupSafeKeyboardSensor, KeyboardSensor],
  ] as const)('the %s sensor wraps dnd-kit’s handleCancel', (_name, Sensor, Base) => {
    const wrapped = (Sensor.prototype as unknown as Cancellable).handleCancel;
    const base = (Base.prototype as unknown as Cancellable).handleCancel;
    expect(typeof base).toBe('function');
    expect(wrapped).not.toBe(base);
  });

  it('keep the activators, so the same input starts a drag', () => {
    expect(PopupSafePointerSensor.activators).toBe(PointerSensor.activators);
    expect(PopupSafeKeyboardSensor.activators).toBe(KeyboardSensor.activators);
  });

  describe('a cancel that isn’t a no-op resize reaches dnd-kit', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('keyboard: Escape still cancels', () => {
      vi.stubGlobal('window', { innerWidth: 420, innerHeight: 540 });
      const onCancel = vi.fn();
      const sensor = { props: { onCancel }, detach: vi.fn() };
      const escape = event('keydown');
      (PopupSafeKeyboardSensor.prototype as unknown as Cancellable).handleCancel.call(sensor, escape);
      expect(escape.preventDefault).toHaveBeenCalled();
      expect(sensor.detach).toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalled();
    });
  });

  it('windowSize reads the inner size', () => {
    expect(windowSize({ innerWidth: 420, innerHeight: 540 } as Window)).toBe('420×540');
  });
});
