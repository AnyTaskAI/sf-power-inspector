import { sfConn, apiVersion, updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";

const sfHost = resolveSfHost();
let rawResponseData = null;
let currentTableRows = [];
let currentTableColumns = [];

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
}

function setupEvents() {
  document.getElementById("btn-send").addEventListener("click", sendRequest);

  // Tab switching
  document.querySelectorAll("#response-tabs .tool-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#response-tabs .tool-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab;
      document.getElementById("json-view-container").style.display = target === "json" ? "block" : "none";
      document.getElementById("table-view-container").style.display = target === "table" ? "flex" : "none";
    });
  });

  // Table search & CSV export
  document.getElementById("table-search-input").addEventListener("input", filterAndRenderTable);
  document.getElementById("btn-export-table-csv").addEventListener("click", exportTableCsv);

  // Preset Endpoints
  document.getElementById("preset-endpoints").addEventListener("change", (e) => {
    const val = e.target.value;
    if (!val) return;
    const [method, url] = val.split(":");
    document.getElementById("http-method").value = method;
    document.getElementById("api-url").value = url.replace("v62.0", `v${apiVersion}`);
    if (method === "POST" && url.includes("composite")) {
      document.getElementById("request-body").value = JSON.stringify({
        compositeRequest: [
          { method: "GET", url: `/services/data/v${apiVersion}/limits`, referenceId: "refLimits" },
          { method: "GET", url: `/services/data/v${apiVersion}/sobjects`, referenceId: "refSobjects" }
        ]
      }, null, 2);
    } else {
      document.getElementById("request-body").value = "";
    }
  });

  // Copy response
  document.getElementById("btn-copy-resp").addEventListener("click", () => {
    if (!rawResponseData) return;
    copyToClipboard(JSON.stringify(rawResponseData, null, 2), "Response JSON copied to clipboard!");
  });

  // Download response
  document.getElementById("btn-download-resp").addEventListener("click", () => {
    if (!rawResponseData) return;
    const blob = new Blob([JSON.stringify(rawResponseData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `salesforce-api-response-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

async function sendRequest() {
  const method = document.getElementById("http-method").value;
  const url = document.getElementById("api-url").value.trim();
  const rawBody = document.getElementById("request-body").value.trim();
  const statusEl = document.getElementById("response-status");
  const outputEl = document.getElementById("response-output");

  statusEl.textContent = "⏳ Sending...";
  outputEl.textContent = "";

  let body = undefined;
  if (rawBody && (method === "POST" || method === "PATCH" || method === "PUT")) {
    try {
      body = JSON.parse(rawBody);
    } catch (e) {
      statusEl.textContent = "❌ Invalid JSON in Request Body";
      outputEl.textContent = e.message;
      return;
    }
  }

  const startTime = performance.now();

  try {
    const res = await sfConn.rest(url, {
      method,
      body,
      bodyType: "json",
      responseType: "json"
    });
    rawResponseData = res;
    const duration = ((performance.now() - startTime) / 1000).toFixed(2);
    statusEl.innerHTML = `<span style="color:#16a34a;">✓ 200 OK (${duration}s)</span>`;

    // Render interactive JSON with clickable IDs
    renderInteractiveJson(res);

    // Render universal visual table view
    renderUniversalVisualTable(res);
  } catch (err) {
    const duration = ((performance.now() - startTime) / 1000).toFixed(2);
    statusEl.innerHTML = `<span style="color:#dc2626;">❌ Error (${duration}s)</span>`;
    outputEl.textContent = err.message;
    document.getElementById("table-record-count").textContent = "0";
    document.getElementById("visual-table-head").innerHTML = `<tr><th style="color:red">Request Error</th></tr>`;
    document.getElementById("visual-table-body").innerHTML = `<tr><td>${err.message}</td></tr>`;
  }
}

function renderInteractiveJson(data) {
  const outputEl = document.getElementById("response-output");
  const jsonStr = JSON.stringify(data, null, 2);

  // Replace any 15 or 18-char Salesforce ID with interactive links
  const linkedHtml = jsonStr.replace(
    /"([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})"/g,
    (match, id) => {
      if (/^(true|false|null|attributes)$/i.test(id)) return match;
      return `"<a href="https://${sfHost}/${id}" target="_blank" style="color:#0176d3; font-weight:700; text-decoration:underline;" title="Open in Salesforce">${id}</a>" <a href="inspect-record.html?host=${sfHost}&id=${id}" target="_blank" style="font-size:10px; background:#e0f2fe; color:#0369a1; padding:1px 5px; border-radius:3px; text-decoration:none;" title="Show All Data">🔍 Inspect</a>`;
    }
  );

  outputEl.innerHTML = linkedHtml;
}

// ----------------- Universal Visual Table Renderer -----------------

function renderUniversalVisualTable(data) {
  const countEl = document.getElementById("table-record-count");
  const badgeEl = document.getElementById("table-type-badge");
  document.getElementById("table-search-input").value = "";

  if (!data || typeof data !== "object") {
    countEl.textContent = "0";
    renderTableElements(["Message"], [["No tabular data returned"]]);
    return;
  }

  // Case 1: Standard Query or Tooling Query response with records array
  if (Array.isArray(data.records)) {
    badgeEl.textContent = "SOQL RECORDS";
    prepareRecordsTable(data.records);
    return;
  }

  // Case 2: SObjects describe collection (/services/data/vXX.X/sobjects)
  if (Array.isArray(data.sobjects)) {
    badgeEl.textContent = "SOBJECTS CATALOG";
    prepareRecordsTable(data.sobjects);
    return;
  }

  // Case 3: SObject describe with fields array (/sobjects/{type}/describe)
  if (Array.isArray(data.fields)) {
    badgeEl.textContent = "FIELDS METADATA";
    prepareRecordsTable(data.fields);
    return;
  }

  // Case 4: Composite API response (/services/data/vXX.X/composite)
  if (Array.isArray(data.compositeResponse)) {
    badgeEl.textContent = "COMPOSITE RESPONSES";
    const rows = data.compositeResponse.map(sub => ({
      referenceId: sub.referenceId,
      httpStatusCode: sub.httpStatusCode,
      bodyPreview: typeof sub.body === "object" ? JSON.stringify(sub.body).slice(0, 120) : String(sub.body ?? "")
    }));
    prepareRecordsTable(rows);
    return;
  }

  // Case 5: Root Array of objects
  if (Array.isArray(data)) {
    badgeEl.textContent = "ARRAY ITEMS";
    if (data.length > 0 && typeof data[0] === "object" && data[0] !== null) {
      prepareRecordsTable(data);
    } else {
      // Primitive array
      currentTableColumns = ["Index", "Value"];
      currentTableRows = data.map((v, i) => [i + 1, String(v ?? "")]);
      countEl.textContent = data.length;
      filterAndRenderTable();
    }
    return;
  }

  // Case 6: Key-Value Dictionary of Nested Metrics Objects (e.g. /services/data/vXX.X/limits)
  const keys = Object.keys(data);
  const isAllObjectValues = keys.length > 0 && keys.every(k => typeof data[k] === "object" && data[k] !== null);

  if (isAllObjectValues) {
    badgeEl.textContent = "ORG LIMITS / METRICS";
    // Check if values have Max and Remaining (like Salesforce Limits)
    const sampleVal = data[keys[0]];
    if ("Max" in sampleVal && "Remaining" in sampleVal) {
      currentTableColumns = ["Limit / Metric Name", "Max Limit", "Remaining", "Used", "Usage %", "Status Meter"];
      currentTableRows = keys.map(limitName => {
        const item = data[limitName];
        const max = item.Max || 0;
        const rem = item.Remaining || 0;
        const used = max - rem;
        const pct = max > 0 ? Math.round((used / max) * 100) : 0;
        return [
          limitName,
          max.toLocaleString(),
          rem.toLocaleString(),
          used.toLocaleString(),
          `${pct}%`,
          { pct, used, max }
        ];
      });
      countEl.textContent = keys.length;
      filterAndRenderTable();
      return;
    } else {
      // Generic dictionary of objects: transform into table with Key + extracted sub-properties
      const subKeys = Array.from(new Set(keys.flatMap(k => Object.keys(data[k]))));
      currentTableColumns = ["Key", ...subKeys];
      currentTableRows = keys.map(k => {
        const item = data[k];
        const row = [k];
        subKeys.forEach(sk => {
          let val = item[sk];
          if (typeof val === "object" && val !== null) val = JSON.stringify(val);
          row.push(val ?? "");
        });
        return row;
      });
      countEl.textContent = keys.length;
      filterAndRenderTable();
      return;
    }
  }

  // Case 7: Key-Value Dictionary of Primitives (Single Record or UserInfo, e.g. /services/oauth2/userinfo)
  badgeEl.textContent = "RECORD PROPERTIES";
  currentTableColumns = ["Property / Field", "Value"];
  currentTableRows = keys.map(k => {
    let val = data[k];
    if (typeof val === "object" && val !== null) val = JSON.stringify(val);
    return [k, val ?? ""];
  });
  countEl.textContent = keys.length;
  filterAndRenderTable();
}

function prepareRecordsTable(records) {
  const countEl = document.getElementById("table-record-count");
  if (!records || records.length === 0) {
    countEl.textContent = "0";
    renderTableElements(["Message"], [["Zero records in response"]]);
    return;
  }

  countEl.textContent = records.length;
  const first = records[0];
  const columns = Object.keys(first).filter(k => k !== "attributes");

  currentTableColumns = ["#", "Actions", ...columns];
  currentTableRows = records.map((rec, idx) => {
    const id = rec.Id || rec.id;
    const actions = id ? { isAction: true, id } : "—";
    const cells = [idx + 1, actions];
    columns.forEach(col => {
      let val = rec[col];
      if (typeof val === "object" && val !== null) val = JSON.stringify(val);
      cells.push(val ?? "");
    });
    return cells;
  });

  filterAndRenderTable();
}

function filterAndRenderTable() {
  const query = document.getElementById("table-search-input").value.trim().toLowerCase();

  let filtered = currentTableRows;
  if (query) {
    filtered = currentTableRows.filter(row =>
      row.some(cell => {
        if (typeof cell === "object" && cell !== null) return false;
        return String(cell).toLowerCase().includes(query);
      })
    );
  }

  renderTableElements(currentTableColumns, filtered);
}

function renderTableElements(columns, rows) {
  const thead = document.getElementById("visual-table-head");
  const tbody = document.getElementById("visual-table-body");

  thead.innerHTML = `<tr>` + columns.map(c => `<th>${c}</th>`).join("") + `</tr>`;

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${columns.length}" style="text-align:center; padding:20px; color:var(--text-muted);">No rows match the search query.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const cellsHtml = row.map(cell => {
      // Meter bar object
      if (typeof cell === "object" && cell !== null && "pct" in cell) {
        let color = "#16a34a";
        if (cell.pct >= 60) color = "#d97706";
        if (cell.pct >= 85) color = "#dc2626";
        return `
          <td style="width: 140px;">
            <div style="width: 100%; height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden;">
              <div style="width: ${Math.min(cell.pct, 100)}%; height: 100%; background: ${color};"></div>
            </div>
          </td>
        `;
      }

      // Actions column
      if (typeof cell === "object" && cell !== null && cell.isAction) {
        return `
          <td style="white-space: nowrap;">
            <a href="https://${sfHost}/${cell.id}" target="_blank" class="btn btn-secondary" style="font-size:10px; padding:2px 6px; text-decoration:none;">↗ Open</a>
            <a href="inspect-record.html?host=${sfHost}&id=${cell.id}" target="_blank" class="btn btn-primary" style="font-size:10px; padding:2px 6px; text-decoration:none;">🔍 Inspect</a>
          </td>
        `;
      }

      const strVal = String(cell ?? "");

      // Check for Salesforce 15 or 18 char ID
      const isSfId = /^[a-zA-Z0-9]{15}$|^[a-zA-Z0-9]{18}$/.test(strVal) && !/^(true|false|null)$/i.test(strVal);
      if (isSfId) {
        return `
          <td>
            <a href="https://${sfHost}/${strVal}" target="_blank" style="color:#0176d3; font-weight:600; text-decoration:none;">${strVal} ↗</a>
            <a href="inspect-record.html?host=${sfHost}&id=${strVal}" target="_blank" style="font-size:10px; background:#e0f2fe; color:#0369a1; padding:1px 4px; border-radius:3px; text-decoration:none; margin-left:4px;">🔍</a>
          </td>
        `;
      }

      return `<td title="${strVal}">${strVal}</td>`;
    }).join("");

    return `<tr>${cellsHtml}</tr>`;
  }).join("");
}

function exportTableCsv() {
  if (currentTableRows.length === 0) {
    alert("No table data to export.");
    return;
  }

  const exportCols = currentTableColumns.filter(c => c !== "Actions" && c !== "Status Meter");
  const colIndices = exportCols.map(c => currentTableColumns.indexOf(c));

  const csvRows = [exportCols.map(c => `"${c.replace(/"/g, '""')}"`).join(",")];

  currentTableRows.forEach(row => {
    const vals = colIndices.map(idx => {
      const v = row[idx];
      return `"${String(v ?? "").replace(/"/g, '""')}"`;
    });
    csvRows.push(vals.join(","));
  });

  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rest-table-export-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function copyToClipboard(text, msg) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
    alert(msg);
  } catch (e) {
    alert("Copy failed.");
  } finally {
    document.body.removeChild(textarea);
  }
}

init();
