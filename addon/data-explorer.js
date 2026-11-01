import { sfConn, apiVersion, updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";
import { executeAiQuery } from "./ai-service.js";

const sfHost = resolveSfHost();
let currentRecords = [];
let currentFilteredRecords = [];
let queryHistory = JSON.parse(localStorage.getItem("sfpi_query_history") || "[]");

// Autocomplete & Palette State
let cachedSObjects = [];
const objectDescribeCache = new Map(); // sobjectName -> full describe object
let currentPaletteSObject = null;
let currentPaletteItems = []; // Array of { id, name, label, type, category, insertCode, tooltip }
let activePaletteTab = "ALL";
let paletteFilterQuery = "";
let currentSuggestions = [];
let activeSuggestionIndex = 0;

// Pagination State
let displayedQueryRowCount = 50;
let queryNextUrl = null;
let isLoadingNextBatch = false;

// ─── TOAST NOTIFICATION UTILITY ─────────────────────────────────────────
function showToast(msg) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─── INITIALIZATION ───────────────────────────────────────────────────
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
  renderHistory();

  // Load SObjects in background for instant autocomplete
  await loadSObjectsCatalog();

  // Initialize query from URL parameters or storage
  await initQueryFromUrlOrStorage();
}

async function initQueryFromUrlOrStorage() {
  const params = new URLSearchParams(window.location.search);
  const urlQuery = params.get("query") || params.get("q");
  const targetObj = params.get("sobject") || params.get("obj");

  if (urlQuery) {
    document.getElementById("query-input").value = urlQuery;
    const extracted = extractTargetObject(urlQuery);
    if (extracted) {
      loadPaletteForObject(extracted);
      const relInput = document.getElementById("rel-obj-input");
      if (relInput) relInput.value = extracted;
    }
    await runQuery();
    return;
  }

  if (targetObj) {
    const query = await buildSmartQueryForObject(targetObj);
    document.getElementById("query-input").value = query;
    loadPaletteForObject(targetObj);
    const relInput = document.getElementById("rel-obj-input");
    if (relInput) relInput.value = targetObj;
    await runQuery();
    return;
  }

  const prefill = localStorage.getItem("sfpi_prefill_query");
  if (prefill) {
    document.getElementById("query-input").value = prefill;
    localStorage.removeItem("sfpi_prefill_query");
    const extracted = extractTargetObject(prefill);
    if (extracted) {
      loadPaletteForObject(extracted);
    }
    await runQuery();
  }
}

// ─── SOBJECT & METADATA CACHE ─────────────────────────────────────────
async function loadSObjectsCatalog() {
  try {
    const res = await sfConn.getSObjects();
    cachedSObjects = Array.isArray(res) ? res : (res?.sobjects || []);
    // Pre-warm describes for core entities so autocomplete is INSTANT (<0.1ms) with zero network latency
    const corePrewarm = ["Account", "Contact", "Opportunity", "Lead", "Case", "User", "Task", "RecordType", "Profile"];
    corePrewarm.forEach(obj => {
      getObjectDescribe(obj).catch(() => {});
    });
  } catch (e) {
    console.warn("Failed to pre-cache SObjects:", e);
  }
}

async function getObjectDescribe(objName) {
  if (!objName) return null;
  const key = objName.toLowerCase();
  if (objectDescribeCache.has(key)) {
    return objectDescribeCache.get(key);
  }
  try {
    const meta = await sfConn.metadata(objName);
    objectDescribeCache.set(key, meta);
    // Background pre-warm lookup references (e.g. User, Account, Contact)
    if (meta && meta.fields) {
      setTimeout(() => {
        meta.fields.forEach(f => {
          if (f.type === "reference" && f.referenceTo && f.referenceTo.length > 0) {
            f.referenceTo.forEach(target => {
              if (target && !objectDescribeCache.has(target.toLowerCase())) {
                getObjectDescribe(target).catch(() => {});
              }
            });
          }
        });
      }, 50);
    }
    return meta;
  } catch (e) {
    return null;
  }
}

async function buildSmartQueryForObject(objName) {
  try {
    const meta = await getObjectDescribe(objName);
    const fields = meta?.fields || [];
    if (fields.length > 0) {
      const selected = ["Id"];
      const candidatePriority = [
        "Name", "DeveloperName", "MasterLabel", "Subject", "CaseNumber", 
        "Title", "ContractNumber", "SolutionName", "Username", "LastName", 
        "FirstName", "Company", "Status", "Type", "CreatedDate"
      ];
      for (const cand of candidatePriority) {
        const match = fields.find(f => f.name.toLowerCase() === cand.toLowerCase());
        if (match && !selected.includes(match.name)) {
          selected.push(match.name);
          if (selected.length >= 6) break;
        }
      }
      if (selected.length === 1) {
        const safeExtras = fields.filter(f => f.name !== "Id" && !["address", "location", "base64"].includes(f.type)).slice(0, 4);
        safeExtras.forEach(f => selected.push(f.name));
      }
      return `SELECT ${selected.join(", ")} FROM ${objName} LIMIT 50`;
    }
  } catch (e) {
    console.warn("Could not describe object for query:", e);
  }
  return `SELECT Id FROM ${objName} LIMIT 50`;
}

function extractTargetObject(text) {
  if (!text) return null;
  // Strip subqueries inside parentheses (depth > 0) to find top-level FROM clause
  let depth = 0;
  let cleanText = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") { if (depth > 0) depth--; }
    else if (depth === 0) cleanText += ch;
  }
  const fromMatch = cleanText.match(/\bFROM\s+([a-zA-Z0-9_]+)/i);
  if (!fromMatch) return null;
  const word = fromMatch[1];
  const stopWords = new Set(["this", "last", "next", "the", "a", "an", "all", "where", "limit", "offset", "order", "group", "having"]);
  if (stopWords.has(word.toLowerCase())) return null;
  return word;
}

// ─── NESTED FIELD & RELATION FLATTENING ──────────────────────────────
function flattenRecord(rec, prefix = "") {
  if (!rec || typeof rec !== "object") return {};
  const result = {};

  for (const [key, val] of Object.entries(rec)) {
    if (key === "attributes") continue;
    const fullPath = prefix ? `${prefix}.${key}` : key;

    if (val !== null && typeof val === "object") {
      if (Array.isArray(val.records)) {
        // Child subquery relationship (e.g. Contacts: { totalSize: 3, records: [...] })
        result[fullPath] = val.records;
        result[`${fullPath}._size`] = val.totalSize !== undefined ? val.totalSize : val.records.length;
      } else {
        // Parent lookup relationship (e.g. Account: { Name: "Acme", Owner: { Email: "..." } })
        Object.assign(result, flattenRecord(val, fullPath));
      }
    } else {
      result[fullPath] = val;
    }
  }
  return result;
}

function extractSelectedFieldsFromQuery(soql) {
  if (!soql) return [];
  const selectIdx = soql.search(/\bSELECT\b/i);
  if (selectIdx === -1) return [];

  const afterSelect = soql.substring(selectIdx + 6);
  let depth = 0;
  let fromIdx = -1;
  for (let i = 0; i < afterSelect.length - 4; i++) {
    const char = afterSelect[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (depth === 0) {
      if (/\s+FROM\s+/i.test(afterSelect.substring(i, i + 6))) {
        fromIdx = i;
        break;
      }
    }
  }

  const selectClause = fromIdx !== -1 ? afterSelect.substring(0, fromIdx) : afterSelect;
  const tokens = parseSelectFieldTokens(selectClause);

  return tokens.map(f => {
    f = f.trim();
    if (f.startsWith("(") && f.endsWith(")")) {
      const childMatch = f.match(/\bFROM\s+([a-zA-Z0-9_]+)/i);
      if (childMatch) return childMatch[1];
    }
    const aliasMatch = f.match(/^([\w.]+)(?:\s+[\w]+)?$/);
    if (aliasMatch) return aliasMatch[1];
    return f;
  });
}

function parseSelectFieldTokens(fieldsStr) {
  if (!fieldsStr) return [];
  const tokens = [];
  let depth = 0;
  let cur = "";

  for (let i = 0; i < fieldsStr.length; i++) {
    const c = fieldsStr[i];
    if (c === '(') {
      depth++;
      cur += c;
    } else if (c === ')') {
      depth--;
      cur += c;
    } else if (c === ',' && depth === 0) {
      const trimmed = cur.trim();
      if (trimmed) tokens.push(trimmed);
      cur = "";
    } else {
      cur += c;
    }
  }
  const lastTrimmed = cur.trim();
  if (lastTrimmed) tokens.push(lastTrimmed);

  return tokens;
}

function getFieldLabelForColumn(targetObj, colName) {
  if (!colName) return "";
  const meta = targetObj ? objectDescribeCache.get(targetObj.toLowerCase()) : null;

  // 1. Direct field on entity
  if (meta && meta.fields) {
    const direct = meta.fields.find(f => f.name.toLowerCase() === colName.toLowerCase());
    if (direct && direct.label) return direct.label;
  }

  // 2. Parent relationship lookup (e.g. "Owner.Name", "Account.Name", "CreatedBy.Email")
  if (colName.includes(".")) {
    const parts = colName.split(".");
    const relName = parts[0];
    const fieldPart = parts.slice(1).join(".");

    if (meta && meta.fields) {
      const lookupField = meta.fields.find(f => f.relationshipName && f.relationshipName.toLowerCase() === relName.toLowerCase());
      if (lookupField) {
        const cleanLookup = lookupField.label.replace(/\s+ID$/i, "").replace(/\s+Id$/i, "");
        const formattedPart = fieldPart.split(".").map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
        return `${cleanLookup} ${formattedPart}`;
      }
    }
    return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
  }

  // 3. Child subquery (e.g. "Contacts", "Opportunities")
  if (meta && meta.childRelationships) {
    const childRel = meta.childRelationships.find(cr => cr.relationshipName && cr.relationshipName.toLowerCase() === colName.toLowerCase());
    if (childRel) {
      return `${childRel.relationshipName} (Subquery)`;
    }
  }

  // 4. Default: convert CamelCase to title case
  return colName.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/__c$/, "");
}

function getExportColumns(flattenedRows, query = "") {
  if (!flattenedRows || flattenedRows.length === 0) return [];

  const availableKeys = new Set();
  flattenedRows.slice(0, 100).forEach(row => {
    Object.keys(row).forEach(k => {
      if (!k.endsWith("._size")) {
        availableKeys.add(k);
      }
    });
  });

  const activeSoql = query || document.getElementById("query-input")?.value || "";
  const requestedFields = extractSelectedFieldsFromQuery(activeSoql);

  const orderedColumns = [];
  const addedSet = new Set();

  // Match requested fields in the exact order specified by the user's SOQL
  for (const req of requestedFields) {
    const matchedKey = Array.from(availableKeys).find(k => k.toLowerCase() === req.toLowerCase());
    if (matchedKey && !addedSet.has(matchedKey)) {
      orderedColumns.push(matchedKey);
      addedSet.add(matchedKey);
    } else if (!matchedKey && !addedSet.has(req)) {
      if (flattenedRows.some(r => req in r)) {
        orderedColumns.push(req);
        addedSet.add(req);
      }
    }
  }

  // Append any extra keys present in data that weren't explicitly named
  const remaining = Array.from(availableKeys).filter(k => !addedSet.has(k)).sort((a, b) => {
    if (a === "Id") return -1;
    if (b === "Id") return 1;
    return a.localeCompare(b);
  });

  return [...orderedColumns, ...remaining];
}

