import { sfConn, apiVersion, updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";

let sfHost = resolveSfHost();

let cachedSObjects = [];
let targetObjectFields = [];
let currentExecutionResults = []; // array of { rowNum, success, id, error }

async function init() {
  if (!sfHost) {
    sfHost = resolveSfHost();
  }
  if (!sfHost) {
    // Attempt fallback from background service worker
    sfHost = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 2500);
      try {
        chrome.runtime.sendMessage({ message: "getActiveSfHost" }, (res) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(res || null);
        });
      } catch (e) {
        clearTimeout(timer);
        resolve(null);
      }
    });

    if (sfHost) {
      sessionStorage.setItem("sfpi_active_host", sfHost);
      localStorage.setItem("sfpi_last_host", sfHost);
    }
  }

  if (!sfHost) {
    alert("Salesforce host not connected. Please open the extension from an active Salesforce browser tab.");
    return;
  }

  // Pre-render immediately with cached info
  let orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
  updateNavbarOrgBadge(sfHost, orgInfo);

  await sfConn.getSession(sfHost);

  // Re-render with live org session details
  orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
  updateNavbarOrgBadge(sfHost, orgInfo);

  // Check URL params for target sobject
  const params = new URLSearchParams(window.location.search);
  const initialSObject = params.get("sobject") || "Account";
  const sobjectInput = document.getElementById("target-sobject");
  if (sobjectInput) sobjectInput.value = initialSObject;

  setupEvents();
  loadSObjectsCatalog();
  loadTargetFields(initialSObject);
}

async function loadSObjectsCatalog() {
  try {
    const res = await sfConn.getSObjects();
    cachedSObjects = Array.isArray(res) ? res : (res?.sobjects || []);
  } catch (e) {
    console.warn("Failed to load SObjects catalog:", e);
    cachedSObjects = [];
  }
}

async function loadTargetFields(sobjectName) {
  const extIdSelect = document.getElementById("upsert-ext-id");
  try {
    const meta = await sfConn.metadata(sobjectName);
    targetObjectFields = meta.fields || [];

    // Populate Upsert External ID dropdown
    const extIdFields = targetObjectFields.filter(f => f.externalId || f.idLookup || f.name === "Id");
    extIdSelect.innerHTML = `<option value="">Select External ID field...</option>` +
      extIdFields.map(f => `<option value="${f.name}">${f.name} (${f.label})</option>`).join("");
    
    // Refresh field mapping and preview if data exists
    updateFieldMapping();
  } catch (e) {
    console.warn(`Could not load fields for ${sobjectName}:`, e);
    targetObjectFields = [];
  }
}

