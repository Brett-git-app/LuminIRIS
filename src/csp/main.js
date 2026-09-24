// =====================================================================
// LuminIRIS - Official SysAdmin API Client
// Direct integration with /api/admin (IRIS 2026.2+, mainspec_v2.json)
// Auth: JWT (access_token 60s + refresh_token 15min, auto-refresh)
// =====================================================================

const API_BASE = "/api/admin";
const REFRESH_INTERVAL = 50 * 1000; // access_token valid 60s; refresh every 50s

// ---------- Global State ----------
let accessToken = null;
let refreshToken = null;
let refreshTimer = null;

// ---------- Tab Title Mapping ----------
const TAB_TITLES = {
    overview:   { title: "System Overview",  subtitle: "Real-time monitoring via official /api/admin" },
    webapp:     { title: "Web & REST API",   subtitle: "CSP applications and REST endpoints" },
    permission: { title: "Permissions",      subtitle: "Users and roles management" },
    task:       { title: "System Tasks",     subtitle: "Scheduled tasks and running processes" },
    log:        { title: "Audit Logs",       subtitle: "Security audit records" },
    python:     { title: "Embedded Python",  subtitle: "Run Python code inside IRIS 2026.2" }
};

// =====================================================================
// Auth Module
// =====================================================================

async function irisLogin(user, pass) {
    const res = await fetch(API_BASE + "/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: user, password: pass })
    });
    if (res.status !== 200) return false;
    const d = await res.json();
    accessToken = d.access_token;
    refreshToken = d.refresh_token;
    if (!accessToken) return false;
    startTokenRefresh();
    return true;
}

function startTokenRefresh() {
    stopTokenRefresh();
    refreshTimer = setInterval(async () => {
        try {
            const res = await fetch(API_BASE + "/refresh", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refresh_token: refreshToken })
            });
            if (res.status === 200) {
                const d = await res.json();
                accessToken = d.access_token;
                if (d.refresh_token) refreshToken = d.refresh_token;
            } else {
                showLogin("Session expired, please sign in again");
            }
        } catch (e) { /* network glitch ignored, retry next round */ }
    }, REFRESH_INTERVAL);
}

function stopTokenRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

function irisLogout() {
    try { fetch(API_BASE + "/logout", { method: "POST", headers: authHeader() }); } catch (e) {}
    accessToken = refreshToken = null;
    stopTokenRefresh();
    showLogin();
}

function authHeader() {
    return { "Authorization": "Bearer " + (accessToken || "") };
}

// =====================================================================
// API Client (auto-retry once on 401)
// =====================================================================

async function apiCall(path, method) {
    method = method || "GET";
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetch(API_BASE + path, { method: method, headers: authHeader() });
            if (res.status === 401) continue;
            const d = await res.json();
            if (d && d.result !== undefined) return d.result;
            return null;
        } catch (e) { return null; }
    }
    return null;
}

// =====================================================================
// Login UI Control
// =====================================================================

function showLogin(msg) {
    stopTokenRefresh();
    const overlay = document.getElementById("login-overlay");
    overlay.style.display = "flex";
    document.getElementById("login-msg").innerText = msg || "";
    setTimeout(() => document.getElementById("login-user").focus(), 100);
}

function hideLogin() {
    document.getElementById("login-overlay").style.display = "none";
}

async function doLogin() {
    const user = document.getElementById("login-user").value.trim();
    const pass = document.getElementById("login-pass").value;
    const msg = document.getElementById("login-msg");
    if (!user || !pass) { msg.innerText = "Please enter username and password"; return; }
    msg.innerText = "Signing in...";
    const ok = await irisLogin(user, pass);
    if (ok) {
        hideLogin();
        document.getElementById("login-pass").value = "";
        loadAll();
    } else {
        msg.innerText = "Invalid credentials or API unavailable";
    }
}

// =====================================================================
// Initialization
// =====================================================================

function initApp() {
    document.querySelectorAll(".nav-item").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(btn.dataset.tab).classList.add("active");
            const meta = TAB_TITLES[btn.dataset.tab];
            if (meta) {
                document.getElementById("page-title").innerText = meta.title;
                document.getElementById("page-subtitle").innerText = meta.subtitle;
            }
            // Lazy-load Python module only when its tab is opened
            if (btn.dataset.tab === "python") loadPython();
        };
    });
    document.getElementById("login-btn").onclick = doLogin;
    document.getElementById("login-pass").onkeydown = e => { if (e.key === "Enter") doLogin(); };
    document.getElementById("logout-btn").onclick = irisLogout;
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
} else {
    initApp();
}

