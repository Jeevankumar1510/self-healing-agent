# Self-Healing PC Agent

A local Windows system-health dashboard and a foundation for a carefully
controlled diagnostics assistant. The current implementation is **Phase 1**:
real, read-only host monitoring with a Next.js web frontend and a local Python
metrics API. It does not install packages on the monitored system, terminate
processes, delete files, or change system settings.

## Architecture

- `monitoring/` gathers typed CPU, memory, disk, uptime, process, and Python
  runtime measurements through `psutil`.
- `api/main.py` exposes those measurements from FastAPI. `python app.py` binds
  the API to `127.0.0.1` only.
- `memory/activity_repository.py` stores throttled monitoring samples and
  consented diagnosis outcomes in a bounded local SQLite activity log.
- `frontend/` contains the responsive Next.js dashboard, charts, and settings.
  The browser connects directly to the monitoring API on the same PC, including
  when the dashboard is hosted on Vercel. User-selected warning thresholds and
  refresh preferences stay in browser local storage.
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
npm run dev
```

Open <http://localhost:3000>. The API listens at <http://127.0.0.1:8000>.
The dashboard connects from your browser directly to the local API.

## Use the hosted website on any PC

Open <https://self-healing-agent-steel.vercel.app> on the PC you want to
monitor, then start the Python API on that same PC:

```powershell
python app.py
```

The browser talks to `127.0.0.1:8000` on the computer where the website is
open; metrics and activity history do not pass through Vercel. Allow local
network access if the browser prompts. Keep the API bound to `127.0.0.1`; do
not expose it to the internet.

The API allows only the local development origins and the production Vercel
site by default. To use a different deployment or custom domain, set
`SHA_ALLOWED_ORIGINS` in the API process to a comma-separated list of exact
origins (scheme and host, no paths), for example:

```powershell
$env:SHA_ALLOWED_ORIGINS = "https://dashboard.example.com"
python app.py
```

Do not use a wildcard origin.

## Vercel deployment

The Next.js frontend can be deployed from GitHub by importing the repository
in Vercel and setting the **Root Directory** to `frontend`. Vercel detects the
Next.js build automatically. The website itself is static with respect to PC
data: each browser connects directly to its own PC's local API. Start that
Python API on the PC being monitored as described above. No metrics API URL or
secret belongs in Vercel environment variables.

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