function setupEvents() {
  const sobjectInput = document.getElementById("target-sobject");
  const dropdown = document.getElementById("sobject-suggestions");

  sobjectInput.addEventListener("input", (e) => {
    const term = e.target.value.trim().toLowerCase();
    if (!term) { dropdown.style.display = "none"; return; }

    const list = Array.isArray(cachedSObjects) ? cachedSObjects : (cachedSObjects?.sobjects || []);
    const matches = list
      .filter(o => o.name.toLowerCase().includes(term) || (o.label && o.label.toLowerCase().includes(term)))
      .slice(0, 10);

    if (matches.length === 0) { dropdown.style.display = "none"; return; }

    dropdown.innerHTML = matches.map(o => `
      <div class="autocomplete-item" data-name="${o.name}">
        <div>
          <strong>${o.name}</strong>
          <span style="font-size:11px; color:var(--text-muted); margin-left:6px;">${o.label || ""}</span>
        </div>
        <span class="autocomplete-badge">${o.custom ? "CUSTOM" : "STANDARD"}</span>
      </div>
    `).join("");
    dropdown.style.display = "block";
  });

  dropdown.addEventListener("click", (e) => {
    const item = e.target.closest(".autocomplete-item");
    if (!item) return;
    const name = item.dataset.name;
    sobjectInput.value = name;
    dropdown.style.display = "none";
    loadTargetFields(name);
  });

  sobjectInput.addEventListener("blur", () => {
    setTimeout(() => {
      dropdown.style.display = "none";
      loadTargetFields(sobjectInput.value.trim());
    }, 200);
  });

  document.getElementById("import-action").addEventListener("change", (e) => {
    document.getElementById("upsert-field-container").style.display =
      e.target.value === "upsert" ? "block" : "none";
  });

  // Tab switching: Preview, Grid, Log
  document.querySelectorAll(".tool-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tool-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab;
      document.getElementById("results-preview-view").style.display = target === "preview" ? "block" : "none";
      document.getElementById("results-grid-view").style.display = target === "grid" ? "block" : "none";
      document.getElementById("results-log-view").style.display = target === "log" ? "block" : "none";
    });
  });

  // File Upload & Drag-and-Drop
  const fileInput = document.getElementById("file-upload-input");
  const dropZone = document.getElementById("drop-zone");

  document.getElementById("btn-browse-file").addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (e) => {
    if (e.target.files?.[0]) handleFile(e.target.files[0]);
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "#0176d3";
    dropZone.style.background = "#eff6ff";
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.style.borderColor = "var(--border)";
    dropZone.style.background = "#fafafa";
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "var(--border)";
    dropZone.style.background = "#fafafa";
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  });

  document.getElementById("import-data").addEventListener("input", updateFieldMapping);
  document.getElementById("btn-sample-data").addEventListener("click", generateSample);
  document.getElementById("btn-run-import").addEventListener("click", executeImport);
  document.getElementById("btn-export-results").addEventListener("click", exportResultsCsv);
}

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById("import-data").value = e.target.result;
    document.getElementById("drop-zone").textContent = `✓ Loaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    updateFieldMapping();
  };
  reader.readAsText(file);
}

function generateSample() {
  const sobject = document.getElementById("target-sobject").value.trim() || "Account";
  if (sobject.toLowerCase() === "contact") {
    document.getElementById("import-data").value = `FirstName\tLastName\tEmail\tTitle
John\tDoe\tjohn.doe@example.com\tVP Engineering
Jane\tSmith\tjane.smith@example.com\tDirector of IT`;
  } else {
    document.getElementById("import-data").value = `Name\tType\tPhone\tIndustry
