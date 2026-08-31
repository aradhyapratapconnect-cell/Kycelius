import { describe, expect, it } from 'vitest';
import {
  parseCron,
  nextFireAt,
  describeCron,
  CronExpressionError,
} from '../cron';

const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 30): Date =>
  new Date(y, mo, d, h, mi, s);

const sameMinute = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate() &&
  a.getHours() === b.getHours() &&
  a.getMinutes() === b.getMinutes();

describe('parseCron', () => {
  it('accepts a valid 5-field expression and normalizes it', () => {
    const cron = parseCron(' 0 9 * * 1-5 ');
    expect(cron.expression).toBe('0 9 * * 1-5');
    expect(cron.minutes.has(0)).toBe(true);
    expect(cron.hours.has(9)).toBe(true);
    expect(cron.dayOfMonth.all).toBe(true);
    expect(cron.months.size).toBe(12);
    expect(cron.dayOfWeek.values.has(1)).toBe(true);
    expect(cron.dayOfWeek.all).toBe(false);
  });

  it('normalizes day 7 to Sunday (0)', () => {
    expect(parseCron('0 0 * * 7').dayOfWeek.values.has(0)).toBe(true);
  });

  it('rejects wrong field counts', () => {
    [('0 9 * *' as string), ''] .forEach(expr => {
      expect(() => parseCron(expr)).toThrow(CronExpressionError);
    });
  });

  it('rejects out-of-range and malformed fields', () => {
    expect(() => parseCron('61 * * * *')).toThrow(CronExpressionError);
    expect(() => parseCron('0 0 0 * *')).toThrow(CronExpressionError);
    expect(() => parseCron('0 9 jan * *')).toThrow(CronExpressionError);
    expect(() => parseCron('0 */0 * * *')).toThrow(CronExpressionError);
  });
});

describe('nextFireAt', () => {
  it('every minute fires on the next minute boundary', () => {
    const from = at(2026, 0, 3, 8, 59, 30);
    expect(sameMinute(nextFireAt('* * * * *', from), at(2026, 0, 3, 9, 0, 0))).toBe(true);
  });

  it('daily at 09:00 fires today if still ahead, else tomorrow', () => {
    const before = at(2026, 0, 3, 8, 59, 30);
    expect(sameMinute(nextFireAt('0 9 * * *', before), at(2026, 0, 3, 9, 0, 0))).toBe(true);

    const after = at(2026, 0, 3, 9, 0, 30);
    expect(sameMinute(nextFireAt('0 9 * * *', after), at(2026, 0, 4, 9, 0, 0))).toBe(true);
  });

  it('step syntax "*/15 * * * *"', () => {
    const from = at(2026, 0, 3, 8, 0, 45);
    const next = nextFireAt('*/15 * * * *', from);
    expect(next.getMinutes()).toBe(15);
    expect(sameMinute(next, at(2026, 0, 3, 8, 15, 0))).toBe(true);
  });

  it('hourly at :05', () => {
    const from = at(2026, 0, 3, 8, 59, 30);
    expect(sameMinute(nextFireAt('5 * * * *', from), at(2026, 0, 3, 9, 5, 0))).toBe(true);
  });

  it('weekday 09:00 skips the weekend', () => {
    // 2026-01-03 is a Saturday; weekdays -> next Monday 2026-01-05.
    const from = at(2026, 0, 3, 8, 59, 30);
    expect(sameMinute(nextFireAt('0 9 * * 1-5', from), at(2026, 0, 5, 9, 0, 0))).toBe(true);
  });

  it('applies OR semantics when both day-of-month and day-of-week are set', () => {
    // "midnight on the 13th OR any Friday": from a Thursday 2026-01-01,
    // the next Friday (Jan 2) wins.
    const from = at(2026, 0, 1, 0, 0, 30);
    expect(sameMinute(nextFireAt('0 0 13 * 5', from), at(2026, 0, 2, 0, 0, 0))).toBe(true);
  });

  it('crosses month/year boundaries via hour-only fields', () => {
    const from = at(2025, 11, 31, 23, 59, 30);
    expect(sameMinute(nextFireAt('0 0 * * *', from), at(2026, 0, 1, 0, 0, 0))).toBe(true);
  });

  it('throws for an unsatisfiable expression (Feb 30)', () => {
    expect(() => nextFireAt('0 0 30 2 *', at(2026, 0, 1, 0, 0, 0))).toThrow(CronExpressionError);
  });
});

describe('describeCron', () => {
  it('summarizes common presets', () => {
    expect(describeCron('*/10 * * * *')).toBe('Every 10 minutes');
    expect(describeCron('* * * * *')).toBe('Every minute');
    expect(describeCron('0 9 * * *')).toBe('Every day at 9:00 AM');
    expect(describeCron('0 9 * * 1-5')).toBe('Monday–Friday at 9:00 AM');
  });

  it('falls back to the raw expression for anything uncommon', () => {
    expect(describeCron('5 8 1 1 *')).toBe('5 8 1 1 *');
    expect(describeCron('not cron')).toBe('not cron');
  });
});