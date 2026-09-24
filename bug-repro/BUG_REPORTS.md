# Embedded Python - Bug Reports

Contest bonus item: *"Find a bug in Embedded Python"*.
Two independently reproducible defects of the `%SYS.Python.Run()` API are reported below (a third, lower-severity observation about the `iris.globals` wrapper is included for completeness). All findings were observed on a live, unmodified production build.

## Environment

| Item | Value |
|------|-------|
| Product | InterSystems IRIS for Windows (x86-64) **2026.2 (Build 221U) EDT** |
| Embedded Python | **CPython 3.11.9** (`tags/v3.11.9:de54cf5`, MSC v.1938, 64 bit, AMD64) |
| OS | Windows 10 (10.0.17763), 64-bit |
| Interface used | ObjectScript terminal, `USER` namespace |
| Reproduction script | [`ep_bug_repro.isc`](./ep_bug_repro.isc) in this folder (run: `Get-Content ep_bug_repro.isc | iris session IRIS -U USER`) |

---

## Bug Report #1 - `%SYS.Python.Run()` returns an ERROR status when the Python code succeeds

**Severity:** High (API contract violation; forces every caller to ignore the return value)

### Steps to reproduce

In an IRIS terminal (any namespace with Embedded Python enabled):

```objectscript
set sc=##class(%SYS.Python).Run("x=1")
write $system.Status.IsError(sc),!
do $system.Status.DisplayError(sc)
```

The script `x=1` is a valid Python statement that cannot fail.

### Expected behavior

`$system.Status.IsError(sc)` returns `0` (success), consistent with every other ObjectScript API that returns a `%Status`.

### Actual behavior

```
IsError = 1
Error #00: (no error description)
```

(The raw terminal output on the Chinese-locale validation instance is the localized equivalent of the line above; it is rendered in English here for portability.)

A fully successful Python execution yields an **error** `%Status`, error number `#00`, with **no error text**. The identical result is returned for `Run("print('hi')")` and for longer successful scripts (e.g. a script that temporarily redirects `sys.stdout` to an `io.StringIO` and restores it - see TEST 2 and TEST 4 of the repro script).

### Impact

- The documented success/failure indicator of the API is a **false positive** on every successful call.
- Callers following standard ObjectScript conventions (`If $$$ISERR(sc) Quit sc`) abort on success.
- Error code `#00` with empty description gives no hint that it is spurious.
- In LuminIRIS this initially made the Embedded Python REST endpoint report `status:"error"` while the Python code had executed correctly.

### Workaround

Do not branch on the returned `%Status`. Have the Python code capture its own result (and, on failure, `traceback.format_exc()`) into an IRIS global via `iris.gref(...)`, then determine success/failure in ObjectScript from that payload. This is exactly the mechanism used by `Luminiris.PythonApi`.

---

## Bug Report #2 - `%SYS.Python.Run()` returns a SUCCESS status when the Python code raises an exception, and the exception details are lost

**Severity:** High (silent failure; data-loss of diagnostic information)

### Steps to reproduce

```objectscript
set sc=##class(%SYS.Python).Run("raise Exception('boom-marker-123')")
write $system.Status.IsError(sc),!
do $system.Status.DisplayError(sc)
```

### Expected behavior

- `$system.Status.IsError(sc)` returns `1`.
- The `%Status` error text contains the Python exception type/message (at minimum the marker string `boom-marker-123`), ideally the traceback, so the ObjectScript caller can react to and log the real failure.

### Actual behavior

```
IsError = 0
Warning (-1) #00: (no error description)
```

- The call reports **success** (`IsError=0`) although the Python script raised an unhandled exception.
- The Python message `boom-marker-123` and the traceback appear **nowhere** in the `%Status`; they are only echoed to the principal device and cannot be captured programmatically from the return value.

### Impact

- **Silent failure**: an ObjectScript routine that runs user Python code via `Run()` cannot detect that execution failed - the failure is indistinguishable from success.
- Combined with Bug Report #1, the returned `%Status` is unusable in both directions: errors on success, success on error, never with the real error text.
- In a server/REST context (no interactive terminal) the Python traceback is completely invisible to the caller.

### Workaround

Wrap the Python source in a `try/except BaseException` block inside the script itself, serialize `traceback.format_exc()` into an IRIS global (`iris.gref('^NAME')[None] = traceback.format_exc()`), and treat the presence of a Python `Traceback (most recent call last)` marker as failure. LuminIRIS uses exactly this approach, which is why invalid user code (e.g. `1/0`) is correctly returned as `status:"error"` with a full `ZeroDivisionError` traceback.

---

## Additional Observation #3 - `iris.globals` is an empty placeholder wrapper; calling it raises a misleading `NameError`

**Severity:** Low/Medium (API discoverability and documentation)

### Steps to reproduce

```python
import iris
print(hasattr(iris, "globals"))   # True  - the attribute exists
print(dir(iris.globals))          # []    - but it exposes nothing
iris.globals.set("^X", "v")       # NameError
```

Verified live via the in-process shell and via the deployed REST console:

```
has iris.globals: True
dir(iris.globals): []
NameError: Cannot call an iris.package wrapper. If you were trying to call a
method of an ObjectScript class, check that the name of the wrapper is
correct. Given name was: globals.set
```

### Expected behavior

Either a documented, functional `iris.globals` API, or the placeholder should not exist; the error message should point to the actual supported API.

### Actual behavior

The attribute exists but resolves to an empty `iris.package` wrapper with no members; invoking an assumed method (`set`/`get`) raises a `NameError` whose text ("check that the name of the wrapper is correct") sends the developer in the wrong direction. The working API is `iris.gref('^NAME')` (subscripted root-node access with key `None`), which is not obvious from this error.

### Workaround

Use `g = iris.gref('^NAME'); g[None] = value; print(g[None])` for root-node global read/write.

---

## Summary

| # | Defect | Reproducible by | Points claimed |
|---|--------|-----------------|----------------|
| 1 | `Run()` returns error status on success | 3 lines of ObjectScript | 2 (first reproducible bug) |
| 2 | `Run()` returns success status on Python exception; exception details discarded | 3 lines of ObjectScript | 1 (second reproducible bug) |
| 3 | `iris.globals` empty wrapper with misleading error | 3 lines of Python | additional finding |

Both #1 and #2 are deterministic, require no special configuration beyond a working Embedded Python installation, and are reproduced by the single attached script `ep_bug_repro.isc`.
