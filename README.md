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
git clone https://github.com/Ildana-ai/actual2ics.git
cd actual2ics
npm install
npm install -g .
```

The last line puts an `actual2ics` command on your PATH. Skip it and run
`node actual2ics.mjs` from the clone instead if you prefer; every example below
works either way.

## Point it at your budget

Everything comes from environment variables, so the password is never part of
the `actual2ics` command line and never lands in a file in this repository. If
your shell keeps history, put a space before the `export` line or set the
variables in a file you `source`, so the password stays out of the history too.

**If you run an Actual sync server** (most people):

```bash
export ACTUAL_URL=https://actual.example.com
export ACTUAL_PASSWORD='your server password'
export ACTUAL_SYNC_ID=your-budgets-sync-id
```

`ACTUAL_SYNC_ID` is the Sync ID Actual assigns your budget — the same value the
[official API](https://actualbudget.org/docs/api/) uses to download it. The
API keeps a local copy of the budget while it works; by default that goes in
`.actual-data` inside the folder you run from. Set `ACTUAL_DATA_DIR` to put it
somewhere deliberate. If the
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

Add a calendar reminder to each event with `--reminder`. Use a positive number
followed by `m` for minutes, `h` for hours, or `d` for days:

```bash
actual2ics --reminder 15m
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
and regenerate it on a schedule. One cron line does it, but cron does not see
the variables you exported in your shell, so set them in the crontab:

```
ACTUAL_URL=https://actual.example.com
ACTUAL_PASSWORD=your-server-password
ACTUAL_SYNC_ID=your-budgets-sync-id
ACTUAL_DATA_DIR=/var/lib/actual2ics
0 6 * * * actual2ics --months 6 --out /srv/calendars/money.ics
```

`crontab -e` opens that file; its permissions are yours alone by default.

Re-running overwrites the file. Each event's identity is fixed by its schedule
and its date, so a re-import updates the events you already have instead of
piling up duplicates.

## Command line

| Option | Default | What it does |
|---|---|---|
| `--months N` | `6` | How far ahead to project, 1 to 120. Any one schedule stops at 750 occurrences, so a daily schedule reaches about two years however large N is |
| `--out PATH` | `actual-schedules.ics` | Where to write the file |
| `--calendar-name NAME` | `Actual — Scheduled` | The name your calendar app shows |
| `--currency CODE` | budget's setting | Adds a currency symbol, e.g. `USD`, `EUR`, `CAD` |
| `--event-format MODE` | `default` | Changes the event summary/description style. `default` keeps the payee and amount in the summary; `compact` uses the payee as the summary and puts the amount on its own line in the details; `schedule` uses the schedule name as the event title, and puts the payee and the amount on separate lines in the details |
| `--reminder TIME` | off | Adds a display reminder before each event. Use values such as `15m`, `15h`, or `1d`, up to 999. Repeat for more than one |
| `--at HH:MM` | all-day | Give events a time instead of a whole day, e.g. `09:00`. One hour long |
| `--exclude-account NAME` | none | Leave an account out. Repeat for more than one |
| `--only-account NAME` | none | Keep only these accounts. Repeat for more than one. Not usable with `--exclude-account` |
| `--exclude-schedule NAME` | none | Leave a named schedule out. Repeat for more than one |
| `--include-completed` | off | Also emit schedules Actual has marked completed |
| `--help` | | Print usage |

### Reminders

Repeat `--reminder` to get more than one alert on every event:

```bash
actual2ics --reminder 1d --reminder 2h
```

Say it the way you'd say it out loud — `15m`, `2h`, `1d`, up to 999 of any unit.

One thing to know: events are all-day by default, so the countdown runs from the
start of the day the money moves, and calendar apps disagree about what "2 hours
before an all-day event" means. `--at` settles it.

### Giving events a time

```bash
actual2ics --at 09:00 --reminder 30m
```

Events become one hour long at that time instead of filling the whole day, so
"30 minutes before" means 08:30 and nothing has to guess. The time is local to
whoever opens the calendar — no timezone is written into the file, so the same
feed reads correctly in every zone.

Without `--at`, nothing changes: events stay all-day.

### Choosing what appears

Not every account belongs on a calendar. A tracking account that amortises
prepaid expenses posts on schedule but is nothing you plan your week around:

```bash
actual2ics --exclude-account "Prepaid Amortization"
```

Or come at it from the other side and name only what you want:

```bash
actual2ics --only-account "Checking" --only-account "Credit Card"
```

Use one or the other — asking for both at once is an error rather than a guess.
To silence a single schedule rather than a whole account:

```bash
actual2ics --exclude-schedule "Weekly transfer"
```

All three repeat. Matching is on the name exactly as Actual shows it, ignoring
capitals. A name that matches nothing stops the run rather than quietly filtering
nothing — a typo you can't see is worse than an error you can. When any of them
is used, the summary line says how much it dropped.

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
- The only network connection is the one Actual's own API library opens to
  the sync server you named. Nothing else is contacted.

## Development

```bash
npm install
npm test
```

The tests cover argument handling, amount formatting, RFC 5545 escaping and
line folding, and calendar structure — no budget or server required.

## License

MIT. See [LICENSE](LICENSE); the brand carve-out is in [NOTICE](NOTICE).
Security issues: see [SECURITY.md](SECURITY.md).

Not affiliated with Actual Budget. Built by [Ildana](https://ildana.ai).
