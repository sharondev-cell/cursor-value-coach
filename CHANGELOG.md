# Changelog

## 0.3.4

### Fixed

- Coaching no longer merges chats across Cursor windows that share the same workspace folder (e.g. different git branches, each with their own chats). Each window pins to its focused composer/chat and ignores sibling windows’ transcript activity and shared focus state.

### Tests

- Vitest unit tests for `WindowChatScope` pin/focus rules, strict transcript scoping, and per-window snooze isolation.

## 0.3.3

### Security

- DPAPI decrypt no longer places secrets on the PowerShell command line (temp files + wipe).
- Cursor `state.vscdb` reads allowlisted to auth keys only.
- Usage fetch hard-allowlists `api2.cursor.sh`, rejects redirects, scrubs tokens from UI errors.
- Stronger consent copy; added SECURITY.md and listing data-access table.

## 0.3.2

### Added

- First-run consent modal before live usage (login decrypt + api2.cursor.sh).
- TERMS.md

### Changed

- `valueCoach.showUsage` defaults to **false** until consent is granted.

## 0.3.1

### Changed

- All features are free (removed Pro license gating).
- Unattended coaching only fires when tooling looks repetitive/stuck, not for long varied workloads.
- Default `unattendedToolThreshold` raised from 8 to 16.
- Display name / docs oriented for marketplace: “Value Coach for Cursor”.

### Added

- PRIVACY.md, SUPPORT.md, and marketplace listing metadata (icon, gallery banner, links).
- Affiliation / privacy disclosures in README.

## 0.3.0

- Live plan usage status bar (optional).
- Burn coaching for identical tool retries and unattended patterns.
- Weekly report and event history.
