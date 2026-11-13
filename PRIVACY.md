# Privacy Policy — Value Coach for Cursor

**Last updated:** 12 November 2026

This policy describes how the **Value Coach for Cursor** editor extension (“Value Coach”, “the extension”) handles data. Value Coach is an independent third-party extension. It is **not** made by, affiliated with, or endorsed by Anysphere, Inc. or Cursor.

## Summary

- Coaching scans **local** Cursor agent transcripts for structural counts and tool fingerprints only. Chat text is not stored by the extension and is not uploaded to the publisher.
- Optional live plan-usage % reads your **local** Cursor login material on-device and calls Cursor’s own API (`api2.cursor.sh`). That path is **off by default** and requires an in-editor consent prompt (or an explicit settings enable).
- The publisher does **not** operate a telemetry backend for this extension today.

## Data the extension may access

### 1. Local agent transcripts (optional; default on)

When `valueCoach.readTranscripts` is enabled, the extension reads local Cursor agent-transcript files under your Cursor user data (for example under `~/.cursor/projects/.../agent-transcripts`).

To keep coaching scoped to **this Cursor window’s active chat** (including when several windows share one workspace folder), it may also read the local workspace `state.vscdb` key `composer.composerData` for focused/selected composer ids only — not chat bodies, and not auth keys.

It keeps and uses **structural** information such as:

- Approximate turn and tool-event counts
- Hashed tool-signature fingerprints (not raw tool argument payloads)
- Opaque transcript ids (hashes), not filesystem paths in persisted state
- Focused composer ids (in-memory pin per window)

It does **not** persist raw chat/message text for coaching history.

**Control:** set `valueCoach.readTranscripts` to `false` to stop transcript reading (coaching pauses).

### 2. Live plan usage (optional; default off — consent required)

When you accept the first-run consent prompt (or later set `valueCoach.showUsage` to true and confirm), the extension may:

1. Read Cursor’s local encrypted session store (`state.vscdb`) on your machine
2. Decrypt login material **on-device** (for example Windows DPAPI / OSCrypt, where implemented)
3. Call `api2.cursor.sh` **GetCurrentPeriodUsage** with that session so the status bar can show included usage %

The extension does **not** write that token to disk. The request goes to Cursor’s infrastructure, not to a publisher-operated server.

**Control:** set `valueCoach.showUsage` to `false` for fully offline coaching (no login decrypt, no usage API call). On platforms without a decrypt path, the extension still offers a one-click open of Cursor’s Plan & Usage UI instead of live %.

### 3. Local coaching state

The extension stores on your device (VS Code / Cursor `globalState`), for example:

- Recent coaching events (capped history)
- Snooze / notification gate state

**Control:** run **Value Coach: Clear Local Data** to wipe stored coaching events and snooze state.

## Data the publisher receives

The publisher does **not** currently collect analytics, crash reports, or account data from Value Coach installs. Installing from Open VSX or the Visual Studio Marketplace may involve those marketplaces’ own download metrics under **their** privacy policies.

## Third parties

| Party | Role |
| --- | --- |
| Cursor / Anysphere (`api2.cursor.sh`) | Optional usage API when live usage is enabled |
| Open VSX / Visual Studio Marketplace / Cursor Marketplace | Distribution and listing metrics if you install from them |

## Retention

- Local coaching events: kept on your device until cleared or overwritten by the capped history.
- Session material for usage: held in memory for the request; not persisted by the extension.
- Publisher retention: none for extension runtime data (no publisher backend).

## Children’s privacy

Value Coach is intended for adult developers and workplace use. It is not directed at children.

## Security & misuse

See [SECURITY.md](SECURITY.md). In short: install only from trusted listings; a malicious modified build of *any* login-reading extension could exfiltrate a session. This project’s published source allowlists keys, hardcodes the usage URL, keeps usage off until consent, and avoids putting secrets on process command lines.

## Your choices

- Disable transcript coaching: `valueCoach.readTranscripts`
- Disable live usage: `valueCoach.showUsage`
- Clear local coaching data + usage consent: **Value Coach: Clear Local Data**
- Uninstall the extension from the editor’s Extensions view

## Contact

For privacy questions about this extension, open a GitHub issue labeled `privacy` at  
https://github.com/sharondev-cell/cursor-value-coach/issues  
or use the support channel in [SUPPORT.md](SUPPORT.md) / Marketplace Q&A.

## Changes

We may update this policy as the extension changes. Material updates will bump the “Last updated” date and appear in [CHANGELOG.md](CHANGELOG.md) when relevant.
