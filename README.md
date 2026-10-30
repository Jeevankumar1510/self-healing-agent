# Self-Healing PC Agent

A local Windows system-health dashboard and a foundation for a carefully
controlled diagnostics assistant. The current implementation is **Phase 1**:
real, read-only host monitoring with a Next.js web frontend and a local Python
metrics API. It does not terminate processes, delete files, or change system
settings.

The hosted website can provide individual invited accounts with password
sign-in and required authenticator-app MFA. Browser-only mode cannot read
device CPU, memory, processes, disks, or OS health; those require a local agent.

## Architecture

- `monitoring/` gathers typed CPU, memory, disk, uptime, process, and Python
  runtime measurements through `psutil`.
- `api/main.py` exposes those measurements from FastAPI. `python app.py` binds
  the API to `127.0.0.1` only.
- `memory/activity_repository.py` stores throttled monitoring samples and
  consented diagnosis outcomes in a bounded local SQLite activity log.
- `frontend/` contains the responsive Next.js dashboard, charts, settings, and
  same-origin API proxies. User-selected warning thresholds and refresh
  preferences stay in browser local storage.
- `config/settings.py` validates default monitoring configuration.
- `tests/` covers settings validation, monitor behavior, and metrics responses.

The monitoring API is not an authorization boundary and should remain bound to
localhost. The web frontend cannot itself remediate problems. Deterministic
incident detection, knowledge retrieval, approval-gated actions, verification,
and persistent incident memory are future phases. The AI diagnosis page can
send an explicitly consented, redacted issue report and a small set of
aggregated system measurements to OpenAI; it never executes the suggested fix.

## Requirements

- Windows 10/11
- Python 3.11 or 3.12 (developed against Python 3.12)
- Node.js 20.9 or newer and npm

## Install

In PowerShell, from the project directory:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
cd frontend
npm install
```

If PowerShell blocks environment activation, use
`.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt` instead.

## Run locally

Open two PowerShell terminals in the project directory.

Terminal 1 — local metrics API:

```powershell
.\.venv\Scripts\python.exe app.py
```

Terminal 2 — Next.js frontend:

```powershell
cd frontend
$env:NEXT_PUBLIC_SUPABASE_URL = "https://YOUR-PROJECT.supabase.co"
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "YOUR-PUBLISHABLE-KEY"
npm run dev
```

Create/configure the Supabase project first (see below); the app fails closed
without these public project settings. Open <http://localhost:3000>. The API
listens at <http://127.0.0.1:8000>. The Next.js server proxies dashboard API
requests to the local Python service.

## Hosted accounts and MFA

The frontend supports individual invited Supabase accounts. Each person uses
their own email/password and enrolls a TOTP authenticator app; the server-side
Next.js proxy requires a Supabase `aal2` session before serving the dashboard
or API routes. The app enrolls and challenges TOTP factors; disable other
MFA methods in Supabase so TOTP is the only available second factor. Public
sign-up is not part of the app; invite users from the Supabase dashboard.

1. Create a Supabase project on its free plan. In **Authentication → Providers
   → Email**, disable public sign-ups. In **Authentication → Multi-Factor
   Authentication**, allow authenticator/TOTP and disable SMS/phone factors.
2. Set the Supabase **Site URL** to the deployed website. Add these allowed
   redirect URLs:
   `https://YOUR-VERCEL-DOMAIN/auth/callback` and
   `http://localhost:3000/auth/callback`.
3. Configure custom SMTP before inviting people outside the Supabase
   organization. The built-in mailer is best-effort, limited, and does not
   deliver to arbitrary external users. Gmail SMTP uses `smtp.gmail.com` on
   port `465` (SSL) or `587` (STARTTLS), with the Gmail address and a Google
   App Password. Google requires 2-Step Verification for App Passwords;
   whether a personal Gmail sender will be accepted and deliver reliably is
   not guaranteed. A dedicated transactional sender with a verified domain
   and SPF/DKIM is preferred. Never put an SMTP/App Password in the frontend,
   Vercel variables, or Git; enter it only in Supabase's SMTP settings.