// ─── QUERY EXECUTION ENGINE ──────────────────────────────────────────
async function runQuery() {
  const query = document.getElementById("query-input").value.trim();
  if (!query) return;

  const type = document.getElementById("query-type").value;
  const autoPaginate = document.getElementById("auto-paginate").checked;
  const queryAll = document.getElementById("chk-query-all")?.checked;
  const statsEl = document.getElementById("query-stats");

  statsEl.textContent = "⏳ Running query...";
  const startTime = performance.now();
  displayedQueryRowCount = 50;
  queryNextUrl = null;

  try {
    let result;
    if (type === "graphql") {
      result = await sfConn.graphql(query);
      currentRecords = result.data?.uiapi?.query || result.data || [];
    } else {
      const isTooling = type === "tooling";
      const baseEndpoint = isTooling 
        ? `/services/data/v${apiVersion}/tooling/query/`
        : (queryAll ? `/services/data/v${apiVersion}/queryAll/` : `/services/data/v${apiVersion}/query/`);

      if (autoPaginate) {
        let url = `${baseEndpoint}?q=${encodeURIComponent(query)}`;
        result = await sfConn.rest(url);
        let all = result.records ? [...result.records] : [];
        while (result.nextRecordsUrl) {
          result = await sfConn.rest(result.nextRecordsUrl);
          if (result.records) all.push(...result.records);
        }
        currentRecords = all;
      } else {
        result = await sfConn.rest(`${baseEndpoint}?q=${encodeURIComponent(query)}`);
        currentRecords = result.records || [];
        queryNextUrl = result.nextRecordsUrl || null;
      }
    }

    const duration = ((performance.now() - startTime) / 1000).toFixed(2);
    statsEl.textContent = `✓ Fetched ${currentRecords.length} records in ${duration}s${queryNextUrl ? ' (Scroll down to stream more)' : ''}`;
    document.getElementById("record-count").textContent = currentRecords.length;
    const gridCountBadge = document.getElementById("grid-count-badge");
    if (gridCountBadge) gridCountBadge.textContent = `${currentRecords.length} records`;

    currentFilteredRecords = currentRecords;
    const gridFilter = document.getElementById("grid-filter");
    if (gridFilter) gridFilter.value = "";
    const filterStatus = document.getElementById("grid-filter-status");
    if (filterStatus) filterStatus.textContent = "";

    renderTable(currentFilteredRecords, false);
    document.getElementById("json-output").textContent = JSON.stringify(result, null, 2);

    saveHistory(query);

    // Sync relationship explorer target object
    const targetObj = extractTargetObject(query);
    if (targetObj) {
      const relInput = document.getElementById("rel-obj-input");
      if (relInput) relInput.value = targetObj;
    }
  } catch (err) {
    // Smart auto-healing: if query failed because of 'No such column Name'
    if (err.message && err.message.includes("No such column 'Name'") && query.includes("Name")) {
      const healedQuery = query.replace(/\bName\s*,?\s*/gi, "").replace(/,\s*FROM/i, " FROM");
      statsEl.textContent = "⚡ Retrying with safe fields...";
      try {
        document.getElementById("query-input").value = healedQuery;
        const baseEndpoint = (type === "tooling")
          ? `/services/data/v${apiVersion}/tooling/query/`
          : (queryAll ? `/services/data/v${apiVersion}/queryAll/` : `/services/data/v${apiVersion}/query/`);
        const healedResult = await sfConn.rest(`${baseEndpoint}?q=${encodeURIComponent(healedQuery)}`);
        currentRecords = healedResult.records || [];
        queryNextUrl = healedResult.nextRecordsUrl || null;
        const duration = ((performance.now() - startTime) / 1000).toFixed(2);
        statsEl.textContent = `✓ Fetched ${currentRecords.length} records in ${duration}s`;
        document.getElementById("record-count").textContent = currentRecords.length;
        const gridCountBadge = document.getElementById("grid-count-badge");
        if (gridCountBadge) gridCountBadge.textContent = `${currentRecords.length} records`;
        currentFilteredRecords = currentRecords;
        renderTable(currentFilteredRecords, false);
        document.getElementById("json-output").textContent = JSON.stringify(healedResult, null, 2);
        saveHistory(healedQuery);
        return;
      } catch (eHeal) {}
    }
    statsEl.textContent = `❌ Error: ${err.message}`;
    document.getElementById("table-head").innerHTML = `<th style="color:red">Error</th>`;
    document.getElementById("table-body").innerHTML = `<tr><td style="color:#dc2626; padding:15px;">${escapeHtml(err.message)}</td></tr>`;
  }
}

// ─── DATA GRID RENDERING ──────────────────────────────────────────────
function renderTable(records, append = false) {
  const thead = document.getElementById("table-head");
  const tbody = document.getElementById("table-body");

  if (!records || records.length === 0) {
    thead.innerHTML = `<th>No records found</th>`;
    tbody.innerHTML = "";
    return;
  }

  const flattenedRows = records.map(r => flattenRecord(r));
  const activeSoql = document.getElementById("query-input")?.value || "";
  const columns = getExportColumns(flattenedRows, activeSoql);

  const headerMode = document.getElementById("select-header-display")?.value || "both";
  const targetObj = extractTargetObject(activeSoql) || currentPaletteSObject || "Account";

  if (!append) {
    thead.innerHTML = `<th style="width:40px; text-align:center;">#</th>` + columns.map(c => {
      const label = getFieldLabelForColumn(targetObj, c);
      if (headerMode === "label") {
        return `<th title="API Name: ${escapeHtml(c)}"><span style="font-weight:700;">${escapeHtml(label)}</span></th>`;
      } else if (headerMode === "api") {
        return `<th title="Field Label: ${escapeHtml(label)}"><span style="font-family:var(--font-mono); font-size:11px;">${escapeHtml(c)}</span></th>`;
      } else {
        return `
          <th title="${escapeHtml(label)} (${escapeHtml(c)})">
            <div style="display:flex; flex-direction:column; gap:2px;">
              <span style="font-weight:700; color:var(--text-main); font-size:12px;">${escapeHtml(label)}</span>
              <span style="font-size:10px; color:var(--text-muted); font-family:var(--font-mono); font-weight:normal;">${escapeHtml(c)}</span>
            </div>
          </th>
        `;
      }
    }).join("");
  }

  const startIdx = append ? tbody.children.length : 0;
  const batch = flattenedRows.slice(startIdx, displayedQueryRowCount);

  if (batch.length === 0 && append) return;

  const rowsHtml = batch.map((rec, idx) => {
    const rowNum = startIdx + idx + 1;
    const cells = columns.map(col => {
      let val = rec[col];

      // Handle Child Subquery Relationship Array
      if (Array.isArray(val)) {
        return `<td><span class="badge" style="background:#dcfce7; color:#15803d; font-size:11px; font-weight:600;" title="${val.length} child records">${col} (${val.length})</span></td>`;
      }

      if (val === null || val === undefined) {
        return `<td><span style="color:var(--text-muted); font-style:italic;">null</span></td>`;
      }

      const strVal = String(val);
      const isSfId = (strVal.length === 15 || strVal.length === 18) && /^[a-zA-Z0-9]{15,18}$/.test(strVal);

      if (isSfId) {
        return `<td><a href="inspect-record.html?host=${encodeURIComponent(sfHost)}&id=${encodeURIComponent(strVal)}" target="_blank" style="color:var(--primary); font-weight:700; text-decoration:none;" title="Inspect in Record Inspector & Editor">🔍 ${escapeHtml(strVal)}</a></td>`;
      }

      return `<td title="${escapeHtml(strVal)}">${escapeHtml(strVal)}</td>`;
    }).join("");

    return `<tr><td>${rowNum}</td>${cells}</tr>`;
  }).join("");

  if (append) {
    tbody.insertAdjacentHTML("beforeend", rowsHtml);
  } else {
    tbody.innerHTML = rowsHtml;
  }
}

