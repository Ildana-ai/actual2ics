# Security

actual2ics reads your budget through Actual's own API library and writes one
`.ics` file. It never writes to the budget. The only network connection is the
one that library opens to the sync server you configured; nothing else is
contacted.

The password and sync ID come from environment variables and are never written
to disk by this tool. Actual's API keeps a working copy of the budget in
`ACTUAL_DATA_DIR` (default `.actual-data` in the current folder); treat that
folder as you would the budget itself.

## Reporting a problem

Email **hello@ildana.ai**. A confirmed issue is fixed in a new release and
credited in the release notes if you want it to be.
