# Embedded Python in IRIS 2026.2: Building an In-Process Python REST Console (and Two Bugs We Found Along the Way)

> *Technical companion to the LuminIRIS management console — a 2026 InterSystems Technology Innovation Contest submission.*

**Suggested DC tags:** InterSystems IRIS, Embedded Python, REST API, ObjectScript, Bug report, Contest

---

## The goal

LuminIRIS is a browser console for IRIS. The official SysAdmin API (`/api/admin`, shipped with IRIS 2026.2) covers monitoring, security, tasks and auditing — but it has **no Python execution endpoint**. I wanted the operator to be able to run Python **inside the IRIS process** from the browser, with the full `iris` module at hand:

```
Browser  --Bearer JWT-->  /luminiris/api/python/exec
                                  |
                          ##class(%SYS.Python).Run(code)
                                  |
                          CPython 3.11 inside the IRIS process
```

This article is the complete, honest build log: the working design, the five non-obvious things that had to be exactly right, and **two reproducible defects in `%SYS.Python.Run()`** that I reported for the contest's "find a bug in Embedded Python" bonus. Every statement here was verified on IRIS for Windows (x86-64) **2026.2 (Build 221U) EDT** with **CPython 3.11.9**.

---

## Step 1 — A `%CSP.REST` class, and why it must live in `%SYS`

The dispatcher is tiny:

```objectscript
Class Luminiris.PythonApi Extends %CSP.REST
{
Parameter HandleCorsRequest = 1;

XData UrlMap
{
<Routes>
  <Route Url="/python/info" Method="get"  Call="GetInfo"/>
  <Route Url="/python/exec" Method="post" Call="ExecCode"/>
</Routes>
}

ClassMethod GetInfo() As %Status
{
    Set %response.ContentType = "application/json"
    /* ...run embedded Python, build %DynamicObject ret... */
    Write ret.%ToJSON()
    Quit $$$OK
}
}
```

Three details cost hours each:

1. **The XData block must be named `UrlMap`.** Calling it `Routes` or anything else silently disables dispatch.
2. **The class must be compiled in the `%SYS` namespace**, and the web application created with `Namespace=%SYS`. `%CSP.REST` dispatch is only resolvable there; compiling in `USER` produced a class that loaded fine but whose route map never fired (404, undefined dispatch map).
3. **The web application must be `Type=2`** (REST application). Without it, `DispatchClass` is ignored completely — this is the single most invisible setting in the whole stack.

The registration, done entirely in code (no portal clicking), mirrors the built-in `/api/admin`:

```objectscript
// Namespace=%SYS  Type=2  DispatchClass=Luminiris.PythonApi
// AutheEnabled=32 (JWT) + JWTAuthEnabled=1
```

Security note: `%SYS` **forces** authentication. I tried anonymous variants — `AutheEnabled=64` answers 403, `4` or `0` answer 401. The solution is not to weaken the app but to reuse the JWT the browser already holds from `/api/admin/login`: the frontend calls `/luminiris/api/python/*` same-origin with the same `Authorization: Bearer` header. Hitting the URL directly in the address bar correctly returns 401 — which is exactly what you want for an in-process code-execution endpoint.

---

## Step 2 — Getting Python output *out*: globals, not files

Here is the first real trap. My initial implementation wrote the Python result to a temp file and read it back with sequential I/O:

```objectscript
// DO NOT DO THIS INSIDE A CSP METHOD
Open path Use path Read line Close path
```

Symptom: `GET /python/info` returned **HTTP 200 with a completely empty body**. The Python ran perfectly. Cause: the ObjectScript `Use <device>` command **switches the current output device**. Inside a CSP request the current device *is* the HTTP response stream — so the final `Write ret.%ToJSON()` went to my temp file, and the response got nothing.

The fix is to never touch devices at all. Python and ObjectScript already share a perfect in-process channel: **IRIS globals**, reached from Python through the native binding `iris.gref`.

Python side (root node of a global is keyed by `None`):

```python
import iris, json
iris.gref('^LUM.PYINFO')[None] = json.dumps(result)
```

ObjectScript side:

```objectscript
Kill ^LUM.PYINFO
Set sc = ##class(%SYS.Python).Run(probe)
Set json = $Get(^LUM.PYINFO)
Kill ^LUM.PYINFO
```

