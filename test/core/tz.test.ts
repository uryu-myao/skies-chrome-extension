import { describe, expect, it } from 'vitest';
import {
  formatHHMM,
  formatRelativeOffset,
  formatUtcOffset,
  localDateKey,
  localMidnightUtcMillis,
  localMinutesOfDay,
  localWeekday,
  offsetMinutes,
  relativeOffsetMinutes,
} from '../../src/core/tz';

describe('offsetMinutes — §10.1 DST boundaries', () => {
  it('US spring-forward 2026-03-08: offset jumps from -300 to -240', () => {
    expect(offsetMinutes('America/New_York', new Date('2026-03-08T06:00:00Z'))).toBe(-300);
    expect(offsetMinutes('America/New_York', new Date('2026-03-08T08:00:00Z'))).toBe(-240);
  });

  it('US fall-back 2026-11-01: offset drops from -240 to -300', () => {
    expect(offsetMinutes('America/New_York', new Date('2026-11-01T05:00:00Z'))).toBe(-240);
    expect(offsetMinutes('America/New_York', new Date('2026-11-01T07:00:00Z'))).toBe(-300);
  });

  it('EU spring-forward 2026-03-29: offset jumps from +60 to +120', () => {
    expect(offsetMinutes('Europe/Berlin', new Date('2026-03-29T00:30:00Z'))).toBe(60);
    expect(offsetMinutes('Europe/Berlin', new Date('2026-03-29T01:30:00Z'))).toBe(120);
  });

  it('Australia spring-forward 2026-10-04 (southern hemisphere, offset increases not decreases)', () => {
    expect(offsetMinutes('Australia/Sydney', new Date('2026-10-03T15:00:00Z'))).toBe(600);
    expect(offsetMinutes('Australia/Sydney', new Date('2026-10-03T17:00:00Z'))).toBe(660);
  });

  it('Tokyo vs Berlin: one-sided transition — Tokyo stays fixed while Berlin changes', () => {
    expect(offsetMinutes('Asia/Tokyo', new Date('2026-03-29T00:30:00Z'))).toBe(540);
    expect(offsetMinutes('Asia/Tokyo', new Date('2026-03-29T01:30:00Z'))).toBe(540);
  });
});

describe('offsetMinutes — §10.2 half/quarter-hour zones', () => {
  const at = new Date('2026-06-15T12:00:00Z');

  it('Asia/Kolkata is +5:30', () => {
    expect(offsetMinutes('Asia/Kolkata', at)).toBe(330);
  });

  it('Asia/Kathmandu is +5:45', () => {
    expect(offsetMinutes('Asia/Kathmandu', at)).toBe(345);
  });

  it('Pacific/Chatham is +12:45 (standard time)', () => {
    expect(offsetMinutes('Pacific/Chatham', at)).toBe(765);
  });

  it('America/St_Johns is a half-hour offset (-2:30 under DST in June)', () => {
    expect(offsetMinutes('America/St_Johns', at)).toBe(-150);
  });
});

describe('offsetMinutes — §10.3 date line', () => {
  it('Kiritimati (+14) and Niue (-11) are 25 hours apart', () => {
    const at = new Date('2026-06-15T12:00:00Z');
    const diff = offsetMinutes('Pacific/Kiritimati', at) - offsetMinutes('Pacific/Niue', at);
    expect(diff).toBe(25 * 60);
  });
});

describe('localMinutesOfDay / localWeekday', () => {
  it('reads local time-of-day independent of the system timezone', () => {
    // 2026-06-15T12:00:00Z is 21:00 in Tokyo (UTC+9)
    expect(localMinutesOfDay('Asia/Tokyo', new Date('2026-06-15T12:00:00Z'))).toBe(21 * 60);
  });

  it('local weekday matches Date.getDay() convention (0=Sun..6=Sat)', () => {
    // 2026-06-15 is a Monday
    expect(localWeekday('UTC', new Date('2026-06-15T12:00:00Z'))).toBe(1);
  });

  it("uses each timezone's own local weekday, not the reference timezone's", () => {
    // Just before UTC midnight on Sunday is already Monday in Tokyo (UTC+9)
    const instant = new Date('2026-06-14T23:30:00Z');
    expect(localWeekday('UTC', instant)).toBe(0); // Sunday
    expect(localWeekday('Asia/Tokyo', instant)).toBe(1); // Monday
  });
});

