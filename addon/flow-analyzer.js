import { sfConn, apiVersion, updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";

const sfHost = resolveSfHost();
let allFlowRecords = [];
let scanResults = new Map(); // flowId -> { flow, issues, status: 'pending'|'scanning'|'done'|'error', errorMsg }
let isScanning = false;

async function init() {
  if (!sfHost) {
    alert("Salesforce host not found.");
    return;
  }

  // Pre-render immediately with cached info
  let orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
  updateNavbarOrgBadge(sfHost, orgInfo);

  try {
    await sfConn.getSession(sfHost);
  } catch (err) {
    console.warn("[Flow Scanner] Session establishment warning:", err);
  }

  // Re-render with live org session details
  orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
  updateNavbarOrgBadge(sfHost, orgInfo);

  if (!sfConn.sessionId) {
    const statusEl = document.getElementById("scan-status");
    const tbody = document.getElementById("flows-body");
    statusEl.innerHTML = `<span style="color:#dc2626;">❌ Session not detected</span>`;
    tbody.innerHTML = `<tr><td colspan="5" style="color:#dc2626; text-align:center; padding:30px;">
      <div style="font-weight:600; font-size:14px; margin-bottom:6px;">⚠️ Salesforce Session Not Detected</div>
      <div style="font-size:12px; opacity:0.85; margin-bottom:12px;">Unable to detect active Salesforce session for <code>${sfHost}</code>. Please ensure you are logged into Salesforce and refresh your tab.</div>
      <button class="btn btn-secondary" style="font-size:12px; padding:5px 14px;" data-action="reload-scanner">🔄 Reload Scanner</button>
    </td></tr>`;
    tbody.onclick = (e) => {
      const btn = e.target.closest("[data-action='reload-scanner']");
      if (btn) location.reload();
    };
    return;
  }

  setupEvents();
  await loadFlowCatalog();
}

function setupEvents() {
  document.getElementById("btn-scan-all").addEventListener("click", () => {
    if (!isScanning) scanAllFlows();
  });

  document.getElementById("flow-filter").addEventListener("input", renderTable);
  document.getElementById("risk-filter").addEventListener("change", renderTable);

  const tbody = document.getElementById("flows-body");
  tbody?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "reload-scanner") {
      location.reload();
    } else if (action === "retry-flows") {
      retryLoadFlows();
    } else if (action === "scan-flow") {
      const flowId = btn.dataset.id;
      if (flowId) scanSingleFlow(flowId);
    }
  });
}

