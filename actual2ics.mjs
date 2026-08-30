#!/usr/bin/env node
// actual2ics — Actual Budget scheduled transactions as a calendar file.
// Read-only against the budget. Nothing is uploaded anywhere.

import * as api from '@actual-app/api';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PRODID = '-//Ildana//actual2ics//EN';
const MAX_OCCURRENCES = 750;

// ---------------------------------------------------------------- arguments

const VALID_EVENT_FORMATS = new Set(['default', 'compact', 'schedule']);
const EVENT_FORMAT_ALIASES = {
  default: 'default',
  compact: 'compact',
  schedule: 'schedule',
  name: 'schedule',
  'schedule-name': 'schedule',
};

function normalizeEventFormat(value) {
  const format = String(value ?? 'default').trim().toLowerCase();
  const normalized = EVENT_FORMAT_ALIASES[format] || format;
  if (!VALID_EVENT_FORMATS.has(normalized)) {
    throw new Error(
      `unknown event format: ${format}; expected one of: ${[...VALID_EVENT_FORMATS].join(', ')}`,
    );
  }
  return normalized;
}

function parseArgs(argv) {
  const opts = {
    months: 6,
    out: 'actual-schedules.ics',
    calendarName: 'Actual — Scheduled',
    includeCompleted: false,
    eventFormat: 'default',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const need = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--months': {
        const n = Number(need());
        if (!Number.isInteger(n) || n < 1 || n > 120) {
          throw new Error('--months must be a whole number from 1 to 120');
        }
        opts.months = n;
        break;
      }
      case '--out':
        opts.out = need();
        break;
      case '--calendar-name':
        opts.calendarName = need();
        break;
      case '--currency':
        opts.currency = need().toUpperCase();
        break;
      case '--event-format':
        opts.eventFormat = normalizeEventFormat(need());
        break;
      case '--include-completed':
        opts.includeCompleted = true;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  return opts;
}

const USAGE = `actual2ics — write Actual Budget's scheduled transactions to an .ics file

  actual2ics [--months 6] [--out actual-schedules.ics]
             [--calendar-name "Actual — Scheduled"] [--currency USD]
             [--event-format default|compact|schedule] [--include-completed]

Event formats:
  default  = Payee and amount is the summary, details include account/schedule/status
  compact  = Payee is the summary, amount on its own line, then account/schedule/status
  schedule = Schedule name is the summary, description includes a separate amount line before account/status

Amounts follow the budget's own currency setting. Actual leaves that unset by
default and shows no symbol; --currency adds one without changing the budget.

Configuration comes from the environment, never from flags or files:

  ACTUAL_URL                  sync server URL          (server mode)
  ACTUAL_PASSWORD             sync server password     (server mode)
  ACTUAL_SYNC_ID              budget's Sync ID         (server mode)
  ACTUAL_ENCRYPTION_PASSWORD  end-to-end encryption password, if the budget uses one
  ACTUAL_BUDGET_ID            local budget id          (local mode, no server)
  ACTUAL_DATA_DIR             where the budget cache lives (default ./.actual-data)
`;

// ------------------------------------------------------------------- dates

const ymd = (d) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;

const parseISO = (s) => new Date(`${s}T00:00:00Z`);

function addDaysUTC(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function addMonthsUTC(date, months) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

// How many occurrences to ask Actual for so the window is certainly covered.
// The engine stops early on its own when the schedule ends, so overshooting is free.
function occurrenceBudget(config, months) {
  const interval = Math.max(1, Number(config.interval) || 1);
  const perWindow = {
    daily: months * 31,
    weekly: months * 5,
    monthly: months + 2,
    yearly: Math.ceil(months / 12) + 1,
  }[config.frequency];
  if (perWindow === undefined) return null;
  return Math.min(MAX_OCCURRENCES, Math.max(1, Math.ceil(perWindow / interval) + 2));
}

// ------------------------------------------------------------------ amounts

function makeAmountFormatter(currencyCode) {
  if (currencyCode) {
    try {
      const fmt = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
      });
      return (cents) => fmt.format(cents / 100);
    } catch {
      // Unknown currency code in the budget's prefs — fall through to plain digits.
    }
  }
  const fmt = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (cents) => fmt.format(cents / 100);
}

