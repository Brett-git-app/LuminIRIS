# LuminIRIS

> Submission for the 2026 InterSystems Technology Innovation Contest
> Zero custom backend code · Direct integration with the official SysAdmin REST API · A modern IRIS management console deployable in under 3 minutes

![IRIS](https://img.shields.io/badge/InterSystems%20IRIS-2026.2%2B-3b82f6)
![IPM](https://img.shields.io/badge/IPM-zpm%20install-8b5cf6)
![Docker](https://img.shields.io/badge/Docker-compose%20up-06b6d4)
![Backend](https://img.shields.io/badge/backend-1%20small%20REST%20dispatcher-10b981)

---

## 1. Project Overview

The built-in InterSystems IRIS Management Portal is feature-complete but its interface is traditional and its key operational metrics are scattered across multiple menu levels, making it hard for operators to grasp instance health at a glance.

Built on top of the **official SysAdmin REST API exposed in IRIS 2026.2** (`/api/admin`, following the version-shipped `mainspec_v2.json` OpenAPI 3.0 specification), **LuminIRIS** is a dark-themed, glassmorphism-style **single-pane management console**. Five management scenarios - system monitoring, web applications, user permissions, scheduled tasks, and security auditing - are reachable from one entry point. All data comes **live from the official APIs** with no secondary storage.


---

## 2. Key Highlights

| # | Highlight | Description |
|---|-----------|-------------|
| 1 | **Zero-backend portal, zero intrusion** | 3 static files make up the complete portal; no tables created, no resident service processes - zero burden on production instances. The one server-side class is only the small Embedded Python dispatcher |
| 2 | **Strict official-spec compliance** | Every endpoint strictly maps to `mainspec_v2.json` (OpenAPI 3.0); request paths, response structures, and status codes all follow the official contract |
| 3 | **JWT dual-token secure auth** | access_token lives only 60 seconds, refresh_token approx. 15 minutes; the frontend silently refreshes every 50 seconds, auto-retries on 401, and revokes tokens on logout |
| 4 | **Async task polling pattern** | The audit endpoint returns `202 Accepted + Location`; the frontend polls `/v1/async-result` until `State=Finished`, fully implementing the official async-task protocol |
| 5 | **Modern glassmorphism UI** | Deep-tech background, animated gradient glow, frosted-glass cards, animated progress bars, terminal-style log stream, status tags, responsive layout |
| 6 | **Same-origin, environment-agnostic** | API base is the relative path `/api/admin`, same-origin as the portal; no CORS configuration, zero changes when switching instances, ports, or upgrading major versions |
| 7 | **Dual-standard delivery** | Ships both a **Docker image** (one-click experience) and an **IPM package** (publishable to Open Exchange, one-command install for production) |
| 8 | **Embedded Python console** | An interactive Python terminal inside the portal that executes code directly in the IRIS process via `##class(%SYS.Python).Run`, with full `iris` module access to globals/SQL - contest bonus +3 |
| 9 | **Battle-tested + reproducible platform bug reports** | Every integration issue on the live 2026.2 instance is logged with root cause/fix in **Section 6**; two deterministic Embedded Python defects (`%SYS.Python.Run()` broken status semantics in both directions) are formally reported with a one-command repro script in **Section 7 / `bug-repro/`** for the contest bonus |

---

## 3. Architecture

```
+----------------------------------------------------+
|  Browser                                           |
|  +----------------------------------------------+  |
|  |  LuminIRIS  SPA                              |  |
|  |  index.html + style.css + main.js (3 files)  |  |
|  |  Glassmorphism UI . JWT client . Async poll   |  |
|  +---------------------+------------------------+  |
+------------------------|---------------------------+
                         |  HTTPS / same-origin / Authorization: Bearer
                         v
+----------------------------------------------------+
|  InterSystems IRIS 2026.2  .  Web Gateway :52773   |
|                                                    |
|   /csp/user/luminiris/   Static portal assets      |
|   /api/admin/login          JWT login / refresh / logout |
|   /api/admin/info           Instance info          |
|   /api/admin/v2/monitor/    Performance / resources |
|   /api/admin/v2/web-apps    Web applications       |
|   /api/admin/v2/security/*  Users / roles / audit  |
|   /api/admin/v2/tasks       Scheduled tasks        |
|   /api/admin/v2/processes   Running processes      |
|   /api/admin/v1/async-result 202 async result poll |
|   /luminiris/api/python/*   Embedded Python (shipped class|
|                             Luminiris.PythonApi)   |
|                                                    |
|        (All monitoring data comes from official    |
|         IRIS built-in services; the only custom    |
|         server-side code is the small Python REST  |
|         dispatcher class Luminiris.PythonApi)      |
+----------------------------------------------------+
```

---

## 4. Modules vs. Official APIs

| Module | Function | Official Endpoint |
|--------|----------|-------------------|
| Auth | Login / auto-refresh / logout | `POST /api/admin/login`, `/refresh`, `/logout` |
| Overview | Instance version, namespaces, current user | `GET /api/admin/info` |
| Overview | Cache hit ratio, Global refs/sec, Set+Kill, disk reads/writes | `GET /api/admin/v2/monitor/dashboard/main` |
| Overview | System resource Seize dynamic bars | `GET /api/admin/v2/monitor/dashboard/system-resources` |
| Web & API | CSP/Web app names, namespace, auth methods, enabled status | `GET /api/admin/v2/web-apps` |
| Permissions | User list (full name, type, enabled/disabled) | `GET /api/admin/v2/security/users` |
| Permissions | Role tag cloud | `GET /api/admin/v2/security/roles` |
| Tasks | Scheduled tasks (type, namespace, next scheduled time) | `GET /api/admin/v2/tasks` |
| Tasks | Running processes (PID, namespace, routine, state) | `GET /api/admin/v2/processes?maxRows=50` |
| Audit Logs | Security audit records (terminal-style log stream, 202 async fetch) | `POST /api/admin/v2/security/audit/records` -> `GET /v1/async-result` |
| Embedded Python | Python runtime info + interactive code execution inside IRIS | `GET /luminiris/api/python/info`, `POST /luminiris/api/python/exec` (`%CSP.REST` class `Luminiris.PythonApi` using `##class(%SYS.Python).Run`) |

### Key Protocol: JWT Auto-Refresh

```javascript
// access_token is valid for only 60s; the client silently swaps it for a
// new one using refresh_token every 50 seconds.
setInterval(() => fetch('/api/admin/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token })
}), 50_000);
```

### Key Protocol: 202 Async Task Polling

Audit queries are long-running. The official API returns `202 Accepted` with the result address in the `Location` response header, and the frontend polls until completion:

```javascript
const res = await fetch('/api/admin/v2/security/audit/records',
                        { method: 'POST', headers: authHeader() });
if (res.status === 202) {
    const loc = res.headers.get('location');          // /api/admin/v1/async-result?id=...
    // Poll until result.State === "Finished", then read result.Result
}
```

### Key Feature: Embedded Python Console

The official SysAdmin API does not expose a Python execution endpoint, so LuminIRIS ships one small ObjectScript class, `Luminiris.PythonApi` (extends `%CSP.REST`), deployed as a dedicated REST application at `/luminiris/api`. It invokes the IRIS **Embedded Python** engine directly via `##class(%SYS.Python).Run(...)`. This is the only custom server-side code in the project and it exists solely to surface the Embedded Python feature. Using a `%CSP.REST` class (instead of a raw `.csp` file) gives explicit, reliable URL mapping via an XData route table.

Two routes are exposed:

- `GET /luminiris/api/python/info` - returns Python version, implementation, platform, the IRIS version via the `iris` module, and a list of installed data-science packages (numpy, pandas, sklearn, ...).
- `POST /luminiris/api/python/exec` with JSON body `{"code": "..."}` - executes arbitrary Python code inside IRIS and returns captured stdout/stderr. User code is passed through a scratch global (`^LUM.PYCODE`) to avoid quoting issues; stdout is captured with `io.StringIO` and returned through `^LUM.PYOUT` (runtime info uses `^LUM.PYINFO`). The globals are deleted immediately after each call.

> Implementation note: results travel through globals via the native Python binding `iris.gref('^NAME')[None]` (the `iris.globals` package is an empty placeholder; `iris.gref` is the real API). This deliberately avoids ObjectScript sequential-file I/O, which would hijack the CSP output device.

From the browser, the operator gets a full interactive console:

```python
import iris
print('IRIS version :', iris.cls('%SYSTEM.Version').GetVersion())
g = iris.gref('^LUM.DEMO')          # read/write an IRIS global directly
g[None] = 'hello from Embedded Python'
print('global value:', g[None])
```

This demonstrates real **Embedded Python** usage (contest bonus: +3 points) - the Python code runs inside the IRIS process, has full access to the `iris` module to read/write globals, call ObjectScript, and run SQL, with zero external Python interpreter required.

---

## 5. Real-Environment Validation (IRIS 2026.2)

End-to-end validation completed on a live **InterSystems IRIS 2026.2 (Build 221U)** instance:

| Module | Measured Data |
|--------|---------------|
| Overview | Correctly identified version 2026.2 Build 221U; cache efficiency **90.83%**; Global refs **316/sec** |
| Web & API | Loaded **22** web applications |
| Permissions | **9** users, **37** roles |
| Tasks | **16** scheduled tasks, **28** running processes |
| Audit Logs | Async-task mode successfully returned **358** real audit records |
| Embedded Python | `GET /python/info` reported **CPython 3.11.9** on Windows-10 / AMD64 with the `iris` module loaded; `POST /python/exec` ran `print(2**10)` returning `1024`, and invalid code correctly returned a `ZeroDivisionError` traceback with `status:"error"` |

<img width="1920" height="936" alt="login" src="https://github.com/user-attachments/assets/bb168115-f0aa-4c63-a53f-7d0604893311" />
<img width="1912" height="956" alt="4ab316e281b29f69ae7a3cbea01dc60" src="https://github.com/user-attachments/assets/02eb8d77-714d-44b8-a6fe-c29677eb9170" />
<img width="1912" height="956" alt="webapi" src="https://github.com/user-attachments/assets/3e8bdad1-68fc-4276-8c96-36e0ce0ba9aa" />
<img width="1912" height="956" alt="080274ef8b58360ba294e702b9726f8" src="https://github.com/user-attachments/assets/4ae180e4-ded2-4cf1-91bd-25440605bef5" />
<img width="1912" height="956" alt="4296dcf357308478d30f6b48fcd1b24" src="https://github.com/user-attachments/assets/5a75fe9f-1ff9-4cad-87d8-f6f3416eb466" />
<img width="1912" height="956" alt="92ab54352af3d9002a0e28457bc089d" src="https://github.com/user-attachments/assets/3868be15-64cb-4099-8074-8547f3b33ce6" />
<img width="1920" height="936" alt="5ec0ce44b113e9f7718815c43158a9c" src="https://github.com/user-attachments/assets/657f721d-1637-4aaf-b1d2-03638de6fcfa" />
<img width="1920" height="936" alt="e520203c9a8d1e479cafee42b42b61f" src="https://github.com/user-attachments/assets/83524104-ee15-41bf-b899-0c7b922ca0ae" />
<img width="1920" height="936" alt="c4b42562ef2b4e048261d2a85d9f192" src="https://github.com/user-attachments/assets/bffc1825-d7d2-4a48-a66d-8fe0b25786ca" />
<img width="1920" height="936" alt="773cf84c3607881533d507b3f070dac" src="https://github.com/user-attachments/assets/53798c4b-635f-4cd2-ba40-33714ac42fc0" />

---

## 6. Debugging Log: Real Bugs Hit, Root Causes, and Fixes

The Embedded Python integration was built and validated entirely against a live IRIS 2026.2 instance. Every issue below was reproduced, root-caused, and fixed; the final configuration in this repository is the result of this process. They are documented here to save other developers the same investigation time.

| # | Symptom | Root Cause | Fix |
|---|---------|-----------|-----|
| 1 | `GET /python/info` returned **HTTP 200 with an empty body** | The first implementation passed results back through a sequential file (`OPEN`/`USE`/`READ`/`CLOSE`). The ObjectScript `USE <device>` command **redirected the current output device**, so the final `Write ret.%ToJSON()` went to the file instead of the HTTP response | Removed all sequential-file I/O from the CSP method. Results now travel through IRIS globals, which never touch the output device |
| 2 | `iris.globals.set(...)` failed silently - "returned no data" | `iris.globals` exists but is an **empty placeholder package** (`dir(iris.globals)` → `[]`). The real native binding is `iris.gref` | Discovered via `dir(iris)` inside `##class(%SYS.Python).Shell()`; switched to `iris.gref('^NAME')[None] = value` for root-node access |
| 3 | `%SYS.Python.Run()` returned an opaque **error `#00` (no error text)** even when the script ran perfectly - and later testing showed the inverse as well (success status when Python raised) | The returned `%Status` is unreliable in **both** directions; Python-side exceptions are swallowed and not translated into the status text. Confirmed as two platform defects - see **Section 7** | The Python wrapper captures its own `traceback.format_exc()` into a global; ObjectScript judges success by actual output (a `Traceback` marker means error), not by the `%Status` |
| 4 | REST dispatch silently ignored: requests 404 / `DispatchMap` undefined | `%CSP.REST` is only visible in the **`%SYS` namespace**. Compiling the class in USER and setting `Namespace="USER"` meant the route XData never loaded. Additionally `Type=2` (REST application) is mandatory - without it `DispatchClass` is ignored | Compile `PythonApi.cls` in `%SYS` and create the app with `Namespace=%SYS`, `Type=2`, `DispatchClass=Luminiris.PythonApi` (mirrors the built-in `/api/admin`) |
| 5 | REST app returned **401/403 regardless of configuration** | The `%SYS` namespace enforces security: `AutheEnabled=64` (unauthenticated) → 403; `4` or `0` → 401. Anonymous dispatch is impossible there | `AutheEnabled=32` (JWT) + `JWTAuthEnabled=1`; the portal calls the endpoint same-origin with the Bearer token it already holds from `/api/admin/login` |
| 6 | `iris.system.version()` → `AttributeError: module 'iris_system' has no attribute 'version'` | The Python-side API surface differs from the ObjectScript class naming; the function does not exist under that path | Use the documented class bridge: `iris.cls('%SYSTEM.Version').GetVersion()`, with a nested fallback for portability |
| 7 | Status dot on the "ready" badge rendered as **mojibake** in the browser | The badge used a literal Unicode character (`●`, U+25CF) in `main.js`. On a Chinese-locale (GBK) Web Gateway the byte stream was interpreted with the wrong charset before the browser executed it | Replaced every non-ASCII character in the three front-end files with ASCII Unicode escapes (`"●"` → `"\u25CF"`, `"—"` → `"\u2014"`). The shipped front end is now **100% ASCII source**, immune to gateway charset assumptions |
| 8 | Copied static files returned **404** under `/csp/user/luminiris/` | `/csp/user` had `LockCSPName=1`, which only serves explicitly registered CSP names; freshly copied physical files are rejected | Set `LockCSPName=0` (and `AutheEnabled=65` for anonymous static access) in both `setup.script` and the bootstrap installer |
| 9 | Embedded Python failed on bare-metal Windows (`%SYS.Python` unavailable) | IRIS 2026.2 on Windows neither ships nor installs Python, and the CPF helpers assumed in older guides (`$System.Config.Set()`, `GetCPFParameter()`) **do not exist in 2026.2** | Install Python 3.11 **for all users**, then edit `iris.cpf` `[config]` directly: `PythonRuntimeLibrary=...python311.dll` and `PythonRuntimeLibraryVersion=3.11`; restart IRIS (see Deployment prerequisites) |
| 10 | Audit query initially returned nothing usable | The audit endpoint is **asynchronous**: it answers `202 Accepted` with a `Location` header instead of the records | Implemented the official poll loop against `/api/admin/v1/async-result` until `State=Finished`; 358 records then loaded successfully |

**Methodology note:** when the Python binding behaved unexpectedly, the fastest diagnostic was the in-process shell (`Do ##class(%SYS.Python).Shell()`) plus `dir(iris)` - the discrepancy between documented/assumed APIs (`iris.globals`, `iris.system.version`) and the actual runtime surface was immediately visible.

---

## 7. Embedded Python Bug Reports (Contest Bonus)

For the contest item *"Find a bug in Embedded Python"*, two independently reproducible defects were found, verified on the live build (IRIS 2026.2 Build 221U + CPython 3.11.9 on Windows), and written up with full reproduction steps:

1. **`%SYS.Python.Run()` returns an ERROR `%Status` (`#00`, no description) when the Python code executes successfully** - e.g. `Run("x=1")` yields `$system.Status.IsError(sc)=1`.
2. **`%SYS.Python.Run()` returns a SUCCESS `%Status` when the Python code raises an exception, and the Python exception message/traceback is discarded** - e.g. `Run("raise Exception('boom')")` yields `IsError(sc)=0`; the marker string appears nowhere in the status.

A third, lower-severity observation (the empty `iris.globals` placeholder wrapper that raises a misleading `NameError`) is included as an additional finding.

Full reports (Title / Environment / Steps / Expected / Actual / Impact / Workaround) and a one-command reproduction script are in:

- **[`bug-repro/BUG_REPORTS.md`](bug-repro/BUG_REPORTS.md)** - formal bug reports
- **[`bug-repro/ep_bug_repro.isc`](bug-repro/ep_bug_repro.isc)** - deterministic reproduction script (`Get-Content ep_bug_repro.isc | iris session IRIS -U USER`)

Both `Run()` issues are deterministic and need no configuration beyond a working Embedded Python installation. The workarounds (self-capturing traceback into an `iris.gref` global; judging success from payload instead of the returned status) are already implemented in `Luminiris.PythonApi`.

---

## 8. Deployment

The portal is pure static assets served directly by the IRIS Web Gateway. Two standard deployment methods are available - **Docker** and **IPM**. Choose either one.

> Prerequisite: **InterSystems IRIS 2026.2 or later** (provides the official SysAdmin API `/api/admin`).
>
> **Embedded Python prerequisite (Python tab only):** the five management modules need nothing extra. The optional Embedded Python console additionally requires a configured Python runtime:
> - **Docker / official Linux kits** - no action needed; the `iris-community` image ships with Embedded Python preconfigured (Python 3.x inside the image, verified against the documented container `sys.path`).
> - **Bare-metal Windows** - Windows does not ship Python and the IRIS installer does not add it. Install 64-bit Python 3.11 **for all users**, stop IRIS, then add to the `[config]` section of `iris.cpf` and restart:
>   ```ini
>   PythonRuntimeLibrary=C:\Program Files\Python311\python311.dll
>   PythonRuntimeLibraryVersion=3.11
>   ```
>   Verify with `Do ##class(%SYS.Python).Shell()` (the banner must show `Python 3.11.x ... on win32`). Optional packages: `python -m pip install --target "<install-dir>\mgr\python" numpy pandas`.
> - **Bare-metal Linux** - install the Python 3 version supported by your IRIS release (e.g. `python3.10` on Ubuntu 22.04); the IRIS installer links it automatically.

### Method A: Docker (recommended for one-click evaluation)

Base image is the official public image **`intersystemsdc/iris-community:2026.2`** (same tag available at `containers.intersystems.com/intersystems/iris-community:2026.2`), no login required, pinned to the 2026.2 GA release in the Dockerfile. (Note: image tags use `-em` for *Extended Maintenance* releases, not "embedded Python" - Embedded Python is already built into every current community image.)

**A1. Docker Compose (one command)**

```bash
cd luminiris
docker compose up -d --build
```

**A2. Native Docker commands**

```bash
docker build -t luminiris:2.1.0 .
docker run -d \
  --name luminiris \
  -p 52773:52773 \
  -p 1972:1972 \
  -e IRIS_PASSWORD=SYS \
  luminiris:2.1.0
```

During the image build, `setup.script` runs automatically: it **installs the portal module via IPM** (deploying the static assets), configures `/csp/user` to allow anonymous access to the static assets, **compiles `Luminiris.PythonApi` in the `%SYS` namespace**, and creates the `/luminiris/api` REST application (`Type=2`, JWT-secured exactly like `/api/admin`). Monitoring data endpoints remain JWT-protected (no security risk). After the container starts, IRIS is launched automatically by the official `iris-main` entrypoint.

### Method B: IPM (recommended for existing IRIS instances / production)

IPM (InterSystems Package Manager, formerly zpm) is InterSystems' official package manager. The project's `module.xml` declares a `ClassRoot` (`src/cls`) and a CSP resource (`src/csp`, deployed to `<install-dir>/csp/user/luminiris/`). IPM itself cannot register web applications, so one extra code-driven step is required afterwards: **run the bundled `install.isc` bootstrap** (it is idempotent - it compiles `Luminiris.PythonApi` in `%SYS`, creates the JWT-secured `/luminiris/api` REST application, and enables anonymous access to the static pages; copying the already-deployed files again is harmless). See Method C for its one-line invocation, or run the equivalent terminal commands:

```objectscript
ZN "%SYS"
do $system.OBJ.Load("/your/path/luminiris/src/cls/Luminiris/PythonApi.cls","ck")
do $system.OBJ.Load("/your/path/luminiris/src/install/Luminiris.Installer.cls","ck")
do ##class(Luminiris.Installer).EnsureRestApp()
```

**B1. Install from a local directory**

Open an IRIS terminal:

```bash
# Linux
iris session IRIS

# Windows (default instance name)
iris session IRIS
```

Then run:

```objectscript
ZN "USER"
zpm "install /your/path/luminiris"
```

Windows example (place the project in an English-only path):

```objectscript
ZN "USER"
zpm "install C:\contest\luminiris"
```

> If the instance does not yet have IPM enabled, first load the installer shipped with the version:
> ```objectscript
> do $system.OBJ.Load($System.Util.InstallDirectory()_"dist/install/misc/zpm.xml","ck")
> zpm
> zpm:USER> repo -reset-defaults
> ```

**B2. Install from Open Exchange (after publication)**

Once the work is published to InterSystems Open Exchange, any instance can install it directly:

```objectscript
ZN "USER"
zpm "install luminiris"
```

**B3. Uninstall**

```objectscript
ZN "USER"
zpm "uninstall luminiris"
```

### Method C: No-IPM Bootstrap (fallback)

When IPM is not available, use the bundled minimal bootstrap script (loads a single `Luminiris.Installer` class, no other dependencies):

1. Edit `install.isc` and change `root` on line 9 to the absolute path of this project directory (forward slashes work on both Windows and Linux):
   ```objectscript
   set root = "C:/IRIS"
   ```
2. Run (pick the syntax for your shell):
   ```bash
   # Linux / macOS / Windows CMD
   iris session IRIS -U USER < install.isc
   ```
   ```powershell
   # Windows PowerShell (does not support < redirection; use a pipe)
   Get-Content install.isc | iris session IRIS -U USER
   ```
   The script copies the 3 static files to `<install-dir>/csp/user/luminiris/`, compiles `Luminiris.PythonApi` in the `%SYS` namespace, creates the JWT-secured `/luminiris/api` REST application, and configures anonymous access to the static pages - all automatically.

You can also call it manually from the IRIS terminal:
```objectscript
ZN "USER"
do $system.OBJ.Load("C:/IRIS/src/install/Luminiris.Installer.cls","ck")
do ##class(Luminiris.Installer).Install("C:/IRIS/src/csp")
```

**B4. (Optional) Avoid the double-login under IPM**

The IPM method does not modify the instance security configuration. When accessing the static page, you may first see the native IRIS auth prompt and then the portal login. To match the Docker experience (anonymous static pages, data protected by portal JWT), an administrator can run this once in the terminal:

```objectscript
ZN "%SYS"
set p("AutheEnabled")=65    // 1=Password + 64=Unauthenticated
do ##class(Security.Applications).Modify("/csp/user",.p)
```

---

## 9. Access & Login

After deployment, open in a browser:

```
http://<server-ip>:52773/csp/user/luminiris/index.html
```

- **Docker**: `http://localhost:52773/csp/user/luminiris/index.html`
  - Login: `_SYSTEM` / `SYS` (set by `IRIS_PASSWORD`, change as needed)
- **IPM install on existing instance**: use a valid admin account of that instance (e.g. `_SYSTEM`)

After login you see real-time data for all five modules; tokens auto-refresh every 50 seconds, and you can manually refresh or log out from the top-right corner.

---

## 10. Project Structure

```
luminiris/
+-- module.xml            # IPM package definition (ClassRoot + CSP resource)
+-- package.json          # Package metadata
+-- Dockerfile            # Built on the official iris-community image
+-- docker-compose.yml    # One-click orchestration
+-- setup.script          # ObjectScript run during image build (IPM install + REST/security config)
+-- install.isc           # Minimal no-IPM bootstrap (change one path to run)
+-- .dockerignore
+-- README.md
+-- bug-repro/            # Embedded Python bug reports (contest bonus), see Section 7
+   +-- BUG_REPORTS.md    # Formal reports: Run() status defects + iris.globals wrapper
+   +-- ep_bug_repro.isc  # One-command deterministic reproduction script
+-- articles/             # Developer Community announcement articles (English)
+   +-- article-1-luminiris-console-overview.md      # Project/architecture showcase
+   +-- article-2-embedded-python-rest-console.md    # Embedded Python deep dive + bugs
+-- src/
    +-- csp/              # * Portal source (static)
    |   +-- index.html    # Page structure: login overlay + side nav + six modules
    |   +-- style.css     # Dark glassmorphism theme, animations, responsive layout
    |   +-- main.js       # JWT auth, API client, 202 async polling, Python console client
    +-- cls/              # * ObjectScript classes (compiled into the namespace)
    |   +-- Luminiris/
    |       +-- PythonApi.cls   # %CSP.REST dispatcher: Embedded Python info + exec
    +-- install/
        +-- Luminiris.Installer.cls   # Optional bootstrap installer (not needed for IPM/Docker)
```

> Deployment priority: **Docker (Method A) -> IPM (Method B) -> bootstrap (Method C)**. The three methods do not conflict; Methods A and B never use the `Luminiris.Installer` class or `install.isc` (excluded from the image via `.dockerignore`).

---

## 11. Security Notes

- The portal itself **stores no credentials**: the username and password are only used to exchange a short-lived JWT via `/api/admin/login`; tokens are kept in browser memory and expire when the page is closed.
- access_token is valid for only 60 seconds, combining auto-refresh and 401 retry to balance security and experience.
- Only the three static files are anonymously accessible (no business data); **all management data endpoints require a valid JWT**, with permissions identical to the official Management Portal.
- The Embedded Python endpoints (`/luminiris/api/python/*`) are also JWT-protected with the same `/api/admin` token; executing Python in-process is an administrator-level capability, identical in power to the built-in Python shell (`%SYS.Python.Shell()`), so the portal must only be deployed for trusted admin users.
- For production, access via HTTPS and change `IRIS_PASSWORD` / default admin credentials to strong passwords.

---

## 12. Tech Stack

- **Frontend**: Native HTML5 / CSS3 / JavaScript (ES2017+, zero build, zero npm runtime dependencies)
- **Design**: Glassmorphism (CSS variables, `backdrop-filter`, gradient animations, Flex/Grid responsive)
- **Backend protocol**: InterSystems IRIS SysAdmin REST API (OpenAPI 3.0 / mainspec_v2)
- **Auth**: JWT Bearer Token (dual-token auto-refresh)
- **Delivery**: Docker, Docker Compose, IPM (Open Exchange standard package)