// ─── ADVANCED COPY & EXPORT FORMATTERS ─────────────────────────────────
function formatValueForTsv(val) {
  if (val === null || val === undefined) return "";
  if (Array.isArray(val)) return `[${val.length} child records]`;
  if (typeof val === "object") return JSON.stringify(val);
  return String(val).replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function formatValueForCsv(val) {
  if (val === null || val === undefined) return '""';
  if (Array.isArray(val)) return `"[${val.length} child records]"`;
  if (typeof val === "object") val = JSON.stringify(val);
  return `"${String(val).replace(/"/g, '""')}"`;
}

function copyExcelTsv() {
  if (!currentRecords || currentRecords.length === 0) {
    alert("No records to copy.");
    return;
  }
  const flattened = currentRecords.map(r => flattenRecord(r));
  const activeSoql = document.getElementById("query-input")?.value || "";
  const columns = getExportColumns(flattened, activeSoql);
  const rows = [];
  rows.push(columns.join("\t"));

  for (const row of flattened) {
    const vals = columns.map(c => formatValueForTsv(row[c]));
    rows.push(vals.join("\t"));
  }

  navigator.clipboard.writeText(rows.join("\r\n")).then(() => {
    showToast(`✓ Copied ${flattened.length} rows (Excel/TSV) to clipboard!`);
  });
}

function copyCsv() {
  if (!currentRecords || currentRecords.length === 0) {
    alert("No records to copy.");
    return;
  }
  const flattened = currentRecords.map(r => flattenRecord(r));
  const activeSoql = document.getElementById("query-input")?.value || "";
  const columns = getExportColumns(flattened, activeSoql);
  const rows = [];
  rows.push(columns.map(c => `"${c.replace(/"/g, '""')}"`).join(","));

  for (const row of flattened) {
    const vals = columns.map(c => formatValueForCsv(row[c]));
    rows.push(vals.join(","));
  }

  navigator.clipboard.writeText(rows.join("\r\n")).then(() => {
    showToast(`✓ Copied ${flattened.length} rows (CSV) to clipboard!`);
  });
}

function copyJson() {
  if (!currentRecords || currentRecords.length === 0) {
    alert("No records to copy.");
    return;
  }
  navigator.clipboard.writeText(JSON.stringify(currentRecords, null, 2)).then(() => {
    showToast(`✓ Copied ${currentRecords.length} JSON records to clipboard!`);
  });
}

function copyInClause() {
  if (!currentRecords || currentRecords.length === 0) {
    alert("No records to copy.");
    return;
  }
  const flattened = currentRecords.map(r => flattenRecord(r));
  const first = flattened[0];
  const colName = Object.keys(first).find(k => k.toLowerCase() === "id") || Object.keys(first)[0];
  const ids = flattened.map(r => r[colName]).filter(Boolean).map(id => `'${id}'`);
  const inClause = `(${ids.join(", ")})`;

  navigator.clipboard.writeText(inClause).then(() => {
    showToast(`✓ Copied SOQL IN clause with ${ids.length} IDs!`);
  });
}

function exportCsv() {
  if (!currentRecords || currentRecords.length === 0) {
    alert("No records to export.");
    return;
  }
  const flattened = currentRecords.map(r => flattenRecord(r));
  const columns = getExportColumns(flattened);
  const rows = [];
  rows.push(columns.map(c => `"${c.replace(/"/g, '""')}"`).join(","));

  for (const row of flattened) {
    const vals = columns.map(c => formatValueForCsv(row[c]));
    rows.push(vals.join(","));
  }

  const blob = new Blob([rows.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `salesforce-export-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportJson() {
  if (!currentRecords || currentRecords.length === 0) {
    alert("No records to export.");
    return;
  }
  const blob = new Blob([JSON.stringify(currentRecords, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `salesforce-export-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── QUERY PLAN EXPLAIN ───────────────────────────────────────────────
async function getQueryPlan() {
  const query = document.getElementById("query-input").value.trim();
  if (!query) return;

  const statsEl = document.getElementById("query-stats");
  statsEl.textContent = "⏳ Analyzing Query Plan...";

  try {
    const res = await sfConn.rest(`/services/data/v${apiVersion}/query/?explain=${encodeURIComponent(query)}`);
    document.getElementById("plan-output").textContent = JSON.stringify(res, null, 2);
    document.querySelector('.tool-tab[data-tab="plan"]').click();
    statsEl.textContent = "✓ Query Plan generated";
  } catch (err) {
    statsEl.textContent = `❌ Query Plan error: ${err.message}`;
    document.getElementById("plan-output").textContent = `Error: ${err.message}`;
    document.querySelector('.tool-tab[data-tab="plan"]').click();
  }
}

// ─── AI PROMPT-TO-SOQL STUDIO ENGINE ──────────────────────────────────
async function generateAiQuery() {
  const promptInput = document.getElementById("ai-prompt-input");
  const promptText = (promptInput?.value || "").trim();
  if (!promptText) {
    alert("Please enter a description or prompt for the query.");
    return;
  }

  const outputContainer = document.getElementById("ai-output-container");
  const codeEl = document.getElementById("ai-generated-code");
  const explainEl = document.getElementById("ai-explanation");
  const provider = document.getElementById("ai-model-provider")?.value || "local";

  outputContainer.style.display = "flex";
  codeEl.textContent = "⏳ Analyzing prompt and generating multi-object SOQL...";
  explainEl.textContent = "";

  // 1. Detect target SObject
  let targetObj = document.getElementById("ai-target-obj")?.value.trim();
  if (!targetObj) {
    targetObj = extractTargetObject(promptText) || inferObjectFromPrompt(promptText) || "Account";
    const targetInput = document.getElementById("ai-target-obj");
    if (targetInput) targetInput.value = targetObj;
  }

  const includeChildren = document.getElementById("ai-include-children")?.checked !== false;
  const includeParents = document.getElementById("ai-include-parents")?.checked !== false;

  // 2. Describe live schema for target object
  const meta = await getObjectDescribe(targetObj);
  const fields = meta?.fields || [];
  const childRels = meta?.childRelationships || [];

  // 3. Schema-Aware Local AI Engine (100% Free, zero cost, instant)
  if (provider === "local" || !localStorage.getItem(`sfpi_key_${provider}`)) {
    const generated = synthesizeSoqlFromPrompt(promptText, targetObj, fields, childRels, includeChildren, includeParents);
    codeEl.textContent = generated.soql;
    explainEl.innerHTML = generated.explanation;
    return;
  }

  // 4. External AI Model (Gemini Free Tier, OpenAI, Claude)
  try {
    const parentLookups = fields.filter(f => f.type === "reference" && f.relationshipName).map(f => `${f.relationshipName} (${(f.referenceTo || []).join(",")})`).slice(0, 15);
    const validChildren = childRels.filter(r => r.relationshipName).map(r => `${r.relationshipName} -> ${r.childSObject}`).slice(0, 15);

    const systemPrompt = `You are an expert Salesforce CTA architect. Generate a syntactically correct SOQL query for the target object '${targetObj}'.
Available Parent Relationships: ${parentLookups.join(", ")}
Available Child Relationships: ${validChildren.join(", ")}
Return ONLY valid SOQL in a sql code block followed by a brief explanation. Use dot-notation for parents (e.g. Account.Name) and subqueries for children (e.g. (SELECT Id FROM Contacts)).`;

    const res = await executeAiQuery({
      prompt: `Target Object: ${targetObj}\nPrompt: ${promptText}`,
      systemPrompt,
      provider,
      strictMasking: true
    });

    const content = res.content || "";
    const soqlMatch = content.match(/```(?:sql|soql)?\s*([\s\S]*?)```/i);
    const cleanSoql = soqlMatch ? soqlMatch[1].trim() : content.trim();

    codeEl.textContent = cleanSoql;
    explainEl.innerHTML = `<strong>Architectural Notes:</strong><br>${escapeHtml(content.replace(/```[\s\S]*?```/g, "").trim())}`;
  } catch (err) {
    // Fallback to local heuristic
    const fallback = synthesizeSoqlFromPrompt(promptText, targetObj, fields, childRels, includeChildren, includeParents);
    codeEl.textContent = fallback.soql;
    explainEl.innerHTML = `<span style="color:#b45309;">Notice: AI provider returned an error (${escapeHtml(err.message)}). Generated using free built-in local engine:</span><br>${fallback.explanation}`;
  }
}

function inferObjectFromPrompt(text) {
  const p = text.toLowerCase();
  if (p.includes("contact")) return "Contact";
  if (p.includes("opp") || p.includes("deal") || p.includes("pipeline")) return "Opportunity";
  if (p.includes("case") || p.includes("ticket") || p.includes("support")) return "Case";
  if (p.includes("lead")) return "Lead";
  if (p.includes("user") || p.includes("profile") || p.includes("role")) return "User";
  if (p.includes("task") || p.includes("event") || p.includes("activity")) return "Task";
  return "Account";
}

function synthesizeSoqlFromPrompt(prompt, targetObj, fields, childRels, includeChildren, includeParents) {
  const p = prompt.toLowerCase();
  const selectParts = ["Id"];

  // Pick core standard name/title field
  const candidateNames = ["Name", "DeveloperName", "MasterLabel", "Subject", "CaseNumber", "Title", "ContractNumber", "Username", "LastName"];
  for (const cand of candidateNames) {
    const match = fields.find(f => f.name.toLowerCase() === cand.toLowerCase());
    if (match && !selectParts.includes(match.name)) {
      selectParts.push(match.name);
      break;
    }
  }

  // Check attributes mentioned in prompt
  const attributeKeywords = [
    { word: "email", field: "Email" },
    { word: "phone", field: "Phone" },
    { word: "amount", field: "Amount" },
    { word: "stage", field: "StageName" },
    { word: "status", field: "Status" },
    { word: "type", field: "Type" },
    { word: "industry", field: "Industry" },
    { word: "revenue", field: "AnnualRevenue" },
    { word: "rating", field: "Rating" },
    { word: "created", field: "CreatedDate" },
    { word: "modified", field: "LastModifiedDate" }
  ];

  attributeKeywords.forEach(k => {
    if (p.includes(k.word)) {
      const match = fields.find(f => f.name.toLowerCase() === k.field.toLowerCase());
      if (match && !selectParts.includes(match.name)) selectParts.push(match.name);
    }
  });

  // Include Parent Relationships if requested
  const parentNotes = [];
  if (includeParents) {
    const parentLookups = fields.filter(f => f.type === "reference" && f.relationshipName);
    
    // Check if Account parent mentioned
    if (p.includes("account") && targetObj.toLowerCase() !== "account") {
      const accLookup = parentLookups.find(f => f.relationshipName.toLowerCase() === "account");
      if (accLookup) {
        selectParts.push("Account.Name");
        if (p.includes("industry")) selectParts.push("Account.Industry");
        parentNotes.push(`Traverses parent lookup <code>Account.Name</code>`);
      }
    }

    // Check if Owner parent mentioned
    if (p.includes("owner") || p.includes("manager")) {
      const ownerLookup = parentLookups.find(f => f.relationshipName.toLowerCase() === "owner");
      if (ownerLookup) {
        selectParts.push("Owner.Name", "Owner.Email");
        parentNotes.push(`Traverses parent lookup <code>Owner.Name, Owner.Email</code>`);
      }
    }
  }

  // Include Child Subqueries if requested
  const childSubqueries = [];
  if (includeChildren && childRels.length > 0) {
    if ((p.includes("contact") || p.includes("people")) && targetObj.toLowerCase() === "account") {
      const contactRel = childRels.find(r => r.relationshipName === "Contacts");
      if (contactRel) {
        childSubqueries.push(`(SELECT Id, FirstName, LastName, Email, Title FROM Contacts)`);
      }
    }
    if ((p.includes("opp") || p.includes("deal") || p.includes("revenue")) && targetObj.toLowerCase() === "account") {
      const oppRel = childRels.find(r => r.relationshipName === "Opportunities");
      if (oppRel) {
        childSubqueries.push(`(SELECT Id, Name, Amount, StageName, CloseDate FROM Opportunities WHERE IsClosed = false)`);
      }
    }
    if ((p.includes("case") || p.includes("ticket")) && targetObj.toLowerCase() === "account") {
      const caseRel = childRels.find(r => r.relationshipName === "Cases");
      if (caseRel) {
        childSubqueries.push(`(SELECT Id, CaseNumber, Status, Subject, Priority FROM Cases WHERE IsClosed = false)`);
      }
    }
  }

  // Build WHERE conditions
  const whereClauses = [];
  if ((p.includes("california") || /\bca\b/i.test(p)) && (targetObj === "Account" || fields.some(f => f.name === "BillingState"))) {
    whereClauses.push("BillingState = 'CA'");
  }
  if ((p.includes("50k") || p.includes("50000")) && targetObj === "Opportunity") {
    whereClauses.push("Amount > 50000");
  }
  if (p.includes("closed won") || p.includes("won")) whereClauses.push("IsWon = true");
  if (p.includes("this month")) whereClauses.push("CreatedDate = THIS_MONTH");
  if (p.includes("this quarter")) whereClauses.push("CloseDate = THIS_QUARTER");
  if (p.includes("this year")) whereClauses.push("CreatedDate = THIS_YEAR");

  // Format final SOQL
  let selectClause = selectParts.join(", ");
  if (childSubqueries.length > 0) {
    selectClause += ",\n  " + childSubqueries.join(",\n  ");
  }

  let soql = `SELECT ${selectClause}\nFROM ${targetObj}`;
  if (whereClauses.length > 0) {
    soql += `\nWHERE ${whereClauses.join(" AND ")}`;
  }
  soql += `\nLIMIT 50`;

  const explanation = `
    <strong>Generated Strategy:</strong>
    <ul style="margin:4px 0 0 16px; padding:0;">
      <li><strong>Target Object:</strong> <code>${targetObj}</code></li>
      ${parentNotes.map(n => `<li>${n}</li>`).join("")}
      ${childSubqueries.length > 0 ? `<li><strong>Child Subqueries:</strong> Integrated ${childSubqueries.length} parent-to-child nested queries</li>` : ""}
      <li><strong>Cost & Governor Limits:</strong> Clean single-statement query conforming to Salesforce Bulk limits.</li>
    </ul>
  `;

  return { soql, explanation };
}

// ─── RELATIONSHIP EXPLORER TAB ────────────────────────────────────────
async function loadRelationshipExplorer() {
  const objName = document.getElementById("rel-obj-input")?.value.trim() || "Account";
  const parentContainer = document.getElementById("rel-parent-list");
  const childContainer = document.getElementById("rel-child-list");
  const parentCountEl = document.getElementById("rel-parent-count");
  const childCountEl = document.getElementById("rel-child-count");

  parentContainer.innerHTML = `<span style="font-size:12px; color:var(--text-muted);">Discovering parent relationships for ${escapeHtml(objName)}...</span>`;
  childContainer.innerHTML = `<span style="font-size:12px; color:var(--text-muted);">Discovering child relationships for ${escapeHtml(objName)}...</span>`;

  const meta = await getObjectDescribe(objName);
  if (!meta) {
    parentContainer.innerHTML = `<span style="color:#dc2626; font-size:12px;">Could not describe object '${escapeHtml(objName)}'.</span>`;
    childContainer.innerHTML = "";
    return;
  }

  const fields = meta.fields || [];
  const childRels = meta.childRelationships || [];

  // Filter Parent Lookups
  const parentLookups = fields.filter(f => f.type === "reference" && f.relationshipName);
  if (parentCountEl) parentCountEl.textContent = `${parentLookups.length} parent relationships`;

  if (parentLookups.length === 0) {
    parentContainer.innerHTML = `<span style="font-size:12px; color:var(--text-muted);">No parent lookup relationships on ${escapeHtml(objName)}.</span>`;
  } else {
    parentContainer.innerHTML = parentLookups.map(f => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 8px; border-radius:4px; background:rgba(0,0,0,0.02); border:1px solid var(--border);">
        <div>
          <strong style="font-size:12px; color:var(--text-main);">${escapeHtml(f.relationshipName)}</strong>
          <span style="font-size:11px; color:var(--text-muted); margin-left:6px;">(${escapeHtml((f.referenceTo || []).join(", "))})</span>
        </div>
        <div style="display:flex; gap:4px;">
          <button type="button" class="relation-badge-parent btn-add-parent" data-rel="${escapeHtml(f.relationshipName)}.Name" title="Add ${escapeHtml(f.relationshipName)}.Name to query">
            + ${escapeHtml(f.relationshipName)}.Name
          </button>
        </div>
      </div>
    `).join("");
  }

  // Filter Child Relationships
  const validChildren = childRels.filter(r => r.relationshipName);
  if (childCountEl) childCountEl.textContent = `${validChildren.length} child relationships`;

  if (validChildren.length === 0) {
    childContainer.innerHTML = `<span style="font-size:12px; color:var(--text-muted);">No child relationships on ${escapeHtml(objName)}.</span>`;
  } else {
    childContainer.innerHTML = validChildren.map(r => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 8px; border-radius:4px; background:rgba(0,0,0,0.02); border:1px solid var(--border);">
        <div>
          <strong style="font-size:12px; color:var(--text-main);">${escapeHtml(r.relationshipName)}</strong>
          <span style="font-size:11px; color:var(--text-muted); margin-left:6px;">(Child: ${escapeHtml(r.childSObject)})</span>
        </div>
        <div>
          <button type="button" class="relation-badge-child btn-add-child" data-child="${escapeHtml(r.relationshipName)}" data-sobj="${escapeHtml(r.childSObject)}" title="Insert subquery for ${escapeHtml(r.relationshipName)}">
            + (SELECT ... FROM ${escapeHtml(r.relationshipName)})
          </button>
        </div>
      </div>
    `).join("");
  }

  // Attach insertion events
  parentContainer.querySelectorAll(".btn-add-parent").forEach(btn => {
    btn.addEventListener("click", () => {
      const fieldPath = btn.getAttribute("data-rel");
      insertFieldToQuery(fieldPath);
      showToast(`Added ${fieldPath} to SELECT clause!`);
    });
  });

  childContainer.querySelectorAll(".btn-add-child").forEach(btn => {
    btn.addEventListener("click", () => {
      const relName = btn.getAttribute("data-child");
      insertChildSubquery(relName);
      showToast(`Inserted (${relName}) subquery!`);
    });
  });
}

function insertChildSubquery(relName, childObj = "") {
  const input = document.getElementById("query-input");
  let val = input.value;

  let subFields = "Id, Name";
  const cLower = (childObj || "").toLowerCase();
  const rLower = (relName || "").toLowerCase();
  if (cLower === "contact") subFields = "Id, LastName, Email";
  else if (cLower === "opportunity") subFields = "Id, Name, StageName, Amount";
  else if (cLower === "case") subFields = "Id, CaseNumber, Status, Subject";
  else if (cLower === "task" || cLower === "event" || cLower === "activityhistory" || cLower === "openactivity" || rLower.includes("activit")) {
    subFields = "Id, Subject, Status, ActivityDate";
  }

  const subquery = `(SELECT ${subFields} FROM ${relName})`;

  const selectMatch = val.match(/^(\s*SELECT\s+)([\s\S]*?)(\s+FROM\s+[\s\S]*)$/i);
  if (selectMatch) {
    const prefix = selectMatch[1];
    let fields = selectMatch[2].trim();
    const rest = selectMatch[3];
    input.value = `${prefix}${fields},\n  ${subquery}${rest}`;
  } else {
    input.value = `SELECT Id, Name,\n  ${subquery}\nFROM ${currentPaletteSObject || "Account"} LIMIT 50`;
  }
  updatePaletteActiveStates();
}

function insertFieldToQuery(fieldName) {
  const input = document.getElementById("query-input");
  let val = input.value;
  const selectMatch = val.match(/^(\s*SELECT\s+)([\s\S]*?)(\s+FROM\s+[\s\S]*)$/i);

  if (selectMatch) {
    const prefix = selectMatch[1];
    let fieldsStr = selectMatch[2].trim();
    const rest = selectMatch[3];

    const currentTokens = parseSelectFieldTokens(fieldsStr);
    if (!currentTokens.some(t => t.toLowerCase() === fieldName.toLowerCase())) {
      currentTokens.push(fieldName);
      input.value = `${prefix}${currentTokens.join(", ")}${rest}`;
    }
  } else {
    input.value = `SELECT Id, ${fieldName} FROM ${currentPaletteSObject || "Account"} LIMIT 50`;
  }
  updatePaletteActiveStates();
}

function toggleFieldInQuery(fieldId) {
  const item = currentPaletteItems.find(i => i.id.toLowerCase() === fieldId.toLowerCase());
  if (!item) return;

  const input = document.getElementById("query-input");
  let val = input.value;
  const targetObj = extractTargetObject(val) || currentPaletteSObject || "Account";

  const selectMatch = val.match(/^(\s*SELECT\s+)([\s\S]*?)(\s+FROM\s+[\s\S]*)$/i);
  if (!selectMatch) {
    input.value = `SELECT Id, ${item.insertCode} FROM ${targetObj} LIMIT 50`;
    updatePaletteActiveStates();
    return;
  }

  const prefix = selectMatch[1];
  let fieldsStr = selectMatch[2].trim();
  const rest = selectMatch[3];

  const currentTokens = parseSelectFieldTokens(fieldsStr);
  const existingIdx = currentTokens.findIndex(t => {
    if (item.category === "CHILDREN") {
      return t.toLowerCase().includes(`from ${item.name.toLowerCase()}`) || t.toLowerCase() === item.name.toLowerCase();
    }
    return t.toLowerCase() === item.name.toLowerCase() || t.toLowerCase().endsWith(`.${item.name.toLowerCase()}`);
  });

  if (existingIdx !== -1) {
    // Already in query -> Toggle OFF
    currentTokens.splice(existingIdx, 1);
    if (currentTokens.length === 0) currentTokens.push("Id");
    input.value = `${prefix}${currentTokens.join(", ")}${rest}`;
    showToast(`Removed ${item.name} from query`);
  } else {
    // Not in query -> Toggle ON
    currentTokens.push(item.insertCode);
    input.value = `${prefix}${currentTokens.join(", ")}${rest}`;
    showToast(`Added ${item.name} to query`);
  }

  updatePaletteActiveStates();
}

function getActiveFieldsInQuery() {
  const query = document.getElementById("query-input")?.value || "";
  const selectMatch = query.match(/^\s*SELECT\s+([\s\S]*?)\s+FROM\s+/i);
  if (!selectMatch) return new Set();

  const tokens = parseSelectFieldTokens(selectMatch[1].trim());
  const activeSet = new Set();

  tokens.forEach(t => {
    t = t.trim();
    if (t.startsWith("(") && t.endsWith(")")) {
      const match = t.match(/\bFROM\s+([a-zA-Z0-9_]+)/i);
      if (match) activeSet.add(match[1].toLowerCase());
    } else {
      activeSet.add(t.toLowerCase());
    }
  });

  return activeSet;
}

function updatePaletteActiveStates() {
  const activeFieldsInQuery = getActiveFieldsInQuery();
  const chips = document.querySelectorAll("#palette-fields-list .btn-palette-chip");

  chips.forEach(chip => {
    const fieldId = chip.getAttribute("data-field-id") || "";
    const item = currentPaletteItems.find(i => i.id.toLowerCase() === fieldId.toLowerCase());
    if (!item) return;

    const isSelected = activeFieldsInQuery.has(item.name.toLowerCase()) ||
      (item.category === "CHILDREN" && activeFieldsInQuery.has(item.name.toLowerCase()));

    chip.classList.toggle("active", isSelected);
    const labelSpan = chip.querySelector(".chip-label-text");
    if (labelSpan) {
      labelSpan.textContent = (isSelected ? "✓ " : "") + item.label;
    }
  });
}

function insertCommonFields() {
  const input = document.getElementById("query-input");
  const targetObj = extractTargetObject(input.value) || currentPaletteSObject || "Account";
  const meta = objectDescribeCache.get(targetObj.toLowerCase());
  const fieldNames = (meta?.fields || []).map(f => f.name);

  let common = ["Id"];
  const candidates = ["Name", "CaseNumber", "Subject", "Title", "Type", "Status", "StageName", "Amount", "Email", "Phone", "CreatedDate"];
  for (const c of candidates) {
    const found = fieldNames.find(f => f.toLowerCase() === c.toLowerCase());
    if (found && !common.includes(found)) common.push(found);
  }
  if (common.length === 1 && fieldNames.length > 1) {
    common = fieldNames.slice(0, 5);
  }

  input.value = `SELECT ${common.join(", ")} FROM ${targetObj} ORDER BY CreatedDate DESC LIMIT 50`;
  updatePaletteActiveStates();
  showToast(`Loaded ${common.length} common fields for ${targetObj}!`);
}

function insertAllPaletteFields() {
  const input = document.getElementById("query-input");
  const targetObj = extractTargetObject(input.value) || currentPaletteSObject || "Account";
  const meta = objectDescribeCache.get(targetObj.toLowerCase());
  if (!meta || !meta.fields) return;

  const validFields = meta.fields
    .filter(f => !f.name.endsWith("Address") && f.type !== "address")
    .map(f => f.name);

  input.value = `SELECT ${validFields.join(", ")} FROM ${targetObj} LIMIT 50`;
  updatePaletteActiveStates();
  showToast(`Inserted all ${validFields.length} fields for ${targetObj}!`);
}

function clearQueryFields() {
  const input = document.getElementById("query-input");
  const targetObj = extractTargetObject(input.value) || currentPaletteSObject || "Account";
  input.value = `SELECT Id FROM ${targetObj} LIMIT 50`;
  updatePaletteActiveStates();
  showToast("Cleared SELECT fields to Id");
}

// ─── FIELD PALETTE CONTROLLER ─────────────────────────────────────────
function toggleSchemaPalette() {
  const panel = document.getElementById("schema-palette");
  const isHidden = panel.style.display === "none";
  panel.style.display = isHidden ? "block" : "none";
  if (isHidden) {
    const targetObj = extractTargetObject(document.getElementById("query-input").value) || "Account";
    loadPaletteForObject(targetObj);
  }
}

async function loadPaletteForObject(objName) {
  if (!objName) return;
  currentPaletteSObject = objName;
  const labelEl = document.getElementById("palette-target-label");
  const fieldsContainer = document.getElementById("palette-fields-list");

  if (labelEl) labelEl.textContent = `Target: ${objName}`;
  if (fieldsContainer) {
    fieldsContainer.innerHTML = `<span style="font-size:11px; color:var(--text-muted);">Loading fields and relations for ${escapeHtml(objName)}...</span>`;
  }

  const meta = await getObjectDescribe(objName);
  if (!meta) {
    if (fieldsContainer) fieldsContainer.innerHTML = `<span style="font-size:11px; color:#dc2626;">Could not describe object '${escapeHtml(objName)}'. Check spelling or permissions.</span>`;
    return;
  }

  const fields = meta.fields || [];
  const childRels = meta.childRelationships || [];

  currentPaletteItems = [];

  // 1. Regular fields (Standard & Custom)
  fields.forEach(f => {
    const isCustom = f.custom || f.name.endsWith("__c");
    currentPaletteItems.push({
      id: f.name,
      name: f.name,
      label: f.label || f.name,
      type: f.type,
      category: isCustom ? "CUSTOM" : "STANDARD",
      insertCode: f.name,
      tooltip: `${f.label} (${f.name}) • Type: ${f.type}`
    });

    // 2. Parent Relationship Lookups (e.g. Owner.Name, Account.Name, CreatedBy.Email)
    if (f.type === "reference" && f.relationshipName) {
      const relName = f.relationshipName;
      const cleanLabel = (f.label || relName).replace(/\s+ID$/i, "").replace(/\s+Id$/i, "");

      currentPaletteItems.push({
        id: `${relName}.Name`,
        name: `${relName}.Name`,
        label: `${cleanLabel}.Name`,
        type: "parent-lookup",
        category: "LOOKUP",
        insertCode: `${relName}.Name`,
        tooltip: `Parent lookup via ${f.name} (${(f.referenceTo || []).join("/")}): ${relName}.Name`
      });

      if (f.referenceTo && f.referenceTo.includes("User")) {
        currentPaletteItems.push({
          id: `${relName}.Email`,
          name: `${relName}.Email`,
          label: `${cleanLabel}.Email`,
          type: "parent-lookup",
          category: "LOOKUP",
          insertCode: `${relName}.Email`,
          tooltip: `Parent User email: ${relName}.Email`
        });
      }
    }
  });

  // 3. Child Relationships (Subqueries)
  childRels.forEach(cr => {
    if (cr.relationshipName && cr.childSObject) {
      const relName = cr.relationshipName;
      const childObj = cr.childSObject;

      let subFields = "Id, Name";
      const cLower = (childObj || "").toLowerCase();
      const rLower = (relName || "").toLowerCase();
      if (cLower === "contact") subFields = "Id, LastName, Email";
      else if (cLower === "opportunity") subFields = "Id, Name, StageName, Amount";
      else if (cLower === "case") subFields = "Id, CaseNumber, Status, Subject";
      else if (cLower === "task" || cLower === "event" || cLower === "activityhistory" || cLower === "openactivity" || rLower.includes("activit")) {
        subFields = "Id, Subject, Status, ActivityDate";
      }

      const subqueryCode = `(SELECT ${subFields} FROM ${relName})`;

      currentPaletteItems.push({
        id: relName,
        name: relName,
        label: `${relName}`,
        type: "subquery",
        category: "CHILDREN",
        insertCode: subqueryCode,
        tooltip: `Child subquery for ${childObj}: ${subqueryCode}`
      });
    }
  });

  updatePaletteCounts();
  renderPaletteChips();
}

function updatePaletteCounts() {
  const allCount = currentPaletteItems.length;
  const stdCount = currentPaletteItems.filter(i => i.category === "STANDARD").length;
  const customCount = currentPaletteItems.filter(i => i.category === "CUSTOM").length;
  const lookupCount = currentPaletteItems.filter(i => i.category === "LOOKUP").length;
  const childCount = currentPaletteItems.filter(i => i.category === "CHILDREN").length;

  const setElText = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };

  setElText("palette-count-all", allCount);
  setElText("palette-count-standard", stdCount);
  setElText("palette-count-custom", customCount);
  setElText("palette-count-lookups", lookupCount);
  setElText("palette-count-children", childCount);
}

function renderPaletteChips() {
  const container = document.getElementById("palette-fields-list");
  if (!container) return;

  const q = paletteFilterQuery.trim().toLowerCase();
  const activeFieldsInQuery = getActiveFieldsInQuery();

  const filtered = currentPaletteItems.filter(item => {
    const matchCat = activePaletteTab === "ALL" || item.category === activePaletteTab;
    const matchQ = !q ||
      item.name.toLowerCase().includes(q) ||
      item.label.toLowerCase().includes(q) ||
      item.type.toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<span style="font-size:11px; color:var(--text-muted); padding:4px;">No fields or relations match "${escapeHtml(paletteFilterQuery)}".</span>`;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const isSelected = activeFieldsInQuery.has(item.name.toLowerCase()) ||
      (item.category === "CHILDREN" && activeFieldsInQuery.has(item.name.toLowerCase()));

    let extraClass = "";
    if (item.category === "LOOKUP") extraClass = "chip-lookup";
    else if (item.category === "CHILDREN") extraClass = "chip-child";
    if (isSelected) extraClass += " active";

    let icon = "";
    if (item.category === "LOOKUP") icon = "🔗 ";
    else if (item.category === "CHILDREN") icon = "🌲 ";

    return `
      <button type="button" class="btn btn-secondary btn-palette-chip ${extraClass}" data-field-id="${escapeHtml(item.id)}" title="${escapeHtml(item.tooltip)}">
        <span class="chip-label-text">${isSelected ? "✓ " : ""}${icon}<strong>${escapeHtml(item.label)}</strong></span>
        <span class="chip-type-tag" style="font-size:9px; color:#6b7280; font-family:var(--font-mono);">${escapeHtml(item.name)} (${escapeHtml(item.type)})</span>
      </button>
    `;
  }).join("");
}

function onPaletteSearch(e) {
  const query = e.target.value.trim().toLowerCase();
  if (!query) return;
  const list = Array.isArray(cachedSObjects) ? cachedSObjects : (cachedSObjects?.sobjects || []);
  const match = list.find(o => o.name.toLowerCase() === query || o.name.toLowerCase().startsWith(query));
  if (match) {
    loadPaletteForObject(match.name);
  }
}

function onPaletteFieldFilter(e) {
  paletteFilterQuery = e.target.value;
  renderPaletteChips();
}

// ─── STANDARD ENTITY COMMON FIELDS DICTIONARY (ZERO-LATENCY INSTANT AUTOCOMPLETE) ──
const STANDARD_ENTITY_COMMON_FIELDS = {
  user: [
    { name: "Id", label: "User ID", type: "id" },
    { name: "Name", label: "Full Name", type: "string" },
    { name: "FirstName", label: "First Name", type: "string" },
    { name: "LastName", label: "Last Name", type: "string" },
    { name: "Email", label: "Email", type: "email" },
    { name: "Username", label: "Username", type: "string" },
    { name: "IsActive", label: "Active", type: "boolean" },
    { name: "Title", label: "Title", type: "string" },
    { name: "Department", label: "Department", type: "string" },
    { name: "Phone", label: "Phone", type: "phone" },
    { name: "MobilePhone", label: "Mobile", type: "phone" },
    { name: "UserRoleId", label: "Role ID", type: "reference", relationshipName: "UserRole", referenceTo: ["UserRole"] },
    { name: "ProfileId", label: "Profile ID", type: "reference", relationshipName: "Profile", referenceTo: ["Profile"] },
    { name: "Alias", label: "Alias", type: "string" },
    { name: "CreatedDate", label: "Created Date", type: "datetime" },
    { name: "LastLoginDate", label: "Last Login", type: "datetime" }
  ],
  account: [
    { name: "Id", label: "Account ID", type: "id" },
    { name: "Name", label: "Account Name", type: "string" },
    { name: "Type", label: "Type", type: "picklist" },
    { name: "Industry", label: "Industry", type: "picklist" },
    { name: "AnnualRevenue", label: "Annual Revenue", type: "currency" },
    { name: "NumberOfEmployees", label: "Employees", type: "int" },
    { name: "Phone", label: "Phone", type: "phone" },
    { name: "Website", label: "Website", type: "url" },
    { name: "OwnerId", label: "Owner ID", type: "reference", relationshipName: "Owner", referenceTo: ["User"] },
    { name: "ParentId", label: "Parent Account ID", type: "reference", relationshipName: "Parent", referenceTo: ["Account"] },
    { name: "BillingStreet", label: "Billing Street", type: "string" },
    { name: "BillingCity", label: "Billing City", type: "string" },
    { name: "BillingState", label: "Billing State", type: "string" },
    { name: "BillingPostalCode", label: "Billing Zip", type: "string" },
    { name: "BillingCountry", label: "Billing Country", type: "string" },
    { name: "CreatedDate", label: "Created Date", type: "datetime" },
    { name: "LastModifiedDate", label: "Last Modified Date", type: "datetime" }
  ],
  contact: [
    { name: "Id", label: "Contact ID", type: "id" },
    { name: "FirstName", label: "First Name", type: "string" },
    { name: "LastName", label: "Last Name", type: "string" },
    { name: "Name", label: "Full Name", type: "string" },
    { name: "Email", label: "Email", type: "email" },
    { name: "Phone", label: "Phone", type: "phone" },
    { name: "MobilePhone", label: "Mobile Phone", type: "phone" },
    { name: "Title", label: "Title", type: "string" },
    { name: "Department", label: "Department", type: "string" },
    { name: "AccountId", label: "Account ID", type: "reference", relationshipName: "Account", referenceTo: ["Account"] },
    { name: "ReportsToId", label: "Reports To ID", type: "reference", relationshipName: "ReportsTo", referenceTo: ["Contact"] },
    { name: "OwnerId", label: "Owner ID", type: "reference", relationshipName: "Owner", referenceTo: ["User"] },
    { name: "CreatedDate", label: "Created Date", type: "datetime" }
  ],
  opportunity: [
    { name: "Id", label: "Opportunity ID", type: "id" },
    { name: "Name", label: "Opportunity Name", type: "string" },
    { name: "StageName", label: "Stage", type: "picklist" },
    { name: "Amount", label: "Amount", type: "currency" },
    { name: "Probability", label: "Probability (%)", type: "percent" },
    { name: "CloseDate", label: "Close Date", type: "date" },
    { name: "Type", label: "Type", type: "picklist" },
    { name: "LeadSource", label: "Lead Source", type: "picklist" },
    { name: "IsClosed", label: "Closed", type: "boolean" },
    { name: "IsWon", label: "Won", type: "boolean" },
    { name: "AccountId", label: "Account ID", type: "reference", relationshipName: "Account", referenceTo: ["Account"] },
    { name: "OwnerId", label: "Owner ID", type: "reference", relationshipName: "Owner", referenceTo: ["User"] },
    { name: "CreatedDate", label: "Created Date", type: "datetime" }
  ],
  case: [
    { name: "Id", label: "Case ID", type: "id" },
    { name: "CaseNumber", label: "Case Number", type: "string" },
    { name: "Subject", label: "Subject", type: "string" },
    { name: "Status", label: "Status", type: "picklist" },
    { name: "Priority", label: "Priority", type: "picklist" },
    { name: "Origin", label: "Origin", type: "picklist" },
    { name: "Type", label: "Type", type: "picklist" },
    { name: "IsClosed", label: "Closed", type: "boolean" },
    { name: "AccountId", label: "Account ID", type: "reference", relationshipName: "Account", referenceTo: ["Account"] },
    { name: "ContactId", label: "Contact ID", type: "reference", relationshipName: "Contact", referenceTo: ["Contact"] },
    { name: "OwnerId", label: "Owner ID", type: "reference", relationshipName: "Owner", referenceTo: ["User"] },
    { name: "CreatedDate", label: "Created Date", type: "datetime" }
  ],
  lead: [
    { name: "Id", label: "Lead ID", type: "id" },
    { name: "FirstName", label: "First Name", type: "string" },
    { name: "LastName", label: "Last Name", type: "string" },
    { name: "Name", label: "Full Name", type: "string" },
    { name: "Company", label: "Company", type: "string" },
    { name: "Title", label: "Title", type: "string" },
    { name: "Email", label: "Email", type: "email" },
    { name: "Phone", label: "Phone", type: "phone" },
    { name: "Status", label: "Status", type: "picklist" },
    { name: "IsConverted", label: "Converted", type: "boolean" },
    { name: "OwnerId", label: "Owner ID", type: "reference", relationshipName: "Owner", referenceTo: ["User"] },
    { name: "CreatedDate", label: "Created Date", type: "datetime" }
  ],
  recordtype: [
    { name: "Id", label: "Record Type ID", type: "id" },
    { name: "Name", label: "Name", type: "string" },
    { name: "DeveloperName", label: "Developer Name", type: "string" },
    { name: "NamespacePrefix", label: "Namespace Prefix", type: "string" },
    { name: "Description", label: "Description", type: "string" },
    { name: "BusinessProcessId", label: "Business Process ID", type: "reference" },
    { name: "SobjectType", label: "SObject Type", type: "string" },
    { name: "IsActive", label: "Active", type: "boolean" }
  ],
  profile: [
    { name: "Id", label: "Profile ID", type: "id" },
    { name: "Name", label: "Profile Name", type: "string" },
    { name: "UserType", label: "User Type", type: "picklist" },
    { name: "Description", label: "Description", type: "string" }
  ],
  userrole: [
    { name: "Id", label: "Role ID", type: "id" },
    { name: "Name", label: "Role Name", type: "string" },
    { name: "DeveloperName", label: "Developer Name", type: "string" }
  ]
};

function getFieldTypeIcon(type) {
  if (!type) return "📄";
  const t = type.toLowerCase();
  if (t === "id" || t === "reference") return "🆔";
  if (t === "string" || t === "textarea" || t === "encryptedstring") return "🔤";
  if (t === "int" || t === "double" || t === "currency" || t === "percent") return "🔢";
  if (t === "date" || t === "datetime" || t === "time") return "📅";
  if (t === "boolean") return "☑️";
  if (t === "picklist" || t === "multipicklist") return "🏷️";
  if (t === "email" || t === "phone" || t === "url") return "🌐";
  if (t.includes("lookup")) return "🔗";
  if (t.includes("subquery")) return "🌲";
  return "📄";
}

function resolveRelationshipPath(baseObjName, pathSegments) {
  let currentObj = baseObjName;
  const labels = [];

  for (let i = 0; i < pathSegments.length; i++) {
    const seg = pathSegments[i];
    const segLower = seg.toLowerCase();
    const meta = objectDescribeCache.get(currentObj.toLowerCase());

    let targetEntity = null;
    let segLabel = seg;

    if (meta && meta.fields) {
      const lookupField = meta.fields.find(f => 
        (f.relationshipName && f.relationshipName.toLowerCase() === segLower) ||
        (f.name && f.name.toLowerCase() === (segLower + "id")) ||
        (f.name && f.name.toLowerCase() === segLower)
      );

      if (lookupField) {
        segLabel = (lookupField.label || seg).replace(/\s+ID$/i, "").replace(/\s+Id$/i, "");
        if (lookupField.referenceTo && lookupField.referenceTo.length > 0) {
          targetEntity = lookupField.referenceTo[0];
        } else if (lookupField.relationshipName) {
          targetEntity = lookupField.relationshipName;
        }
      }
    }

    if (!targetEntity) {
      if (segLower === "owner" || segLower === "createdby" || segLower === "lastmodifiedby" || segLower === "manager") {
        targetEntity = "User";
        segLabel = seg.charAt(0).toUpperCase() + seg.slice(1);
      } else if (segLower === "account" || segLower === "parent") {
        targetEntity = "Account";
        segLabel = seg.charAt(0).toUpperCase() + seg.slice(1);
      } else if (segLower === "contact" || segLower === "reportsto") {
        targetEntity = "Contact";
        segLabel = seg.charAt(0).toUpperCase() + seg.slice(1);
      } else if (segLower === "recordtype") {
        targetEntity = "RecordType";
        segLabel = "Record Type";
      } else if (segLower === "profile") {
        targetEntity = "Profile";
        segLabel = "Profile";
      } else if (segLower === "role" || segLower === "userrole") {
        targetEntity = "UserRole";
        segLabel = "User Role";
      } else if (segLower.endsWith("__r")) {
        targetEntity = seg.slice(0, -3) + "__c";
        segLabel = seg.slice(0, -3).replace(/_/g, " ");
      } else {
        targetEntity = seg;
      }
    }

    labels.push(segLabel);
    currentObj = targetEntity;
  }

  return {
    targetEntity: currentObj,
    label: labels.join(" • ")
  };
}

// ─── LIVE AUTOCOMPLETE ENGINE ─────────────────────────────────────────
async function handleAutocompleteInput(e, force = false) {
  const input = e.target || document.getElementById("query-input");
  if (!input) return;

  const val = input.value;
  const selStart = input.selectionStart;
  const textBefore = val.slice(0, selStart);

  // 1. Check if cursor is right after FROM or typing an SObject name
  const isAfterFrom = /\bFROM\s+([a-zA-Z0-9_]*)$/i.exec(textBefore);
  if (isAfterFrom) {
    const term = isAfterFrom[1].toLowerCase();
    showSObjectSuggestions(term, isAfterFrom[1]);
    return;
  }

  // 2. Check if cursor is inside a child subquery: (SELECT ... FROM ChildRel)
  let targetObj = null;
  const lastOpenParen = textBefore.lastIndexOf('(');
  const lastCloseParen = textBefore.lastIndexOf(')');

  if (lastOpenParen > lastCloseParen) {
    const subqueryText = textBefore.slice(lastOpenParen);
    const parentObj = extractTargetObject(val) || currentPaletteSObject || "Account";
    const parentMeta = objectDescribeCache.get(parentObj.toLowerCase());

    const childFromMatch = subqueryText.match(/\bFROM\s+([a-zA-Z0-9_]+)/i);
    if (childFromMatch) {
      const childRelName = childFromMatch[1];
      const childRel = parentMeta?.childRelationships?.find(r => r.relationshipName?.toLowerCase() === childRelName.toLowerCase());
      targetObj = childRel?.childSObject || childRelName;
    } else {
      targetObj = parentObj;
    }
  } else {
    targetObj = extractTargetObject(val) || extractTargetObject(textBefore) || currentPaletteSObject || "Account";
  }

  // Extract the current word/token being typed
  const currentWordMatch = textBefore.match(/([a-zA-Z0-9_.]+)$/);
  const currentWord = currentWordMatch ? currentWordMatch[1] : "";

  // If force (Ctrl+Space) or typing a word
  if (targetObj && (currentWord.length >= 1 || force)) {
    if (currentWord.includes(".")) {
      // Dot traversal (e.g. Owner.Name or Account.Owner.Email)
      showRelationshipTraversalSuggestions(targetObj, currentWord);
    } else {
      // Direct field or relationship name (e.g. Name, Owner, CreatedDate)
      showBaseFieldSuggestions(targetObj, currentWord);
    }
    return;
  }

  hideAutocomplete();
}

function showRelationshipTraversalSuggestions(targetObj, currentWord) {
  const parts = currentWord.split(".");
  const filterPart = parts.pop().toLowerCase();
  const chain = parts; // Array of lookup segments, e.g. ["Owner"] or ["Account", "Owner"]

  const resolved = resolveRelationshipPath(targetObj, chain);
  const targetEntity = resolved.targetEntity;
  const entityKey = targetEntity.toLowerCase();

  // Try cache first, then fallback to built-in dictionary
  const cachedMeta = objectDescribeCache.get(entityKey);
  let fields = cachedMeta?.fields || STANDARD_ENTITY_COMMON_FIELDS[entityKey] || [];

  // If not cached, trigger fetch in background for future keystrokes
  if (!cachedMeta) {
    getObjectDescribe(targetEntity).then(meta => {
      if (meta && meta.fields && currentSuggestions.length > 0) {
        showRelationshipTraversalSuggestions(targetObj, currentWord);
      }
    }).catch(() => {});
  }

  // Filter fields on target entity
  const matchedFields = fields.filter(f => 
    !filterPart || f.name.toLowerCase().includes(filterPart) || (f.label && f.label.toLowerCase().includes(filterPart))
  ).slice(0, 20);

  // Lookups on target entity for chained traversal (e.g. Owner.Profile.)
  const lookupChains = fields.filter(f => 
    f.type === "reference" && f.relationshipName &&
    (!filterPart || f.relationshipName.toLowerCase().includes(filterPart) || (f.label && f.label.toLowerCase().includes(filterPart)))
  ).slice(0, 5);

  currentSuggestions = [
    ...matchedFields.map(f => ({
      type: "relation_field",
      insertText: `${chain.join(".")}.${f.name}`,
      display: `${chain.join(".")}.${f.name}`,
      subtext: `${resolved.label} • ${f.label || f.name}`,
      badge: (f.type || "FIELD").toUpperCase(),
      icon: getFieldTypeIcon(f.type),
      replacePrefix: currentWord
    })),
    ...lookupChains.map(f => ({
      type: "parent_rel_expand",
      insertText: `${chain.join(".")}.${f.relationshipName}.`,
      display: `${chain.join(".")}.${f.relationshipName}.`,
      subtext: `Lookup to ${(f.referenceTo || []).join("/")}`,
      badge: "LOOKUP 🔗",
      icon: "🔗",
      replacePrefix: currentWord
    }))
  ];

  if (currentSuggestions.length === 0) {
    hideAutocomplete();
    return;
  }

  renderAutocomplete();
}

function showBaseFieldSuggestions(targetObj, currentWord) {
  const term = currentWord.toLowerCase();
  const entityKey = targetObj.toLowerCase();

  const cachedMeta = objectDescribeCache.get(entityKey);
  let fields = cachedMeta?.fields || STANDARD_ENTITY_COMMON_FIELDS[entityKey] || [];
  let childRels = cachedMeta?.childRelationships || [];

  // Trigger background fetch if not yet loaded
  if (!cachedMeta) {
    getObjectDescribe(targetObj).then(meta => {
      if (meta && currentSuggestions.length > 0) {
        showBaseFieldSuggestions(targetObj, currentWord);
      }
    }).catch(() => {});
  }

  // 1. SOQL Functions matching term
  const functions = ["FIELDS(ALL)", "FIELDS(STANDARD)", "FIELDS(CUSTOM)", "COUNT()", "toLabel()", "FORMAT()"]
    .filter(fn => !term || fn.toLowerCase().includes(term))
    .map(fn => ({
      type: "function",
      insertText: fn,
      display: fn,
      subtext: "SOQL Built-in Function",
      badge: "FUNCTION ⚡",
      icon: "⚡",
      replacePrefix: currentWord
    }));

  // 2. Parent Lookups on targetObj (e.g. Owner., Account., Parent., CreatedBy.)
  const parentLookups = fields.filter(f => 
    f.type === "reference" && f.relationshipName &&
    (!term || f.relationshipName.toLowerCase().includes(term) || (f.label && f.label.toLowerCase().includes(term)))
  ).slice(0, 10).map(f => ({
    type: "parent_rel_expand",
    insertText: `${f.relationshipName}.`,
    display: `${f.relationshipName}.`,
    subtext: `${f.label || f.relationshipName} (${(f.referenceTo || []).join("/")})`,
    badge: "LOOKUP 🔗",
    icon: "🔗",
    replacePrefix: currentWord
  }));

  // 3. Direct Fields on targetObj
  const directFields = fields.filter(f => 
    !term || f.name.toLowerCase().includes(term) || (f.label && f.label.toLowerCase().includes(term))
  ).slice(0, 20).map(f => ({
    type: "field",
    insertText: f.name,
    display: f.name,
    subtext: f.label || "",
    badge: (f.type || "FIELD").toUpperCase(),
    icon: getFieldTypeIcon(f.type),
    replacePrefix: currentWord
  }));

  // 4. Child Subqueries (e.g. Contacts, Opportunities, Cases)
  const matchingChildren = childRels.filter(r => 
    r.relationshipName && (!term || r.relationshipName.toLowerCase().includes(term) || (r.childSObject && r.childSObject.toLowerCase().includes(term)))
  ).slice(0, 8).map(r => {
    let subFields = "Id, Name";
    const cLower = (r.childSObject || "").toLowerCase();
    const rLower = (r.relationshipName || "").toLowerCase();
    if (cLower === "contact") subFields = "Id, FirstName, LastName, Email";
    else if (cLower === "opportunity") subFields = "Id, Name, StageName, Amount";
    else if (cLower === "case") subFields = "Id, CaseNumber, Status, Subject";
    else if (cLower === "task" || cLower === "event" || cLower === "activityhistory" || cLower === "openactivity" || rLower.includes("activit")) {
      subFields = "Id, Subject, Status, ActivityDate";
    }

    return {
      type: "child_subquery",
      insertText: `(SELECT ${subFields} FROM ${r.relationshipName})`,
      display: `(SELECT ... FROM ${r.relationshipName})`,
      subtext: `Child subquery (${r.childSObject})`,
      badge: "SUBQUERY 🌲",
      icon: "🌲",
      replacePrefix: currentWord
    };
  });

  currentSuggestions = [
    ...functions,
    ...parentLookups,
    ...directFields,
    ...matchingChildren
  ];

  if (currentSuggestions.length === 0) {
    hideAutocomplete();
    return;
  }

  renderAutocomplete();
}

function showSObjectSuggestions(term, rawPrefix) {
  const dropdown = document.getElementById("autocomplete-dropdown");
  if (!dropdown) return;

  const list = Array.isArray(cachedSObjects) ? cachedSObjects : (cachedSObjects?.sobjects || []);
  const catalog = (list && list.length > 0)
    ? list
    : [
        { name: "Account", label: "Account", custom: false },
        { name: "Contact", label: "Contact", custom: false },
        { name: "Opportunity", label: "Opportunity", custom: false },
        { name: "Lead", label: "Lead", custom: false },
        { name: "Case", label: "Case", custom: false },
        { name: "User", label: "User", custom: false },
        { name: "Task", label: "Task", custom: false },
        { name: "Event", label: "Event", custom: false }
      ];

  const filtered = catalog
    .filter(o => !term || o.name.toLowerCase().includes(term) || (o.label && o.label.toLowerCase().includes(term)))
    .slice(0, 15);

  if (filtered.length === 0) {
    hideAutocomplete();
    return;
  }

  currentSuggestions = filtered.map(o => ({
    type: "sobject",
    insertText: o.name + " ",
    display: o.name,
    subtext: o.label || "",
    badge: o.custom ? "CUSTOM" : "STANDARD",
    icon: "📦",
    replacePrefix: rawPrefix
  }));

  renderAutocomplete();
}

function renderAutocomplete() {
  const dropdown = document.getElementById("autocomplete-dropdown");
  if (!dropdown) return;
  activeSuggestionIndex = 0;

  dropdown.innerHTML = currentSuggestions.map((item, idx) => {
    let badgeStyle = "background:var(--border); color:var(--text-muted);";
    if (item.badge.includes("LOOKUP")) {
      badgeStyle = "background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe;";
    } else if (item.badge.includes("SUBQUERY")) {
      badgeStyle = "background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0;";
    } else if (item.badge.includes("FUNCTION")) {
      badgeStyle = "background:#fef3c7; color:#b45309; border:1px solid #fde68a;";
    } else if (item.badge === "CUSTOM") {
      badgeStyle = "background:#f3e8ff; color:#7e22ce; border:1px solid #e9d5ff;";
    } else if (item.badge === "STANDARD") {
      badgeStyle = "background:#f1f5f9; color:#334155; border:1px solid #cbd5e1;";
    }

    return `
      <div class="autocomplete-item ${idx === 0 ? "active" : ""}" data-index="${idx}" style="display:flex; justify-content:space-between; align-items:center; padding:7px 12px; cursor:pointer; font-size:12px; border-bottom:1px solid rgba(0,0,0,0.04); gap:12px;">
        <div style="display:flex; align-items:center; gap:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          <span style="font-size:13px; opacity:0.85;">${item.icon || "📄"}</span>
          <strong style="color:var(--text-main); font-family:var(--font-mono); font-size:12px;">${escapeHtml(item.display)}</strong>
          ${item.subtext ? `<span style="color:var(--text-muted); font-size:11px; margin-left:4px; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(item.subtext)}</span>` : ""}
        </div>
        <span class="badge" style="font-size:10px; padding:2px 7px; white-space:nowrap; border-radius:10px; font-weight:600; ${badgeStyle}">${escapeHtml(item.badge)}</span>
      </div>
    `;
  }).join("");

  dropdown.style.display = "block";

  dropdown.querySelectorAll(".autocomplete-item").forEach(itemEl => {
    itemEl.addEventListener("mouseenter", () => {
      dropdown.querySelectorAll(".autocomplete-item").forEach(i => i.classList.remove("active"));
      itemEl.classList.add("active");
      activeSuggestionIndex = parseInt(itemEl.dataset.index, 10);
    });

    itemEl.addEventListener("mousedown", (e) => {
      e.preventDefault();
      applySuggestion(activeSuggestionIndex);
    });
  });
}

function hideAutocomplete() {
  const dropdown = document.getElementById("autocomplete-dropdown");
  if (dropdown) dropdown.style.display = "none";
  currentSuggestions = [];
}

function handleAutocompleteKeydown(e) {
  const dropdown = document.getElementById("autocomplete-dropdown");
  const isVisible = dropdown && dropdown.style.display !== "none" && currentSuggestions.length > 0;

  // Ctrl+Space or Cmd+Space explicitly triggers autocomplete
  if ((e.ctrlKey || e.metaKey) && (e.key === " " || e.code === "Space")) {
    e.preventDefault();
    handleAutocompleteInput(e, true);
    return;
  }

  if (isVisible) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeSuggestionIndex = (activeSuggestionIndex + 1) % currentSuggestions.length;
      highlightSuggestion();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      activeSuggestionIndex = (activeSuggestionIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
      highlightSuggestion();
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        applySuggestion(activeSuggestionIndex);
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hideAutocomplete();
      return;
    }
  }

  // Ctrl+Enter or Cmd+Enter executes query
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    hideAutocomplete();
    runQuery();
  }
}

function highlightSuggestion() {
  const dropdown = document.getElementById("autocomplete-dropdown");
  if (!dropdown) return;
  const items = dropdown.querySelectorAll(".autocomplete-item");
  items.forEach((item, idx) => {
    if (idx === activeSuggestionIndex) {
      item.classList.add("active");
      item.scrollIntoView({ block: "nearest" });
    } else {
      item.classList.remove("active");
    }
  });
}

function applySuggestion(index) {
  const item = currentSuggestions[index];
  if (!item) return;

  const input = document.getElementById("query-input");
  const val = input.value;
  const selStart = input.selectionStart;
  const prefix = item.replacePrefix;

  const before = val.slice(0, selStart - prefix.length);
  const after = val.slice(selStart);

  let insertion = item.insertText;

  // 1. If relationship traversal item (e.g. "Owner."):
  if (item.type === "parent_rel_expand" || insertion.endsWith(".")) {
    input.value = before + insertion + after;
    input.selectionStart = input.selectionEnd = before.length + insertion.length;
    input.focus();
    // Instantly trigger next-level traversal suggestions!
    handleAutocompleteInput({ target: input }, true);
    return;
  }

  // 2. Direct field or child subquery in SELECT clause:
  const isSelectClause = /\bSELECT\b[\s\S]*$/i.test(before) && !/\bFROM\b[\s\S]*$/i.test(before);
  if (isSelectClause && !after.trim().startsWith(",") && !after.trim().toUpperCase().startsWith("FROM")) {
    insertion += ", ";
  } else if (!isSelectClause && !insertion.endsWith(" ")) {
    insertion += " ";
  }

  input.value = before + insertion + after;
  input.selectionStart = input.selectionEnd = before.length + insertion.length;

  hideAutocomplete();
  input.focus();
  updateContextObject();
}

function updateContextObject() {
  const input = document.getElementById("query-input");
  const targetObj = extractTargetObject(input?.value || "");
  if (targetObj && targetObj !== currentPaletteSObject) {
    currentPaletteSObject = targetObj;
    const panel = document.getElementById("schema-palette");
    if (panel && panel.style.display !== "none") {
      loadPaletteForObject(targetObj);
    }
  }
}

// ─── AUTOCOMPLETE & EVENT HANDLERS ────────────────────────────────────
function setupEvents() {
  // Run query button
  document.getElementById("btn-run")?.addEventListener("click", runQuery);

  // Advanced Copy & Export Actions
  document.getElementById("btn-copy-excel")?.addEventListener("click", copyExcelTsv);
  document.getElementById("btn-copy-csv")?.addEventListener("click", copyCsv);
  document.getElementById("btn-copy-json")?.addEventListener("click", copyJson);
  document.getElementById("btn-copy-in")?.addEventListener("click", copyInClause);
  document.getElementById("btn-export-csv")?.addEventListener("click", exportCsv);
  document.getElementById("btn-export-json")?.addEventListener("click", exportJson);

  // Grid client-side filter
  document.getElementById("grid-filter")?.addEventListener("input", applyGridFilter);

  // Helper buttons
  document.getElementById("btn-helper-fields-all")?.addEventListener("click", () => applyHelper("FIELDS(ALL)"));
  document.getElementById("btn-helper-fields-std")?.addEventListener("click", () => applyHelper("FIELDS(STANDARD)"));
  document.getElementById("btn-helper-count")?.addEventListener("click", () => applyHelper("COUNT()"));
  document.getElementById("btn-toggle-schema-panel")?.addEventListener("click", toggleSchemaPalette);
  document.getElementById("palette-obj-search")?.addEventListener("input", onPaletteSearch);
  document.getElementById("palette-field-filter")?.addEventListener("input", onPaletteFieldFilter);
  document.getElementById("btn-quick-common-fields")?.addEventListener("click", insertCommonFields);
  document.getElementById("btn-insert-all-fields")?.addEventListener("click", insertAllPaletteFields);
  document.getElementById("btn-clear-query-fields")?.addEventListener("click", clearQueryFields);

  // Palette Category Tab Switching
  document.querySelectorAll("#palette-tabs .palette-tab-btn").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#palette-tabs .palette-tab-btn").forEach(t => {
        t.classList.remove("active");
        t.style.background = "var(--bg-card)";
        t.style.color = "var(--text-muted)";
      });
      tab.classList.add("active");
      tab.style.background = "var(--primary)";
      tab.style.color = "#fff";
      activePaletteTab = tab.dataset.tab;
      renderPaletteChips();
    });
  });

  // Palette Chips Click Delegation
  document.getElementById("palette-fields-list")?.addEventListener("click", (e) => {
    const chip = e.target.closest(".btn-palette-chip");
    if (!chip) return;
    const fieldId = chip.getAttribute("data-field-id");
    if (fieldId) {
      toggleFieldInQuery(fieldId);
    }
  });

  // Data Grid Header Mode Change
  document.getElementById("select-header-display")?.addEventListener("change", () => {
    if (currentFilteredRecords && currentFilteredRecords.length > 0) {
      renderTable(currentFilteredRecords, false);
    }
  });

  // Keyboard shortcut Ctrl+Enter / Cmd+Enter to execute query & autocomplete typing
  const queryInput = document.getElementById("query-input");
  queryInput?.addEventListener("input", (e) => {
    handleAutocompleteInput(e);
    updatePaletteActiveStates();
  });
  queryInput?.addEventListener("keydown", handleAutocompleteKeydown);
  queryInput?.addEventListener("blur", () => {
    setTimeout(hideAutocomplete, 200);
  });

  // Tab switching
  document.querySelectorAll("#result-tabs .tool-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#result-tabs .tool-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab;

      document.getElementById("grid-view").style.display = target === "grid" ? "flex" : "none";
      document.getElementById("ai-prompt-view").style.display = target === "ai-prompt" ? "block" : "none";
      document.getElementById("relations-view").style.display = target === "relations" ? "block" : "none";
      document.getElementById("json-view").style.display = target === "json" ? "block" : "none";
      document.getElementById("plan-view").style.display = target === "plan" ? "block" : "none";
      document.getElementById("history-view").style.display = target === "history" ? "block" : "none";
      document.getElementById("guide-view").style.display = target === "guide" ? "block" : "none";

      if (target === "relations") {
        loadRelationshipExplorer();
      }
    });
  });

  // AI Studio Events
  document.getElementById("btn-ai-generate")?.addEventListener("click", generateAiQuery);
  document.getElementById("btn-ai-run-now")?.addEventListener("click", () => {
    const code = document.getElementById("ai-generated-code")?.textContent.trim();
    if (code) {
      document.getElementById("query-input").value = code;
      document.querySelector('.tool-tab[data-tab="grid"]')?.click();
      runQuery();
    }
  });
  document.getElementById("btn-ai-copy")?.addEventListener("click", () => {
    const code = document.getElementById("ai-generated-code")?.textContent.trim();
    if (code) {
      navigator.clipboard.writeText(code).then(() => showToast("✓ Copied AI SOQL to clipboard!"));
    }
  });
  document.getElementById("btn-ai-explain")?.addEventListener("click", () => {
    const query = document.getElementById("query-input")?.value.trim();
    if (query) {
      document.getElementById("ai-prompt-input").value = `Explain this SOQL query: ${query}`;
      generateAiQuery();
    }
  });
  document.getElementById("btn-ai-optimize")?.addEventListener("click", getQueryPlan);

  // Sample prompt chips
  document.querySelectorAll(".prompt-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const prompt = chip.getAttribute("data-prompt");
      const input = document.getElementById("ai-prompt-input");
      if (input) input.value = prompt;
      generateAiQuery();
    });
  });

  // Relationship tab loader button
  document.getElementById("btn-rel-load")?.addEventListener("click", loadRelationshipExplorer);

  // Clear history button
  document.getElementById("btn-clear-history")?.addEventListener("click", () => {
    localStorage.removeItem("sfpi_query_history");
    queryHistory = [];
    renderHistory();
  });

  // Close autocomplete on click outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".autocomplete-container")) {
      hideAutocomplete();
    }
  });
}

function applyGridFilter() {
  const q = document.getElementById("grid-filter")?.value.trim().toLowerCase();
  const statusEl = document.getElementById("grid-filter-status");
  const countBadge = document.getElementById("grid-count-badge");

  if (!q) {
    currentFilteredRecords = currentRecords;
    if (statusEl) statusEl.textContent = "";
    if (countBadge) countBadge.textContent = `${currentRecords.length} records`;
  } else {
    currentFilteredRecords = currentRecords.filter(rec => {
      const flattened = flattenRecord(rec);
      return Object.values(flattened).some(v => String(v ?? "").toLowerCase().includes(q));
    });
    if (statusEl) statusEl.textContent = `Showing ${currentFilteredRecords.length} of ${currentRecords.length}`;
    if (countBadge) countBadge.textContent = `${currentFilteredRecords.length} / ${currentRecords.length} records`;
  }

  displayedQueryRowCount = 50;
  renderTable(currentFilteredRecords, false);
}

function applyHelper(helperText) {
  const input = document.getElementById("query-input");
  let val = input.value;
  const targetObj = extractTargetObject(val) || currentPaletteSObject || "Account";

  if (helperText === "COUNT()") {
    input.value = `SELECT COUNT() FROM ${targetObj}`;
  } else {
    input.value = `SELECT ${helperText} FROM ${targetObj} LIMIT 50`;
  }
  input.focus();
}

function saveHistory(query) {
  if (!query) return;
  queryHistory = queryHistory.filter(q => q !== query);
  queryHistory.unshift(query);
  if (queryHistory.length > 30) queryHistory.pop();
  localStorage.setItem("sfpi_query_history", JSON.stringify(queryHistory));
  renderHistory();
}

function renderHistory() {
  const list = document.getElementById("history-list");
  if (!list) return;
  if (queryHistory.length === 0) {
    list.innerHTML = `<li style="color:var(--text-muted); font-size:12px;">No recent queries.</li>`;
    return;
  }
  list.innerHTML = queryHistory.map(q => `
    <li style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:var(--bg-card); border:1px solid var(--border); border-radius:6px;">
      <code style="font-size:12px; font-family:var(--font-mono); color:var(--text-main); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-right:12px;">${escapeHtml(q)}</code>
      <button class="btn btn-secondary btn-sm btn-load-hist" data-query="${escapeHtml(q)}">Load Query</button>
    </li>
  `).join("");

  list.querySelectorAll(".btn-load-hist").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("query-input").value = btn.getAttribute("data-query");
      document.querySelector('.tool-tab[data-tab="grid"]')?.click();
      runQuery();
    });
  });
}

// Infinite scroll listener on query results container
const gridViewContainer = document.getElementById("grid-view");
gridViewContainer?.addEventListener("scroll", async () => {
  if (gridViewContainer.scrollTop + gridViewContainer.clientHeight >= gridViewContainer.scrollHeight - 60) {
    if (displayedQueryRowCount < currentFilteredRecords.length) {
      displayedQueryRowCount += 50;
      renderTable(currentFilteredRecords, true);
    } else if (queryNextUrl && !isLoadingNextBatch) {
      isLoadingNextBatch = true;
      const statsEl = document.getElementById("query-stats");
      if (statsEl) statsEl.textContent = `⏳ Streaming next batch from Salesforce...`;
      try {
        const nextRes = await sfConn.rest(queryNextUrl);
        const newRecords = nextRes.records || [];
        queryNextUrl = nextRes.nextRecordsUrl || null;
        currentRecords = currentRecords.concat(newRecords);
        currentFilteredRecords = currentRecords;
        document.getElementById("record-count").textContent = currentRecords.length;
        const gridCountBadge = document.getElementById("grid-count-badge");
        if (gridCountBadge) gridCountBadge.textContent = `${currentRecords.length} records`;
        if (statsEl) statsEl.textContent = `✓ Fetched ${currentRecords.length} records (Streaming)${queryNextUrl ? ' - Scroll for more' : ''}`;
        displayedQueryRowCount += 50;
        renderTable(currentFilteredRecords, true);
      } catch (e) {
        console.warn("Failed to stream next records:", e);
      } finally {
        isLoadingNextBatch = false;
      }
    }
  }
});

init();
