<p align="center">
  <a href="https://ildana.ai">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/ildana-lockup-white-512.png">
      <img src=".github/assets/ildana-lockup-black-512.png" alt="Ildana — Augmented Intelligence" width="260">
    </picture>
  </a>
</p>

# Actual → Calendar

Put [Actual Budget](https://actualbudget.org)'s scheduled transactions on your
calendar. `actual2ics` reads your schedules and writes a standard `.ics` file
that Apple Calendar, Google Calendar, Proton Calendar, Outlook, or anything else
will import or subscribe to.

Your rent, your car payment, your paycheck — on the same calendar as everything
else you plan around.

It reads your budget and never writes to it. Nothing is uploaded anywhere; the
file lands on your own disk.

## Install

Needs [Node](https://nodejs.org) 20 or newer.

```bash
npm install -g actual2ics
```

Or clone this repository and run `npm install` inside it.

## Point it at your budget

Everything comes from environment variables, so no password ever sits in a
command you typed or a file you might commit.

**If you run an Actual sync server** (most people):

```bash
export ACTUAL_URL=https://actual.example.com
export ACTUAL_PASSWORD='your server password'
export ACTUAL_SYNC_ID=your-budgets-sync-id
```

`ACTUAL_SYNC_ID` is the Sync ID Actual assigns your budget — the same value the
[official API](https://actualbudget.org/docs/api/) uses to download it. If the
budget is end-to-end encrypted, add its encryption password too:

```bash
export ACTUAL_ENCRYPTION_PASSWORD='your encryption password'
```

**If you have no server** and the budget already lives on this machine, name it
instead:

```bash
export ACTUAL_BUDGET_ID=my-budget-a1b2c3d
export ACTUAL_DATA_DIR=~/Library/Application\ Support/Actual
```

## Run it

```bash
actual2ics
```

That writes `actual-schedules.ics` in the current folder, covering the next six
months. Pick your own window and destination:

```bash
actual2ics --months 12 --out ~/Calendars/money.ics
```

Every scheduled transaction becomes an all-day event on the day it is due:

```
Rent Co -$1,200.00
  Account: Checking
  Schedule: Rent
  Posts automatically
```

## Get it onto your calendar

**Once:** double-click the `.ics` file, or use your calendar app's Import.

**Always current:** write the file somewhere your calendar app subscribes to,
and regenerate it on a schedule. A daily cron line is the whole trick:

```bash
0 6 * * * /usr/local/bin/actual2ics --months 6 --out /srv/calendars/money.ics
```

Re-running overwrites the file. Each event's identity is fixed by its schedule
and its date, so a re-import updates the events you already have instead of
piling up duplicates.

## Command line

| Option | Default | What it does |
|---|---|---|
| `--months N` | `6` | How far ahead to project, 1 to 120 |
| `--out PATH` | `actual-schedules.ics` | Where to write the file |
| `--calendar-name NAME` | `Actual — Scheduled` | The name your calendar app shows |
| `--currency CODE` | budget's setting | Adds a currency symbol, e.g. `USD`, `EUR`, `CAD` |
| `--event-format MODE` | `default` | Changes the event summary/description style. `default` keeps the payee and amount in the summary; `compact` uses the payee as the summary and puts the amount on its own line in the details; `schedule` uses the schedule name as the event title, and puts the payee and the amount on separate lines in the details |
| `--remind SPAN` | none | Add a reminder, e.g. `30m`, `2h`, `1d`. Repeat for more than one |
| `--exclude-account NAME` | none | Leave an account out. Repeat for more than one |
| `--include-completed` | off | Also emit schedules Actual has marked completed |
| `--help` | | Print usage |

### Reminders

`--remind` puts an alert on every event, and you can ask for more than one:

```bash
actual2ics --remind 1d --remind 2h
```

Say it the way you'd say it out loud — `30m`, `2h`, `1d`.

One thing to know: these are all-day events, so the countdown runs from the start
of the day the money moves. Calendar apps disagree about what "2 hours before an
all-day event" means, so check where the first alert lands and adjust to taste.

### Leaving accounts out

Not every account belongs on a calendar. A tracking account that amortises
prepaid expenses posts on schedule but is nothing you plan your week around:

```bash
actual2ics --exclude-account "Prepaid Amortization"
```

Repeat the flag for more than one account. Match is on the account name exactly
as Actual shows it, ignoring capitals. A name that matches no account stops the
run rather than quietly excluding nothing — a typo you can't see is worse than an
error you can. When the flag is used, the summary line says how much it dropped.

### About amounts

Amounts come straight from the budget as whole cents, so nothing is rounded on
the way out. Actual leaves a budget's currency unset by default and shows no
symbol; `--currency USD` adds one for the calendar without touching the budget.

Schedules with an amount *range* rather than a fixed figure show the range —
`Employer $3,000.00–$3,200.00`.

### About recurrence

Repeating dates are worked out by Actual's own scheduling engine, not
reimplemented here, so "third Friday of the month, moved off weekends, ending
after nine payments" lands on exactly the days Actual shows you.

Each occurrence is written out as its own dated event rather than as a calendar
recurrence rule. It makes for a slightly bigger file and a calendar that is
always right.

## What it will not do

- It never writes to your budget. Read-only, by construction.
- It does not host or serve the file. It writes a file; cron and your own
  storage do the rest.
- It does not touch the network except to reach the sync server you named.

## Development

```bash
npm install
npm test
```

The tests cover argument handling, amount formatting, RFC 5545 escaping and
line folding, and calendar structure — no budget or server required.

## License

MIT. See [LICENSE](LICENSE).

Not affiliated with Actual Budget. Built by [Ildana](https://ildana.ai).