describe('localMidnightUtcMillis', () => {
  it('finds the UTC instant of local midnight for a zone ahead of UTC', () => {
    // 00:00 JST on 2026-06-15 is 2026-06-14T15:00:00Z
    const millis = localMidnightUtcMillis('Asia/Tokyo', 2026, 6, 15);
    expect(new Date(millis).toISOString()).toBe('2026-06-14T15:00:00.000Z');
  });

  it('finds the UTC instant of local midnight for a zone behind UTC', () => {
    // 00:00 EDT on 2026-06-15 (UTC-4 in June) is 2026-06-15T04:00:00Z
    const millis = localMidnightUtcMillis('America/New_York', 2026, 6, 15);
    expect(new Date(millis).toISOString()).toBe('2026-06-15T04:00:00.000Z');
  });

  it('round-trips through localDateKey', () => {
    const millis = localMidnightUtcMillis('Asia/Kolkata', 2026, 6, 15);
    expect(localDateKey('Asia/Kolkata', new Date(millis))).toBe('2026-06-15');
  });
});

describe('formatHHMM', () => {
  it('formats minutes-of-day as zero-padded HH:MM', () => {
    expect(formatHHMM(0)).toBe('00:00');
    expect(formatHHMM(90)).toBe('01:30');
    expect(formatHHMM(23 * 60 + 59)).toBe('23:59');
  });

  it('wraps values outside [0, 1440)', () => {
    expect(formatHHMM(-30)).toBe('23:30');
    expect(formatHHMM(1440 + 30)).toBe('00:30');
  });
});

describe('relativeOffsetMinutes', () => {
  it('is the entry offset minus the reference offset', () => {
    const at = new Date('2026-06-15T12:00:00Z');
    // New York (UTC-4 in June) is 13h behind Tokyo (UTC+9)
    expect(relativeOffsetMinutes('America/New_York', 'Asia/Tokyo', at)).toBe(-13 * 60);
    expect(relativeOffsetMinutes('Asia/Tokyo', 'America/New_York', at)).toBe(13 * 60);
    expect(relativeOffsetMinutes('Asia/Tokyo', 'Asia/Tokyo', at)).toBe(0);
  });

  it('changes across a one-sided DST switch (§4.2) — Berlin vs Tokyo on 2026-03-29', () => {
    expect(relativeOffsetMinutes('Europe/Berlin', 'Asia/Tokyo', new Date('2026-03-29T00:30:00Z'))).toBe(-8 * 60);
    expect(relativeOffsetMinutes('Europe/Berlin', 'Asia/Tokyo', new Date('2026-03-29T01:30:00Z'))).toBe(-7 * 60);
  });

  it('keeps half/quarter-hour remainders', () => {
    const at = new Date('2026-06-15T12:00:00Z');
    expect(relativeOffsetMinutes('Asia/Kolkata', 'Asia/Tokyo', at)).toBe(-210);
    expect(relativeOffsetMinutes('Asia/Kathmandu', 'UTC', at)).toBe(345);
  });
});

describe('formatRelativeOffset', () => {
  it('writes whole hours with a sign and a real minus sign', () => {
    expect(formatRelativeOffset(-13 * 60)).toBe('−13h');
    expect(formatRelativeOffset(2 * 60)).toBe('+2h');
  });

  it('writes half/quarter hours as H:MM, never as decimals', () => {
    expect(formatRelativeOffset(210)).toBe('+3:30h');
    expect(formatRelativeOffset(345)).toBe('+5:45h');
    expect(formatRelativeOffset(-210)).toBe('−3:30h');
    expect(formatRelativeOffset(-30)).toBe('−0:30h');
  });

  it('writes zero as 0h', () => {
    expect(formatRelativeOffset(0)).toBe('0h');
  });
});

describe('formatUtcOffset', () => {
  it('pads hours and only adds minutes when non-zero', () => {
    expect(formatUtcOffset(540)).toBe('UTC+09');
    expect(formatUtcOffset(-240)).toBe('UTC−04');
    expect(formatUtcOffset(345)).toBe('UTC+05:45');
    expect(formatUtcOffset(-150)).toBe('UTC−02:30');
    expect(formatUtcOffset(14 * 60)).toBe('UTC+14');
  });

  it('writes zero as plain UTC', () => {
    expect(formatUtcOffset(0)).toBe('UTC');
  });
});
