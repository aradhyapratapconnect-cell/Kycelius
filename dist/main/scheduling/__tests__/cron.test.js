"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const cron_1 = require("../cron");
const at = (y, mo, d, h = 0, mi = 0, s = 30) => new Date(y, mo, d, h, mi, s);
const sameMinute = (a, b) => a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() &&
    a.getHours() === b.getHours() &&
    a.getMinutes() === b.getMinutes();
(0, vitest_1.describe)('parseCron', () => {
    (0, vitest_1.it)('accepts a valid 5-field expression and normalizes it', () => {
        const cron = (0, cron_1.parseCron)(' 0 9 * * 1-5 ');
        (0, vitest_1.expect)(cron.expression).toBe('0 9 * * 1-5');
        (0, vitest_1.expect)(cron.minutes.has(0)).toBe(true);
        (0, vitest_1.expect)(cron.hours.has(9)).toBe(true);
        (0, vitest_1.expect)(cron.dayOfMonth.all).toBe(true);
        (0, vitest_1.expect)(cron.months.size).toBe(12);
        (0, vitest_1.expect)(cron.dayOfWeek.values.has(1)).toBe(true);
        (0, vitest_1.expect)(cron.dayOfWeek.all).toBe(false);
    });
    (0, vitest_1.it)('normalizes day 7 to Sunday (0)', () => {
        (0, vitest_1.expect)((0, cron_1.parseCron)('0 0 * * 7').dayOfWeek.values.has(0)).toBe(true);
    });
    (0, vitest_1.it)('rejects wrong field counts', () => {
        ['0 9 * *', ''].forEach(expr => {
            (0, vitest_1.expect)(() => (0, cron_1.parseCron)(expr)).toThrow(cron_1.CronExpressionError);
        });
    });
    (0, vitest_1.it)('rejects out-of-range and malformed fields', () => {
        (0, vitest_1.expect)(() => (0, cron_1.parseCron)('61 * * * *')).toThrow(cron_1.CronExpressionError);
        (0, vitest_1.expect)(() => (0, cron_1.parseCron)('0 0 0 * *')).toThrow(cron_1.CronExpressionError);
        (0, vitest_1.expect)(() => (0, cron_1.parseCron)('0 9 jan * *')).toThrow(cron_1.CronExpressionError);
        (0, vitest_1.expect)(() => (0, cron_1.parseCron)('0 */0 * * *')).toThrow(cron_1.CronExpressionError);
    });
});
(0, vitest_1.describe)('nextFireAt', () => {
    (0, vitest_1.it)('every minute fires on the next minute boundary', () => {
        const from = at(2026, 0, 3, 8, 59, 30);
        (0, vitest_1.expect)(sameMinute((0, cron_1.nextFireAt)('* * * * *', from), at(2026, 0, 3, 9, 0, 0))).toBe(true);
    });
    (0, vitest_1.it)('daily at 09:00 fires today if still ahead, else tomorrow', () => {
        const before = at(2026, 0, 3, 8, 59, 30);
        (0, vitest_1.expect)(sameMinute((0, cron_1.nextFireAt)('0 9 * * *', before), at(2026, 0, 3, 9, 0, 0))).toBe(true);
        const after = at(2026, 0, 3, 9, 0, 30);
        (0, vitest_1.expect)(sameMinute((0, cron_1.nextFireAt)('0 9 * * *', after), at(2026, 0, 4, 9, 0, 0))).toBe(true);
    });
    (0, vitest_1.it)('step syntax "*/15 * * * *"', () => {
        const from = at(2026, 0, 3, 8, 0, 45);
        const next = (0, cron_1.nextFireAt)('*/15 * * * *', from);
        (0, vitest_1.expect)(next.getMinutes()).toBe(15);
        (0, vitest_1.expect)(sameMinute(next, at(2026, 0, 3, 8, 15, 0))).toBe(true);
    });
    (0, vitest_1.it)('hourly at :05', () => {
        const from = at(2026, 0, 3, 8, 59, 30);
        (0, vitest_1.expect)(sameMinute((0, cron_1.nextFireAt)('5 * * * *', from), at(2026, 0, 3, 9, 5, 0))).toBe(true);
    });
    (0, vitest_1.it)('weekday 09:00 skips the weekend', () => {
        // 2026-01-03 is a Saturday; weekdays -> next Monday 2026-01-05.
        const from = at(2026, 0, 3, 8, 59, 30);
        (0, vitest_1.expect)(sameMinute((0, cron_1.nextFireAt)('0 9 * * 1-5', from), at(2026, 0, 5, 9, 0, 0))).toBe(true);
    });
    (0, vitest_1.it)('applies OR semantics when both day-of-month and day-of-week are set', () => {
        // "midnight on the 13th OR any Friday": from a Thursday 2026-01-01,
        // the next Friday (Jan 2) wins.
        const from = at(2026, 0, 1, 0, 0, 30);
        (0, vitest_1.expect)(sameMinute((0, cron_1.nextFireAt)('0 0 13 * 5', from), at(2026, 0, 2, 0, 0, 0))).toBe(true);
    });
    (0, vitest_1.it)('crosses month/year boundaries via hour-only fields', () => {
        const from = at(2025, 11, 31, 23, 59, 30);
        (0, vitest_1.expect)(sameMinute((0, cron_1.nextFireAt)('0 0 * * *', from), at(2026, 0, 1, 0, 0, 0))).toBe(true);
    });
    (0, vitest_1.it)('throws for an unsatisfiable expression (Feb 30)', () => {
        (0, vitest_1.expect)(() => (0, cron_1.nextFireAt)('0 0 30 2 *', at(2026, 0, 1, 0, 0, 0))).toThrow(cron_1.CronExpressionError);
    });
});
(0, vitest_1.describe)('describeCron', () => {
    (0, vitest_1.it)('summarizes common presets', () => {
        (0, vitest_1.expect)((0, cron_1.describeCron)('*/10 * * * *')).toBe('Every 10 minutes');
        (0, vitest_1.expect)((0, cron_1.describeCron)('* * * * *')).toBe('Every minute');
        (0, vitest_1.expect)((0, cron_1.describeCron)('0 9 * * *')).toBe('Every day at 9:00 AM');
        (0, vitest_1.expect)((0, cron_1.describeCron)('0 9 * * 1-5')).toBe('Monday–Friday at 9:00 AM');
    });
    (0, vitest_1.it)('falls back to the raw expression for anything uncommon', () => {
        (0, vitest_1.expect)((0, cron_1.describeCron)('5 8 1 1 *')).toBe('5 8 1 1 *');
        (0, vitest_1.expect)((0, cron_1.describeCron)('not cron')).toBe('not cron');
    });
});