// A schedule's amount is integer cents, or a {num1, num2} range for "is between".
function describeAmount(amount, format) {
  if (amount == null) return '';
  if (typeof amount === 'object') {
    const [lo, hi] = [Number(amount.num1), Number(amount.num2)].sort((a, b) => a - b);
    return `${format(lo)}–${format(hi)}`;
  }
  return format(Number(amount));
}

function buildEventDetails({
  payee,
  account,
  amount,
  scheduleName,
  postsAutomatically,
  eventFormat = 'default',
}) {
  const format = normalizeEventFormat(eventFormat);
  if (format === 'compact') {
    const detail = [];
    if (amount) detail.push(`Amount: ${amount}`);
    detail.push(`Account: ${account}`);
    if (scheduleName) detail.push(`Schedule: ${scheduleName}`);
    if (postsAutomatically) detail.push('Posts automatically');
    return {
      summary: payee,
      description: detail.join('\n'),
    };
  }

  if (format === 'schedule') {
    const detail = [];
    if (payee) detail.push(`Description: ${payee}`);
    if (amount) detail.push(`Amount: ${amount}`);
    detail.push(`Account: ${account}`);
    if (postsAutomatically) detail.push('Posts automatically');
    return {
      summary: scheduleName || payee,
      description: detail.join('\n'),
    };
  }

  const summary = amount ? `${payee} ${amount}` : payee;
  const detail = [`Account: ${account}`];
  if (scheduleName) detail.push(`Schedule: ${scheduleName}`);
  if (postsAutomatically) detail.push('Posts automatically');
  return {
    summary,
    description: detail.join('\n'),
  };
}

// ---------------------------------------------------------------------- ics

const escapeText = (s) =>
  String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

// RFC 5545 folds at 75 octets, and the count is bytes, not characters.
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a multi-byte character across the fold.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines carry a leading space
  }
  return parts.join('\r\n ');
}

function buildCalendar({ name, events, stamp }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
  ];
  for (const ev of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(ev.date)}`,
      `DTEND;VALUE=DATE:${ymd(addDaysUTC(ev.date, 1))}`,
      `SUMMARY:${escapeText(ev.summary)}`,
      `DESCRIPTION:${escapeText(ev.description)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------ budget

function connectionFromEnv(env) {
  const dataDir = resolve(env.ACTUAL_DATA_DIR || './.actual-data');
  const { ACTUAL_URL, ACTUAL_PASSWORD, ACTUAL_SYNC_ID, ACTUAL_BUDGET_ID } = env;

  if (ACTUAL_URL || ACTUAL_SYNC_ID) {
    const missing = [
      ['ACTUAL_URL', ACTUAL_URL],
      ['ACTUAL_PASSWORD', ACTUAL_PASSWORD],
      ['ACTUAL_SYNC_ID', ACTUAL_SYNC_ID],
    ]
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length) {
      throw new Error(`server mode needs ${missing.join(', ')}`);
    }
    return { mode: 'server', dataDir };
  }
  if (ACTUAL_BUDGET_ID) return { mode: 'local', dataDir };
  throw new Error(
    'no budget configured — set ACTUAL_URL, ACTUAL_PASSWORD and ACTUAL_SYNC_ID, ' +
      'or ACTUAL_BUDGET_ID for a budget already on this machine',
  );
}

async function openBudget(conn, env) {
  mkdirSync(conn.dataDir, { recursive: true });
  const lib =
    conn.mode === 'server'
      ? await api.init({
          dataDir: conn.dataDir,
          serverURL: env.ACTUAL_URL,
          password: env.ACTUAL_PASSWORD,
        })
      : await api.init({ dataDir: conn.dataDir });

  if (conn.mode === 'server') {
    await api.downloadBudget(env.ACTUAL_SYNC_ID, {
      password: env.ACTUAL_ENCRYPTION_PASSWORD,
    });
  } else {
    await api.loadBudget(env.ACTUAL_BUDGET_ID);
  }
  return lib;
}