async function loadFlowCatalog() {
  const statusEl = document.getElementById("scan-status");
  const tbody = document.getElementById("flows-body");

  statusEl.textContent = "Loading Flow catalog...";
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px;">Querying active Flow catalog via Tooling API...</td></tr>`;

  try {
    if (!sfConn.sessionId && sfHost) {
      await sfConn.getSession(sfHost);
    }

    let res = null;
    // 1. Primary: Query active flows with Description
    try {
      res = await sfConn.query(`SELECT Id, MasterLabel, ProcessType, Status, VersionNumber, Description FROM Flow WHERE Status = 'Active'`, true);
    } catch (err1) {
      // 2. Query active flows without Description (in case of field permission/version variance)
      try {
        res = await sfConn.query(`SELECT Id, MasterLabel, ProcessType, Status, VersionNumber FROM Flow WHERE Status = 'Active'`, true);
      } catch (err2) {
        // 3. Query all flows without WHERE clause
        try {
          res = await sfConn.query(`SELECT Id, MasterLabel, ProcessType, Status, VersionNumber FROM Flow LIMIT 200`, true);
        } catch (err3) {
          // 4. Standard data API fallback (for non-admin users / free sandboxes)
          try {
            const resDef = await sfConn.query(`SELECT Id, DurableId, ApiName, Label, ProcessType, TriggerType, ActiveVersionId FROM FlowDefinitionView LIMIT 200`, false);
            if (resDef && resDef.records && resDef.records.length > 0) {
              res = {
                records: resDef.records.map(r => ({
                  Id: r.ActiveVersionId || r.Id,
                  MasterLabel: r.Label || r.ApiName,
                  ProcessType: r.ProcessType || "Flow",
                  Status: "Active",
                  VersionNumber: 1,
                  Description: r.TriggerType || ""
                }))
              };
            }
          } catch (err4) {
            throw err1; // Throw original Tooling API error if all fallbacks fail
          }
        }
      }
    }

    allFlowRecords = (res && res.records) ? res.records : [];

    // Fallback: If 0 active flows found, check if there are ANY flows in this org (e.g. Draft, Inactive)
    if (allFlowRecords.length === 0) {
      try {
        const resAll = await sfConn.query(`SELECT Id, MasterLabel, ProcessType, Status, VersionNumber FROM Flow LIMIT 200`, true);
        if (resAll && resAll.records && resAll.records.length > 0) {
          allFlowRecords = resAll.records;
        }
      } catch (eFallback) {
        console.warn("[Flow Scanner] All-flows query fallback note:", eFallback);
      }
    }

    // Always sort cleanly in JavaScript without relying on Tooling API SOQL ordering
    allFlowRecords.sort((a, b) => (a.MasterLabel || "").localeCompare(b.MasterLabel || ""));

    scanResults.clear();
    allFlowRecords.forEach(flow => {
      scanResults.set(flow.Id, {
        flow,
        issues: null,
        status: "pending",
        errorMsg: null
      });
    });

    if (allFlowRecords.length === 0) {
      statusEl.innerHTML = `<span style="color:var(--text-muted);">No flows found in this Salesforce org</span>`;
    } else {
      const activeCount = allFlowRecords.filter(f => f.Status === "Active").length;
      statusEl.innerHTML = `<span style="color:#0176d3; font-weight:600;">Found ${allFlowRecords.length} flows (${activeCount} active)</span> — Ready to scan`;
    }
    renderTable();

    // Deep-linking support: if flowId or id is in the URL, filter and scan that flow!
    const params = new URLSearchParams(window.location.search);
    const targetFlowId = params.get("flowId") || params.get("id");
    if (targetFlowId) {
      const match = allFlowRecords.find(f => f.Id === targetFlowId || f.Id.startsWith(targetFlowId));
      if (match) {
        const filterInput = document.getElementById("flow-filter");
        if (filterInput) filterInput.value = match.MasterLabel;
        renderTable();
        await scanSingleFlow(match.Id);
      }
    }
  } catch (err) {
    statusEl.innerHTML = `<span style="color:#dc2626;">❌ Catalog fetch failed: ${err.message}</span>`;
    tbody.innerHTML = `<tr><td colspan="5" style="color:#dc2626; text-align:center; padding:25px;">
      <div style="font-weight:600; font-size:14px; margin-bottom:6px;">⚠️ Unable to query Salesforce Flows</div>
      <div style="font-size:12px; opacity:0.85; margin-bottom:12px;">${err.message}</div>
      <button class="btn btn-secondary" style="font-size:12px; padding:4px 12px;" data-action="retry-flows">🔄 Retry Flow Query</button>
    </td></tr>`;
  }
}

async function scanAllFlows() {
  if (allFlowRecords.length === 0) return;
  isScanning = true;

  const btnScan = document.getElementById("btn-scan-all");
  const statusEl = document.getElementById("scan-status");
  const progressContainer = document.getElementById("progress-container");
  const progressBar = document.getElementById("progress-bar");

  btnScan.disabled = true;
  btnScan.textContent = "⏳ Scanning batch-wise...";
  progressContainer.style.display = "block";
  progressBar.style.width = "0%";

  let completed = 0;
  const total = allFlowRecords.length;

  // Controlled batch size of 2 flows with gentle throttling delay to avoid Tooling API limits
  const batchSize = 2;
  const throttleMs = 180;

  for (let i = 0; i < total; i += batchSize) {
    if (!isScanning) break;
    const batch = allFlowRecords.slice(i, i + batchSize);
    await Promise.all(batch.map(flow => scanSingleFlow(flow.Id, false)));
    completed += batch.length;
    const pct = Math.min(100, Math.round((completed / total) * 100));
    progressBar.style.width = `${pct}%`;
    statusEl.textContent = `Batch-scanning flow ${completed} of ${total} (${pct}%)...`;
    renderTable();

    // Gentle throttle pause between batches to protect governor limits
    if (i + batchSize < total) {
      await new Promise(r => setTimeout(r, throttleMs));
    }
  }

  isScanning = false;
  btnScan.disabled = false;
  btnScan.textContent = "⚡ Re-Scan All Flows";

  let totalIssues = 0;
  for (const item of scanResults.values()) {
    if (item.issues && item.issues.length > 0) totalIssues += item.issues.length;
  }

  statusEl.innerHTML = `<span style="color:#16a34a; font-weight:600;">✓ Scan Complete</span>: ${total} flows scanned, ${totalIssues} anti-patterns identified.`;
  renderTable();
}

