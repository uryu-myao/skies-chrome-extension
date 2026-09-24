import { useLayoutEffect, useRef, useState } from 'react';

interface SegmentedControlOption<T> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

function SegmentedControl<T>({ options, value, onChange }: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(
    null
  );
  const activeIndex = options.findIndex((option) => option.value === value);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const buttons = container.querySelectorAll('button');
      const activeButton = buttons[activeIndex] as HTMLElement | undefined;
      if (!activeButton) return;
      setThumb({ left: activeButton.offsetLeft, width: activeButton.offsetWidth });
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [activeIndex]);

  return (
    <div className="settings-panel__segmented" ref={containerRef}>
      {thumb && (
        <div
          className="settings-panel__segmented-thumb"
          style={{
            transform: `translateX(${thumb.left}px)`,
            width: `${thumb.width}px`,
          }}
          aria-hidden="true"
        />
      )}
      {options.map((option, index) => (
        <button
          key={index}
          type="button"
          className={index === activeIndex ? 'active' : ''}
          onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default SegmentedControl;
