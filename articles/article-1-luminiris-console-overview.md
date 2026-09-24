# LuminIRIS: A  Glassmorphism Management Console for InterSystems IRIS 2026.2



**Suggested DC tags:** InterSystems IRIS, SysAdmin API, REST API, Frontend, Docker, IPM, Management Portal, Contest


## Why another management portal?

The built-in IRIS Management Portal is powerful and complete, but its key operational signals — cache efficiency, global activity, web applications, users and roles, scheduled jobs, security events — are scattered across many menu levels. When you are on call and need to answer *"is this instance healthy right now?"* in ten seconds, that matters.

**LuminIRIS** is my contest answer: a single-pane, dark-themed **glassmorphism** console where the five management scenarios an operator actually uses every day live behind one login:

1. **Overview** — instance identity plus live performance counters and resource bars
2. **Web & API** — every registered CSP/REST web application
3. **Permissions** — users and roles
4. **Tasks** — scheduled tasks and running processes
5. **Audit Logs** — security audit records in a terminal-style stream
6. **Embedded Python** *(contest bonus)* — an interactive Python console running **inside the IRIS process**

Everything was built and validated against a live **InterSystems IRIS 2026.2 (Build 221U)** instance.

---

## The one architectural decision that shapes everything

The complete portal is three static files served directly by the IRIS Web Gateway:

```
index.html    # layout: login overlay + sidebar + six modules
style.css     # glassmorphism theme, animations, responsive grid
main.js       # JWT auth client, API calls, async polling, Python console
```