async function scanSingleFlow(flowId, shouldReRender = true) {
  const item = scanResults.get(flowId);
  if (!item) return;

  item.status = "scanning";
  if (shouldReRender) renderTable();

  try {
    // Tooling API: Exactly 1 row for Metadata retrieval
    const q = `SELECT Id, Metadata FROM Flow WHERE Id = '${flowId}'`;
    const res = await sfConn.query(q, true);
    const flowWithMeta = res.records?.[0];

    if (!flowWithMeta || !flowWithMeta.Metadata) {
      item.issues = [{ level: "info", text: "No Metadata payload returned (may be managed package or compiled-only)." }];
      item.status = "done";
    } else {
      item.issues = analyzeFlowMetadata(item.flow, flowWithMeta.Metadata);
      item.status = "done";
    }
  } catch (err) {
    item.status = "error";
    item.errorMsg = err.message;
    item.issues = [{ level: "warning", text: `Metadata read restricted: ${err.message}` }];
  }

  if (shouldReRender) renderTable();
}

/**
 * Traverses flow metadata graph starting at loop.nextValueConnector to identify
 * all elements that execute inside the loop body iteration path.
 */
function getElementsInLoop(loop, meta) {
  const loopName = loop.name;
  const startTarget = loop.nextValueConnector?.targetReference;
  if (!startTarget) return new Set();

  const elementsInLoop = new Set();
  const visited = new Set();
  const queue = [startTarget];

  // Map all candidate nodes across the flow
  const allElements = [
    ...(meta.recordCreates || []),
    ...(meta.recordUpdates || []),
    ...(meta.recordDeletes || []),
    ...(meta.recordLookups || []),
    ...(meta.actionCalls || []),
    ...(meta.assignments || []),
    ...(meta.decisions || []),
    ...(meta.subflows || []),
    ...(meta.screens || [])
  ];
  const elementMap = new Map();
  allElements.forEach(el => elementMap.set(el.name, el));

  while (queue.length > 0) {
    const currentName = queue.shift();
    if (!currentName || visited.has(currentName)) continue;
    visited.add(currentName);

    // If it reaches the loop node itself, the iteration branch connects back
    if (currentName === loopName) continue;

    elementsInLoop.add(currentName);

    const el = elementMap.get(currentName);
    if (!el) continue;

    if (el.connector?.targetReference) {
      queue.push(el.connector.targetReference);
    }
    if (el.defaultConnector?.targetReference) {
      queue.push(el.defaultConnector.targetReference);
    }
    if (Array.isArray(el.rules)) {
      el.rules.forEach(rule => {
        if (rule.connector?.targetReference) {
          queue.push(rule.connector.targetReference);
        }
      });
    }
  }

  return elementsInLoop;
}

