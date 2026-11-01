import { sfConn, apiVersion, updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";

const sfHost = resolveSfHost();
let allLogs = [];
let currentLogId = null;

async function init() {
  if (!sfHost) {
    alert("Salesforce host not found.");
    return;
  }

  // Pre-render immediately with cached info
  let orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
  updateNavbarOrgBadge(sfHost, orgInfo);

  await sfConn.getSession(sfHost);

  // Re-render with live org session details
  orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
  updateNavbarOrgBadge(sfHost, orgInfo);

  setupEvents();
  loadLogs();
}

async function loadLogs() {
  const tbody = document.getElementById("logs-body");
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px;">Fetching logs via Tooling API...</td></tr>`;

  try {
    const q = `SELECT Id, LogUser.Name, Operation, Status, StartTime, LogLength FROM ApexLog ORDER BY StartTime DESC LIMIT 50`;
    const res = await sfConn.query(q, true);
    allLogs = res.records || [];
    document.getElementById("log-count").textContent = allLogs.length;
    renderLogsList(allLogs);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:red; text-align:center; padding:20px;">Failed to load logs: ${e.message}</td></tr>`;
  }
}

function renderLogsList(logs) {
  const tbody = document.getElementById("logs-body");
  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px;">No logs recorded</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(l => {
    const time = new Date(l.StartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const isSuccess = l.Status === "Success";
    const statusStyle = isSuccess ? "color:#16a34a;" : "color:#dc2626; font-weight:bold;";
    const sizeKb = Math.round(l.LogLength / 1024) + " KB";

    return `
      <tr class="log-row" data-id="${l.Id}" style="cursor:pointer;">
        <td>${time}</td>
        <td>${l.LogUser?.Name || "-"}</td>
        <td title="${l.Operation}">${l.Operation}</td>
        <td style="${statusStyle}">${l.Status}</td>
        <td>${sizeKb}</td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".log-row").forEach(row => {
    row.addEventListener("click", () => {
      tbody.querySelectorAll(".log-row").forEach(r => r.style.background = "");
      row.style.background = "#eef4ff";
      loadLogBody(row.dataset.id);
    });
  });
}

async function loadLogBody(id) {
  currentLogId = id;
  const contentEl = document.getElementById("log-content");
  contentEl.textContent = "Loading log content...";
  document.getElementById("selected-log-info").textContent = `Viewing Log: ${id}`;
  document.getElementById("btn-download-log").disabled = false;

  try {
    const body = await sfConn.rest(`/services/data/v${apiVersion}/tooling/sobjects/ApexLog/${id}/Body/`, {
      responseType: "text"
    });
    contentEl.textContent = body;
  } catch (e) {
    contentEl.textContent = "Failed to load log body: " + e.message;
  }
}

async function enableLoggingForCurrentUser() {
  const btn = document.getElementById("btn-enable-trace");
  btn.textContent = "Setting TraceFlag...";
  btn.disabled = true;

  try {
    // 1. Get current user ID
    const userInfo = await sfConn.rest(`/services/oauth2/userinfo`);
    const userId = userInfo.user_id;

    // 2. Query or create DebugLevel
    let debugLevelId;
    const dlRes = await sfConn.tooling(`/query/?q=SELECT+Id+FROM+DebugLevel+WHERE+DeveloperName='SFPowerInspector'+LIMIT+1`);
    if (dlRes.records?.length > 0) {
      debugLevelId = dlRes.records[0].Id;
    } else {
      const createDl = await sfConn.tooling(`/sobjects/DebugLevel`, {
        method: "POST",
        body: {
          DeveloperName: "SFPowerInspector",
          MasterLabel: "SFPowerInspector",
          ApexCode: "FINEST",
          ApexProfiling: "INFO",
          Callout: "INFO",
          Database: "INFO",
          System: "DEBUG",
          Validation: "INFO",
          Visualforce: "INFO",
          Workflow: "INFO"
        }
      });
      debugLevelId = createDl.id;
    }

    // 3. Create or update TraceFlag (valid for 1 hour)
    const expiration = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await sfConn.tooling(`/sobjects/TraceFlag`, {
      method: "POST",
      body: {
        TracedEntityId: userId,
        DebugLevelId: debugLevelId,
        LogType: "USER_DEBUG",
        StartDate: new Date().toISOString(),
        ExpirationDate: expiration
      }
    });

    alert("✓ Debug logging enabled for your user for 1 hour!");
    btn.textContent = "✓ Logging Active";
  } catch (e) {
    alert("❌ Error configuring TraceFlag: " + e.message);
    btn.textContent = "⚡ Enable Logging for Me";
    btn.disabled = false;
  }
}

async function deleteAllLogs() {
  if (!confirm("Are you sure you want to delete all debug logs from this org?")) return;
  try {
    const res = await sfConn.tooling(`/query/?q=SELECT+Id+FROM+ApexLog+LIMIT+200`);
    const ids = res.records.map(r => r.Id);
    if (ids.length === 0) {
      alert("No logs to delete.");
      return;
    }
    for (const id of ids) {
      await sfConn.tooling(`/sobjects/ApexLog/${id}`, { method: "DELETE" });
    }
    alert(`✓ Deleted ${ids.length} logs.`);
    await loadLogs();
  } catch (e) {
    alert("❌ Error deleting logs: " + e.message);
  }
}

function setupEvents() {
  document.getElementById("btn-refresh").addEventListener("click", loadLogs);
  document.getElementById("btn-enable-trace").addEventListener("click", enableLoggingForCurrentUser);
  document.getElementById("btn-delete-all").addEventListener("click", deleteAllLogs);

  document.getElementById("log-filter").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = allLogs.filter(l =>
      (l.LogUser?.Name || "").toLowerCase().includes(q) ||
      (l.Operation || "").toLowerCase().includes(q) ||
      (l.Status || "").toLowerCase().includes(q)
    );
    renderLogsList(filtered);
  });

  document.getElementById("btn-download-log").addEventListener("click", () => {
    const body = document.getElementById("log-content").textContent;
    if (!body || !currentLogId) return;
    const blob = new Blob([body], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `apex-log-${currentLogId}.log`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

init();