The browser talks **directly, same-origin**, to the official SysAdmin REST API shipped in IRIS 2026.2 (`/api/admin`, documented by the version's own `mainspec_v2.json` OpenAPI 3.0 specification):

```
Browser (LuminIRIS SPA, 3 static files)
        │  same-origin HTTPS, Authorization: Bearer <jwt>
        ▼
IRIS 2026.2 Web Gateway
   /csp/user/luminiris/*      static portal assets
   /api/admin/login|refresh|logout
   /api/admin/info
   /api/admin/v2/monitor/dashboard/*
   /api/admin/v2/web-apps
   /api/admin/v2/security/users|roles|audit/*
   /api/admin/v2/tasks
   /api/admin/v2/processes
   /api/admin/v1/async-result
   /luminiris/api/python/*    the ONLY custom server-side class
```

Consequences I care about:

- **Zero intrusion** — no tables created, no globals kept, no resident service process. Delete the three files and nothing of the instance remains.
- **Upgrade for free** — when IRIS adds fields or endpoints to `/api/admin`, the portal inherits them; there is no middleware to migrate.
- **No CORS, no config drift** — the API base is the relative string `/api/admin`. The same build runs against `localhost:52773`, a VM IP, or a container without a single change.
- **Tiny audit surface** — the portal stores no credentials. Username/password are used once to exchange a JWT; tokens live only in page memory.

The single exception is one small `%CSP.REST` class (`Luminiris.PythonApi`, compiled in the `%SYS` namespace) — it exists solely to surface Embedded Python, which the official SysAdmin API does not expose. The technical companion article covers it in depth.

---
<img width="1920" height="936" alt="dae4bce4bd016a1100a7894221fcd1b" src="https://github.com/user-attachments/assets/f2473fc1-7cb7-44f0-b149-fb5dfd444c8d" />

## Module walkthrough, with the real numbers

Every counter below is what the live 2026.2 instance actually returned during validation — not mock data. The portal has no secondary storage; it only renders what the official API answers.

`[SCREENSHOT: Overview dashboard — version card, cache hit ratio, Global refs/sec, resource Seize bars]`


### Overview — health at a glance

- `GET /api/admin/info` → product, version, namespaces, current user
- `GET /api/admin/v2/monitor/dashboard/main` → cache hit ratio, Global references per second, Set+Kill rate, disk reads/writes
- `GET /api/admin/v2/monitor/dashboard/system-resources` → animated resource bars

Measured on the validation instance: cache efficiency **90.83%**, Global refs **316/sec**, version correctly identified as **2026.2 Build 221U**.
<img width="1920" height="936" alt="d3388ec98c139fd37dfaeba0e5647a0" src="https://github.com/user-attachments/assets/fcc09b04-8857-4ed7-acf8-335fb67fa83f" />
### Web & API

`GET /api/admin/v2/web-apps` rendered **22** applications — name, namespace, enabled state, authentication methods — as filterable cards.
<img width="1912" height="956" alt="6e94e56c4a23a7f6a1b4155014b24a0" src="https://github.com/user-attachments/assets/7e283de2-4f84-47f3-a841-2210aa318cc1" />

### Permissions

- `GET /api/admin/v2/security/users` → **9** users (full name, type, enabled/disabled)
- `GET /api/admin/v2/security/roles` → **37** roles shown as a tag cloud
<img width="1912" height="956" alt="b5a4efa087a5c73a96134a9b96ca3a4" src="https://github.com/user-attachments/assets/e64c7bf5-0fea-496c-916e-f3d3d69fb2a5" />

### Tasks

- `GET /api/admin/v2/tasks` → **16** scheduled tasks (type, namespace, next run)
- `GET /api/admin/v2/processes?maxRows=50` → **28** live processes (PID, namespace, routine, state)
<img width="1912" height="956" alt="568d6b8d9c1647b4850c2034121b70e" src="https://github.com/user-attachments/assets/fad6d541-4cd5-4571-a728-95e102dd793b" />

### Audit Logs — the async protocol deserves its own paragraph

`[SCREENSHOT: Audit Logs tab — dark terminal-style stream with colored severity tags]`

The audit endpoint is a **long-running query**. It does not block-and-return records; it answers immediately with:

```
HTTP/202 Accepted
Location: /api/admin/v1/async-result?id=<job-id>
```

The client polls that location until `State === "Finished"` and then reads `Result`. Implementing the official async-task contract end-to-end was the most interesting frontend piece — and it returned **358 real audit records** on the test instance. Core of the loop:

```javascript
const res = await fetch('/api/admin/v2/security/audit/records',
                        { method: 'POST', headers: authHeader() });
if (res.status === 202) {
    const loc = res.headers.get('location');
    // poll GET loc until result.State === "Finished", then render result.Result
}
```
<img width="1912" height="956" alt="396a2c92bf326d3e6b92db56e5b7f46" src="https://github.com/user-attachments/assets/b4a2b9dc-b2e9-4cd9-8286-1e507eab7246" />

### Embedded Python console

`[SCREENSHOT: Python tab — green "● ready" badge, runtime info card, code editor, output pane]`

A terminal-style editor posts `{"code": "..."}` to `POST /luminiris/api/python/exec`; the code runs **inside the IRIS process** via `##class(%SYS.Python).Run(...)` and stdout comes back captured. Verified live:

```python
>>> print(2**10)
1024
>>> import platform; print(platform.python_version())
3.11.9
```

Invalid code comes back with a genuine Python traceback — `print(1/0)` correctly returns `status:"error"` with a `ZeroDivisionError`, because the server wrapper captures `traceback` itself (more on why that is necessary in article 2).

`GET /luminiris/api/python/info` reports CPython **3.11.9**, platform, executable, `sys.path`, detected data-science packages, and the IRIS version obtained **through the `iris` Python module** — proving the Python code is truly embedded, not spawned:

```python
import iris
print(iris.cls('%SYSTEM.Version').GetVersion())
# IRIS for Windows (x86-64) 2026.2 (Build 221U) ...
```

One-click snippets are provided (System info, IRIS globals, Math demo, JSON parse). The IRIS snippet reads and writes a real global through the native binding `iris.gref('^LUM.DEMO')` and cleans it up afterwards.

---
<img width="1920" height="936" alt="4e35eec96cfd089645a3ff8e5acb151" src="https://github.com/user-attachments/assets/9b2ddccd-2cc1-4121-a125-75ff6adf6408" />
<img width="1920" height="936" alt="78aaf8095297f8a73253308454d4f6d" src="https://github.com/user-attachments/assets/51730538-c950-4b28-98cd-dada29b404f4" />
<img width="1920" height="936" alt="b23e53d402de29d892df269340eea23" src="https://github.com/user-attachments/assets/b079359e-a564-405a-ab38-dd57be2d02d1" />
<img width="1920" height="936" alt="f3fb4e21e520e0e48cf6b5fe505be02" src="https://github.com/user-attachments/assets/d6a32f30-ac4f-4b85-9aa8-087703f66da4" />

## Authentication: short-lived JWT, fully silent

The portal reuses the official SysAdmin identity provider exactly:

| Token | Lifetime | Use |
|---|---|---|
| `access_token` | **60 seconds** | `Authorization: Bearer` on every request |
| `refresh_token` | ~15 minutes | silent exchange on `/api/admin/refresh` |

A timer refreshes at 50 seconds; any in-flight request that meets a 401 is retried once after a forced refresh; logout revokes the tokens. Because the access token dies with the browser tab, a stolen page state is worth at most one minute.

```javascript
setInterval(() => fetch('/api/admin/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token })
}), 50_000);
```

Permissions are **not** reimplemented: every data call is evaluated by IRIS with the same rights as the built-in Management Portal. If the logged-in user cannot read audit records in the native portal, they cannot read them in LuminIRIS either. The only anonymously reachable resources are the three static files — no business data is ever served unauthenticated.

---

## Deploy in under three minutes

The project ships both as a **Docker image** and an **IPM package**, plus a dependency-free bootstrap fallback. Everything (REST app registration, namespace compile, static-access flags) is done **in code** — nobody has to click through the Management Portal to install it.

### Option A — Docker Compose

```bash
cd luminiris
docker compose up -d --build
```

The image is built on the public, no-login base `intersystemsdc/iris-community:2026.2`; a build-time `setup.script` installs the IPM module, compiles the Python dispatcher in `%SYS`, and registers the JWT-secured REST application. Open:

```
http://localhost:52773/csp/user/luminiris/index.html
# login: _SYSTEM / SYS  (IRIS_PASSWORD, change it for real use)
```

### Option B — IPM on an existing instance

```objectscript
ZN "USER"
zpm "install /your/path/luminiris"
```

…then run the idempotent one-line registration snippet from the README (IPM itself cannot register web applications, so the project ships a tiny code-driven bootstrap for that step). Once published to Open Exchange, it becomes simply `zpm "install luminiris"`.

> **Embedded Python note:** the five management modules need no extra prerequisites. The Python tab additionally needs a configured Python runtime — preconfigured in the community Docker image; on bare-metal Windows you install Python 3.11 for all users and point two CPF keys (`PythonRuntimeLibrary`, `PythonRuntimeLibraryVersion`) at it. The README documents the exact procedure.

---

## Design notes (it is allowed for ops tooling to look good)

`[SCREENSHOT: full-page hero shot showing the gradient glow + frosted cards]`

- Pure CSS glassmorphism: CSS variables, `backdrop-filter` frosted cards, animated ambient gradient glow
- Animated progress rings/bars for counters, status pills, a terminal log stream with colored severity tags
- Responsive Flex/Grid layout; zero build step, zero npm runtime dependencies — open the files or install the package, that's it
- One non-obvious hardening: the shipped frontend is **100% ASCII source**. A literal `●` in `main.js` rendered as mojibake through a non-UTF-8 Web Gateway charset path; all non-ASCII UI characters are now `\u25CF`-style escapes, which are charset-proof.

---

## What I learned building it

- Treating the shipped OpenAPI spec (`mainspec_v2.json`) as the contract meant zero guessed endpoints — every module maps 1:1 to an official route.
- The 202 + Location + polling async pattern is genuinely nice to consume once you know it exists; it deserves to be better known.
- "Zero backend" is a feature for production instances: reviewers and admins can audit the entire portal logic by reading three files, and there is nothing resident to operate.
- The Embedded Python integration surfaced two reproducible platform defects in `%SYS.Python.Run()` status semantics — reported with a one-command reproduction script (and the subject of the companion technical article).

---

## Try it

- Source, Docker/IPM instructions, full endpoint map, validation table, and the bug-reproduction kit: project repository (link to be added at publication)
- Companion article: **Embedded Python in IRIS 2026.2: Building an In-Process Python REST Console (and Two Bugs We Found)**

Feedback welcome — especially ideas for a seventh module. What operational screen do *you* wish existed as a single pane?

---

*Built on InterSystems IRIS 2026.2 · SysAdmin REST API · Embedded Python 3.11.9 · native HTML/CSS/JS · Docker + IPM*
