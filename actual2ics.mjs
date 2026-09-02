#!/usr/bin/env node
// actual2ics — Actual Budget scheduled transactions as a calendar file.
// Read-only against the budget. Nothing is uploaded anywhere.

import * as api from '@actual-app/api';
import { mkdirSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function normalizeReminder(value) {
  const reminder = String(value ?? '').trim().toLowerCase();
  const match = /^([1-9]\d*)([mhd])$/.exec(reminder);
  if (!match || Number(match[1]) > 999) {
    throw new Error('--reminder must use one of the forms 15m, 5h, or 1d, up to 999');
  }
  return reminder;
}

function reminderToTrigger(value) {
  const reminder = normalizeReminder(value);
  const amount = Number(reminder.slice(0, -1));
  const unit = reminder.at(-1);
  switch (unit) {
    case 'm':
      return `-PT${amount}M`;
    case 'h':
      return `-PT${amount}H`;
    case 'd':
      return `-P${amount}D`;
    default:
      throw new Error(`unsupported reminder unit: ${unit}`);
  }
}

// Minutes past midnight, so a time can be added to a date without a timezone.
function parseAtTime(value) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? '').trim());
  if (!match) throw new Error('--at takes a 24-hour time, e.g. 09:00 or 17:30');
  return Number(match[1]) * 60 + Number(match[2]);
}

// Names come from the user; ids are what the schedules carry. A name that matches
// nothing is a typo, and a typo must not quietly filter nothing.
function resolveNames(names, records, label) {
  const byName = new Map();
  for (const record of records) {
    const key = String(record.name ?? '').trim().toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(record.id);
  }
  const ids = new Set();
  for (const name of names) {
    const hits = byName.get(String(name).trim().toLowerCase());
    if (!hits) {
      const err = new Error(`unknown ${label}: ${name}`);
      err.userError = true; // a typo, not a crash — main reports it like a bad flag
      throw err;
    }
    for (const id of hits) ids.add(id);
  }
  return ids;
}

export function resolveExcludes(names, accounts) {
  return resolveNames(names, accounts, 'account');
}

export function resolveSchedules(names, schedules) {
  return resolveNames(names, schedules, 'schedule');
}

function parseArgs(argv) {
  const opts = {
    months: 6,
    out: 'actual-schedules.ics',
    calendarName: 'Actual — Scheduled',
    includeCompleted: false,
    eventFormat: 'default',
    reminders: [],
    at: null,
    excludeAccounts: [],
    onlyAccounts: [],
    excludeSchedules: [],
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
      case '--reminder': {
        const reminder = normalizeReminder(need());
        if (!opts.reminders.includes(reminder)) opts.reminders.push(reminder);
        break;
      }
      case '--at':
        opts.at = parseAtTime(need());
        break;
      case '--exclude-account':
        opts.excludeAccounts.push(need());
        break;
      case '--only-account':
        opts.onlyAccounts.push(need());
        break;
      case '--exclude-schedule':
        opts.excludeSchedules.push(need());
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
  if (opts.excludeAccounts.length && opts.onlyAccounts.length) {
    throw new Error('use --exclude-account or --only-account, not both');
  }
  return opts;
}

const USAGE = `actual2ics — write Actual Budget's scheduled transactions to an .ics file

  actual2ics [--months 6] [--out actual-schedules.ics]
             [--calendar-name "Actual — Scheduled"] [--currency USD]
             [--event-format default|compact|schedule] [--reminder 15m]
             [--at 09:00] [--exclude-account "Name"] [--only-account "Name"]
             [--exclude-schedule "Name"] [--include-completed]

Event formats:
  default  = Payee and amount is the summary, details include account/schedule/status
  compact  = Payee is the summary, amount on its own line, then account/schedule/status
  schedule = Schedule name is the summary, description includes a separate amount line before account/status

Reminder values use the form 15m, 15h, or 1d, up to 999, and add a VALARM trigger
before the event. Repeat --reminder for more than one alert.

Events are all-day unless --at gives them a time, so a reminder counts back from the
start of the day and calendar apps differ on when it fires. --at 09:00 makes the
event an hour long at that local time, which makes the reminder exact.

--exclude-account, --only-account and --exclude-schedule filter what reaches the
calendar. All three repeat; matching is on the name Actual shows, ignoring case; a
name that matches nothing is an error rather than a silent no-op. --exclude-account
and --only-account cannot be used together.

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

// A local wall-clock stamp with no zone and no Z: every calendar app reads it in
// its own timezone, which is what someone paying a bill at 09:00 means. Minutes
// past midnight can push past 24h, so the date rolls over with it.
function floating(date, minutes) {
  const d = new Date(date.getTime() + minutes * 60000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${ymd(d)}T${hh}${mm}00`;
}

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

