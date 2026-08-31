/**
 * N-05: minimal standard cron (5-field) support for scheduled tasks.
 *
 * Pure text + Date module — no Electron, no filesystem — so it can be unit
 * tested in plain vitest. Field order is the usual cron form:
 *   minute hour day-of-month month day-of-week
 * e.g. "0 9 * * 1-5" = weekdays at 09:00.
 *
 * Supported per-field syntax: stars, plain numbers, ranges (N-M), step
 * syntax (like a range of every 10), and comma-separated lists of those.
 * Day-of-week accepts 0-7 with 7 normalized to Sunday (0). When both
 * day-of-month and day-of-week are restricted cron's standard OR semantics
 * apply; a field left as "*" is treated as unconstrained. Times are local
 * (wall clock), matching how a desktop scheduler behaves.
 */

const MINUTES = { min: 0, max: 59 };
const HOURS = { min: 0, max: 23 };
const DAYS_OF_MONTH = { min: 1, max: 31 };
const MONTHS = { min: 1, max: 12 };
const DAYS_OF_WEEK = { min: 0, max: 7 };

/** Maximum window scanned when searching for a next fire time (6 years). */
const MAX_HORIZON_MS = 366 * 6 * 24 * 60 * 60 * 1000;

export interface CronFieldMatch {
  all: boolean;
  values: Set<number>;
}

export interface CronSchedule {
  expression: string;
  minutes: Set<number>;
  hours: Set<number>;
  dayOfMonth: CronFieldMatch;
  months: Set<number>;
  dayOfWeek: CronFieldMatch;
}

export class CronExpressionError extends Error {
  constructor(message: string, readonly expression: string) {
    super(`Invalid cron expression "${expression}": ${message}`);
    this.name = 'CronExpressionError';
  }
}