Acme Corporation\tCustomer - Direct\t(555) 000-1111\tTechnology
Global Media Inc\tCustomer - Channel\t(555) 000-2222\tMedia`;
  }
  updateFieldMapping();
}

// ─── DELIMITER AUTO-DETECTION & HIGH-PERFORMANCE PARSING ─────────────
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/)[0] || "";
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const pipeCount = (firstLine.match(/\|/g) || []).length;

  if (tabCount > 0 && tabCount >= commaCount && tabCount >= semicolonCount) return "\t";
  if (commaCount > 0 && commaCount >= semicolonCount) return ",";
  if (semicolonCount > 0) return ";";
  if (pipeCount > 0) return "|";
  return "\t"; // Default to tab for spreadsheet paste
}

function parseDelimitedLine(line, delimiter = ",") {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === delimiter && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

function parseInputData(raw) {
  raw = raw.trim();
  if (!raw) return { headers: [], records: [], delimiter: "," };

  // 1. JSON Array Parsing
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      const records = Array.isArray(parsed) ? parsed : [parsed];
      const headers = Object.keys(records[0] || {});
      return { headers, records, delimiter: "json" };
    } catch (e) {
      // Fall through to tabular parsing if invalid JSON
    }
  }

  // 2. Tabular / Spreadsheet Delimited Parsing
  const delimiter = detectDelimiter(raw);
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], records: [], delimiter };

  const headers = parseDelimitedLine(lines[0], delimiter).map(h => h.trim().replace(/^["']|["']$/g, ""));
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseDelimitedLine(lines[i], delimiter);
    const obj = {};
    headers.forEach((h, idx) => {
      let val = values[idx] !== undefined ? values[idx].trim().replace(/^["']|["']$/g, "") : null;
      if (val === "" || val === "null" || val === "#NULL#") val = null;
      obj[h] = val;
    });
    records.push(obj);
  }

  return { headers, records, delimiter };
}

// ─── SMART FIELD AUTO-MAPPING ─────────────────────────────────────────
function findMatchingField(headerName) {
  if (!headerName || !targetObjectFields || targetObjectFields.length === 0) return null;
  const hLower = headerName.toLowerCase().trim();
  const norm = s => (s || "").toLowerCase().replace(/__c$/, "").replace(/[\s_.-]+/g, "");
  const hNorm = norm(headerName);

  // Exact API Name Match
  let match = targetObjectFields.find(f => f.name.toLowerCase() === hLower);
  if (match) return match;

  // Exact Label Match
  match = targetObjectFields.find(f => (f.label || "").toLowerCase() === hLower);
  if (match) return match;

  // Normalized Name or Label Match (stripping spaces, underscores, __c)
  match = targetObjectFields.find(f => norm(f.name) === hNorm || norm(f.label) === hNorm);
  if (match) return match;

  return null;
}

function updateFieldMapping() {
  const raw = document.getElementById("import-data").value;
  const container = document.getElementById("mapping-container");
  const tbody = document.getElementById("mapping-body");
  const countEl = document.getElementById("mapping-col-count");
  const badgeEl = document.getElementById("data-format-badge");

  let parsed;
  try {
    parsed = parseInputData(raw);
  } catch (e) {
    if (container) container.style.display = "none";
    if (badgeEl) badgeEl.style.display = "none";
    return;
  }

  if (parsed.headers.length === 0) {
    if (container) container.style.display = "none";
    if (badgeEl) badgeEl.style.display = "none";
    renderPreviewTable(null);
    return;
  }

  // Update format badge
  if (badgeEl) {
    badgeEl.style.display = "inline-flex";
    const delimName = parsed.delimiter === "\t" ? "Excel Spreadsheet (Tab-Separated)" : (parsed.delimiter === "json" ? "JSON Payload" : (parsed.delimiter === ";" ? "Semicolon CSV" : "Standard CSV"));
    badgeEl.textContent = `📋 ${delimName} • ${parsed.records.length} Rows • ${parsed.headers.length} Cols`;
  }

  if (container) container.style.display = "block";
  if (countEl) countEl.textContent = parsed.headers.length;

  const sampleRow = parsed.records[0] || {};

  tbody.innerHTML = parsed.headers.map(h => {
    const matchedField = findMatchingField(h);
    const selectedVal = matchedField ? matchedField.name : "";

    return `
      <tr data-header="${escapeHtml(h)}">
        <td style="text-align:center;">
          <input type="checkbox" class="mapping-active" ${selectedVal ? "checked" : ""}>
        </td>
        <td><code>${escapeHtml(h)}</code></td>
        <td>
          <select class="select mapping-target-field" style="width:100%; font-size:11px;">
            <option value="">-- Ignore Column --</option>
            ${targetObjectFields.map(f => `
              <option value="${f.name}" ${f.name === selectedVal ? "selected" : ""}>${f.name} (${f.label}) [${f.type}]</option>
            `).join("")}
          </select>
        </td>
        <td style="color:var(--text-muted); font-size:11px;">${escapeHtml(String(sampleRow[h] ?? ""))}</td>
      </tr>
    `;
  }).join("");

  // Sync checkbox when dropdown changes
  tbody.querySelectorAll(".mapping-target-field").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const row = e.target.closest("tr");
      const chk = row.querySelector(".mapping-active");
      if (chk) chk.checked = !!e.target.value;
      renderPreviewTable(parsed);
    });
  });

  // Render live Data Preview tab
  renderPreviewTable(parsed);
}

// ─── LIVE DATA PREVIEW TAB ───────────────────────────────────────────
function renderPreviewTable(parsed) {
  const thead = document.getElementById("preview-head");
  const tbody = document.getElementById("preview-body");
  const countEl = document.getElementById("preview-count");

  if (!parsed || !parsed.headers || parsed.headers.length === 0) {
    if (thead) thead.innerHTML = `<tr><th style="width: 50px;">#</th><th>Parsed Columns</th></tr>`;
    if (tbody) tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; padding:30px; color:var(--text-muted);">Paste data or upload a file to preview parsed rows.</td></tr>`;
    if (countEl) countEl.textContent = "0";
    return;
  }

  if (countEl) countEl.textContent = parsed.records.length;

  // Header row showing source column and matched target field badge
  thead.innerHTML = `<tr><th style="width: 50px;">#</th>` + parsed.headers.map(h => {
    const matchedField = findMatchingField(h);
    const badge = matchedField ? `<br><span style="font-size:10px; background:#dcfce7; color:#15803d; padding:1px 5px; border-radius:3px; font-weight:700;">→ ${matchedField.name}</span>` : `<br><span style="font-size:10px; background:#fee2e2; color:#b91c1c; padding:1px 5px; border-radius:3px;">Unmapped</span>`;
    return `<th>${escapeHtml(h)}${badge}</th>`;
  }).join("") + `</tr>`;

  // Rows preview (up to first 25 rows)
  const previewRows = parsed.records.slice(0, 25);
  tbody.innerHTML = previewRows.map((rec, idx) => {
    const cells = parsed.headers.map(h => {
      const val = rec[h];
      const displayVal = val === null || val === undefined ? '<span style="color:#94a3b8; font-style:italic;">null</span>' : escapeHtml(String(val));
      return `<td title="${escapeHtml(String(val ?? ''))}">${displayVal}</td>`;
    }).join("");
    return `<tr><td>${idx + 1}</td>${cells}</tr>`;
  }).join("");

  if (parsed.records.length > 25) {
    tbody.innerHTML += `<tr><td colspan="${parsed.headers.length + 1}" style="text-align:center; font-size:11px; color:var(--text-muted); padding:10px; background:#f8fafc;">...and ${parsed.records.length - 25} more rows parsed and ready for import</td></tr>`;
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function getMappedRecord(rawRecord) {
  const mapped = {};
  const rows = document.querySelectorAll("#mapping-body tr");

  rows.forEach(row => {
    const isActive = row.querySelector(".mapping-active").checked;
    if (!isActive) return;

    const sourceHeader = row.dataset.header;
    const targetField = row.querySelector(".mapping-target-field").value;

    if (targetField && rawRecord[sourceHeader] !== undefined) {
      mapped[targetField] = rawRecord[sourceHeader];
    }
  });

  return mapped;
}

async function executeImport() {
  const sobject = document.getElementById("target-sobject").value.trim();
  const action = document.getElementById("import-action").value;
  const rawData = document.getElementById("import-data").value.trim();
  const extIdField = document.getElementById("upsert-ext-id").value.trim();

  const summaryEl = document.getElementById("import-summary");
  const outputEl = document.getElementById("import-output");
  const resultsBody = document.getElementById("results-body");
  const resultsCount = document.getElementById("results-count");
  const progressContainer = document.getElementById("progress-container");
  const progressBar = document.getElementById("progress-bar");
  const btnExport = document.getElementById("btn-export-results");

  if (!sobject || !rawData) {
    alert("Please specify Target SObject and provide data.");
    return;
  }
  if (action === "upsert" && !extIdField) {
    alert("Please select the External ID field for Upsert.");
    return;
  }

  let parsed;
  try {
    parsed = parseInputData(rawData);
  } catch (e) {
    alert("Error parsing data: " + e.message);
    return;
  }

  const records = parsed.records;
  if (records.length === 0) {
    alert("No records found in data.");
    return;
  }

  // Prep UI: Switch active tab to Grid view
  currentExecutionResults = [];
  document.querySelectorAll(".tool-tab").forEach(t => t.classList.remove("active"));
  document.getElementById("tab-btn-grid")?.classList.add("active");
  document.getElementById("results-preview-view").style.display = "none";
  document.getElementById("results-grid-view").style.display = "block";
  document.getElementById("results-log-view").style.display = "none";

  progressContainer.style.display = "block";
  progressBar.style.width = "0%";
  btnExport.style.display = "none";
  summaryEl.textContent = `Processing 0 of ${records.length}...`;
  outputEl.textContent = `[${new Date().toLocaleTimeString()}] Starting ${action.toUpperCase()} on ${records.length} ${sobject} records (Batch Size: 200)...\n`;
  resultsBody.innerHTML = "";

  let successCount = 0;
  let failureCount = 0;
  const batchSize = 200;
  const total = records.length;

  for (let i = 0; i < total; i += batchSize) {
    const rawBatch = records.slice(i, i + batchSize);
    const batch = rawBatch.map(r => getMappedRecord(r));

    try {
      if (action === "insert") {
        const payload = {
          allOrNone: false,
          records: batch.map(r => ({ attributes: { type: sobject }, ...r }))
        };
        const res = await sfConn.rest(`/services/data/v${apiVersion}/composite/sobjects`, {
          method: "POST",
          body: payload
        });
        res.forEach((r, idx) => {
          const rowNum = i + idx + 1;
          if (r.success) {
            successCount++;
            currentExecutionResults.push({ rowNum, success: true, id: r.id, error: "" });
            outputEl.textContent += `✓ [Row ${rowNum}] Inserted ID: ${r.id}\n`;
          } else {
            failureCount++;
            const errStr = (r.errors || []).map(e => `${e.statusCode}: ${e.message}`).join("; ");
            currentExecutionResults.push({ rowNum, success: false, id: "", error: errStr });
            outputEl.textContent += `❌ [Row ${rowNum}] Failed: ${errStr}\n`;
          }
        });
      } else if (action === "update") {
        const payload = {
          allOrNone: false,
          records: batch.map(r => ({ attributes: { type: sobject }, ...r }))
        };
        const res = await sfConn.rest(`/services/data/v${apiVersion}/composite/sobjects`, {
          method: "PATCH",
          body: payload
        });
        res.forEach((r, idx) => {
          const rowNum = i + idx + 1;
          if (r.success) {
            successCount++;
            currentExecutionResults.push({ rowNum, success: true, id: r.id, error: "" });
            outputEl.textContent += `✓ [Row ${rowNum}] Updated ID: ${r.id}\n`;
          } else {
            failureCount++;
            const errStr = (r.errors || []).map(e => `${e.statusCode}: ${e.message}`).join("; ");
            currentExecutionResults.push({ rowNum, success: false, id: "", error: errStr });
            outputEl.textContent += `❌ [Row ${rowNum}] Failed: ${errStr}\n`;
          }
        });
      } else if (action === "upsert") {
        const url = `/services/data/v${apiVersion}/composite/sobjects/${sobject}/${extIdField}`;
        const payload = {
          allOrNone: false,
          records: batch.map(r => ({ attributes: { type: sobject }, ...r }))
        };
        const res = await sfConn.rest(url, {
          method: "PATCH",
          body: payload
        });
        res.forEach((r, idx) => {
          const rowNum = i + idx + 1;
          if (r.success) {
            successCount++;
            currentExecutionResults.push({ rowNum, success: true, id: r.id, error: "" });
            outputEl.textContent += `✓ [Row ${rowNum}] Upserted ID: ${r.id} (Created: ${r.created})\n`;
          } else {
            failureCount++;
            const errStr = (r.errors || []).map(e => `${e.statusCode}: ${e.message}`).join("; ");
            currentExecutionResults.push({ rowNum, success: false, id: "", error: errStr });
            outputEl.textContent += `❌ [Row ${rowNum}] Failed: ${errStr}\n`;
          }
        });
      } else if (action === "delete") {
        const ids = batch.map(r => r.Id || r.id).filter(Boolean);
        const url = `/services/data/v${apiVersion}/composite/sobjects?ids=${ids.join(",")}&allOrNone=false`;
        const res = await sfConn.rest(url, { method: "DELETE" });
        res.forEach((r, idx) => {
          const rowNum = i + idx + 1;
          if (r.success) {
            successCount++;
            currentExecutionResults.push({ rowNum, success: true, id: r.id, error: "" });
            outputEl.textContent += `✓ [Row ${rowNum}] Deleted ID: ${r.id}\n`;
          } else {
            failureCount++;
            const errStr = (r.errors || []).map(e => `${e.statusCode}: ${e.message}`).join("; ");
            currentExecutionResults.push({ rowNum, success: false, id: ids[idx] || "", error: errStr });
            outputEl.textContent += `❌ [Row ${rowNum}] Failed: ${errStr}\n`;
          }
        });
      }
    } catch (batchErr) {
      rawBatch.forEach((_, idx) => {
        failureCount++;
        currentExecutionResults.push({ rowNum: i + idx + 1, success: false, id: "", error: batchErr.message });
      });
      outputEl.textContent += `❌ [Batch Exception] ${batchErr.message}\n`;
    }

    const completed = Math.min(i + batchSize, total);
    const pct = Math.round((completed / total) * 100);
    progressBar.style.width = `${pct}%`;
    summaryEl.textContent = `Processed ${completed} of ${total} (${pct}%)...`;
    renderResultsGrid();
  }

  summaryEl.innerHTML = `<span style="color:#16a34a; font-weight:700;">${successCount} Succeeded</span>, <span style="color:#dc2626; font-weight:700;">${failureCount} Failed</span>`;
  resultsCount.textContent = currentExecutionResults.length;
  btnExport.style.display = "inline-flex";
  outputEl.textContent += `\n════════════════════════════════════════\nImport Complete! Total: ${total} | Succeeded: ${successCount} | Failed: ${failureCount}\n`;
}

function renderResultsGrid() {
  const tbody = document.getElementById("results-body");
  tbody.innerHTML = currentExecutionResults.map(r => {
    let idCell = "";
    if (r.id) {
      idCell = `<a href="https://${sfHost}/${r.id}" target="_blank" style="color:#0176d3; font-weight:600; text-decoration:none;">${r.id} ↗</a> <a href="inspect-record.html?host=${encodeURIComponent(sfHost)}&id=${r.id}" target="_blank" style="font-size:10px; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:3px; text-decoration:none; margin-left:4px;" title="Inspect & Edit in Record Inspector">🔍 Inspect</a>`;
    } else {
      idCell = `<span style="color:var(--text-muted);">-</span>`;
    }

    return `
      <tr>
        <td>${r.rowNum}</td>
        <td>
          <span style="font-size:11px; font-weight:700; padding:2px 6px; border-radius:4px; ${r.success ? "background:#f0fdf4; color:#16a34a;" : "background:#fef2f2; color:#dc2626;"}">
            ${r.success ? "SUCCESS" : "FAILED"}
          </span>
        </td>
        <td>${idCell}</td>
        <td style="color:${r.error ? "#dc2626" : "inherit"}; font-size:11px;">${escapeHtml(r.error || "—")}</td>
      </tr>
    `;
  }).join("");
}

function exportResultsCsv() {
  if (currentExecutionResults.length === 0) return;

  const csvRows = ["Row,Status,RecordId,Error"];
  currentExecutionResults.forEach(r => {
    csvRows.push(`${r.rowNum},${r.success ? "SUCCESS" : "FAILED"},"${r.id}","${(r.error || "").replace(/"/g, '""')}"`);
  });

  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `import-results-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

init();
