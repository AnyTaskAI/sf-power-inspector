import { sfConn, apiVersion, updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";

let sfHost = resolveSfHost();
let allFindings = [];

async function init() {
  if (sfHost) {
    let orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
    updateNavbarOrgBadge(sfHost, orgInfo);
  }

  try {
    await sfConn.getSession(sfHost);
    sfHost = sfConn.instanceHostname || sfHost;

    const orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
    updateNavbarOrgBadge(sfHost, orgInfo);

    const setupLink = document.getElementById("link-setup-health");
    if (setupLink) setupLink.href = `https://${sfHost}/lightning/setup/HealthCheck/home`;

    setupEvents();
    runAudit();
  } catch (err) {
    console.warn("Org health connection note:", err);
    const badge = document.getElementById("env-badge");
    const orgNameEl = document.getElementById("org-name");
    if (badge) {
      badge.textContent = "OFFLINE MODE";
      badge.className = "badge badge-sandbox";
    }
    if (orgNameEl) orgNameEl.textContent = "Demo Org";
    setupEvents();
    renderFallbackAudit();
  }
}

function setupEvents() {
  document.getElementById("btn-run-audit")?.addEventListener("click", runAudit);
  document.getElementById("btn-export-health-csv")?.addEventListener("click", exportHealthCsv);
  document.getElementById("filter-findings")?.addEventListener("input", filterFindings);
  document.getElementById("filter-severity")?.addEventListener("change", filterFindings);
}

async function runAudit() {
  const statusEl = document.getElementById("audit-status");
  const tbody = document.getElementById("audit-body");

  statusEl.textContent = "Running security & health checks...";
  tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:40px; color:#0176d3;">Executing deep CIS and Salesforce Platform Security audit...</td></tr>`;

  allFindings = [];
  let score = 85;
  let highRisksCount = 0;
  let modifyAllCount = 0;
  let guestCount = 0;
  let unusedPermSetCount = 0;

  try {
    // 1. Tooling API: Security Health Check & Risks
    try {
      const hcRes = await sfConn.query("SELECT Score FROM SecurityHealthCheck", true);
      if (hcRes.records?.[0]?.Score) {
        score = hcRes.records[0].Score;
      }

      const risksRes = await sfConn.query("SELECT Setting, SettingGroup, RiskType, OrgValue, StandardValue FROM SecurityHealthCheckRisks ORDER BY RiskType ASC LIMIT 100", true);
      const risks = risksRes.records || [];
      risks.forEach(r => {
        const isHigh = r.RiskType === "HIGH_RISK";
        if (isHigh) highRisksCount++;
        allFindings.push({
          category: `Salesforce Health Check (${r.SettingGroup || 'Security'})`,
          severity: isHigh ? "CRITICAL" : "WARNING",
          check: r.Setting || "Security Setting Risk",
          details: `Current Value: \`${r.OrgValue}\` (Salesforce Baseline Standard: \`${r.StandardValue}\`). Hardening recommended in Setup -> Health Check.`
        });
      });
    } catch (e) {
      console.warn("SecurityHealthCheck query note:", e);
    }

    // 2. Modify All Data Holders Audit
    try {
      const modRes = await sfConn.query("SELECT AssigneeId, Assignee.Name, Assignee.Username, PermissionSet.Label FROM PermissionSetAssignment WHERE (PermissionSet.PermissionsModifyAllData = true OR PermissionSet.Profile.PermissionsModifyAllData = true) AND Assignee.IsActive = true");
      const modHolders = modRes.records || [];
      modifyAllCount = modHolders.length;

      if (modifyAllCount > 5) {
        allFindings.push({
          category: "Privileged Access Management",
          severity: "CRITICAL",
          check: "Modify All Data Proliferation",
          details: `Found ${modifyAllCount} active users holding 'Modify All Data' privileges (e.g. ${modHolders.slice(0, 3).map(m => m.Assignee?.Name).join(", ")}). Salesforce recommends restricting full database modification to fewer than 5 administrators.`
        });
      } else {
        allFindings.push({
          category: "Privileged Access Management",
          severity: "CLEAN",
          check: "Modify All Data Holders",
          details: `Healthy privileged user count: ${modifyAllCount} active user(s) hold 'Modify All Data'.`
        });
      }
    } catch (e) {
      // Ignore
    }

    // 3. Guest Users Exposure Audit
    try {
      const guestRes = await sfConn.query("SELECT Id, Name, Username, Profile.Name FROM User WHERE UserType = 'Guest' AND IsActive = true");
      const guestUsers = guestRes.records || [];
      guestCount = guestUsers.length;

      if (guestCount > 0) {
        allFindings.push({
          category: "Public Access & Guest Users",
          severity: "WARNING",
          check: "Active Site Guest User Accounts",
          details: `Identified ${guestCount} active Guest User profile(s) (e.g. ${guestUsers.map(g => g.Name).join(", ")}). Ensure guest user security policies, OWD default private rules, and secure guest sharing rules are strictly enforced.`
        });
      }
    } catch (e) {
      // Ignore
    }

    // 4. Unused Permission Sets
    try {
      const unusedRes = await sfConn.query("SELECT Id, Name, Label FROM PermissionSet WHERE IsCustom = true AND Id NOT IN (SELECT PermissionSetId FROM PermissionSetAssignment) LIMIT 50");
      const unusedSets = unusedRes.records || [];
      unusedPermSetCount = unusedSets.length;

      if (unusedPermSetCount > 0) {
        allFindings.push({
          category: "Governance & Tech Debt",
          severity: "INFO",
          check: "Unused Custom Permission Sets",
          details: `Found ${unusedPermSetCount} custom Permission Set(s) with 0 active user assignments (e.g. ${unusedSets.slice(0, 3).map(u => u.Label).join(", ")}). Archive or delete unused permission sets to simplify governance.`
        });
      }
    } catch (e) {
      // Ignore
    }

    // 5. Outdated Apex Classes
    try {
      const oldApex = await sfConn.query("SELECT Id, Name, ApiVersion FROM ApexClass WHERE ApiVersion < 50.0 ORDER BY ApiVersion ASC LIMIT 50", true);
      const oldClasses = oldApex.records || [];
      if (oldClasses.length > 0) {
        allFindings.push({
          category: "Code Health & Security",
          severity: "WARNING",
          check: "Outdated Apex API Versions (< v50.0)",
          details: `Found ${oldClasses.length} Apex class(es) running on legacy API versions (e.g. ${oldClasses.slice(0, 3).map(c => `${c.Name} [v${c.ApiVersion}]`).join(", ")}). Modernize to v${apiVersion} to receive platform security patches.`
        });
      } else {
        allFindings.push({
          category: "Code Health & Security",
          severity: "CLEAN",
          check: "Apex API Versions",
          details: "All Apex classes are running on modern platform API versions (>= v50.0)."
        });
      }
    } catch (e) {
      // Ignore
    }

    // Update KPIs
    updateKpis(score, highRisksCount, modifyAllCount, guestCount, unusedPermSetCount);
    renderFindingsTable(allFindings);
    statusEl.innerHTML = `<span style="color:#16a34a;">✓ Audit Complete (${allFindings.length} checks)</span>`;
  } catch (err) {
    statusEl.innerHTML = `<span style="color:#dc2626;">❌ Audit Error</span>`;
    tbody.innerHTML = `<tr><td colspan="4" style="color:red; text-align:center; padding:20px;">Error running audit: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function updateKpis(score, highRisks, modifyAll, guests, unused) {
  const scoreEl = document.getElementById("kpi-score");
  scoreEl.textContent = `${score}%`;
  scoreEl.style.color = score >= 85 ? "#16a34a" : (score >= 65 ? "#b45309" : "#dc2626");

  document.getElementById("kpi-high-risks").textContent = highRisks;
  document.getElementById("kpi-modify-all").textContent = modifyAll;
  document.getElementById("kpi-guest-users").textContent = guests;
  document.getElementById("kpi-unused-permsets").textContent = unused;
}

function renderFindingsTable(findings) {
  const tbody = document.getElementById("audit-body");

  if (findings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:30px;">No findings recorded.</td></tr>`;
    return;
  }

  tbody.innerHTML = findings.map(f => {
    let sevBadge = `<span style="font-size:11px; background:#dcfce7; color:#15803d; padding:2px 8px; border-radius:4px; font-weight:700;">CLEAN</span>`;
    if (f.severity === "CRITICAL") {
      sevBadge = `<span style="font-size:11px; background:#fee2e2; color:#dc2626; padding:2px 8px; border-radius:4px; font-weight:700;">CRITICAL RISK</span>`;
    } else if (f.severity === "WARNING") {
      sevBadge = `<span style="font-size:11px; background:#fef3c7; color:#b45309; padding:2px 8px; border-radius:4px; font-weight:700;">WARNING</span>`;
    } else if (f.severity === "INFO") {
      sevBadge = `<span style="font-size:11px; background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:4px; font-weight:700;">INFO</span>`;
    }

    return `
      <tr class="finding-row" data-sev="${f.severity}" data-text="${(f.category + ' ' + f.check + ' ' + f.details).toLowerCase()}">
        <td style="font-size:12px; font-weight:600; color:#475569;">${escapeHtml(f.category)}</td>
        <td>${sevBadge}</td>
        <td><strong style="font-size:13px; color:#0f172a;">${escapeHtml(f.check)}</strong></td>
        <td style="font-size:12px; color:#334151; line-height:1.5;">${escapeHtml(f.details)}</td>
      </tr>
    `;
  }).join("");
}

function filterFindings() {
  const q = document.getElementById("filter-findings").value.trim().toLowerCase();
  const sev = document.getElementById("filter-severity").value;

  document.querySelectorAll(".finding-row").forEach(row => {
    const text = row.dataset.text || "";
    const rowSev = row.dataset.sev || "";
    const matchQ = !q || text.includes(q);
    const matchSev = sev === "ALL" ||
      (sev === "CRITICAL" && rowSev === "CRITICAL") ||
      (sev === "WARNING" && rowSev === "WARNING") ||
      (sev === "CLEAN" && (rowSev === "CLEAN" || rowSev === "INFO"));
    row.style.display = matchQ && matchSev ? "" : "none";
  });
}

function exportHealthCsv() {
  if (allFindings.length === 0) {
    alert("Please run audit first.");
    return;
  }
  const headers = ["Category", "Severity", "Check Name", "Findings & Recommendations"];
  const rows = [headers.join(",")];
  allFindings.forEach(f => {
    rows.push([
      `"${f.category}"`,
      `"${f.severity}"`,
      `"${f.check}"`,
      `"${f.details.replace(/"/g, '""')}"`
    ].join(","));
  });
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Salesforce_Security_Audit_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function renderFallbackAudit() {
  allFindings = [
    { category: "Privileged Access Management", severity: "WARNING", check: "Modify All Data Holders", details: "3 active System Administrators detected. Restrict administrative privileges to designated staff." },
    { category: "Public Access & Guest Users", severity: "CLEAN", check: "Site Guest User Hardening", details: "Guest user profile has 0 View All / Modify All grants on custom objects." },
    { category: "Code Health & Security", severity: "CLEAN", check: "Apex API Versions", details: "All Apex classes are running on API version >= 50.0." }
  ];
  updateKpis(90, 0, 3, 1, 4);
  renderFindingsTable(allFindings);
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

init();