function analyzeFlowMetadata(flow, meta) {
  const issues = [];
  meta = meta || {};

  // 1. Missing Flow Description
  if (!flow.Description && !meta.description) {
    issues.push({ level: "info", text: "Missing Description: Document architectural purpose & trigger context." });
  }

  // 2. Hardcoded Salesforce IDs (15 or 18 chars)
  const rawMeta = JSON.stringify(meta);
  const idPattern = /['"][0-9a-zA-Z]{15}['"]|['"][0-9a-zA-Z]{18}['"]/g;
  const hardcodedMatches = rawMeta.match(idPattern) || [];
  if (hardcodedMatches.length > 0) {
    const sample = [...new Set(hardcodedMatches)].slice(0, 3).join(", ");
    issues.push({ level: "warning", text: `Hardcoded Salesforce IDs detected (${sample}) — Will break across environments/sandboxes.` });
  }

  // 3. Governor Limit Validations: SOQL 101, DML 150, & Actions in Loops
  const loops = meta.loops || [];
  const loopElementsMap = new Map();
  loops.forEach(loop => {
    loopElementsMap.set(loop.name, getElementsInLoop(loop, meta));
  });

  const recordCreates = meta.recordCreates || [];
  const recordUpdates = meta.recordUpdates || [];
  const recordDeletes = meta.recordDeletes || [];
  const recordLookups = meta.recordLookups || [];
  const actionCalls = meta.actionCalls || [];

  const dmlOperations = [
    { type: "Create", list: recordCreates },
    { type: "Update", list: recordUpdates },
    { type: "Delete", list: recordDeletes }
  ];

  // DML in Loop (DML 150 Limit)
  dmlOperations.forEach(({ type, list }) => {
    list.forEach(dml => {
      for (const [loopName, loopElements] of loopElementsMap.entries()) {
        if (loopElements.has(dml.name) || dml.connector?.targetReference === loopName) {
          issues.push({
            level: "error",
            text: `DML in Loop [DML 150 Limit]: '${dml.name}' (${type}) executes inside loop '${loopName}' — Move DML outside loop using record collections!`
          });
          break;
        }
      }
    });
  });

  // SOQL in Loop (SOQL 101 Limit)
  recordLookups.forEach(lookup => {
    for (const [loopName, loopElements] of loopElementsMap.entries()) {
      if (loopElements.has(lookup.name) || lookup.connector?.targetReference === loopName) {
        issues.push({
          level: "error",
          text: `SOQL in Loop [SOQL 101 Limit]: Get Records '${lookup.name}' executes inside loop '${loopName}' — Query records before the loop to prevent limit failure!`
        });
        break;
      }
    }
  });

  // Invocable Actions in Loop
  actionCalls.forEach(act => {
    for (const [loopName, loopElements] of loopElementsMap.entries()) {
      if (loopElements.has(act.name) || act.connector?.targetReference === loopName) {
        issues.push({
          level: "warning",
          text: `Action in Loop: Action '${act.name}' executes inside loop '${loopName}' — Ensure invocable apex is bulkified to avoid CPU/Callout limits.`
        });
        break;
      }
    }
  });

  // 4. Fault Paths (Fault Connectors) Validation — Always Maintain
  dmlOperations.forEach(({ type, list }) => {
    list.forEach(dml => {
      if (!dml.faultConnector || !dml.faultConnector.targetReference) {
        issues.push({
          level: "warning",
          text: `Missing Fault Connector: DML '${dml.name}' (${type}) has no fault path. A database exception will roll back without user-friendly feedback.`
        });
      }
    });
  });

  actionCalls.forEach(act => {
    if (!act.faultConnector || !act.faultConnector.targetReference) {
      issues.push({
        level: "warning",
        text: `Missing Fault Connector: Action '${act.name}' has no error-handling fault path. Apex errors or integration downtime will crash the flow.`
      });
    }
  });

  // 5. Subflow execution review
  const subflows = meta.subflows || [];
  if (subflows.length > 5) {
    issues.push({ level: "info", text: `High Subflow density (${subflows.length} subflows) — Monitor transaction depth to stay within CPU limit.` });
  }

  return issues;
}

function renderTable() {
  const tbody = document.getElementById("flows-body");
  const searchFilter = document.getElementById("flow-filter").value.toLowerCase();
  const riskFilter = document.getElementById("risk-filter").value;

  if (allFlowRecords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">No flows found in this Salesforce org.</td></tr>`;
    return;
  }

  const filtered = allFlowRecords.filter(flow => {
    const item = scanResults.get(flow.Id);
    const matchesSearch = flow.MasterLabel.toLowerCase().includes(searchFilter) ||
                          flow.ProcessType.toLowerCase().includes(searchFilter) ||
                          flow.Id.toLowerCase().includes(searchFilter);
    if (!matchesSearch) return false;

    if (riskFilter === "active") {
      return flow.Status === "Active";
    }
    if (riskFilter === "issues") {
      return item && item.issues && item.issues.some(i => i.level === "warning" || i.level === "error");
    }
    if (riskFilter === "clean") {
      return item && item.issues && item.issues.length === 0;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color: var(--text-muted);">No flows match the filter criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(flow => {
    const item = scanResults.get(flow.Id) || {};
    let statusActionHtml = "";
    let diagnosticsHtml = "";

    if (item.status === "pending") {
      statusActionHtml = `<button class="btn btn-secondary" style="font-size:11px; padding:3px 8px;" data-action="scan-flow" data-id="${flow.Id}">Scan</button>`;
      diagnosticsHtml = `<span style="color:var(--text-muted); font-size:12px;">Not scanned yet — Click Scan or "Scan All"</span>`;
    } else if (item.status === "scanning") {
      statusActionHtml = `<span style="font-size:11px; color:#0176d3; font-weight:600;">Scanning...</span>`;
      diagnosticsHtml = `<span style="color:#0176d3; font-size:12px;">⏳ Analyzing flow elements...</span>`;
    } else if (item.status === "error") {
      statusActionHtml = `<button class="btn btn-secondary" style="font-size:11px; padding:3px 8px;" data-action="scan-flow" data-id="${flow.Id}">Retry</button>`;
      diagnosticsHtml = `<span style="color:#dc2626; font-size:12px;">⚠️ ${item.errorMsg || "Analysis warning"}</span>`;
    } else {
      statusActionHtml = `<button class="btn btn-secondary" style="font-size:11px; padding:3px 8px;" data-action="scan-flow" data-id="${flow.Id}">Re-Scan</button>`;
      if (!item.issues || item.issues.length === 0) {
        diagnosticsHtml = `<span style="color:#16a34a; font-weight:600; font-size:12px;">✓ Clean — No anti-patterns detected</span>`;
      } else {
        diagnosticsHtml = item.issues.map(iss => {
          let color = "#3b82f6";
          let bg = "#eff6ff";
          if (iss.level === "warning") { color = "#d97706"; bg = "#fffbeb"; }
          if (iss.level === "error") { color = "#dc2626"; bg = "#fef2f2"; }

          return `
            <div style="font-size:11px; margin-bottom:4px; padding:3px 6px; border-radius:4px; background:${bg}; color:${color}; border:1px solid ${color}33;">
              <strong>[${iss.level.toUpperCase()}]</strong> ${iss.text}
            </div>
          `;
        }).join("");
      }
    }

    return `
      <tr>
        <td>
          <div style="font-weight:600; font-size:13px; color:var(--text-primary);">${flow.MasterLabel}</div>
          <div style="display:flex; gap:8px; align-items:center; margin-top:2px;">
            <code style="font-size:11px; color:#6b7280;">${flow.Id}</code>
            <a href="https://${sfHost}/builder_platform_interaction/flowBuilder.app?flowId=${flow.Id}" target="_blank" style="color:#0176d3; font-size:11px; font-weight:600; text-decoration:none;">↗ Open in Builder</a>
          </div>
        </td>
        <td>
          <span style="font-size:11px; background:#f1f5f9; padding:2px 6px; border-radius:4px; font-weight:500;">
            ${flow.ProcessType}
          </span>
        </td>
        <td>
          <span style="font-size:11px; color:#16a34a; font-weight:600; background:#f0fdf4; padding:2px 6px; border-radius:4px;">
            ${flow.Status} (v${flow.VersionNumber})
          </span>
        </td>
        <td style="text-align:center;">
          ${statusActionHtml}
        </td>
        <td>
          ${diagnosticsHtml}
        </td>
      </tr>
    `;
  }).join("");
}

window.scanSingleFlowId = (flowId) => {
  scanSingleFlow(flowId, true);
};

window.retryLoadFlows = async () => {
  if (!sfConn.sessionId && sfHost) {
    try {
      await sfConn.getSession(sfHost);
    } catch (e) {}
  }
  loadFlowCatalog();
};

init();
