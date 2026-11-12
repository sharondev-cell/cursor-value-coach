# Security — Value Coach for Cursor

## What this extension can access

With **live usage enabled** (off by default + consent):

- Reads two allowlisted keys from local Cursor `state.vscdb`
- Decrypts the access token **on-device** (Windows DPAPI / OSCrypt)
- Sends that token **only** to `https://api2.cursor.sh/.../GetCurrentPeriodUsage` over HTTPS
- Does **not** write the token to disk and does **not** send it to the publisher

Coaching (default) only reads local transcript structure (counts / hashes).

## Can this be hacked or used unlawfully?

**Any extension that can read a local login can be abused if you install a malicious build.** That is true of this project and of many editor tools.

### Realistic threats

| Threat | Risk | Mitigation |
| --- | --- | --- |
| Fake / modified VSIX from an untrusted site | **High** if you install it — could exfiltrate your Cursor session after decrypt | Install only from Open VSX / VS Marketplace / this GitHub repo’s releases; compare publisher id |
| Malware already running as your Windows user | **High** — it can often read `state.vscdb` anyway | OS hygiene; Value Coach does not make this worse than same-user malware |
| Compromised update of a trusted listing | Medium | Prefer verified publishers; watch sudden permission/behavior changes |
| Network attacker on HTTPS to api2.cursor.sh | Low if TLS works | Hardcoded HTTPS URL; redirects rejected |
| Token left in PowerShell command line | Reduced | DPAPI uses temp files + env paths, not secrets in argv |
| Token shown in UI errors | Reduced | Error strings are scrubbed before display |

### What this code deliberately does *not* do

- No publisher telemetry server
- No sending transcripts or chat text to the publisher
- No reading arbitrary Cursor DB keys (allowlist only)
- No usage API calls when `valueCoach.showUsage` is false

### Report a vulnerability

Open a private report via [GitHub Issues](https://github.com/sharondev-cell/cursor-value-coach/issues) with subject **Security**, or Marketplace Q&A. Do not paste live access tokens.

## Your safest setup

1. Leave live usage **off** unless you need the % badge (coaching still works).
2. Install only from the official listing once published.
3. Use **Clear Local Data** + disable `showUsage` if you want to revoke the usage path.
4. If you suspect compromise: sign out of Cursor, sign back in (rotates session), uninstall untrusted extensions.
