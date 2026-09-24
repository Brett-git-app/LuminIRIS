/// Luminiris.Installer - minimal bootstrap installer (used only when IPM is unavailable)
/// With IPM this class is NOT needed: module.xml deploys the CSP files and
/// compiles the classes automatically.
Class Luminiris.Installer
{

/// Minimal install.
///   srcDir - absolute path of the local src/csp directory; optional.
///            Pass "" (IPM flow) when the files are already in place.
/// Steps:
///   1. read the real physical Path of the /csp/user Web application,
///   2. copy the static front-end files to <csp-user-path>/luminiris/,
///   3. compile Luminiris.PythonApi (Embedded Python REST dispatcher),
///   4. create the /luminiris/api REST application (JWT-secured),
///   5. allow anonymous access to the static pages only.
/// The /api/admin data endpoints stay protected by the portal JWT login.
ClassMethod Install(srcDir As %String = "") As %Status
{
    Set origNS = $namespace

    // ---------- 1) Configure /csp/user static application ----------
    zn "%SYS"
    Kill cfg
    Set sc = ##class(Security.Applications).Get("/csp/user", .cfg)
    If $$$ISERR(sc) {
        zn origNS
        Write "GET /csp/user FAILED: ", $system.Status.GetErrorText(sc), !
        Quit sc
    }
    Set target = ##class(%File).NormalizeDirectory(cfg("Path") _ "luminiris")
    Write "csp/user Path = ", cfg("Path"), !
    Write "LuminIRIS target = ", target, !

    // 65 = Password(1) + Unauthenticated(64). LockCSPName=0 serves copied
    // static files without a manual CSP registration step.
    Set cfg("AutheEnabled") = 65
    Set cfg("LockCSPName") = 0
    Set sc = ##class(Security.Applications).Modify("/csp/user", .cfg)
    If $$$ISERR(sc) {
        zn origNS
        Write "SECURITY CONFIG FAILED: ", $system.Status.GetErrorText(sc), !
        Quit sc
    }

    // ---------- 2) Create/update the /luminiris/api REST application ----------
    Do ..EnsureRestApp()
    zn origNS

    // ---------- 3) Copy the static front-end files ----------
    Do ##class(%File).CreateDirectoryChain(target)
    If (srcDir '= "") {
        Set srcDir = ##class(%File).NormalizeDirectory(srcDir)
        For i = 1:1:3 {
            Set f = $list($listbuild("index.html", "style.css", "main.js"), i)
            Set sc = ##class(%File).CopyFile(srcDir _ f, target _ f)
            If $$$ISERR(sc) {
                Write "COPY FAILED: ", f, " -> ", $system.Status.GetErrorText(sc), !
                Quit sc
            }
            Write "copied: ", f, !
        }

        // ---------- 4) Compile the Embedded Python REST dispatcher ----------
        // srcDir is .../src/csp ; the class lives in .../src/cls
        // CRITICAL: %CSP.REST is only visible in %SYS namespace, so we must
        // compile PythonApi there (same pattern as official /api/admin).
        Set clsFile = ##class(%File).NormalizeDirectory(srcDir _ "../cls") _
                      "Luminiris/PythonApi.cls"
        If ##class(%File).Exists(clsFile) {
            zn "%SYS"
            Write "compiling: ", clsFile, " (in %SYS)", !
            Set sc = $system.OBJ.Load(clsFile, "ck")
            If $$$ISERR(sc) {
                Write "COMPILE WARNING: ", $system.Status.GetErrorText(sc), !
            } Else {
                Write "compiled: Luminiris.PythonApi (in %SYS)", !
            }
            If origNS '= "%SYS" { zn origNS }
        } Else {
            Write "class not found (skip): ", clsFile, !
        }
    }

    Write !, "[OK] Portal:  http://localhost:52773/csp/user/luminiris/index.html", !
    Write "[OK] Python:  http://localhost:52773/luminiris/api/python/info", !
    Quit $$$OK
}

/// Create /luminiris/api as a REST dispatch application (idempotent).
/// Runs in the %SYS namespace (CRITICAL: must match where the class is
/// compiled, since %CSP.REST is only visible in %SYS).  Same pattern as
/// the official /api/admin application.
ClassMethod EnsureRestApp() As %Status
{
    Set app = "/luminiris/api"
    Set props("Namespace") = "%SYS"        // must match PythonApi compile namespace
    Set props("Type") = 2                   // REST application type (critical!)
    Set props("Enabled") = 1
    Set props("DispatchClass") = "Luminiris.PythonApi"
    Set props("AutheEnabled") = 32           // JWT auth (same as /api/admin)
    Set props("JWTAuthEnabled") = 1          // enable JWT validation

    Set exists = 1
    Set sc = ##class(Security.Applications).Get(app, .old)
    If $$$ISERR(sc) {
        Set exists = 0
        Set sc = ##class(Security.Applications).Create(app, .props)
        Write "REST app created: ", app, " : ", $system.Status.GetErrorText(sc), !
    } Else {
        Set sc = ##class(Security.Applications).Modify(app, .props)
        Write "REST app updated: ", app, " : ", $system.Status.GetErrorText(sc), !
    }
    Quit sc
}

/// Revert configuration: password-only on /csp/user and remove the REST app.
/// Static files are kept on disk.
ClassMethod Uninstall() As %Status
{
    Set origNS = $namespace
    zn "%SYS"

    Kill cfg
    Set cfg("AutheEnabled") = 1
    Set sc1 = ##class(Security.Applications).Modify("/csp/user", .cfg)

    Set sc2 = ##class(Security.Applications).Delete("/luminiris/api")

    zn origNS
    Write "Uninstall /csp/user: ", $system.Status.GetErrorText(sc1), !
    Write "Uninstall /luminiris/api: ", $system.Status.GetErrorText(sc2), !
    Quit sc1
}

}