window.onload = function () { showLogin(); };
if (document.readyState === "complete") { showLogin(); }

// =====================================================================
// Rendering Helpers
// =====================================================================

function setBar(id, pct) {
    const el = document.getElementById(id);
    if (el) el.style.width = Math.min(100, Math.max(0, pct)) + "%";
}

function esc(s) {
    return String(s == null ? "-" : s).replace(/</g, "&lt;");
}

function statusTag(text, cls) {
    return '<span class="status-tag ' + cls + '">' + esc(text) + "</span>";
}

function fmtBool(v, yes, no) { return v ? (yes || "Enabled") : (no || "Disabled"); }

// =====================================================================
// Module Loaders (all official APIs)
// =====================================================================

// ---------- Overview: /info + /v2/monitor/dashboard/main ----------
async function loadOverview() {
    // Instance info
    const info = await apiCall("/info");
    if (info) {
        document.getElementById("info-version").innerText = info.serverVersion || "--";
        document.getElementById("info-user").innerText = info.username || "--";
        document.getElementById("instance-name").innerText = info.product ? info.product.toUpperCase() : "IRIS";
        const ns = (info.namespaces || []).map(n => n.name).join(", ");
        document.getElementById("info-namespace").innerText = ns || "--";
    }

    // Performance panel
    const perf = await apiCall("/v2/monitor/dashboard/main");
    if (perf && perf.Performance) {
        const p = perf.Performance;
        document.getElementById("m-cache").innerText = (p.CacheEfficiency != null ? p.CacheEfficiency : "--");
        setBar("m-cache-bar", p.CacheEfficiency || 0);
        document.getElementById("m-globals").innerText = p.GlobalRefsPerSecond != null ? p.GlobalRefsPerSecond.toLocaleString() : "--";
        document.getElementById("m-sets").innerText = p.GlobalSetKill != null ? p.GlobalSetKill.toLocaleString() : "--";
        document.getElementById("m-diskread").innerText = p.DiskReads != null ? p.DiskReads.toLocaleString() : "--";
        document.getElementById("m-diskwrite").innerText = p.DiskWrites != null ? p.DiskWrites.toLocaleString() : "--";
    }

    // System resources
    const res = await apiCall("/v2/monitor/dashboard/system-resources");
    if (Array.isArray(res)) {
        const m = document.getElementById("resource-bars");
        m.innerHTML = res.slice(0, 6).map(r =>
            '<div class="res-row">' +
            '<span class="res-name">' + esc(r.Name) + "</span>" +
            '<div class="res-bar"><div class="res-bar-fill" style="width:' +
            Math.min(100, (r.Seize || 0) / 50) + '%"></div></div>' +
            '<span class="res-val">' + esc(r.Seize) + "</span></div>"
        ).join("");
    }
}

// ---------- WebApps: /v2/web-apps ----------
async function loadWebApp() {
    const list = await apiCall("/v2/web-apps");
    const body = document.getElementById("webapp-body");
    const count = document.getElementById("webapp-count");
    if (Array.isArray(list) && list.length) {
        count.innerText = list.length;
        body.innerHTML = list.map(x =>
            "<tr><td>" + esc(x.Name) + "</td>" +
            "<td>" + esc(x.Namespace) + "</td>" +
            "<td>" + esc(x.Type || "CSP") + "</td>" +
            "<td>" + esc((x.AuthenticationMethods || []).join(", ")) + "</td>" +
            "<td>" + statusTag(fmtBool(x.Enabled), x.Enabled ? "running" : "off") + "</td></tr>"
        ).join("");
    } else {
        count.innerText = "0";
        body.innerHTML = '<tr><td colspan="5" class="loading">No data</td></tr>';
    }
}