No files, no devices, no quoting problems (user code itself rides another global, `^LUM.PYCODE`). The globals are killed immediately after each call.

### And the API name itself is a trap: `iris.globals` vs `iris.gref`

Following older examples, I first wrote `iris.globals.set(...)`. It failed silently. In the in-process shell:

```objectscript
Do ##class(%SYS.Python).Shell()
```
```python
>>> import iris
>>> hasattr(iris, 'globals')
True
>>> dir(iris.globals)
[]
>>> iris.globals.set('^X', 'v')
NameError: Cannot call an iris.package wrapper. If you were trying to call
a method of an ObjectScript class, check that the name of the wrapper is
correct. Given name was: globals.set
>>> iris.gref('^X') is not None
True
```

`iris.globals` exists but is an **empty placeholder package**; the real API is `iris.gref('^NAME')`, subscripted directly (`g[None]` for the root node). The error message even points you in the wrong direction. The fastest diagnostic the whole project was just `Do ##class(%SYS.Python).Shell()` plus `dir(iris)` — the gap between assumed and actual API surface was immediately visible.

---

## Step 3 — The exec endpoint: capture stdout, survive exceptions

The user's code must execute as though typed at a real console, and both normal output and Python tracebacks must come back as JSON. User code is passed via global (so newlines and quotes are irrelevant), then wrapped:

```python
import sys, io, traceback, iris
out = ''
try:
    code = iris.gref('^LUM.PYCODE')[None]
    buf = io.StringIO()
    saved = sys.stdout
    sys.stdout = buf
    sys.stderr = buf
    try:
        exec(compile(code, '<luminiris>', 'exec'), {'__name__':'__main__'})
    except Exception:
        traceback.print_exc()
    finally:
        sys.stdout = saved
        sys.stderr = sys.__stderr__
    out = buf.getvalue()
except BaseException:
    out = traceback.format_exc()
iris.gref('^LUM.PYOUT')[None] = out
```

ObjectScript decides success/failure from the **payload**, not from the `Run()` status (the next section explains why):

```objectscript
Set isErr = (out [ "Traceback (most recent call last)")!((out = "")&$$$ISERR(sc))
```

Verified behavior, live:

```jsonc
// POST {"code": "print(2**10)\nimport platform\nprint(platform.python_version())"}
{ "status": "ok", "executed": 1, "output": "1024\n3.11.9\n" }

// POST {"code": "print(1/0)"}
{ "status": "error", "executed": 1,
  "output": "Traceback (most recent call last): ... ZeroDivisionError: division by zero\n" }
```

The `info` endpoint uses the same pattern with an outer `try/except BaseException` that stores `traceback.format_exc()` into the result, and it reads the IRIS version **through Python** to prove true embedding:

```python
iris.cls('%SYSTEM.Version').GetVersion()
# IRIS for Windows (x86-64) 2026.2 (Build 221U) Fri Jun 26 2026...
```

(Note: `iris.system.version()` does **not** exist — `AttributeError: module 'iris_system' has no attribute 'version'`. Use the class bridge above.)

---

## Step 4 — Enabling Embedded Python on bare-metal Windows

IRIS 2026.2 on Windows neither ships nor installs Python, and several helpers referenced in older guides (`$System.Config.Set()`, `GetCPFParameter()`) do not exist in this release. The working procedure is:

1. Install 64-bit Python 3.11 **for all users** (so the DLL is at a stable path).
2. Stop IRIS and edit `iris.cpf`, section `[config]`:
   ```ini
   PythonRuntimeLibrary=C:\Program Files\Python311\python311.dll
   PythonRuntimeLibraryVersion=3.11
   ```
3. Enable the CallIn service and restart IRIS.
4. Verify:
   ```objectscript
   Do ##class(%SYS.Python).Shell()
   Python 3.11.9 (tags/v3.11.9:de54cf5 ...) [MSC v.1938 64 bit (AMD64)] on win32
   ```
5. Optional packages: `python -m pip install --target "<install-dir>\mgr\python" numpy pandas`.

(The community Docker image needs none of this — Embedded Python is preconfigured there. Also, image-tag suffix `-em` means *Extended Maintenance*, not "embedded Python".)

