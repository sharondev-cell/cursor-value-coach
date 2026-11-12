# Value Coach for Cursor

Catches the agent failure modes that torch Cursor quotas — **identical tool retries**, **unattended burns**, long threads — and shows **live plan usage %** so you never dig through Settings → Plan & Usage again.

> **Independent extension.** Not made by, affiliated with, or endorsed by Anysphere, Inc. or Cursor. “Cursor” is used only to describe compatibility.

## Why

Real Cursor threads report $100–$2000 blowups from walk-away loops and identical tool retries. Cursor often has no per-run circuit breaker. Value Coach watches local transcripts and yells before the next retry compounds — and puts your included usage % on the status bar.

## Install

**From VSIX (dev / pre-marketplace):**

1. `npm run compile` then `npm run package`
2. Cursor: **Extensions → ⋯ → Install from VSIX…**

**Repo:** [github.com/sharondev-cell/cursor-value-coach](https://github.com/sharondev-cell/cursor-value-coach)

Marketplace / Open VSX links will appear here once published.

## What you get

### Live usage (status bar)

- **`Usage 15%`** (or whatever you’ve burned) — updates every 5 minutes
- Click → **Open Plan & Usage** / refresh / dashboard link
- Yellow at 80%, red at 95% (configurable)
- One command: **Value Coach: Open Plan & Usage**

### Burn coaching

- Critical STOP for identical tool-signature retries and unattended (stuck/repetitive) burns
- Progressive tips only when the situation gets worse
- Snooze 1h / until new chat
- Local transcript scan (counts + hashes only)
- Event history (up to 100) + weekly burn-risk report

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `valueCoach.showUsage` | true | Live usage status bar (uses Cursor login + api2.cursor.sh) |
| `valueCoach.usageRefreshMinutes` | 5 | Usage poll interval |
| `valueCoach.usageWarnPercent` | 80 | Yellow threshold |
| `valueCoach.usageCriticalPercent` | 95 | Red threshold |
| `valueCoach.repeatLoopThreshold` | 3 | Identical tool retries → STOP |
| `valueCoach.unattendedToolThreshold` | 16 | Tools since last message + repetitive/stuck → unattended |
| `valueCoach.readTranscripts` | true | Offline coaching from local logs |

Set `showUsage` to `false` if you want coaching fully offline.

## Privacy

Full policy: [PRIVACY.md](PRIVACY.md).

- **Coach path**: local transcript counts/hashes only — no chat text stored, no upload to the publisher.
- **Usage path** (optional): reads encrypted Cursor login from local `state.vscdb`, decrypts on-device (Windows DPAPI + OSCrypt), calls `api2.cursor.sh` **GetCurrentPeriodUsage**. Token is not written to disk by this extension.
- **Kill switches**: `valueCoach.showUsage` / `valueCoach.readTranscripts` / **Clear Local Data**.

## Platform notes

- Live usage decrypt is implemented for **Windows** (current Cursor encryption-at-rest).
- On other OSes the usage bar still offers **one-click Plan & Usage**; live % needs a platform decrypt path.

## Support

See [SUPPORT.md](SUPPORT.md). Prefer [GitHub Issues](https://github.com/sharondev-cell/cursor-value-coach/issues) or Marketplace / Open VSX Q&A.

## License

See [LICENSE](LICENSE).
