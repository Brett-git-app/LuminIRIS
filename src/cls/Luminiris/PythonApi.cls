/// Luminiris.PythonApi - Embedded Python REST endpoint for LuminIRIS.
///
/// Demonstrates InterSystems IRIS Embedded Python for the contest bonus points.
/// Deployed as a dedicated REST application at /luminiris/api :
///   GET  /luminiris/api/python/info  -> Python environment information
///   POST /luminiris/api/python/exec  -> execute Python code, return stdout
///
/// All code runs inside the IRIS process via ##class(%SYS.Python).Run();
/// no external Python interpreter is required.
///
/// IPC note: results are returned through IRIS globals using iris.gref
/// (root node keyed by None), which never touches the CSP output device.
Class Luminiris.PythonApi Extends %CSP.REST
{

Parameter CONTENTTYPE = "application/json";

Parameter HandleCorsRequest = 1;

XData UrlMap
{
<Routes>
  <Route Url="/python/info" Method="get"  Call="GetInfo"/>
  <Route Url="/python/exec" Method="post" Call="ExecCode"/>
</Routes>
}

/// GET /python/info - collect Python runtime info via Embedded Python.
ClassMethod GetInfo() As %Status
{
    Set %response.ContentType = "application/json"
    Set %response.CharSet = "utf-8"

    Set ret = {}

    // Probe runs in-process. A top-level try/except captures the real
    // Python traceback into the global, because %SYS.Python.Run returns
    // only an opaque status (#00) when the script raises.
    Set probe = "import sys, platform, json, traceback, iris" _ $c(10) _
        "_r = {}" _ $c(10) _
        "try:" _ $c(10) _
        "    info = {" _
        "'version': sys.version.split()[0], " _
        "'version_full': sys.version, " _
        "'platform': platform.platform(), " _
        "'machine': platform.machine(), " _
        "'processor': platform.processor(), " _
        "'impl': platform.python_implementation(), " _
        "'executable': sys.executable, " _
        "'path': sys.path[:5]" _
        "}" _ $c(10) _
        "    info['packages'] = []" _ $c(10) _
        "    for m in ['numpy','pandas','sklearn','scipy','matplotlib','flask','fastapi','requests','sqlalchemy']:" _ $c(10) _
        "        try:" _ $c(10) _
        "            __import__(m); info['packages'].append(m)" _ $c(10) _
        "        except Exception: pass" _ $c(10) _
        "    try:" _ $c(10) _
        "        info['iris_module'] = True" _ $c(10) _
        "        try:" _ $c(10) _
        "            info['iris_version'] = iris.cls('%SYSTEM.Version').GetVersion()" _ $c(10) _
        "        except Exception:" _ $c(10) _
        "            try:" _ $c(10) _
        "                info['iris_version'] = iris.system.Version.GetVersion()" _ $c(10) _
        "            except Exception as e2:" _ $c(10) _
        "                info['iris_version'] = 'unknown: ' + str(e2)" _ $c(10) _
        "    except Exception as e:" _ $c(10) _
        "        info['iris_module'] = True" _ $c(10) _
        "        info['iris_version'] = str(e)" _ $c(10) _
        "    _r = info" _ $c(10) _
        "except BaseException:" _ $c(10) _
        "    _r = {'_pyerror': traceback.format_exc()}" _ $c(10) _
        "iris.gref('^LUM.PYINFO')[None] = json.dumps(_r, ensure_ascii=False, default=str)"

    Kill ^LUM.PYINFO
    Set sc = ##class(%SYS.Python).Run(probe)

    Set json = $Get(^LUM.PYINFO)
    Kill ^LUM.PYINFO

    If json = "" {
        Set ret.status = "error"
        Set ret.message = "Embedded Python returned no data (run status: " _ $system.Status.GetErrorText(sc) _ ")"
    } Else {
        Set parsed = ##class(%DynamicAbstractObject).%FromJSON(json)
        Set pyErr = parsed.%Get("_pyerror")
        If (pyErr '= "") {
            Set ret.status = "error"
            Set ret.message = pyErr
        } Else {
            Set ret.status = "ok"
            Set ret.result = parsed
        }
    }
    Write ret.%ToJSON()
    Quit $$$OK
}

/// POST /python/exec - execute user Python code, capture stdout/stderr.
/// Request JSON body: {"code": "<python source>"}
ClassMethod ExecCode() As %Status
{
    Set %response.ContentType = "application/json"
    Set %response.CharSet = "utf-8"

    Set ret = {}

    Set pCode = ""
    Try {
        Do %request.Content.Rewind()
        Set req = {}.%FromJSON(%request.Content)
        Set pCode = req.code
    } Catch {
        Set pCode = ""
    }

    If pCode = "" {
        Set ret.status = "error"
        Set ret.message = "no code provided"
        Write ret.%ToJSON()
        Quit $$$OK
    }

    // Pass user code via a global to avoid quoting issues.
    Set ^LUM.PYCODE = pCode

    // Wrapper: read code, capture stdout/stderr, exec, return via ^LUM.PYOUT.
    // Outer try/except guarantees the output global is always written.
    Set wrapper = "import sys, io, traceback, iris" _ $c(10) _
        "out = ''" _ $c(10) _
        "try:" _ $c(10) _
        "    code = iris.gref('^LUM.PYCODE')[None]" _ $c(10) _
        "    buf = io.StringIO()" _ $c(10) _
        "    saved = sys.stdout" _ $c(10) _
        "    sys.stdout = buf" _ $c(10) _
        "    sys.stderr = buf" _ $c(10) _
        "    try:" _ $c(10) _
        "        exec(compile(code, '<luminiris>', 'exec'), {'__name__':'__main__'})" _ $c(10) _
        "    except Exception:" _ $c(10) _
        "        traceback.print_exc()" _ $c(10) _
        "    finally:" _ $c(10) _
        "        sys.stdout = saved" _ $c(10) _
        "        sys.stderr = sys.__stderr__" _ $c(10) _
        "    out = buf.getvalue()" _ $c(10) _
        "except BaseException:" _ $c(10) _
        "    out = traceback.format_exc()" _ $c(10) _
        "iris.gref('^LUM.PYOUT')[None] = out"

    Kill ^LUM.PYOUT
    Set sc = ##class(%SYS.Python).Run(wrapper)
    Set out = $Get(^LUM.PYOUT)
    Kill ^LUM.PYCODE, ^LUM.PYOUT

    // %SYS.Python.Run may return an opaque non-OK status (#00) even when the
    // script ran fine. Treat a populated output without a traceback as success.
    Set isErr = (out [ "Traceback (most recent call last)")!((out = "")&$$$ISERR(sc))
    Set ret.status = $Select(isErr: "error", 1: "ok")
    Set ret.executed = 1
    If out = "" {
        Set ret.output = "(no output)"
    } Else {
        Set ret.output = out
    }
    If isErr,(out = "") {
        Set ret.output = "IRIS Python runtime error: " _ $system.Status.GetErrorText(sc)
    }
    Write ret.%ToJSON()
    Quit $$$OK
}

}
