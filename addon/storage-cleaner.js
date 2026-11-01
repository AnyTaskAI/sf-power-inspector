/**
 * SF Power Inspector — Storage Cleaner & Sandbox Optimizer
 * Safely frees up sandbox data and file storage with selective time period filters,
 * category recommendations, safety confirmations, and batched deletion.
 */

import { sfConn, apiVersion, updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";

const sfHost = resolveSfHost();
let orgLimits = null;
let detectedCustomLogs = [];
let categoryCounts = {};
let isAborted = false;

// Apply theme
const savedTheme = localStorage.getItem("sfpi_theme") || "light";
document.documentElement.setAttribute("data-theme", savedTheme);

// Initialize
async function init() {
  if (!sfHost) {
    alert("Salesforce host not found. Please open from an active Salesforce tab.");
    return;
  }

  // Pre-render immediately with cached info
  let orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
  updateNavbarOrgBadge(sfHost, orgInfo);

  setupEvents();

  try {
    await sfConn.getSession(sfHost);
    orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
    updateNavbarOrgBadge(sfHost, orgInfo);

    await loadStorageLimits();
    detectCustomLogObjects();
  } catch (err) {
    logAudit(`[Session Warning] ${err.message}`);
  }
}

// ─── Load & Render Storage Limits & Proactive Alerts ─────────────────
async function loadStorageLimits() {
  try {
    orgLimits = await sfConn.rest(`/services/data/v${apiVersion}/limits`);
    renderStorageGauges(orgLimits);
  } catch (err) {
    logAudit(`[Error Loading Limits] ${err.message}`);
  }
}

function renderStorageGauges(limits) {
  const dataLim = limits?.DataStorageMB;
  const fileLim = limits?.FileStorageMB;

  // Data Storage
  const dataMax = dataLim?.Max || 0;
  const dataRem = dataLim?.Remaining !== undefined ? dataLim.Remaining : dataMax;
  const dataUsed = Math.max(0, dataMax - dataRem);
  const dataPct = dataMax > 0 ? Math.round((dataUsed / dataMax) * 100) : 0;

  // File Storage
  const fileMax = fileLim?.Max || 0;
  const fileRem = fileLim?.Remaining !== undefined ? fileLim.Remaining : fileMax;
  const fileUsed = Math.max(0, fileMax - fileRem);
  const filePct = fileMax > 0 ? Math.round((fileUsed / fileMax) * 100) : 0;

  // Format Helper
  const fmtMb = (n) => n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n.toLocaleString()} MB`;

  // Update Data Storage DOM
  const dataValEl = document.getElementById("data-storage-val");
  const dataBadgeEl = document.getElementById("data-storage-badge");
  const dataBarEl = document.getElementById("data-storage-bar");

  if (dataValEl) dataValEl.textContent = `${fmtMb(dataUsed)} used of ${fmtMb(dataMax)} (${dataPct}%) • ${fmtMb(dataRem)} remaining`;
  if (dataBarEl) {
    dataBarEl.style.width = `${Math.min(100, dataPct)}%`;
    dataBarEl.style.background = dataPct >= 90 ? "#ef4444" : dataPct >= 75 ? "#f59e0b" : "#22c55e";
  }
  if (dataBadgeEl) {
    dataBadgeEl.textContent = dataPct >= 100 ? `${dataPct}% Over Limit` : `${dataPct}% Used`;
    dataBadgeEl.style.background = dataPct >= 90 ? "#ef4444" : dataPct >= 75 ? "#f59e0b" : "#22c55e";
  }

  // Update File Storage DOM
  const fileValEl = document.getElementById("file-storage-val");
  const fileBadgeEl = document.getElementById("file-storage-badge");
  const fileBarEl = document.getElementById("file-storage-bar");

  if (fileValEl) fileValEl.textContent = `${fmtMb(fileUsed)} used of ${fmtMb(fileMax)} (${filePct}%) • ${fmtMb(fileRem)} remaining`;
  if (fileBarEl) {
    fileBarEl.style.width = `${Math.min(100, filePct)}%`;
    fileBarEl.style.background = filePct >= 90 ? "#ef4444" : filePct >= 75 ? "#f59e0b" : "#22c55e";
  }
  if (fileBadgeEl) {
    fileBadgeEl.textContent = filePct >= 100 ? `${filePct}% Over Limit` : `${filePct}% Used`;
    fileBadgeEl.style.background = filePct >= 90 ? "#ef4444" : filePct >= 75 ? "#f59e0b" : "#22c55e";
  }

  // Proactive 24h Warning / Highlighter Check
  const isHighRisk = dataPct >= 80 || filePct >= 80;
  const isCritical = dataPct >= 100 || filePct >= 100;
  const banner = document.getElementById("storage-proactive-banner");
  const bannerTitle = document.getElementById("storage-banner-title");
  const bannerDesc = document.getElementById("storage-banner-desc");
  const forecastText = document.getElementById("shield-forecast-text");

  if (banner) {
    if (isCritical) {
      banner.style.display = "flex";
      banner.style.background = "#fef2f2";
      banner.style.borderColor = "#f87171";
      banner.style.color = "#991b1b";
      if (bannerTitle) bannerTitle.textContent = `🚨 CRITICAL: Sandbox Storage Exceeded! (Data: ${dataPct}%, File: ${filePct}%)`;
      if (bannerDesc) bannerDesc.textContent = "Your sandbox is over quota. Standard operations, deployments, and test executions will fail with STORAGE_LIMIT_EXCEEDED. Clean up logs and attachments now.";
    } else if (isHighRisk) {
      banner.style.display = "flex";
      banner.style.background = "#fffbeb";
      banner.style.borderColor = "#fcd34d";
      banner.style.color = "#92400e";
      if (bannerTitle) bannerTitle.textContent = `⚠️ Proactive Warning: Sandbox Storage Reaching Capacity (Data: ${dataPct}%, File: ${filePct}%)`;
      if (bannerDesc) bannerDesc.textContent = "Storage limit will likely be reached within 24 hours based on continuous test and log generation. Clean older records to stay safe.";
    } else {
      banner.style.display = "none";
    }
  }

  if (forecastText) {
    if (isCritical) {
      forecastText.innerHTML = `<span style="color:#dc2626; font-weight:700;">Critical Risk:</span> Quota is currently exceeded (${dataPct}% Data). Free up storage immediately to unblock testing and development.`;
    } else if (isHighRisk) {
      forecastText.innerHTML = `<span style="color:#d97706; font-weight:700;">Elevated Risk:</span> Storage is at ${dataPct}%. At normal sandbox velocity, quota will be exhausted within 1 day. Selective cleanup of items older than 7 days is strongly recommended.`;
    } else {
      forecastText.innerHTML = `<span style="color:#059669; font-weight:700;">Healthy:</span> Storage utilization is within safe operational thresholds (${dataPct}% Data, ${filePct}% File).`;
    }
  }
}

// ─── Time Period Filter Helper ──────────────────────────────────────
function getDateFilterClause() {
  const selectedRadio = document.querySelector('input[name="clean-time-period"]:checked')?.value || "7";

  if (selectedRadio === "7") {
    return {
      clause: "CreatedDate < LAST_N_DAYS:7",
      label: "Older than 7 Days",
      dateDesc: "Created more than 7 days ago"
    };
  } else if (selectedRadio === "30") {
    return {
      clause: "CreatedDate < LAST_N_DAYS:30",
      label: "Older than 30 Days (1 Month)",
      dateDesc: "Created more than 30 days ago"
    };
  } else if (selectedRadio === "90") {
    return {
      clause: "CreatedDate < LAST_N_DAYS:90",
      label: "Older than 90 Days (3 Months)",
      dateDesc: "Created more than 90 days ago"
    };
  } else if (selectedRadio === "custom_date") {
    const customDateVal = document.getElementById("clean-calendar-input")?.value;
    if (!customDateVal) {
      return {
        clause: "CreatedDate < LAST_N_DAYS:7",
        label: "Older than 7 Days (Default - no date picked)",
        dateDesc: "Created more than 7 days ago"
      };
    }
    return {
      clause: `CreatedDate < ${customDateVal}T00:00:00Z`,
      label: `Older than ${customDateVal}`,
      dateDesc: `Created before ${customDateVal}`
    };
  } else if (selectedRadio === "custom_days") {
    const daysVal = parseInt(document.getElementById("clean-custom-days-input")?.value, 10) || 14;
    return {
      clause: `CreatedDate < LAST_N_DAYS:${daysVal}`,
      label: `Older than ${daysVal} Days`,
      dateDesc: `Created more than ${daysVal} days ago`
    };
  } else if (selectedRadio === "all") {
    return {
      clause: "",
      label: "All Time (⚠️ All Historical Records)",
      dateDesc: "All records regardless of creation date"
    };
  }

  return {
    clause: "CreatedDate < LAST_N_DAYS:7",
    label: "Older than 7 Days",
    dateDesc: "Created more than 7 days ago"
  };
}

// ─── Detect Custom Log Objects in Schema ────────────────────────────
async function detectCustomLogObjects() {
  try {
    const globalDesc = await sfConn.describeGlobal();
    const sobjects = globalDesc?.sobjects || [];

    detectedCustomLogs = sobjects.filter(s => {
      const n = s.name.toLowerCase();
      return s.custom && (
        n.includes("log") ||
        n.includes("payload") ||
        n.includes("audit") ||
        n.includes("history") ||
        n.includes("error")
      );
    });

    const lbl = document.getElementById("custom-logs-detected-label");
    if (lbl) {
      if (detectedCustomLogs.length > 0) {
        lbl.textContent = `Found ${detectedCustomLogs.length} custom log object(s): ${detectedCustomLogs.map(s => s.name).slice(0, 3).join(", ")}${detectedCustomLogs.length > 3 ? "..." : ""}`;
      } else {
        lbl.textContent = "No custom *Log*__c or *Payload*__c objects detected in this org schema.";
      }
    }
  } catch (err) {
    // Non-fatal schema describe
  }
}

// ─── Count & Analyze Selected Records ───────────────────────────────
async function analyzeSelectedRecords() {
  const btnCount = document.getElementById("btn-count-records");
  const btnStart = document.getElementById("btn-start-clean");
  if (btnCount) btnCount.disabled = true;

  const dateFilter = getDateFilterClause();
  logAudit(`[Analysis Started] Cutoff Filter: ${dateFilter.label} (${dateFilter.clause || "None"})`);

  categoryCounts = {};
  let totalCount = 0;
  let estimatedMb = 0;

  // 1. ApexLog (Tooling API)
  if (document.getElementById("chk-cat-apexlog")?.checked) {
    try {
      const q = dateFilter.clause
        ? `SELECT count() FROM ApexLog WHERE ${dateFilter.clause}`
        : "SELECT count() FROM ApexLog";
      const res = await sfConn.query(q, true, { logErrors: false });
      const count = res.totalSize || 0;
      categoryCounts["ApexLog"] = count;
      totalCount += count;
      estimatedMb += (count * 0.05); // ~50 KB average per Apex log
      updateCountChip("count-cat-apexlog", count);
      logAudit(`• ApexLog: ${count.toLocaleString()} records`);
    } catch (e) {
      updateCountChip("count-cat-apexlog", "Error");
      logAudit(`• ApexLog count error: ${e.message}`);
    }
  } else {
    updateCountChip("count-cat-apexlog", "—");
  }

  // 2. Email Attachments
  if (document.getElementById("chk-cat-emailattach")?.checked) {
    try {
      const q = dateFilter.clause
        ? `SELECT count() FROM Attachment WHERE ParentId IN (SELECT Id FROM EmailMessage) AND ${dateFilter.clause}`
        : "SELECT count() FROM Attachment WHERE ParentId IN (SELECT Id FROM EmailMessage)";
      const res = await sfConn.query(q, false, { logErrors: false });
      const count = res.totalSize || 0;
      categoryCounts["EmailAttachments"] = count;
      totalCount += count;
      estimatedMb += (count * 0.25); // ~250 KB average attachment
      updateCountChip("count-cat-emailattach", count);
      logAudit(`• Email Attachments: ${count.toLocaleString()} records`);
    } catch (e) {
      updateCountChip("count-cat-emailattach", "0");
      logAudit(`• Email Attachments count: 0 (or no EmailMessage access)`);
    }
  } else {
    updateCountChip("count-cat-emailattach", "—");
  }

  // 3. Custom Log Objects
  if (document.getElementById("chk-cat-customlogs")?.checked && detectedCustomLogs.length > 0) {
    let customLogsCount = 0;
    for (const obj of detectedCustomLogs.slice(0, 5)) {
      try {
        const q = dateFilter.clause
          ? `SELECT count() FROM ${obj.name} WHERE ${dateFilter.clause}`
          : `SELECT count() FROM ${obj.name}`;
        const res = await sfConn.query(q, false, { logErrors: false });
        const c = res.totalSize || 0;
        customLogsCount += c;
        categoryCounts[obj.name] = c;
        logAudit(`• ${obj.name}: ${c.toLocaleString()} records`);
      } catch (e) {}
    }
    totalCount += customLogsCount;
    estimatedMb += (customLogsCount * 0.002); // ~2 KB standard record
    updateCountChip("count-cat-customlogs", customLogsCount);
  } else {
    updateCountChip("count-cat-customlogs", "—");
  }

  // 4. Content Documents / Files
  if (document.getElementById("chk-cat-files")?.checked) {
    try {
      const q = dateFilter.clause
        ? `SELECT count() FROM ContentDocument WHERE ${dateFilter.clause}`
        : "SELECT count() FROM ContentDocument";
      const res = await sfConn.query(q, false, { logErrors: false });
      const count = res.totalSize || 0;
      categoryCounts["ContentDocument"] = count;
      totalCount += count;
      estimatedMb += (count * 0.5); // ~500 KB average file
      updateCountChip("count-cat-files", count);
      logAudit(`• ContentDocument: ${count.toLocaleString()} files`);
    } catch (e) {
      updateCountChip("count-cat-files", "Error");
    }
  } else {
    updateCountChip("count-cat-files", "—");
  }

  // 5. Classic Attachments (Non-Email)
  if (document.getElementById("chk-cat-attachments")?.checked) {
    try {
      const q = dateFilter.clause
        ? `SELECT count() FROM Attachment WHERE (NOT ParentId IN (SELECT Id FROM EmailMessage)) AND ${dateFilter.clause}`
        : "SELECT count() FROM Attachment WHERE (NOT ParentId IN (SELECT Id FROM EmailMessage))";
      const res = await sfConn.query(q, false, { logErrors: false });
      const count = res.totalSize || 0;
      categoryCounts["ClassicAttachments"] = count;
      totalCount += count;
      estimatedMb += (count * 0.2);
      updateCountChip("count-cat-attachments", count);
      logAudit(`• Classic Attachments: ${count.toLocaleString()} records`);
    } catch (e) {
      updateCountChip("count-cat-attachments", "0");
    }
  } else {
    updateCountChip("count-cat-attachments", "—");
  }

  // 6. Old ContentVersion Snapshots
  if (document.getElementById("chk-cat-versionhist")?.checked) {
    try {
      const q = dateFilter.clause
        ? `SELECT count() FROM ContentVersion WHERE IsLatest = false AND ${dateFilter.clause}`
        : "SELECT count() FROM ContentVersion WHERE IsLatest = false";
      const res = await sfConn.query(q, false, { logErrors: false });
      const count = res.totalSize || 0;
      categoryCounts["ContentVersion"] = count;
      totalCount += count;
      estimatedMb += (count * 0.4);
      updateCountChip("count-cat-versionhist", count);
      logAudit(`• Old File Version Snapshots: ${count.toLocaleString()} records`);
    } catch (e) {
      updateCountChip("count-cat-versionhist", "0");
    }
  } else {
    updateCountChip("count-cat-versionhist", "—");
  }

  // Update Summary UI
  const totalEl = document.getElementById("total-records-to-delete");
  const estMbEl = document.getElementById("estimated-space-reclaim");
  if (totalEl) totalEl.textContent = `${totalCount.toLocaleString()} records`;
  if (estMbEl) estMbEl.textContent = `~${estimatedMb >= 1024 ? (estimatedMb / 1024).toFixed(1) + ' GB' : estimatedMb.toFixed(1) + ' MB'}`;

  if (btnCount) btnCount.disabled = false;
  if (btnStart) btnStart.disabled = totalCount === 0;

  logAudit(`[Analysis Complete] Total: ${totalCount.toLocaleString()} records eligible for safe deletion.`);
}

function updateCountChip(elId, count) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (typeof count === "number") {
    el.textContent = `${count.toLocaleString()} records`;
    el.style.background = count > 0 ? "rgba(220,38,38,0.1)" : "rgba(0,0,0,0.06)";
    el.style.color = count > 0 ? "#b91c1c" : "var(--text-muted)";
    el.style.fontWeight = count > 0 ? "700" : "400";
  } else {
    el.textContent = count;
  }
}

// ─── Open Safety Confirmation Modal ─────────────────────────────────
function openConfirmationModal() {
  const dateFilter = getDateFilterClause();
  const totalCount = Object.values(categoryCounts).reduce((a, b) => a + b, 0);

  if (totalCount === 0) {
    alert("No records found to delete for the selected criteria.");
    return;
  }

  const modal = document.getElementById("confirm-modal-overlay");
  const periodText = document.getElementById("modal-period-text");
  const recordsText = document.getElementById("modal-records-text");
  const breakdownText = document.getElementById("modal-breakdown-text");
  const chkUnderstand = document.getElementById("chk-modal-understand");
  const btnConfirm = document.getElementById("btn-modal-confirm");

  if (periodText) periodText.textContent = `${dateFilter.label} (${dateFilter.dateDesc})`;
  if (recordsText) recordsText.textContent = `${totalCount.toLocaleString()} records`;
  if (chkUnderstand) chkUnderstand.checked = false;
  if (btnConfirm) btnConfirm.disabled = true;

  if (breakdownText) {
    const lines = Object.entries(categoryCounts)
      .filter(([_, c]) => c > 0)
      .map(([cat, c]) => `${cat}: ${c.toLocaleString()} records`);
    breakdownText.innerHTML = lines.join("<br>");
  }

  if (modal) modal.style.display = "flex";
}

function closeConfirmationModal() {
  const modal = document.getElementById("confirm-modal-overlay");
  if (modal) modal.style.display = "none";
}

// ─── Safe Batched Deletion Engine ────────────────────────────────────
async function startBatchedCleanup() {
  closeConfirmationModal();

  const progressContainer = document.getElementById("clean-progress-container");
  const progressLabel = document.getElementById("clean-progress-label");
  const progressPct = document.getElementById("clean-progress-pct");
  const progressBar = document.getElementById("clean-progress-bar");
  const btnStart = document.getElementById("btn-start-clean");
  const btnCount = document.getElementById("btn-count-records");

  if (progressContainer) progressContainer.style.display = "block";
  if (btnStart) btnStart.disabled = true;
  if (btnCount) btnCount.disabled = true;

  isAborted = false;
  const dateFilter = getDateFilterClause();
  const totalTargetCount = Object.values(categoryCounts).reduce((a, b) => a + b, 0);
  let totalDeleted = 0;

  logAudit("==================================================");
  logAudit(`[CLEANUP STARTED] Target: ${totalTargetCount.toLocaleString()} records • Filter: ${dateFilter.label}`);
  logAudit("==================================================");

  // 1. Delete ApexLog
  if (categoryCounts["ApexLog"] > 0) {
    totalDeleted += await deleteCategoryRecords("ApexLog", dateFilter.clause, true, totalTargetCount, totalDeleted);
  }

  // 2. Delete Email Attachments
  if (!isAborted && categoryCounts["EmailAttachments"] > 0) {
    const emailAttachClause = dateFilter.clause
      ? `ParentId IN (SELECT Id FROM EmailMessage) AND ${dateFilter.clause}`
      : "ParentId IN (SELECT Id FROM EmailMessage)";
    totalDeleted += await deleteCategoryRecords("Attachment", emailAttachClause, false, totalTargetCount, totalDeleted);
  }

  // 3. Delete Custom Log Objects
  if (!isAborted) {
    for (const obj of detectedCustomLogs) {
      if (categoryCounts[obj.name] > 0) {
        totalDeleted += await deleteCategoryRecords(obj.name, dateFilter.clause, false, totalTargetCount, totalDeleted);
        if (isAborted) break;
      }
    }
  }

  // 4. Delete ContentDocument / Files
  if (!isAborted && categoryCounts["ContentDocument"] > 0) {
    totalDeleted += await deleteCategoryRecords("ContentDocument", dateFilter.clause, false, totalTargetCount, totalDeleted);
  }

  // 5. Delete Classic Attachments
  if (!isAborted && categoryCounts["ClassicAttachments"] > 0) {
    const classicClause = dateFilter.clause
      ? `(NOT ParentId IN (SELECT Id FROM EmailMessage)) AND ${dateFilter.clause}`
      : "(NOT ParentId IN (SELECT Id FROM EmailMessage))";
    totalDeleted += await deleteCategoryRecords("Attachment", classicClause, false, totalTargetCount, totalDeleted);
  }

  // 6. Delete Old ContentVersion Snapshots
  if (!isAborted && categoryCounts["ContentVersion"] > 0) {
    const cvClause = dateFilter.clause
      ? `IsLatest = false AND ${dateFilter.clause}`
      : "IsLatest = false";
    totalDeleted += await deleteCategoryRecords("ContentVersion", cvClause, false, totalTargetCount, totalDeleted);
  }

  // Finalize
  if (progressLabel) progressLabel.textContent = isAborted ? "Cleanup Aborted" : "Cleanup Complete!";
  if (progressPct) progressPct.textContent = "100%";
  if (progressBar) progressBar.style.width = "100%";

  logAudit("==================================================");
  logAudit(`[CLEANUP FINISHED] Successfully deleted ${totalDeleted.toLocaleString()} records!`);
  logAudit("==================================================");

  // Refresh live org limits to reflect newly freed space
  await loadStorageLimits();
  if (btnCount) btnCount.disabled = false;
  setTimeout(() => analyzeSelectedRecords(), 1500);
}

// ─── Chunked Category Deletion Helper (200 records per batch) ───────
async function deleteCategoryRecords(sobjectName, whereClause, isTooling, totalTargetCount, deletedPrior) {
  let categoryDeleted = 0;
  const progressLabel = document.getElementById("clean-progress-label");
  const progressPct = document.getElementById("clean-progress-pct");
  const progressBar = document.getElementById("clean-progress-bar");

  while (!isAborted) {
    const q = whereClause
      ? `SELECT Id FROM ${sobjectName} WHERE ${whereClause} LIMIT 200`
      : `SELECT Id FROM ${sobjectName} LIMIT 200`;

    let res = null;
    try {
      res = await sfConn.query(q, isTooling, { logErrors: false });
    } catch (e) {
      logAudit(`[Error Querying ${sobjectName}] ${e.message}`);
      break;
    }

    const records = res?.records || [];
    if (records.length === 0) break;

    const batchSize = records.length;
    if (progressLabel) progressLabel.textContent = `Deleting ${sobjectName} (${categoryDeleted + batchSize} records)...`;

    try {
      if (isTooling) {
        // Tooling Composite Delete
        const requests = records.map((r, i) => ({
          method: "DELETE",
          url: `/services/data/v${apiVersion}/tooling/sobjects/${sobjectName}/${r.Id}`,
          referenceId: `del_${i}`
        }));
        await sfConn.composite(requests);
      } else {
        // Standard Composite SObjects Delete
        const ids = records.map(r => r.Id).join(",");
        await sfConn.rest(`/services/data/v${apiVersion}/composite/sobjects?ids=${ids}&allOrNone=false`, {
          method: "DELETE"
        });
      }

      categoryDeleted += batchSize;
      const runningTotal = deletedPrior + categoryDeleted;
      const pct = totalTargetCount > 0 ? Math.min(100, Math.round((runningTotal / totalTargetCount) * 100)) : 100;

      if (progressPct) progressPct.textContent = `${pct}%`;
      if (progressBar) progressBar.style.width = `${pct}%`;

      logAudit(`• [${sobjectName}] Deleted batch of ${batchSize} records. (Total ${sobjectName}: ${categoryDeleted})`);
    } catch (err) {
      logAudit(`• [Error Deleting ${sobjectName}] ${err.message}`);
      break;
    }
  }

  return categoryDeleted;
}

// ─── Logger Helper ──────────────────────────────────────────────────
function logAudit(msg) {
  const el = document.getElementById("clean-audit-log");
  if (!el) return;
  const time = new Date().toLocaleTimeString();
  el.innerHTML += `<div><span style="color:var(--text-muted);">[${time}]</span> ${escapeHtml(msg)}</div>`;
  el.scrollTop = el.scrollHeight;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Setup Event Listeners ──────────────────────────────────────────
function setupEvents() {
  document.getElementById("btn-refresh-limits")?.addEventListener("click", () => {
    loadStorageLimits();
    logAudit("[Limits Refreshed] Storage quotas updated.");
  });

  document.getElementById("btn-analyze-all")?.addEventListener("click", () => analyzeSelectedRecords());
  document.getElementById("btn-count-records")?.addEventListener("click", () => analyzeSelectedRecords());

  // Quick Clean High Impact button on banner
  document.getElementById("btn-banner-quick-clean")?.addEventListener("click", () => {
    // Select 7 days, ApexLog, Email attachments, and open confirmation
    const r7 = document.querySelector('input[name="clean-time-period"][value="7"]');
    if (r7) r7.checked = true;
    updateFilterPreview();
    analyzeSelectedRecords().then(() => openConfirmationModal());
  });

  // Time Period Radio Change
  document.querySelectorAll('input[name="clean-time-period"]').forEach(r => {
    r.addEventListener("change", () => updateFilterPreview());
  });

  document.getElementById("clean-calendar-input")?.addEventListener("change", () => {
    const radio = document.querySelector('input[name="clean-time-period"][value="custom_date"]');
    if (radio) radio.checked = true;
    updateFilterPreview();
  });

  document.getElementById("clean-custom-days-input")?.addEventListener("input", () => {
    const radio = document.querySelector('input[name="clean-time-period"][value="custom_days"]');
    if (radio) radio.checked = true;
    updateFilterPreview();
  });

  // Confirmation Modal
  document.getElementById("btn-start-clean")?.addEventListener("click", () => openConfirmationModal());
  document.getElementById("btn-modal-cancel")?.addEventListener("click", () => closeConfirmationModal());
  
  document.getElementById("chk-modal-understand")?.addEventListener("change", (e) => {
    const btn = document.getElementById("btn-modal-confirm");
    if (btn) btn.disabled = !e.target.checked;
  });

  document.getElementById("btn-modal-confirm")?.addEventListener("click", () => startBatchedCleanup());

  document.getElementById("btn-cancel-clean")?.addEventListener("click", () => {
    isAborted = true;
    logAudit("[User Abort] Cleanup cancellation requested.");
  });
}

function updateFilterPreview() {
  const f = getDateFilterClause();
  const el = document.getElementById("cutoff-date-preview");
  if (el) {
    el.innerHTML = `Active Filter: <strong>${f.clause || "ALL RECORDS (No Date Filter)"}</strong> • <em>${f.dateDesc}</em>`;
  }
}

// Boot
init();

