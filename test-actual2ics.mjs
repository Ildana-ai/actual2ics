import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseArgs,
  occurrenceBudget,
  describeAmount,
  makeAmountFormatter,
  fold,
  escapeText,
  buildCalendar,
  addMonthsUTC,
  ymd,
  buildEventDetails,
} from './actual2ics.mjs';

test('defaults', () => {
  const o = parseArgs([]);
  assert.equal(o.months, 6);
  assert.equal(o.out, 'actual-schedules.ics');
  assert.equal(o.includeCompleted, false);
});

test('flags parse', () => {
  const o = parseArgs(['--months', '12', '--out', 'x.ics', '--include-completed', '--event-format', 'compact']);
  assert.equal(o.months, 12);
  assert.equal(o.out, 'x.ics');
  assert.equal(o.includeCompleted, true);
  assert.equal(o.eventFormat, 'compact');
});

test('event format styles change the generated summary and description', () => {
  const defaultEv = buildEventDetails({
    payee: 'Rent Co',
    account: 'Checking',
    amount: '$1,200.00',
    scheduleName: 'Rent',
    postsAutomatically: true,
    eventFormat: 'default',
  });
  const compactEv = buildEventDetails({
    payee: 'Rent Co',
    account: 'Checking',
    amount: '$1,200.00',
    scheduleName: 'Rent',
    postsAutomatically: true,
    eventFormat: 'compact',
  });
  const scheduleEv = buildEventDetails({
    payee: 'Rent Co',
    account: 'Checking',
    amount: '$1,200.00',
    scheduleName: 'Rent',
    postsAutomatically: true,
    eventFormat: 'schedule',
  });

  assert.equal(defaultEv.summary, 'Rent Co $1,200.00');
  assert.equal(defaultEv.description, 'Account: Checking\nSchedule: Rent\nPosts automatically');
  assert.equal(compactEv.summary, 'Rent Co');
  assert.equal(compactEv.description, 'Amount: $1,200.00\nAccount: Checking\nSchedule: Rent\nPosts automatically');
  assert.equal(scheduleEv.summary, 'Rent');
  assert.equal(scheduleEv.description, 'Description: Rent Co\nAmount: $1,200.00\nAccount: Checking\nPosts automatically');
  assert.throws(() => buildEventDetails({ eventFormat: 'unknown' }), /unknown event format/i);
});

test('bad months are refused, not coerced', () => {
  for (const bad of ['0', '-1', '3.5', 'six', '121']) {
    assert.throws(() => parseArgs(['--months', bad]), /--months/);
  }
  assert.throws(() => parseArgs(['--months']), /needs a value/);
  assert.throws(() => parseArgs(['--nope']), /unknown option/);
});

test('occurrence budget covers the window for every frequency', () => {
  assert.ok(occurrenceBudget({ frequency: 'monthly', interval: 1 }, 6) >= 6);
  assert.ok(occurrenceBudget({ frequency: 'weekly', interval: 1 }, 6) >= 26);
  assert.ok(occurrenceBudget({ frequency: 'daily', interval: 1 }, 6) >= 184);
  assert.ok(occurrenceBudget({ frequency: 'yearly', interval: 1 }, 24) >= 2);
  assert.equal(occurrenceBudget({ frequency: 'hourly', interval: 1 }, 6), null);
});

test('occurrence budget stays within the cap and never asks for zero', () => {
  assert.ok(occurrenceBudget({ frequency: 'daily', interval: 1 }, 120) <= 750);
  assert.ok(occurrenceBudget({ frequency: 'yearly', interval: 50 }, 1) >= 1);
});

test('amounts come from integer cents', () => {
  const usd = makeAmountFormatter('USD');
  assert.equal(describeAmount(-120000, usd), '-$1,200.00');
  assert.equal(describeAmount(0, usd), '$0.00');
  assert.equal(describeAmount({ num1: 5000, num2: 2500 }, usd), '$25.00–$50.00');
  assert.equal(describeAmount(null, usd), '');
});

test('an unknown currency code degrades to plain digits instead of throwing', () => {
  const fmt = makeAmountFormatter('NOTACURRENCY');
  assert.equal(describeAmount(-120000, fmt), '-1,200.00');
});

test('text escaping follows RFC 5545', () => {
  assert.equal(escapeText('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne');
});

test('folding respects the 75-octet limit and keeps characters whole', () => {
  const folded = fold('SUMMARY:' + 'é'.repeat(60));
  for (const line of folded.split('\r\n')) {
    assert.ok(Buffer.from(line, 'utf8').length <= 75, `line too long: ${line.length}`);
  }
  assert.equal(folded.split('\r\n').slice(1).every((l) => l.startsWith(' ')), true);
  assert.equal(folded.replace(/\r\n /g, ''), 'SUMMARY:' + 'é'.repeat(60));
});

test('short lines are left alone', () => {
  assert.equal(fold('VERSION:2.0'), 'VERSION:2.0');
});

test('calendar is well formed and all-day', () => {
  const ics = buildCalendar({
    name: 'Test',
    stamp: '20260829T000000Z',
    events: [
      {
        uid: 'abc-20260901@actual2ics',
        date: new Date('2026-09-01T00:00:00Z'),
        summary: 'Rent Co -$1,200.00',
        description: 'Account: Checking',
      },
    ],
  });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20260901'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20260902'));
  assert.ok(ics.includes('UID:abc-20260901@actual2ics'));
  assert.ok(!/\r\n\r\n/.test(ics), 'no blank lines');
});

test('the same schedule and date always produce the same UID', () => {
  const ev = { uid: 's1-20260901@actual2ics', date: new Date('2026-09-01T00:00:00Z'), summary: 'x', description: 'y' };
  const a = buildCalendar({ name: 'T', stamp: '20260829T000000Z', events: [ev] });
  const b = buildCalendar({ name: 'T', stamp: '20260829T000000Z', events: [ev] });
  assert.equal(a, b);
});

test('month arithmetic clamps to the end of short months', () => {
  assert.equal(ymd(addMonthsUTC(new Date('2026-01-31T00:00:00Z'), 1)), '20260228');
  assert.equal(ymd(addMonthsUTC(new Date('2026-08-29T00:00:00Z'), 6)), '20270228');
  assert.equal(ymd(addMonthsUTC(new Date('2026-12-15T00:00:00Z'), 1)), '20270115');
});

test('--currency overrides a budget with no currency preference', () => {
  const o = parseArgs(['--currency', 'gbp']);
  assert.equal(o.currency, 'GBP');
  assert.equal(describeAmount(-120000, makeAmountFormatter(o.currency)), '-£1,200.00');
});