function buildCalendar({ name, events, stamp, at = null }) {
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
      // Without --at these are whole days; with it they are floating local times,
      // which is what makes a relative reminder land at a predictable hour.
      ...(at === null
        ? [
            `DTSTART;VALUE=DATE:${ymd(ev.date)}`,
            `DTEND;VALUE=DATE:${ymd(addDaysUTC(ev.date, 1))}`,
          ]
        : [
            `DTSTART:${floating(ev.date, at)}`,
            `DTEND:${floating(ev.date, at + 60)}`,
          ]),
      `SUMMARY:${escapeText(ev.summary)}`,
      `DESCRIPTION:${escapeText(ev.description)}`,
      'TRANSP:TRANSPARENT',
    );
    for (const reminder of ev.reminders ?? []) {
      // ACTION:DISPLAY requires a DESCRIPTION; the event's own summary is what a
      // person wants to read on the alert, not the word "Reminder".
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(ev.summary)}`,
        `TRIGGER:${reminderToTrigger(reminder)}`,
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
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
  reminders = [],
  excludeAccounts = [],
  onlyAccounts = [],
  excludeSchedules = [],
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

  // Both account flags resolve through the same path, so a typo is caught either
  // way; parseArgs has already refused the two of them together.
  const excludedIds = resolveExcludes(excludeAccounts, accounts);
  const keptIds = resolveExcludes(onlyAccounts, accounts);
  const excludedScheduleIds = resolveSchedules(excludeSchedules, schedules);

  const events = [];
  const skipped = [];
  let droppedByAccount = 0;
  let droppedBySchedule = 0;
  const droppedAccountIds = new Set();

  for (const schedule of schedules) {
    if (schedule.completed && !includeCompleted) continue;

    const outOfScope = schedule.account
      ? excludedIds.has(schedule.account) ||
        (onlyAccounts.length > 0 && !keptIds.has(schedule.account))
      : onlyAccounts.length > 0; // an account-less schedule is not on the whitelist
    if (outOfScope) {
      droppedByAccount++;
      if (schedule.account) droppedAccountIds.add(schedule.account);
      continue;
    }
    if (excludedScheduleIds.has(schedule.id)) {
      droppedBySchedule++;
      continue;
    }

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
        ...(reminders.length ? { reminders } : {}),
      });
    }
  }

  events.sort((a, b) => a.date - b.date || a.uid.localeCompare(b.uid));
  return {
    events,
    skipped,
    scheduleCount: schedules.length,
    droppedByAccount,
    droppedBySchedule,
    droppedAccounts: droppedAccountIds.size,
  };
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
    const {
      events,
      skipped,
      scheduleCount,
      droppedByAccount,
      droppedBySchedule,
      droppedAccounts,
    } = await collectEvents({
      lib,
      months: opts.months,
      includeCompleted: opts.includeCompleted,
      currency: opts.currency,
      eventFormat: opts.eventFormat,
      reminders: opts.reminders,
      excludeAccounts: opts.excludeAccounts,
      onlyAccounts: opts.onlyAccounts,
      excludeSchedules: opts.excludeSchedules,
    });

    const ics = buildCalendar({
      name: opts.calendarName,
      events,
      stamp: `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      at: opts.at,
    });
    const outPath = resolve(opts.out);
    await writeFile(outPath, ics, 'utf8');

    // A filter that quietly stops matching is worse than one that reports zero.
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const notes = [];
    if (opts.excludeAccounts.length || opts.onlyAccounts.length) {
      notes.push(
        `dropped ${plural(droppedByAccount, 'schedule')} in ` +
          `${plural(droppedAccounts, 'account')}`,
      );
    }
    if (opts.excludeSchedules.length) {
      notes.push(`dropped ${plural(droppedBySchedule, 'schedule')} by name`);
    }
    process.stdout.write(
      `${plural(events.length, 'event')} from ${plural(scheduleCount, 'schedule')} ` +
        `over ${plural(opts.months, 'month')}` +
        `${notes.length ? `, ${notes.join(', ')}` : ''} → ${outPath}\n`,
    );
    for (const note of skipped) process.stderr.write(`skipped ${note}\n`);
  } finally {
    await api.shutdown();
  }
}

// Exported for the tests; main only runs when this file is the entry point.
export {
  parseArgs,
  normalizeReminder,
  reminderToTrigger,
  parseAtTime,
  occurrenceBudget,
  describeAmount,
  makeAmountFormatter,
  buildEventDetails,
  fold,
  escapeText,
  floating,
  buildCalendar,
  addMonthsUTC,
  ymd,
};

// Compare real paths so the guard also passes through the symlink `npm install -g` creates.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    if (err?.userError) {
      process.stderr.write(`${err.message}\n`);
      process.exitCode = 2;
      return;
    }
    process.stderr.write(`${err.stack || err}\n`);
    process.exitCode = 1;
  });
}