// ---------- Permissions: /v2/security/users + /v2/security/roles ----------
async function loadPerm() {
    const users = await apiCall("/v2/security/users");
    const body = document.getElementById("perm-body");
    const count = document.getElementById("perm-count");
    if (Array.isArray(users) && users.length) {
        count.innerText = users.length;
        body.innerHTML = users.map(x =>
            "<tr><td>" + esc(x.Name) + "</td>" +
            "<td>" + esc(x.FullName) + "</td>" +
            "<td>" + esc(x.Type) + "</td>" +
            "<td>" + statusTag(fmtBool(x.Enabled), x.Enabled ? "running" : "off") + "</td></tr>"
        ).join("");
    } else {
        count.innerText = "0";
        body.innerHTML = '<tr><td colspan="4" class="loading">No data</td></tr>';
    }

    const roles = await apiCall("/v2/security/roles");
    const rWrap = document.getElementById("role-tags");
    if (Array.isArray(roles) && roles.length) {
        document.getElementById("role-count").innerText = roles.length;
        rWrap.innerHTML = roles.slice(0, 40).map(r =>
            '<span class="role-tag" title="' + esc(r.Description) + '">' + esc(r.Name) + "</span>"
        ).join("");
    }
}

// ---------- Tasks: /v2/tasks + /v2/processes ----------
async function loadTask() {
    const tasks = await apiCall("/v2/tasks");
    const body = document.getElementById("task-body");
    const count = document.getElementById("task-count");
    if (Array.isArray(tasks) && tasks.length) {
        count.innerText = tasks.length;
        body.innerHTML = tasks.map(x =>
            "<tr><td>" + esc(x.Name) + "</td>" +
            "<td>" + esc(x.Type) + "</td>" +
            "<td>" + esc(x.Namespace) + "</td>" +
            "<td>" + esc(x.NextScheduled || "-") + "</td>" +
            "<td>" + statusTag(x.Suspended ? "Suspended" : "Active", x.Suspended ? "off" : "running") + "</td></tr>"
        ).join("");
    } else {
        count.innerText = "0";
        body.innerHTML = '<tr><td colspan="5" class="loading">No scheduled tasks</td></tr>';
    }

    const procs = await apiCall("/v2/processes?maxRows=50");
    const pBody = document.getElementById("proc-body");
    const pCount = document.getElementById("proc-count");
    if (Array.isArray(procs) && procs.length) {
        pCount.innerText = procs.length;
        pBody.innerHTML = procs.map(x =>
            "<tr><td>" + esc(x.Pid) + "</td>" +
            "<td>" + esc(x.Nspace || "-") + "</td>" +
            "<td>" + esc(x.Routine || "-") + "</td>" +
            "<td>" + esc(x.State || "-") + "</td></tr>"
        ).join("");
    } else {
        pCount.innerText = "0";
        pBody.innerHTML = '<tr><td colspan="4" class="loading">No processes</td></tr>';
    }
}

// ---------- Logs: POST /v2/security/audit/records (202 async task -> poll location) ----------
async function loadLog() {
    const body = document.getElementById("log-body");
    const count = document.getElementById("log-count");
    let records = null;
    try {
        const res = await fetch(API_BASE + "/v2/security/audit/records", { method: "POST", headers: authHeader() });
        if (res.status === 202) {
            // Async task mode: poll location until Finished
            const loc = res.headers.get("location");
            if (loc) {
                for (let i = 0; i < 5; i++) {
                    await new Promise(r => setTimeout(r, 600));
                    const pr = await fetch(loc, { headers: authHeader() });
                    if (pr.status !== 200) continue;
                    const pd = await pr.json();
                    const task = pd.result || {};
                    if (task.State === "Finished") {
                        records = task.Result || [];
                        break;
                    }
                    if (task.FailureReason) break;
                }
            }
        } else if (res.status === 200) {
            const d = await res.json();
            records = Array.isArray(d.result) ? d.result : (d.result && d.result.Result) || [];
        }
    } catch (e) { records = null; }

    if (Array.isArray(records) && records.length) {
        count.innerText = records.length;
        body.innerHTML = records.slice(0, 100).map(r => {
            const isSec = /Security/i.test(r.EventType || "");
            const cls = isSec ? "#fbbf24" : "#6ee7b7";
            return '<div class="log-line">[' + esc(r.TimeStamp || r.UTCTimeStamp || "-") + "] " +
                '<span style="color:' + cls + '">[' + esc(r.EventSource || "-") + "/" + esc(r.Event || "-") + "]</span> " +
                esc(r.Username || "-") + " \u2014 " + esc((r.Description || "").split("\n")[0].substring(0, 80)) + "</div>";
        }).join("");
    } else {
        count.innerText = "0";
        body.innerHTML = '<div class="log-line">No audit records returned (task pending or empty)</div>';
    }
}