---

## Two reproducible bugs in `%SYS.Python.Run()`

While hardening the endpoints I found that the `%Status` returned by `##class(%SYS.Python).Run(...)` is wrong **in both directions**. Both findings are deterministic, need no special setup, and I have submitted them with a one-command repro script for the contest bonus. Environment: IRIS 2026.2 Build 221U, CPython 3.11.9, Windows 10 x64.

### Bug 1 — error status when the Python code succeeds

```objectscript
USER>set sc=##class(%SYS.Python).Run("x=1")
USER>write $system.Status.IsError(sc),!
1
USER>do $system.Status.DisplayError(sc)
Error #00: (no error description)
```

(The validation terminal runs a Chinese-locale IRIS, where the same line is rendered localized; the translation is shown above.)

`x=1` cannot fail, yet the call returns an **error** `%Status`, code `#00`, with no text. The same happens for `Run("print('hi')")` and for longer successful scripts (including the stdout-redirect wrapper from Step 3). Any caller following the standard `If $$$ISERR(sc) Quit sc` convention aborts on success.

### Bug 2 — success status when the Python code raises, and the exception is discarded

```objectscript
USER>set sc=##class(%SYS.Python).Run("raise Exception('boom-marker-123')")
USER>write $system.Status.IsError(sc),!
0
USER>do $system.Status.DisplayError(sc)
Warning (-1) #00: (no error description)
```

The unhandled exception is reported as **success**, and the marker string `boom-marker-123` appears nowhere in the status — no message, no traceback; in a server context it is simply lost. Taken together:

| Script | Real outcome | `IsError(sc)` | Error text |
|---|---|---|---|
| `x=1` | success | **1** | `#00`, empty |
| `raise Exception(...)` | exception | **0** | `-1 #00`, exception gone |

The return value is unusable both ways, which is exactly why the production wrapper in Step 3 captures its own traceback and judges failure by output content.

### Workarounds

1. Never branch on the `Run()` status for user code; wrap source in `try/except BaseException`, persist `traceback.format_exc()` into a global via `iris.gref`, and detect a `Traceback (most recent call last)` marker on the ObjectScript side.
2. Use `iris.gref` (not `iris.globals`) for all Python-to-ObjectScript data exchange.
3. Avoid sequential-file I/O inside CSP methods; use globals so the CSP output device is never re-`Use`d.

A third, lower-severity finding (the empty `iris.globals` wrapper and its misleading `NameError`) is documented in the same report. The full reports and a reproducible script ship with the project under `bug-repro/`:

```powershell
Get-Content ep_bug_repro.isc | iris session IRIS -U USER
```

---

## Lessons worth stealing

1. **`%CSP.REST` checklist:** XData named `UrlMap`; compile in `%SYS`; web app `Namespace=%SYS`, `Type=2`, explicit `DispatchClass`; secure with JWT (`AutheEnabled=32`, `JWTAuthEnabled=1`) and reuse the `/api/admin` token.
2. **IPC inside CSP methods = globals via `iris.gref`.** Files and `Use` fight the response device; globals do not.
3. **Treat `%SYS.Python.Run()` status as advisory only** until the defects above are fixed; self-capture tracebacks.
4. **Discover the real Python API with `##class(%SYS.Python).Shell()` and `dir(iris)`** — the documented/intuitive surface (`iris.globals`, `iris.system.version`) is not always the real one.
5. **A 60-second access token + same-origin Bearer calls** is enough to add a powerful admin feature (in-process Python execution) without inventing any new security machinery.

The full class (`Luminiris.PythonApi`) is about 170 lines of ObjectScript and is the only custom server-side code in LuminIRIS. Source, Docker/IPM packaging, the formal bug reports and the reproduction script are all in the project repository (link added at publication). The companion article introduces the portal itself: **LuminIRIS: A Zero-Backend, Glassmorphism Management Console for InterSystems IRIS 2026.2**.

Happy to hear alternative IPC patterns you have used between Embedded Python and ObjectScript — globals solved every case here, but I would love to know what others reach for.

---

*InterSystems IRIS 2026.2 (Build 221U) · Embedded Python 3.11.9 · `%CSP.REST` · `iris.gref` · JWT*
