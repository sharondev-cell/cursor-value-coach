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
| `valueCoach.showUsage` | false | Live usage status bar (off until consent; uses Cursor login + api2.cursor.sh) |
| `valueCoach.usageRefreshMinutes` | 5 | Usage poll interval |
| `valueCoach.usageWarnPercent` | 80 | Yellow threshold |
| `valueCoach.usageCriticalPercent` | 95 | Red threshold |
| `valueCoach.repeatLoopThreshold` | 3 | Identical tool retries → STOP |
| `valueCoach.unattendedToolThreshold` | 16 | Tools since last message + repetitive/stuck → unattended |
| `valueCoach.readTranscripts` | true | Offline coaching from local logs |

Live usage is **off by default**. On first run you get a consent prompt; coaching still works offline either way.

## Data access (listing disclosure)

| Path | Default | What happens |
| --- | --- | --- |
| Coaching | On | Reads local agent-transcript **structure** (counts / tool hashes). No chat text uploaded to the publisher. |
| Live usage % | **Off** until consent | Reads allowlisted local Cursor login keys, decrypts on-device, calls **only** `api2.cursor.sh` GetCurrentPeriodUsage. Token not written to disk; not sent to the publisher. |
| Publisher telemetry | None | This extension does not phone home to the publisher. |

Full docs: [PRIVACY.md](PRIVACY.md) · [TERMS.md](TERMS.md) · [SECURITY.md](SECURITY.md)

**Kill switches:** `valueCoach.showUsage` / `valueCoach.readTranscripts` / **Clear Local Data**.

**Install safety:** prefer the official Open VSX / Marketplace listing (or this GitHub repo). A modified VSIX from an untrusted source could abuse any login-decrypt feature — see SECURITY.md.

## Platform notes

- Live usage decrypt is implemented for **Windows** (current Cursor encryption-at-rest).
- On other OSes the usage bar still offers **one-click Plan & Usage**; live % needs a platform decrypt path.

## Support

See [SUPPORT.md](SUPPORT.md). Prefer [GitHub Issues](https://github.com/sharondev-cell/cursor-value-coach/issues) or Marketplace / Open VSX Q&A.

## License

See [LICENSE](LICENSE).