4. In Supabase email templates, use token-hash callback links:

   Invite:

   ```html
   <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/set-password">Accept invitation</a>
   ```

   Password recovery:

   ```html
   <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/set-password">Reset password</a>
   ```

5. In Vercel, set `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, then redeploy. These are public
   project settings; never add a Supabase service-role/secret key to Vercel
   frontend variables. If Vercel is connected to GitHub, push the app changes
   and Vercel will build the new deployment after the variables are set.
6. Invite each email from Supabase **Authentication → Users**. The user follows
   the email link, chooses their own password, and enrolls an authenticator
   app. Sign-in requires their individual password and current TOTP code.

Free Supabase projects have usage quotas and may pause after inactivity; check
the current [Supabase pricing](https://supabase.com/pricing) and
[production guidance](https://supabase.com/docs/guides/deployment/going-into-prod).

## What browser-only mode can monitor

A website opened in a browser cannot inspect the computer's CPU utilization,
memory use, running processes, disk volumes, or operating-system health. The
hosted dashboard displays this limitation instead of fabricating readings.
Full device monitoring requires a small local agent on each computer being
monitored; people who only open the website do not install an agent, but
browser-only access is not PC health monitoring.

## Settings

Configure default values with these environment variables before starting the
Python API:

| Variable | Default | Description |
|---|---:|---|
| `SHA_MONITORING_INTERVAL_SECONDS` | `10` | Default refresh interval, 2–300 seconds. |
| `SHA_CPU_WARNING_PERCENT` | `85` | CPU warning threshold, 0–100. |
| `SHA_MEMORY_WARNING_PERCENT` | `85` | Memory warning threshold, 0–100. |
| `SHA_DISK_FREE_WARNING_PERCENT` | `10` | Minimum free disk warning threshold, 0–100. |

You can change refresh intervals and warning thresholds in the dashboard
Settings page. They are stored in the browser only. One high reading creates a
warning, not a confirmed incident.

### OpenAI diagnosis

Set the OpenAI API key in the **same process environment used to launch the
Python API**. For PowerShell, in the API terminal:

```powershell
$env:OPENAI_API_KEY = "your-key"
$env:OPENAI_MODEL = "gpt-4o-mini"
python app.py
```

The diagnosis page remains disabled until the backend reports that a key is
configured. A diagnosis is requested only after the user enters a problem,
checks the explicit consent box, and submits. The report is redacted for
common API-key, bearer-token, and password patterns before sending. The
included evidence is limited to the timestamp, OS and Python version, CPU and
memory percentages, disk capacity/free-space numbers (without volume names),
and process count (without process names or PIDs). No process list, files,
environment variables, or logs are sent. Do not include secrets in the report.
OpenAI processing is subject to the provider's account settings and data
policies.

The structured response distinguishes measured observations from possible
causes, includes recommended checks and uncertainty, and marks proposed
changes as requiring approval. It is advisory only; no action executor is
connected.

## Local activity history

The Activity log stores at most one aggregated system-health sample per minute
and completed/failed diagnosis events. It retains up to 30 days and caps the
database at 20,000 events. The original issue description, process names, PIDs,
and volume names are not saved. Diagnosis result text is locally retained after
the user explicitly submits a diagnosis request; common credential patterns
are redacted before storage. Use **Clear history** in the dashboard to delete
all stored events.

The SQLite database defaults to `data/agent.db`, which is excluded from Git.
Set `SHA_DATABASE_PATH` in the Python API process environment to use a
different local database path.

## Validation

Python tests:

```powershell
python -m pytest -q
```

Frontend checks:

```powershell
cd frontend
npm run lint
npm run build
```

System-monitoring tests use mocks and do not stress or modify the host.

## Current limitations

- No vector database, remediation handlers, or service monitoring is active
  yet.
- Disk measurements cover readable mounted volumes; per-directory usage
  analysis is not enabled.
- Process visibility depends on the current Windows user's permissions.
- CPU sampling waits briefly (up to 0.2 seconds) for a representative value.
- A locked or unreadable volume appears as a collection warning rather than a
  fabricated disk measurement.