function loadAll() {
    loadOverview();
    loadWebApp();
    loadPerm();
    loadTask();
    loadLog();
}

// =====================================================================
// Embedded Python Module
// =====================================================================

// Dedicated REST application serving the Embedded Python endpoints
// (Luminiris.PythonApi extends %CSP.REST, mapped via UrlMap XData).
const PY_BASE = "/luminiris/api/python";

async function loadPython() {
    const badge = document.getElementById("py-status");
    try {
        const res = await fetch(PY_BASE + "/info", { headers: authHeader() });
        const d = await res.json();
        if (d.status === "ok" && d.result) {
            const r = d.result;
            badge.innerText = "\u25CF ready";
            badge.className = "py-hero-badge py-ok";
            document.getElementById("py-version").innerText = r.version || "--";
            document.getElementById("py-impl").innerText = r.impl || "--";
            document.getElementById("py-platform").innerText = r.platform || "--";
            document.getElementById("py-machine").innerText = r.machine || "--";
            document.getElementById("py-exec").innerText = r.executable || "--";
            document.getElementById("py-iris").innerText = r.iris_module ? "loaded" : "--";
            document.getElementById("py-irisver").innerText = r.iris_version || "--";
            const pkgs = r.packages || [];
            document.getElementById("py-pkgs").innerText = pkgs.length;
            document.getElementById("py-pkglist").innerHTML = pkgs.map(p =>
                '<span class="py-pkg-tag">' + esc(p) + "</span>").join("") ||
                '<span style="color:var(--text-2)">none</span>';
        } else {
            badge.innerText = "\u25CF unavailable";
            badge.className = "py-hero-badge py-err";
        }
    } catch (e) {
        badge.innerText = "\u25CF error";
        badge.className = "py-hero-badge py-err";
    }
}

async function runPython() {
    const btn = document.getElementById("py-run-btn");
    const out = document.getElementById("py-output");
    const code = document.getElementById("py-code").value;
    btn.disabled = true;
    btn.classList.add("running");
    out.innerText = "$ python main.py\n[running...]";
    try {
        const res = await fetch(PY_BASE + "/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeader() },
            body: JSON.stringify({ code: code })
        });
        const d = await res.json();
        out.innerText = "$ python main.py\n" + (d.output || "(no output)");
    } catch (e) {
        out.innerText = "$ python main.py\nNetwork error: " + e.message;
    } finally {
        btn.disabled = false;
        btn.classList.remove("running");
    }
}

const SNIPPETS = {
    sys: "import sys, platform\nprint('Python', sys.version.split()[0])\nprint('Platform:', platform.platform())\nprint('Path entries:', len(sys.path))",
    iris: "import iris\nprint('IRIS version:', iris.cls('%SYSTEM.Version').GetVersion())\n# Write/read a global via the native iris.gref binding\ng = iris.gref('^LUM.DEMO')\ng[None] = 'hello from Embedded Python'\nprint('^LUM.DEMO =', g[None])\ndel g[None]\nprint('demo global cleaned up')",
    math: "import math\nprint('pi =', math.pi)\nprint('e  =', math.e)\nprint('sqrt(2) =', math.sqrt(2))\nprint('factorial(10) =', math.factorial(10))\nfor i in range(5):\n    print(f'2^{i} = {2**i}')",
    json: "import json\ndata = {'portal': 'LuminIRIS', 'features': ['monitoring','security','python'], 'score': 100}\nprint(json.dumps(data, indent=2))\nback = json.loads(json.dumps(data))\nprint('round-trip ok:', back['features'])"
};

function loadSnippet(key) {
    document.getElementById("py-code").value = SNIPPETS[key] || "";
}

// Allow Ctrl+Enter to run Python code in the editor
document.addEventListener("DOMContentLoaded", () => {
    const ed = document.getElementById("py-code");
    if (ed) ed.addEventListener("keydown", e => {
        if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); runPython(); }
    });
});