// ------------------------------------------------------------------ collect

export async function collectEvents({
  lib,
  months,
  includeCompleted,
  currency,
  eventFormat = 'default',
  today = new Date(),
}) {
  const [schedules, accounts, payees, prefs] = await Promise.all([
    api.getSchedules(),
    api.getAccounts(),
    api.getPayees(),
    api.getPreferences().catch(() => ({})),
  ]);

  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const payeeName = new Map(payees.map((p) => [p.id, p.name]));
  const format = makeAmountFormatter(currency || prefs?.defaultCurrencyCode);

  const windowStart = parseISO(today.toISOString().slice(0, 10));
  const windowEnd = addMonthsUTC(windowStart, months);

  const events = [];
  const skipped = [];

  for (const schedule of schedules) {
    if (schedule.completed && !includeCompleted) continue;

    let dates;
    if (typeof schedule.date === 'string') {
      // One-time schedule. Actual's expansion handler only accepts a recurrence
      // config, so the single date is used directly.
      dates = [schedule.date];
    } else if (schedule.date && typeof schedule.date === 'object') {
      const count = occurrenceBudget(schedule.date, months);
      if (count === null) {
        skipped.push(`${schedule.name || schedule.id}: unrecognised frequency`);
        continue;
      }
      try {
        dates = await lib.send('schedule/get-upcoming-dates', {
          config: schedule.date,
          count,
        });
      } catch (err) {
        skipped.push(`${schedule.name || schedule.id}: ${err.message}`);
        continue;
      }
    } else {
      skipped.push(`${schedule.name || schedule.id}: no date`);
      continue;
    }

    const payee = payeeName.get(schedule.payee) || 'Unknown payee';
    const account = accountName.get(schedule.account) || 'Unknown account';
    const amount = describeAmount(schedule.amount, format);
    const { summary, description } = buildEventDetails({
      payee,
      account,
      amount,
      scheduleName: schedule.name,
      postsAutomatically: !!schedule.posts_transaction,
      eventFormat,
    });

    for (const iso of dates) {
      const date = parseISO(iso);
      if (date < windowStart || date >= windowEnd) continue;
      events.push({
        uid: `${schedule.id}-${iso.replace(/-/g, '')}@actual2ics`,
        date,
        summary,
        description,
      });
    }
  }

  events.sort((a, b) => a.date - b.date || a.uid.localeCompare(b.uid));
  return { events, skipped, scheduleCount: schedules.length };
}

// --------------------------------------------------------------------- main

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }

  let conn;
  try {
    conn = connectionFromEnv(process.env);
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  const lib = await openBudget(conn, process.env);
  try {
    const { events, skipped, scheduleCount } = await collectEvents({
      lib,
      months: opts.months,
      includeCompleted: opts.includeCompleted,
      currency: opts.currency,
      eventFormat: opts.eventFormat,
    });

    const ics = buildCalendar({
      name: opts.calendarName,
      events,
      stamp: `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    });
    const outPath = resolve(opts.out);
    await writeFile(outPath, ics, 'utf8');

    process.stdout.write(
      `${events.length} event${events.length === 1 ? '' : 's'} from ${scheduleCount} ` +
        `schedule${scheduleCount === 1 ? '' : 's'} over ${opts.months} month` +
        `${opts.months === 1 ? '' : 's'} → ${outPath}\n`,
    );
    for (const note of skipped) process.stderr.write(`skipped ${note}\n`);
  } finally {
    await api.shutdown();
  }
}

// Exported for the tests; main only runs when this file is the entry point.
export {
  parseArgs,
  occurrenceBudget,
  describeAmount,
  makeAmountFormatter,
  buildEventDetails,
  fold,
  escapeText,
  buildCalendar,
  addMonthsUTC,
  ymd,
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`${err.stack || err}\n`);
    process.exitCode = 1;
  });
}