function parseField(field: string, min: number, max: number): CronFieldMatch {
  if (!field) throw new Error('field is empty');
  const values = new Set<number>();

  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(.*)\/(\d+)$/);
    const rangeSpec = stepMatch ? stepMatch[1] : part;
    const step = stepMatch ? Number(stepMatch[2]) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad step in "${part}"`);

    let lo: number;
    let hi: number;
    if (rangeSpec === '*') {
      lo = min;
      hi = max;
    } else if (/^\d+$/.test(rangeSpec)) {
      lo = Number(rangeSpec);
      hi = lo;
    } else {
      const range = rangeSpec.match(/^(\d+)-(\d+)$/);
      if (!range) throw new Error(`bad field segment "${part}"`);
      lo = Number(range[1]);
      hi = Number(range[2]);
    }

    if (lo < min || hi > max) {
      throw new Error(`value out of range in "${part}" (allowed ${min}-${max})`);
    }
    if (lo > hi) throw new Error(`reversed range in "${part}"`);

    for (let v = lo; v <= hi; v += step) values.add(v);
  }

  if (max === 7 && values.has(7)) {
    values.delete(7);
    values.add(0); // Sunday.
  }

  // A "*" (or an explicit full range) means "any" for day-of-month/week which
  // changes the OR semantics — record that distinction explicitly.
  const all = values.size >= max - min + 1 || (max === 7 && values.size >= 7);
  return { all, values };
}

export function parseCron(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new CronExpressionError(
      'expected exactly 5 fields: minute hour day-of-month month day-of-week',
      expression
    );
  }
  try {
    const minutes = parseField(fields[0], MINUTES.min, MINUTES.max).values;
    const hours = parseField(fields[1], HOURS.min, HOURS.max).values;
    const dayOfMonth = parseField(fields[2], DAYS_OF_MONTH.min, DAYS_OF_MONTH.max);
    const months = parseField(fields[3], MONTHS.min, MONTHS.max).values;
    const dayOfWeek = parseField(fields[4], DAYS_OF_WEEK.min, DAYS_OF_WEEK.max);
    return {
      expression: fields.join(' '),
      minutes,
      hours,
      dayOfMonth,
      months,
      dayOfWeek,
    };
  } catch (err) {
    if (err instanceof CronExpressionError) throw err;
    throw new CronExpressionError(err instanceof Error ? err.message : String(err), expression);
  }
}

/**
 * The first strict wall-clock minute after `from` that satisfies `expression`.
 * Fire times are computed fresh from the expression on every call, so missed
 * occurrences while the app was closed are skipped rather than replayed.
 */
export function nextFireAt(expression: string, from: Date = new Date()): Date {
  const cron = parseCron(expression);

  // Move past the current minute so a freshly re-armed task (whose fire time
  // is `from`) never instant-fires again.
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const deadline = new Date(from.getTime() + MAX_HORIZON_MS);

  while (cursor.getTime() <= deadline.getTime()) {
    const month = cursor.getMonth() + 1;
    if (!cron.months.has(month)) {
      // Skip to the start of the next month to keep the scan cheap.
      cursor.setDate(1);
      cursor.setHours(0, 0, 0, 0);
      cursor.setMonth(cursor.getMonth() + 1);
      continue;
    }
    if (!cron.hours.has(cursor.getHours())) {
      cursor.setMinutes(0, 0, 0);
      cursor.setHours(cursor.getHours() + 1);
      continue;
    }
    if (!cron.minutes.has(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
      continue;
    }
    if (dayMatches(cron, cursor.getDate(), cursor.getDay())) {
      return new Date(cursor);
    }
    cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
  }

  throw new CronExpressionError(
    'no fire time exists within 6 years — the expression is effectively unsatisfiable',
    expression
  );
}

function dayMatches(cron: CronSchedule, dayOfMonth: number, dayOfWeek: number): boolean {
  const dom = cron.dayOfMonth;
  const dow = cron.dayOfWeek;
  if (dom.all && dow.all) return true;
  if (dom.all) return dow.values.has(dayOfWeek);
  if (dow.all) return dom.values.has(dayOfMonth);
  return dom.values.has(dayOfMonth) || dow.values.has(dayOfWeek);
}

/** Short human summary of common expressions; falls back to the raw text. */
export function describeCron(expression: string): string {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return expression;

  const restIsEveryDay =
    fields[1] === '*' && fields[2] === '*' && fields[3] === '*' && fields[4] === '*';

  if (fields[0].startsWith('*/') && restIsEveryDay) {
    const step = fields[0].slice(2);
    return step === '1' ? 'Every minute' : `Every ${step} minutes`;
  }

  if (fields[0] === '*' && restIsEveryDay) {
    return 'Every minute';
  }

  const fixedMinute = /^\d+$/.test(fields[0]);
  if (fixedMinute && fields[1] === '*' && fields[2] === '*' && fields[3] === '*' && fields[4] === '*') {
    return `Every hour at :${fields[0].padStart(2, '0')}`;
  }

  if (fixedMinute && /^\d+$/.test(fields[1]) && fields[2] === '*' && fields[3] === '*') {
    const time = formatClockTime(fields[1], fields[0]);
    if (fields[4] === '*') return `Every day at ${time}`;
    return `${describeDayOfWeek(fields[4])} at ${time}`;
  }

  return expression.trim();
}

function formatClockTime(hour: string, minute: string): string {
  const h = Number(hour) % 24;
  const m = Number(minute) % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function describeDayOfWeek(field: string): string {
  switch (field) {
    case '1-5':
      return 'Monday–Friday';
    case '0,6':
    case '6,0':
      return 'Weekends';
    case '0':
    case '7':
      return 'Sundays';
    case '1':
      return 'Mondays';
    case '2':
      return 'Tuesdays';
    case '3':
      return 'Wednesdays';
    case '4':
      return 'Thursdays';
    case '5':
      return 'Fridays';
    case '6':
      return 'Saturdays';
    default:
      return field;
  }
}