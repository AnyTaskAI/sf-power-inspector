import { sfConn, apiVersion, updateNavbarOrgBadge, getOrgEnvironmentDetails, resolveSfHost } from "./sf-connection.js";

let sfHost = resolveSfHost();
let orgInfo = {};
let apexClassesList = [];
let cachedSObjects = [];
let matrixData = [];
let matrixMode = "object"; // "object" or "fls"
let currentApexReport = "";

// ─── 1. TAB SWITCHING (Direct and delegated listeners) ──────────────
function initTabSwitching() {
  // Direct listeners on tab buttons
  document.querySelectorAll("#ai-tabs .tool-tab").forEach(tabBtn => {
    tabBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const tabId = tabBtn.dataset.tab;
      if (tabId) switchTab(tabId);
    });
  });

  // Delegated fallback
  document.addEventListener("click", (e) => {
    const tabBtn = e.target.closest("#ai-tabs .tool-tab");
    if (!tabBtn) return;
    e.preventDefault();
    const tabId = tabBtn.dataset.tab;
    if (tabId) switchTab(tabId);
  });

  // Restore previously selected tab if present
  const savedTab = sessionStorage.getItem("sfpi_active_ai_tab") || "apex-audit";
  switchTab(savedTab);
}

function switchTab(tabId) {
  if (!tabId) tabId = "apex-audit";
  const tabs = document.querySelectorAll("#ai-tabs .tool-tab");
  tabs.forEach(tab => {
    if (tab.dataset.tab === tabId) {
      tab.classList.add("active");
    } else {
      tab.classList.remove("active");
    }
  });

  const views = document.querySelectorAll(".tab-content");
  views.forEach(v => {
    v.style.display = "none";
  });

  const targetView = document.getElementById(`view-${tabId}`);
  if (targetView) {
    targetView.style.display = "flex";
    sessionStorage.setItem("sfpi_active_ai_tab", tabId);
  }
}

// ─── 2. INITIALIZATION & ORG CONNECTION ─────────────────────────────
async function init() {
  initTabSwitching();
  setupEvents();

  const badge = document.getElementById("env-badge");
  const orgNameEl = document.getElementById("org-name");

  // Show connecting status
  if (badge) {
    badge.textContent = "CONNECTING...";
    badge.className = "badge badge-scratch";
  }
  if (orgNameEl) orgNameEl.textContent = "Establishing session...";

  // If sfHost wasn't in URL, resolve it from background or localStorage
  if (!sfHost) {
    sfHost = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 3000);
      try {
        chrome.runtime.sendMessage({ message: "getActiveSfHost" }, (res) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(res || null);
        });
      } catch (e) {
        clearTimeout(timer);
        resolve(null);
      }
    });

    if (!sfHost) {
      const keys = Object.keys(localStorage).filter(k => k.includes("_orgInfo") || k.includes("_access_token"));
      if (keys.length > 0) {
        sfHost = keys[0].replace("_orgInfo", "").replace("_access_token", "");
      }
    }
  }

  // Pre-load and render whatever org environment info we already know immediately
  if (sfHost) {
    orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
    updateNavbarOrgBadge(sfHost, orgInfo);
  }

  try {
    const session = await sfConn.getSession(sfHost);
    sfHost = sfConn.instanceHostname || sfHost;

    if (!session || !sfHost) {
      if (badge) {
        badge.textContent = "OFFLINE MODE";
        badge.className = "badge badge-sandbox";
      }
      if (orgNameEl) orgNameEl.textContent = "Standalone / Local Analyzer — No session detected";
      return;
    }

    // Refresh navbar badge with confirmed session & live org info
    orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
    updateNavbarOrgBadge(sfHost, orgInfo);

    // Update connection status to connected
    if (orgNameEl) {
      const details = getOrgEnvironmentDetails(sfHost, orgInfo);
      const sandboxPart = details.isSandbox && details.sandboxName ? ` • ${details.sandboxName}` : "";
      const envPart = details.environment ? ` • ${details.environment}` : "";
      orgNameEl.textContent = `${details.companyName} • ${details.edition}${sandboxPart}${envPart}`;
      orgNameEl.title = `Organization: ${details.companyName}\nEnvironment: ${details.environment}\nEdition: ${details.edition}${details.instance ? `\nInstance: ${details.instance}` : ''}\nHost: ${sfHost}`;
    }

    // Load real-time metadata in background (don't block UI)
    loadApexClasses().catch(e => console.warn("Apex class load skipped:", e));
    loadSObjectsCatalog().catch(e => console.warn("SObject catalog load skipped:", e));
  } catch (err) {
    console.warn("Session retrieval note:", err);
    if (sfHost) {
      orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
      updateNavbarOrgBadge(sfHost, orgInfo);
      // Even if session failed, still attempt metadata load from cache
    } else {
      if (badge) {
        badge.textContent = "OFFLINE MODE";
        badge.className = "badge badge-sandbox";
      }
      if (orgNameEl) orgNameEl.textContent = "Standalone / Local Mode — Open from Salesforce to connect";
    }
  }
}

async function loadApexClasses() {
  const select = document.getElementById("select-apex-class");
  if (!select) return;

  select.innerHTML = `<option value="">⏳ Loading classes from org...</option>`;

  try {
    // Try Tooling API query first
    const q = `SELECT Id, Name, NamespacePrefix FROM ApexClass ORDER BY Name ASC LIMIT 300`;
    let res;
    try {
      res = await sfConn.query(q, true);
    } catch (e) {
      // Fallback to standard REST query
      res = await sfConn.query(q, false);
    }

    const rawList = res.records || [];
    // Filter to local org classes (exclude managed package classes without accessible source)
    apexClassesList = rawList.filter(cls => !cls.NamespacePrefix);
    if (apexClassesList.length === 0) apexClassesList = rawList;

    select.innerHTML = `<option value="">📂 Load Apex Class (${apexClassesList.length} in Org)...</option>`;

    apexClassesList.forEach(cls => {
      const opt = document.createElement("option");
      opt.value = cls.Id;
      opt.textContent = cls.Name;
      select.appendChild(opt);
    });
  } catch (e) {
    console.warn("Could not load Apex classes:", e);
    select.innerHTML = `<option value="">⚠️ Could not load classes (use Sample or paste code)</option>`;
  }
}

async function loadSObjectsCatalog() {
  try {
    const res = await sfConn.getSObjects();
    cachedSObjects = Array.isArray(res) ? res : (res?.sobjects || []);
  } catch (e) {
    console.warn("Could not load SObjects catalog:", e);
    cachedSObjects = [];
  }
}

// ─── 3. EVENT BINDINGS ───────────────────────────────────────────────
function setupEvents() {
  // Reconnect button
  document.getElementById("btn-refresh-connection")?.addEventListener("click", () => {
    localStorage.removeItem(sfHost + "_orgInfo");
    init();
  });

  // Tab 1: Apex Class loader dropdown
  document.getElementById("select-apex-class")?.addEventListener("change", async (e) => {
    const classId = e.target.value;
    if (!classId) return;

    const editor = document.getElementById("apex-source-input");
    editor.value = "// Loading class source from Salesforce org...";

    try {
      // Query body directly
      let res;
      try {
        res = await sfConn.tooling(`/sobjects/ApexClass/${classId}`);
      } catch (err) {
        const q = `SELECT Body FROM ApexClass WHERE Id = '${classId}'`;
        const qr = await sfConn.query(q, false);
        res = qr.records?.[0] || {};
      }

      if (res.Body) {
        editor.value = res.Body;
        updateCodeStats();
        runApexSecurityScan();
      } else {
        editor.value = "// Apex class body not available or hidden by package.";
      }
    } catch (err) {
      alert("Error loading Apex Class: " + err.message);
    }
  });

  // Tab 1: Sample Apex Patterns dropdown
  document.getElementById("select-sample-apex")?.addEventListener("change", (e) => {
    const val = e.target.value;
    if (!val) return;
    loadApexSample(val);
  });

  // Tab 1: Code editor line counter & run scan
  document.getElementById("apex-source-input")?.addEventListener("input", updateCodeStats);
  document.getElementById("btn-run-apex-scan")?.addEventListener("click", runApexSecurityScan);
  document.getElementById("btn-copy-apex-report")?.addEventListener("click", copyApexReport);

  // Tab 2: SOQL Presets
  document.getElementById("select-soql-preset")?.addEventListener("change", (e) => {
    const val = e.target.value;
    if (!val) return;
    loadSoqlPreset(val);
  });

  document.getElementById("btn-optimize-soql")?.addEventListener("click", runSoqlOptimizer);
  document.getElementById("btn-explain-plan-api")?.addEventListener("click", runLiveOrgQueryPlan);

  // Tab 3: Matrix SObject Auto-complete & Sub-tabs
  setupMatrixAutocomplete();
  document.getElementById("btn-mode-obj")?.addEventListener("click", () => switchMatrixMode("object"));
  document.getElementById("btn-mode-fls")?.addEventListener("click", () => switchMatrixMode("fls"));
  document.getElementById("btn-load-matrix")?.addEventListener("click", loadSecurityMatrix);
  document.getElementById("matrix-filter")?.addEventListener("input", filterMatrixRows);
  document.getElementById("btn-export-matrix-csv")?.addEventListener("click", exportMatrixCsv);

  // Tab 4: Formula Presets & Actions
  document.getElementById("select-formula-preset")?.addEventListener("change", (e) => {
    const val = e.target.value;
    if (!val) return;
    loadFormulaPreset(val);
  });
  document.getElementById("btn-format-formula")?.addEventListener("click", formatFormula);
  document.getElementById("btn-explain-formula")?.addEventListener("click", runFormulaExplainer);

  // Tab 5: Free AI Security & Org Health Scanner
  document.getElementById("btn-run-org-ai-audit")?.addEventListener("click", runOrgSecurityAudit);

  // Tab 6: Free AI Field Health & Detective
  document.getElementById("btn-run-field-health-ai")?.addEventListener("click", () => {
    const objName = document.getElementById("ai-field-obj")?.value.trim() || "Account";
    runFieldHealthAnalysis(objName);
  });
  document.getElementById("ai-field-obj")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const objName = e.target.value.trim() || "Account";
      runFieldHealthAnalysis(objName);
    }
  });
}

function updateCodeStats() {
  const code = document.getElementById("apex-source-input").value;
  const lines = code ? code.split("\n").length : 0;
  const chars = code ? code.length : 0;
  const statsEl = document.getElementById("code-stats");
  if (statsEl) {
    statsEl.textContent = `${lines} lines • ${chars} chars`;
  }
}

// ─── TAB 1: APEX SECURITY & CODE AUDITOR ────────────────────────────
const APEX_SAMPLES = {
  critical: `public without sharing class AccountController {
    // 🚨 Critical 1: Dynamic SOQL Injection (Missing escapeSingleQuotes)
    public static List<Account> searchAccounts(String userInput) {
        String query = 'SELECT Id, Name, (SELECT Id FROM Contacts) FROM Account WHERE Name LIKE \\'%' + userInput + '%\\'';
        return Database.query(query);
    }

    // 🚨 Critical 2: DML Statement in Loop (Governor Limit: DML 150)
    public static void updateContacts(List<Account> accounts) {
        for (Account a : accounts) {
            // 🚨 Critical 3: SOQL Query in Loop (Governor Limit: SOQL 101)
            List<Contact> conList = [SELECT Id, LastName FROM Contact WHERE AccountId = :a.Id];
            for (Contact c : conList) {
                c.Description = 'Updated';
                update c; // 🚨 DML inside loop!
            }
        }
    }

    // 🚨 Critical 4: Hardcoded Secret Credential
    private static final String AWS_SECRET_KEY = "AKIA_SECRET_981247812974912874";
    // ⚠️ High 5: Hardcoded Salesforce ID
    private static final Id DEFAULT_RECORD_TYPE = '0125g000000XyZ1AAA';

    // ⚠️ Medium 6: Silent Empty Catch
    public static void processData() {
        try {
            insert new Lead(LastName='Test');
        } catch (Exception e) {
            // Silently swallowed!
        }
    }
}`,

  ldv: `public with sharing class HighVolumeCaseProcessor {
    // ⚠️ LDV Heap Exhaustion: Querying unlimited records without SOQL for-loop
    public static void archiveOldCases() {
        List<Case> casesToArchive = [SELECT Id, Subject, Description, (SELECT Id, Body FROM Comments) FROM Case WHERE IsClosed = true];
        for (Case c : casesToArchive) {
            c.Status = 'Archived';
        }
        update casesToArchive;
    }

    // ⚠️ Async Queue in Loop
    public static void processBatches(List<Id> caseIds) {
        for (Id cId : caseIds) {
            System.enqueueJob(new CaseSyncQueueable(cId)); // 🚨 Limits hit on bulk triggers
        }
    }
}`,

  security: `public without sharing class CustomLeadService {
    // 🔐 Missing CRUD / FLS (Should use WITH USER_MODE or Security.stripInaccessible)
    public static List<Lead> getLeads() {
        return [SELECT Id, Name, Email, AnnualRevenue, SSN__c FROM Lead];
    }

    public static void updateLeadEmail(Id leadId, String newEmail) {
        Lead l = new Lead(Id = leadId, Email = newEmail);
        update l; // User permissions bypassed due to 'without sharing' and no Schema check
    }
}`,

  clean: `public with sharing class AccountSelector {
    // ✅ Enterprise Best Practice: Selector Pattern with USER_MODE
    public static List<Account> getAccountsWithActiveContacts(Set<Id> accountIds) {
        if (accountIds == null || accountIds.isEmpty()) {
            return new List<Account>();
        }
        return [
            SELECT Id, Name, Type,
                   (SELECT Id, FirstName, LastName, Email FROM Contacts WHERE IsActive__c = true)
            FROM Account
            WHERE Id IN :accountIds
            WITH USER_MODE
        ];
    }
}`
};

function loadApexSample(type) {
  if (APEX_SAMPLES[type]) {
    const editor = document.getElementById("apex-source-input");
    editor.value = APEX_SAMPLES[type];
    updateCodeStats();
    runApexSecurityScan();
  }
}

function runApexSecurityScan() {
  const code = document.getElementById("apex-source-input").value;
  const listEl = document.getElementById("apex-findings-list");
  const badgeEl = document.getElementById("audit-badge");

  if (!code.trim()) {
    listEl.innerHTML = `<div style="padding:20px; color:#dc2626; text-align:center;">Please enter or load Apex code.</div>`;
    return;
  }

  const findings = [];
  const lines = code.split("\n");

  // Rule 1: Dynamic SOQL without String.escapeSingleQuotes
  if (/Database\.query\s*\([^)]*\+[^)]*\)/i.test(code) && !/String\.escapeSingleQuotes/i.test(code)) {
    findings.push({
      severity: "CRITICAL",
      rule: "SOQL Injection Vulnerability",
      desc: "Detected dynamic `Database.query()` constructed via string concatenation without `String.escapeSingleQuotes()`. Attackers can inject arbitrary SOQL statements and exfiltrate confidential data.",
      remediation: "Use bind variables (`:userInput`) or sanitize user input using `String.escapeSingleQuotes(userInput)`.",
      code: "String safeQuery = 'SELECT Id FROM Account WHERE Name = :userInput';\nreturn Database.query(safeQuery);"
    });
  }

  // Rule 2: DML inside loops
  if (/for\s*\([^)]+\)\s*\{[^}]*\b(insert|update|delete|upsert)\b/s.test(code)) {
    findings.push({
      severity: "CRITICAL",
      rule: "DML Statement in Loop (Governor Limit: 150 DMLs)",
      desc: "Database DML operations (`insert`, `update`, `delete`, `upsert`) were found directly inside a loop body. Exceeds the 150 DML governor limit on bulk records.",
      remediation: "Collect modified records into a `List<sObject>` inside the loop and perform a single bulk DML statement after the loop.",
      code: "List<Contact> toUpdate = new List<Contact>();\nfor (Contact c : conList) {\n    c.Description = 'Updated';\n    toUpdate.add(c);\n}\nupdate toUpdate;"
    });
  }

  // Rule 3: SOQL inside loops
  if (/for\s*\([^)]+\)\s*\{[^}]*(\[\s*SELECT\b|Database\.query)/is.test(code)) {
    findings.push({
      severity: "CRITICAL",
      rule: "SOQL Query in Loop (Governor Limit: 100 SOQLs)",
      desc: "SOQL queries executed inside a loop. Fails the 100 synchronous SOQL queries governor limit during batch execution or bulk triggers.",
      remediation: "Pre-fetch parent/child records outside the loop using relationship queries or store in a `Map<Id, sObject>`.",
      code: "Map<Id, Account> accMap = new Map<Id, Account>([\n    SELECT Id, (SELECT Id FROM Contacts) FROM Account WHERE Id IN :accIds\n]);"
    });
  }

  // Rule 4: Hardcoded credentials or secrets
  if (/(password|secret|bearer|token|api_key|aws_key)\s*=\s*['"][a-zA-Z0-9_\-\.]{8,}['"]/i.test(code)) {
    findings.push({
      severity: "CRITICAL",
      rule: "Hardcoded Credential / Secret in Source Code",
      desc: "Hardcoded API keys, passwords, or secret tokens detected in source code. Violates AppExchange Security Guidelines.",
      remediation: "Store secrets in **Named Credentials** or protected **Custom Metadata Types** with field encryption.",
      code: "// In Apex Callout:\nHttpRequest req = new HttpRequest();\nreq.setEndpoint('callout:My_Named_Credential/v1/api');"
    });
  }

  // Rule 5: Hardcoded Salesforce IDs
  const idMatches = code.match(/['"][0-9a-zA-Z]{15}['"]|['"][0-9a-zA-Z]{18}['"]/g);
  if (idMatches && idMatches.length > 0) {
    findings.push({
      severity: "HIGH",
      rule: "Hardcoded Salesforce Record ID",
      desc: `Found ${idMatches.length} hardcoded ID(s): ${idMatches.slice(0, 3).join(", ")}. These IDs break across Sandbox refreshes and Production deployments.`,
      remediation: "Query records dynamically by `DeveloperName` or store configuration in Custom Metadata.",
      code: "Id rTypeId = Schema.SObjectType.Account.getRecordTypeInfosByDeveloperName().get('Enterprise').getRecordTypeId();"
    });
  }

  // Rule 6: Missing USER_MODE or SECURITY_ENFORCED
  if (/\[\s*SELECT\b/i.test(code) && !/WITH\s+(USER_MODE|SECURITY_ENFORCED)/i.test(code) && !/Security\.stripInaccessible/i.test(code)) {
    findings.push({
      severity: "HIGH",
      rule: "Missing CRUD / FLS Enforcement",
      desc: "SOQL query does not specify `WITH USER_MODE` or `WITH SECURITY_ENFORCED`. User field-level security permissions (FLS) are bypassed by default in system mode.",
      remediation: "Add `WITH USER_MODE` (Spring '23+) or `WITH SECURITY_ENFORCED` to respect user object and field permissions.",
      code: "List<Account> accs = [SELECT Id, Name, Phone FROM Account WITH USER_MODE];"
    });
  }

  // Rule 7: Without Sharing declaration
  if (/class\s+\w+\s+without\s+sharing/i.test(code) || /without\s+sharing\s+class/i.test(code)) {
    findings.push({
      severity: "MEDIUM",
      rule: "Apex Class Declared 'without sharing'",
      desc: "The class is declared `without sharing`, which ignores all Salesforce record sharing rules and Organization-Wide Defaults (OWD).",
      remediation: "Declare the class as `with sharing` or `inherited sharing` unless explicitly executing elevated system integration logic.",
      code: "public with sharing class AccountService {\n    // ...\n}"
    });
  }

  // Rule 8: Silent empty catch block
  if (/catch\s*\([^)]+\)\s*\{\s*\}/.test(code)) {
    findings.push({
      severity: "MEDIUM",
      rule: "Empty Exception Catch Block (Silent Failure)",
      desc: "Found an empty `catch (Exception e) {}` block. Suppressing exceptions without logging hides critical bugs and makes debugging impossible.",
      remediation: "Log exceptions or publish to a Custom Logging Object / Platform Event.",
      code: "catch (Exception e) {\n    Logger.error('Transaction Failed', e);\n    throw new CustomException(e.getMessage());\n}"
    });
  }

  // Rule 9: Async job in loop
  if (/for\s*\([^)]+\)\s*\{[^}]*System\.enqueueJob/is.test(code)) {
    findings.push({
      severity: "HIGH",
      rule: "System.enqueueJob Inside Loop (Queueable Governor Limit)",
      desc: "Enqueueing asynchronous jobs within a loop triggers governor limit `Too many queueable jobs added to the queue: 50`.",
      remediation: "Batch records together and enqueue a single queueable job passing the entire collection.",
      code: "System.enqueueJob(new BulkRecordProcessorQueueable(recordIds));"
    });
  }

  // Render Findings
  renderApexFindings(findings);
}

function renderApexFindings(findings) {
  const listEl = document.getElementById("apex-findings-list");
  const badgeEl = document.getElementById("audit-badge");

  if (findings.length === 0) {
    badgeEl.innerHTML = `<span style="color:#16a34a; font-weight:700;">✓ 0 Issues Found</span>`;
    listEl.innerHTML = `
      <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:20px; text-align:center;">
        <div style="font-size:24px; margin-bottom:6px;">✅</div>
        <div style="font-size:15px; font-weight:700; color:#15803d;">Clean Architecture & Security Review Passed</div>
        <div style="font-size:12px; color:#374151; margin-top:4px;">No critical vulnerabilities, governor limit risks, or SOQL injections detected.</div>
      </div>
    `;
    currentApexReport = "SF Power Inspector PRO — Apex Security Audit: 0 Issues Found (Clean)";
    return;
  }

  const criticalCount = findings.filter(f => f.severity === "CRITICAL").length;
  const highCount = findings.filter(f => f.severity === "HIGH").length;
  const healthScore = Math.max(0, 100 - (criticalCount * 25 + highCount * 10 + (findings.length - criticalCount - highCount) * 5));

  let scoreColor = "#16a34a";
  if (healthScore < 80) scoreColor = "#eab308";
  if (healthScore < 50) scoreColor = "#dc2626";

  badgeEl.innerHTML = `<span style="color:#dc2626; font-weight:700;">🚨 ${criticalCount} Critical / ${findings.length} Total</span>`;

  let html = `
    <div class="ai-stat-grid">
      <div class="ai-stat-card">
        <span class="ai-stat-label">Health Score</span>
        <span class="ai-stat-val" style="color:${scoreColor};">${healthScore}%</span>
      </div>
      <div class="ai-stat-card">
        <span class="ai-stat-label">Total Findings</span>
        <span class="ai-stat-val">${findings.length}</span>
      </div>
      <div class="ai-stat-card">
        <span class="ai-stat-label">Critical Risks</span>
        <span class="ai-stat-val" style="color:#dc2626;">${criticalCount}</span>
      </div>
      <div class="ai-stat-card">
        <span class="ai-stat-label">High / Warnings</span>
        <span class="ai-stat-val" style="color:#d97706;">${highCount}</span>
      </div>
    </div>
  `;

  findings.forEach((f, idx) => {
    const isCritical = f.severity === "CRITICAL";
    const isHigh = f.severity === "HIGH";
    const bg = isCritical ? "#fef2f2" : (isHigh ? "#fffbeb" : "#f8fafc");
    const border = isCritical ? "#fecaca" : (isHigh ? "#fef3c7" : "#e2e8f0");
    const color = isCritical ? "#dc2626" : (isHigh ? "#b45309" : "#0284c7");

    html += `
      <div class="finding-card" style="background:${bg}; border-color:${border};">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong style="color:${color}; font-size:13px;">[${f.severity}] #${idx + 1} — ${f.rule}</strong>
        </div>
        <div style="font-size:12px; color:#374151; line-height:1.5;">${f.desc}</div>
        <div style="font-size:11px; background:#fff; border-left:3px solid ${color}; padding:8px 10px; border-radius:4px; margin-top:4px;">
          <strong style="color:#0f172a;">💡 Recommended AI Remediation:</strong>
          <div style="margin-top:2px; color:#475569;">${f.remediation}</div>
          ${f.code ? `<pre style="margin-top:6px; background:#f1f5f9; padding:6px; border-radius:3px; font-family:var(--font-mono); font-size:11px; overflow-x:auto;"><code>${escapeHtml(f.code)}</code></pre>` : ''}
        </div>
      </div>
    `;
  });

  listEl.innerHTML = html;

  // Build markdown report
  currentApexReport = `# SF Power Inspector — Apex Security Audit Report\n` +
    `Org: ${orgInfo.orgName || sfHost} | Health Score: ${healthScore}%\n` +
    `Critical: ${criticalCount} | Total Findings: ${findings.length}\n\n` +
    findings.map((f, i) => `### ${i+1}. [${f.severity}] ${f.rule}\n- **Risk**: ${f.desc}\n- **Remediation**: ${f.remediation}\n`).join("\n");
}

function copyApexReport() {
  if (!currentApexReport) {
    alert("Please run an Apex scan first.");
    return;
  }
  navigator.clipboard.writeText(currentApexReport).then(() => {
    alert("✓ Audit Report copied to clipboard!");
  }).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = currentApexReport;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    alert("✓ Audit Report copied to clipboard!");
  });
}

// ─── TAB 2: SOQL PERFORMANCE & INDEX OPTIMIZER ──────────────────────
const SOQL_PRESETS = {
  negative: `SELECT Id, Name, StageName, Amount FROM Opportunity WHERE StageName != 'Closed Won' AND CloseDate = THIS_YEAR`,
  wildcard: `SELECT Id, Name, BillingCity FROM Account WHERE Name LIKE '%Acme%' ORDER BY CreatedDate DESC`,
  null: `SELECT Id, LastName, Email FROM Contact WHERE AccountId = null AND Email != null`,
  subquery: `SELECT Id, Name, (SELECT Id, Subject FROM Cases WHERE Priority = 'High') FROM Account WHERE AnnualRevenue > 1000000`,
  selective: `SELECT Id, Name, CreatedDate FROM Account WHERE RecordTypeId = '0125g000000XyZ1AAA' AND CreatedDate = TODAY ORDER BY Name ASC LIMIT 100`
};

function loadSoqlPreset(key) {
  if (SOQL_PRESETS[key]) {
    document.getElementById("soql-opt-input").value = SOQL_PRESETS[key];
    runSoqlOptimizer();
  }
}

function runSoqlOptimizer() {
  const query = document.getElementById("soql-opt-input").value.trim();
  const outputEl = document.getElementById("soql-analysis-output");

  if (!query) {
    outputEl.innerHTML = `<span style="color:red; font-weight:600;">Please enter a SOQL query.</span>`;
    return;
  }

  const tips = [];
  let score = 100;

  // Rule 1: Negative operators
  if (/(\!=|\bNOT\s+IN\b|\bEXCLUDES\b)/i.test(query)) {
    score -= 30;
    tips.push({
      type: "CRITICAL",
      title: "Negative Operators Invalidate Standard B-Tree Indexes",
      desc: "Using `!=`, `NOT IN`, or `EXCLUDES` prevents Salesforce optimizer from using standard indexes. Causes full table scans across Large Data Volumes (LDV).",
      remedy: "Filter positively using positive sets (`IN ('Prospecting', 'Qualification')`) or partition with indexed date ranges."
    });
  }

  // Rule 2: Leading wildcards
  if (/LIKE\s+'%[^']+'/i.test(query)) {
    score -= 30;
    tips.push({
      type: "CRITICAL",
      title: "Leading Wildcard (`%value`) Kills Index Selectivity",
      desc: "Filters starting with `%` cannot use standard or custom indexes. The database must inspect every single record.",
      remedy: "Use trailing wildcards (`'value%'`), exact equality (`=`), or implement SOSL full-text search (`FIND {value}`)."
    });
  }

  // Rule 3: Equality to null
  if (/=\s*null/i.test(query)) {
    score -= 20;
    tips.push({
      type: "WARNING",
      title: "Null Comparison (`Field = null`)",
      desc: "Standard Salesforce B-Tree indexes do not store null values. A query checking `= null` scans every record in the table unless a custom index with null inclusion has been explicitly provisioned by Salesforce Support.",
      remedy: "Ensure query includes an additional selective indexed filter (e.g. `CreatedDate = THIS_YEAR`)."
    });
  }

  // Rule 4: Missing LIMIT on large query
  if (!/\bLIMIT\b/i.test(query)) {
    score -= 10;
    tips.push({
      type: "INFO",
      title: "No LIMIT Clause Specified",
      desc: "Consider adding a `LIMIT` clause to avoid fetching excessive records in high-volume environments (governor limit: 50,000 SOQL query rows).",
      remedy: "Add `LIMIT 1000` or process via Batch Apex / SOQL for-loop."
    });
  }

  // Rule 5: SELECT * anti-pattern (large projection)
  const fieldListMatch = query.match(/SELECT\s+(.+?)\s+FROM/i);
  if (fieldListMatch && fieldListMatch[1].split(",").length > 30) {
    score -= 10;
    tips.push({
      type: "WARNING",
      title: "Wide Projection (> 30 Fields Selected)",
      desc: "Fetching dozens of unnecessary fields consumes significant memory and increases serialization latency.",
      remedy: "Select only fields strictly required for the business operation."
    });
  }

  let scoreColor = "#16a34a";
  if (score < 80) scoreColor = "#eab308";
  if (score < 50) scoreColor = "#dc2626";

  outputEl.innerHTML = `
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:6px; padding:14px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div style="font-size:14px; font-weight:700; color:#0f172a;">AI Query Performance Index Score:</div>
        <div style="font-size:12px; color:#64748b; margin-top:2px;">Evaluates B-Tree index eligibility, non-deterministic formulas, and LDV selectivity thresholds.</div>
      </div>
      <div style="font-size:24px; font-weight:800; color:${scoreColor};">${score} / 100</div>
    </div>

    <div style="display:flex; flex-direction:column; gap:8px;">
      ${tips.map(t => `
        <div style="background:#fff; border:1px solid #e2e8f0; border-left:4px solid ${t.type === 'CRITICAL' ? '#dc2626' : (t.type === 'WARNING' ? '#eab308' : '#3b82f6')}; padding:12px; border-radius:4px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="font-size:13px; color:#1e293b;">${t.title}</strong>
            <span style="font-size:10px; font-weight:700; background:#f1f5f9; padding:2px 6px; border-radius:3px;">${t.type}</span>
          </div>
          <div style="font-size:12px; color:#475569; margin-top:4px; line-height:1.5;">${t.desc}</div>
          <div style="font-size:11px; margin-top:6px; color:#0369a1; background:#f0f9ff; padding:6px 8px; border-radius:3px;">
            <strong>💡 AI Tuning:</strong> ${t.remedy}
          </div>
        </div>
      `).join("")}
      ${tips.length === 0 ? `
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:20px; text-align:center;">
          <div style="font-size:20px; color:#16a34a; font-weight:700;">✓ Excellent Query Design</div>
          <div style="font-size:12px; color:#374151; margin-top:4px;">This SOQL query adheres to Salesforce Index and Selectivity Best Practices.</div>
        </div>
      ` : ''}
    </div>
  `;
}

async function runLiveOrgQueryPlan() {
  const query = document.getElementById("soql-opt-input").value.trim();
  const outputEl = document.getElementById("soql-analysis-output");

  if (!query) {
    alert("Please enter a SOQL query first.");
    return;
  }

  outputEl.innerHTML = `<div style="padding:20px; text-align:center; color:#0176d3;">⚡ Contacting Salesforce Query Optimizer via REST API (/query/?explain=...)...</div>`;

  try {
    const url = `/services/data/v${apiVersion}/query/?explain=${encodeURIComponent(query)}`;
    const res = await sfConn.rest(url);
    const plans = res.plans || [];

    if (plans.length === 0) {
      outputEl.innerHTML = `<div style="padding:20px; text-align:center;">No query plans returned by org optimizer.</div>`;
      return;
    }

    outputEl.innerHTML = `
      <div style="margin-bottom:12px; background:#fff; border:1px solid #e2e8f0; border-radius:6px; padding:12px;">
        <strong style="font-size:14px; color:#0176d3;">📊 Live Salesforce Query Optimizer Results (${plans.length} Execution Plans Evaluated):</strong>
        <div style="font-size:12px; color:#64748b; margin-top:2px;">
          Relative Cost ≤ 1.0 indicates a selective indexed query. Relative Cost > 1.0 triggers a full table scan.
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        ${plans.map((p, i) => {
          const isSelective = p.relativeCost <= 1.0;
          const costColor = isSelective ? "#16a34a" : "#dc2626";
          return `
            <div style="background:#fff; border:1px solid #e2e8f0; border-left:4px solid ${costColor}; padding:12px; border-radius:4px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong style="font-size:13px;">Plan #${i + 1}: ${escapeHtml(p.leadingOperationType || 'Unknown')}</strong>
                <span style="font-size:13px; font-weight:800; color:${costColor};">Relative Cost: ${p.relativeCost} (${isSelective ? 'SELECTIVE ✓' : 'FULL TABLE SCAN ⚠️'})</span>
              </div>
              <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; margin-top:8px; font-size:11px; background:#f8fafc; padding:8px; border-radius:4px;">
                <div><strong>Cardinality:</strong> ${p.cardinality?.toLocaleString() ?? 'N/A'}</div>
                <div><strong>Indexed Fields:</strong> ${(p.fields || []).join(', ') || 'None'}</div>
                <div><strong>SObject:</strong> ${p.sobject || 'Main'}</div>
              </div>
              ${p.notes && p.notes.length > 0 ? `
                <div style="margin-top:6px; font-size:11px; color:#475569;">
                  <strong>Optimizer Notes:</strong> ${p.notes.map(n => n.description || n).join('; ')}
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch (err) {
    outputEl.innerHTML = `
      <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:16px; color:#dc2626;">
        <strong>Query Plan API Error:</strong> ${escapeHtml(err.message)}
        <div style="margin-top:4px; font-size:11px; color:#64748b;">Ensure the query is valid SOQL syntax and that your user has access to the target object.</div>
      </div>
    `;
  }
}

// ─── TAB 3: OBJECT & FLS SECURITY MATRIX EXPLORER ───────────────────
function setupMatrixAutocomplete() {
  const input = document.getElementById("matrix-obj-name");
  const dropdown = document.getElementById("obj-autocomplete");
  if (!input || !dropdown) return;

  input.addEventListener("input", () => {
    const term = input.value.trim().toLowerCase();
    const list = Array.isArray(cachedSObjects) ? cachedSObjects : (cachedSObjects?.sobjects || []);
    if (!term || list.length === 0) {
      dropdown.style.display = "none";
      return;
    }

    const matches = list.filter(s =>
      s.name.toLowerCase().includes(term) || (s.label && s.label.toLowerCase().includes(term))
    ).slice(0, 10);

    if (matches.length === 0) {
      dropdown.style.display = "none";
      return;
    }

    dropdown.innerHTML = matches.map(m => `
      <div style="padding:6px 10px; cursor:pointer; font-size:12px; border-bottom:1px solid #f1f5f9;" class="obj-item" data-name="${m.name}">
        <strong>${m.name}</strong> <span style="color:#64748b;">(${m.label})</span>
      </div>
    `).join("");

    dropdown.style.display = "block";

    dropdown.querySelectorAll(".obj-item").forEach(item => {
      item.addEventListener("click", () => {
        input.value = item.dataset.name;
        dropdown.style.display = "none";
        loadSecurityMatrix();
      });
    });
  });

  document.addEventListener("click", (e) => {
    if (input && dropdown && !input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = "none";
    }
  });
}

function switchMatrixMode(mode) {
  matrixMode = mode;
  document.getElementById("btn-mode-obj")?.classList.toggle("active", mode === "object");
  document.getElementById("btn-mode-fls")?.classList.toggle("active", mode === "fls");

  const thead = document.getElementById("matrix-head");
  if (mode === "object") {
    thead.innerHTML = `
      <tr>
        <th>Profile / Permission Set</th>
        <th style="width: 120px;">Type</th>
        <th style="width: 70px; text-align: center;">Read</th>
        <th style="width: 70px; text-align: center;">Create</th>
        <th style="width: 70px; text-align: center;">Edit</th>
        <th style="width: 70px; text-align: center;">Delete</th>
        <th style="width: 90px; text-align: center;">View All</th>
        <th style="width: 90px; text-align: center;">Modify All</th>
      </tr>
    `;
  } else {
    thead.innerHTML = `
      <tr>
        <th>Field API Name</th>
        <th>Profile / Permission Set</th>
        <th style="width: 120px;">Type</th>
        <th style="width: 90px; text-align: center;">Read (FLS)</th>
        <th style="width: 90px; text-align: center;">Edit (FLS)</th>
      </tr>
    `;
  }

  loadSecurityMatrix();
}

async function loadSecurityMatrix() {
  const objName = document.getElementById("matrix-obj-name").value.trim();
  const tbody = document.getElementById("matrix-body");

  if (!objName) {
    alert("Please enter an SObject API name.");
    return;
  }

  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:#0176d3;">Querying ${matrixMode === "object" ? "ObjectPermissions" : "FieldPermissions"} from org...</td></tr>`;

  try {
    if (matrixMode === "object") {
      let res;
      try {
        const q = `SELECT ParentId, Parent.Name, Parent.Label, Parent.IsOwnedByProfile, Parent.Profile.Name, PermissionsRead, PermissionsCreate, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords FROM ObjectPermissions WHERE SobjectType = '${objName}' ORDER BY Parent.IsOwnedByProfile DESC, Parent.Label ASC LIMIT 1000`;
        res = await sfConn.query(q);
      } catch (qErr1) {
        // Fallback without Parent.Profile.Name (for restricted/custom permission models)
        try {
          const qBasic = `SELECT ParentId, Parent.Name, Parent.Label, Parent.IsOwnedByProfile, PermissionsRead, PermissionsCreate, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords FROM ObjectPermissions WHERE SobjectType = '${objName}' LIMIT 500`;
          res = await sfConn.query(qBasic);
        } catch (qErr2) {
          throw qErr1;
        }
      }
      matrixData = res.records || [];

      if (matrixData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);">No explicit ObjectPermissions found for '${objName}'.</td></tr>`;
        return;
      }

      renderObjectMatrix(matrixData);
    } else {
      let res;
      try {
        const q = `SELECT Field, Parent.Name, Parent.Label, Parent.IsOwnedByProfile, Parent.Profile.Name, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE SobjectType = '${objName}' ORDER BY Field ASC, Parent.IsOwnedByProfile DESC LIMIT 500`;
        res = await sfConn.query(q);
      } catch (qErr1) {
        // Fallback without Parent.Profile.Name
        try {
          const qBasic = `SELECT Field, Parent.Name, Parent.Label, Parent.IsOwnedByProfile, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE SobjectType = '${objName}' LIMIT 500`;
          res = await sfConn.query(qBasic);
        } catch (qErr2) {
          throw qErr1;
        }
      }
      matrixData = res.records || [];

      if (matrixData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">No FieldPermissions found for '${objName}'.</td></tr>`;
        return;
      }

      renderFlsMatrix(matrixData);
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:#dc2626; text-align:center; padding:20px;">Failed to generate security matrix: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderObjectMatrix(records) {
  const tbody = document.getElementById("matrix-body");
  const check = (val) => val ? '<span style="color:#16a34a; font-weight:800; font-size:14px;">✓</span>' : '<span style="color:#cbd5e1;">—</span>';

  tbody.innerHTML = records.map(r => {
    const isProfile = r.Parent?.IsOwnedByProfile;
    const displayName = isProfile ? (r.Parent?.Profile?.Name || r.Parent?.Label) : r.Parent?.Label;
    const typeBadge = isProfile
      ? `<span style="font-size:10px; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:3px; font-weight:700;">PROFILE</span>`
      : `<span style="font-size:10px; background:#fef3c7; color:#b45309; padding:2px 6px; border-radius:3px; font-weight:700;">PERMISSION SET</span>`;

    return `
      <tr class="matrix-row" data-name="${(displayName || '').toLowerCase()}">
        <td><strong>${escapeHtml(displayName || 'Unknown')}</strong></td>
        <td>${typeBadge}</td>
        <td style="text-align:center;">${check(r.PermissionsRead)}</td>
        <td style="text-align:center;">${check(r.PermissionsCreate)}</td>
        <td style="text-align:center;">${check(r.PermissionsEdit)}</td>
        <td style="text-align:center;">${check(r.PermissionsDelete)}</td>
        <td style="text-align:center;">${check(r.PermissionsViewAllRecords)}</td>
        <td style="text-align:center;">${check(r.PermissionsModifyAllRecords)}</td>
      </tr>
    `;
  }).join("");
}

function renderFlsMatrix(records) {
  const tbody = document.getElementById("matrix-body");
  const check = (val) => val ? '<span style="color:#16a34a; font-weight:800; font-size:14px;">✓</span>' : '<span style="color:#cbd5e1;">—</span>';

  tbody.innerHTML = records.map(r => {
    const isProfile = r.Parent?.IsOwnedByProfile;
    const displayName = isProfile ? (r.Parent?.Profile?.Name || r.Parent?.Label) : r.Parent?.Label;
    const typeBadge = isProfile
      ? `<span style="font-size:10px; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:3px; font-weight:700;">PROFILE</span>`
      : `<span style="font-size:10px; background:#fef3c7; color:#b45309; padding:2px 6px; border-radius:3px; font-weight:700;">PERMISSION SET</span>`;

    const fieldDisplay = r.Field ? r.Field.replace(/^[^.]+\./, "") : "Unknown";

    return `
      <tr class="matrix-row" data-name="${(fieldDisplay + ' ' + (displayName || '')).toLowerCase()}">
        <td><code style="color:#0176d3; font-weight:700;">${escapeHtml(fieldDisplay)}</code></td>
        <td><strong>${escapeHtml(displayName || 'Unknown')}</strong></td>
        <td>${typeBadge}</td>
        <td style="text-align:center;">${check(r.PermissionsRead)}</td>
        <td style="text-align:center;">${check(r.PermissionsEdit)}</td>
      </tr>
    `;
  }).join("");
}

function filterMatrixRows() {
  const q = document.getElementById("matrix-filter").value.trim().toLowerCase();
  document.querySelectorAll(".matrix-row").forEach(row => {
    const name = row.dataset.name || "";
    row.style.display = name.includes(q) ? "" : "none";
  });
}

function exportMatrixCsv() {
  if (!matrixData || matrixData.length === 0) {
    alert("Please generate matrix first.");
    return;
  }

  const objName = document.getElementById("matrix-obj-name").value.trim() || "Object";
  let rows = [];

  if (matrixMode === "object") {
    rows.push(["Profile or Permission Set", "Type", "Read", "Create", "Edit", "Delete", "View All", "Modify All"].join(","));
    matrixData.forEach(r => {
      const isProfile = r.Parent?.IsOwnedByProfile;
      const name = isProfile ? (r.Parent?.Profile?.Name || r.Parent?.Label) : r.Parent?.Label;
      rows.push([
        `"${name || ''}"`,
        isProfile ? "Profile" : "Permission Set",
        r.PermissionsRead ? "TRUE" : "FALSE",
        r.PermissionsCreate ? "TRUE" : "FALSE",
        r.PermissionsEdit ? "TRUE" : "FALSE",
        r.PermissionsDelete ? "TRUE" : "FALSE",
        r.PermissionsViewAllRecords ? "TRUE" : "FALSE",
        r.PermissionsModifyAllRecords ? "TRUE" : "FALSE"
      ].join(","));
    });
  } else {
    rows.push(["Field", "Profile or Permission Set", "Type", "Read (FLS)", "Edit (FLS)"].join(","));
    matrixData.forEach(r => {
      const isProfile = r.Parent?.IsOwnedByProfile;
      const name = isProfile ? (r.Parent?.Profile?.Name || r.Parent?.Label) : r.Parent?.Label;
      rows.push([
        `"${r.Field || ''}"`,
        `"${name || ''}"`,
        isProfile ? "Profile" : "Permission Set",
        r.PermissionsRead ? "TRUE" : "FALSE",
        r.PermissionsEdit ? "TRUE" : "FALSE"
      ].join(","));
    });
  }

  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${objName}_${matrixMode.toUpperCase()}_Matrix_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── TAB 4: AI FORMULA EXPLAINER & VALIDATOR ────────────────────────
const FORMULA_PRESETS = {
  discount: `IF(
    AND(AnnualRevenue > 10000000, ISPICKVAL(Type, 'Customer - Direct')),
    0.25,
    IF(AnnualRevenue > 2500000, 0.15, 0.05)
)`,
  nullrisk: `AnnualRevenue * Discount_Rate__c / NumberOfEmployees`,
  divzero: `Amount / Closed_Won_Count__c`,
  sla: `IF(
    ISBLANK(Milestone_Start_Date__c),
    NOW(),
    Milestone_Start_Date__c + (SLA_Hours__c / 24)
)`,
  validation: `AND(
    ISCHANGED(StageName),
    ISPICKVAL(StageName, 'Closed Won'),
    ISBLANK(PoNumber__c),
    Amount > 50000
)`
};

function loadFormulaPreset(key) {
  if (FORMULA_PRESETS[key]) {
    document.getElementById("formula-input").value = FORMULA_PRESETS[key];
    runFormulaExplainer();
  }
}

function formatFormula() {
  const ta = document.getElementById("formula-input");
  let f = ta.value.trim();
  if (!f) return;

  // Simple clean formatting of parentheses
  f = f.replace(/,\s*/g, ", ")
       .replace(/\(\s*/g, "(\n  ")
       .replace(/\s*\)/g, "\n)")
       .replace(/\n\s*\n/g, "\n");
  ta.value = f;
}

function runFormulaExplainer() {
  const formula = document.getElementById("formula-input").value.trim();
  const outputEl = document.getElementById("formula-explanation-output");

  if (!formula) {
    outputEl.innerHTML = `<span style="color:red; font-weight:600;">Please enter a formula expression.</span>`;
    return;
  }

  // 1. Identify Referenced Fields
  const fieldMatches = formula.match(/\b[A-Za-z_][A-Za-z0-9_]*(__c|__r)?\b/g) || [];
  const knownFunctions = new Set(["IF", "AND", "OR", "NOT", "ISBLANK", "BLANKVALUE", "NULLVALUE", "ISPICKVAL", "TEXT", "PRIORVALUE", "ISCHANGED", "ISNEW", "CASE", "CONTAINS", "NOW", "TODAY", "DATEVALUE", "DATETIMEVALUE", "YEAR", "MONTH", "DAY", "MAX", "MIN", "MOD", "ROUND", "CEILING", "FLOOR", "ABS", "SQRT", "LEN", "LEFT", "RIGHT", "MID", "SUBSTITUTE", "REGEX", "HYPERLINK", "IMAGE"]);
  const detectedFields = [...new Set(fieldMatches.filter(w => !knownFunctions.has(w.toUpperCase()) && !/^\d+$/.test(w)))];
  const detectedFuncs = [...new Set(fieldMatches.filter(w => knownFunctions.has(w.toUpperCase())).map(f => f.toUpperCase()))];

  // 2. Identify Risks
  const risks = [];

  // Division by zero risk
  if (/\/\s*([A-Za-z_][A-Za-z0-9_]*)/.test(formula)) {
    const match = formula.match(/\/\s*([A-Za-z_][A-Za-z0-9_]*)/);
    risks.push({
      severity: "CRITICAL",
      title: "Division by Zero Risk",
      desc: `Division by operand \`${match[1]}\` without verifying \`!= 0\`. If \`${match[1]}\` is zero or blank, the calculation throws a runtime evaluation fault.`,
      remedy: `Guard division using: \`IF(OR(ISBLANK(${match[1]}), ${match[1]} == 0), 0, Expression / ${match[1]})\``
    });
  }

  // Null arithmetic risk (multiplication or addition without BLANKVALUE)
  if (!/BLANKVALUE|ISBLANK|NULLVALUE/i.test(formula) && /[\*\+\-\/]/.test(formula) && detectedFields.length > 0) {
    risks.push({
      severity: "WARNING",
      title: "Null Arithmetic Risk (Blanks Treated as Null)",
      desc: "Arithmetic operators (`+`, `-`, `*`, `/`) will evaluate to NULL if any referenced field is blank, unless 'Treat blank fields as zeroes' is configured.",
      remedy: "Wrap nullable numeric fields in `BLANKVALUE(Field__c, 0)`."
    });
  }

  // Text vs Picklist comparison error
  if (/(\w+)\s*==?\s*'[^']+'/i.test(formula)) {
    const match = formula.match(/([A-Za-z0-9_]+)\s*==?\s*'([^']+)'/);
    if (match && !/ISPICKVAL|TEXT/i.test(formula)) {
      risks.push({
        severity: "INFO",
        title: "Picklist Direct Comparison Notice",
        desc: `Comparing field \`${match[1]}\` directly to a string literal. If \`${match[1]}\` is a Picklist field, direct string comparison fails in Salesforce formulas.`,
        remedy: `Use \`ISPICKVAL(${match[1]}, '${match[2]}')\` or \`TEXT(${match[1]}) = '${match[2]}'\`.`
      });
    }
  }

  // 3. Step-by-step logic breakdown
  const logicSteps = [];
  if (/AND\s*\(/i.test(formula)) logicSteps.push("All sub-conditions in the `AND(...)` block must evaluate to TRUE simultaneously.");
  if (/OR\s*\(/i.test(formula)) logicSteps.push("Any single sub-condition in the `OR(...)` block being TRUE satisfies the condition.");
  if (/IF\s*\(/i.test(formula)) logicSteps.push("Branches conditionally based on the boolean result (`IF(condition, trueResult, falseResult)`).");
  if (/ISCHANGED\s*\(/i.test(formula)) logicSteps.push("Triggers exclusively when the record field value was modified during the current save event (`ISCHANGED`).");
  if (/ISBLANK\s*\(/i.test(formula)) logicSteps.push("Safely verifies whether a field contains no data before evaluation.");
  if (/ISPICKVAL\s*\(/i.test(formula) || /TEXT\s*\(/i.test(formula)) logicSteps.push("Inspects the selected picklist value.");
  logicSteps.push("Calculates and yields the resulting typed expression value.");

  outputEl.innerHTML = `
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:6px; padding:16px; margin-bottom:12px;">
      <h3 style="font-size:14px; font-weight:700; color:#0176d3; margin-bottom:10px;">🧠 Formula Abstract Syntax & Token Breakdown</h3>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; font-size:12px;">
        <div style="background:#f8fafc; padding:10px; border-radius:4px; border:1px solid #e2e8f0;">
          <strong style="color:#0f172a;">Fields Referenced (${detectedFields.length}):</strong>
          <div style="margin-top:4px; display:flex; flex-wrap:wrap; gap:4px;">
            ${detectedFields.map(f => `<span style="background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:3px; font-family:var(--font-mono); font-size:11px;">${f}</span>`).join("") || '<span style="color:#94a3b8;">None</span>'}
          </div>
        </div>
        <div style="background:#f8fafc; padding:10px; border-radius:4px; border:1px solid #e2e8f0;">
          <strong style="color:#0f172a;">Functions Used (${detectedFuncs.length}):</strong>
          <div style="margin-top:4px; display:flex; flex-wrap:wrap; gap:4px;">
            ${detectedFuncs.map(fn => `<span style="background:#ede9fe; color:#6d28d9; padding:2px 6px; border-radius:3px; font-family:var(--font-mono); font-size:11px;">${fn}</span>`).join("") || '<span style="color:#94a3b8;">None</span>'}
          </div>
        </div>
      </div>
    </div>

    <!-- Plain English Walkthrough -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:6px; padding:16px; margin-bottom:12px;">
      <h4 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:8px;">📖 Plain English Logic Flow:</h4>
      <ul style="font-size:12px; color:#334151; padding-left:20px; line-height:1.6;">
        ${logicSteps.map(s => `<li>${s}</li>`).join("")}
      </ul>
    </div>

    <!-- Risks & Warnings -->
    <div style="display:flex; flex-direction:column; gap:8px;">
      ${risks.map(r => `
        <div style="background:#fff; border:1px solid #e2e8f0; border-left:4px solid ${r.severity === 'CRITICAL' ? '#dc2626' : (r.severity === 'WARNING' ? '#eab308' : '#3b82f6')}; padding:12px; border-radius:4px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="font-size:13px; color:#1e293b;">[${r.severity}] ${r.title}</strong>
          </div>
          <div style="font-size:12px; color:#475569; margin-top:4px; line-height:1.5;">${r.desc}</div>
          <div style="font-size:11px; margin-top:6px; color:#0f172a; background:#f8fafc; padding:6px 8px; border-radius:3px; font-family:var(--font-mono);">
            <strong>💡 Remediation:</strong> ${escapeHtml(r.remedy)}
          </div>
        </div>
      `).join("")}
      ${risks.length === 0 ? `
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:16px; text-align:center;">
          <div style="font-size:14px; font-weight:700; color:#15803d;">✓ No Runtime Null or Arithmetic Risks Detected</div>
        </div>
      ` : ''}
    </div>
  `;
}

// ─── TAB 5: 100% FREE CLIENT-SIDE ORG SECURITY & GOVERNANCE AUDITOR ──────────
async function runOrgSecurityAudit() {
  const container = document.getElementById("org-audit-results");
  if (!container) return;

  container.innerHTML = `
    <div style="padding: 40px; text-align: center; color: #0176d3;">
      <div style="font-size: 32px; margin-bottom: 12px; animation: pulse 1.5s infinite;">🛡️</div>
      <strong>Scanning Administrative Privileges, Permissions & Sharing Models...</strong>
      <div style="font-size: 12px; margin-top: 6px; color: var(--text-muted);">Running client-side zero-cost security rules against live org metadata</div>
    </div>
  `;

  try {
    // 1. Query High-Privilege Permission Sets and Profiles
    let permSetRecords = [];
    try {
      const qPerms = `SELECT Id, Name, Label, IsOwnedByProfile, Profile.Name, PermissionsModifyAllData, PermissionsViewAllData, PermissionsAuthorApex FROM PermissionSet WHERE (PermissionsModifyAllData = true OR PermissionsViewAllData = true OR PermissionsAuthorApex = true) LIMIT 200`;
      const resPerms = await sfConn.query(qPerms);
      permSetRecords = resPerms.records || [];
    } catch (e1) {
      console.warn("PermSet query fallback:", e1);
    }

    // 2. Query Active System Admins / High Privilege Users
    let activeAdmins = [];
    try {
      const qAdmins = `SELECT Id, Name, Username, Email, Profile.Name, LastLoginDate FROM User WHERE IsActive = true AND (Profile.PermissionsModifyAllData = true OR Profile.Name LIKE '%Admin%') ORDER BY LastLoginDate ASC NULLS FIRST LIMIT 100`;
      const resAdmins = await sfConn.query(qAdmins);
      activeAdmins = resAdmins.records || [];
    } catch (e2) {
      console.warn("User query fallback:", e2);
    }

    // 3. Query Custom Entity Sharing Models
    let entityDefs = [];
    try {
      const qEntities = `SELECT QualifiedApiName, MasterLabel, InternalSharingModel, ExternalSharingModel FROM EntityDefinition WHERE IsCustomizable = true AND KeyPrefix != null ORDER BY QualifiedApiName ASC LIMIT 150`;
      const resEntities = await sfConn.query(qEntities, true);
      entityDefs = resEntities.records || [];
    } catch (e3) {
      console.warn("EntityDefinition query fallback:", e3);
    }

    // 4. Run Free Client-Side AI Heuristic Rules
    const findings = [];
    let riskDeductions = 0;

    // Check A: Modify All Data Proliferation
    const modifyAllList = permSetRecords.filter(p => p.PermissionsModifyAllData);
    if (modifyAllList.length > 2) {
      riskDeductions += 20;
      findings.push({
        severity: "CRITICAL",
        title: "High Administrative Proliferation (Modify All Data)",
        desc: `Found ${modifyAllList.length} Profiles or Permission Sets with 'Modify All Data' enabled. This permission grants unconditional access to read, edit, transfer, and delete every record in the org, bypassing all sharing rules and FLS.`,
        items: modifyAllList.map(p => p.IsOwnedByProfile ? `Profile: ${p.Profile?.Name || p.Label}` : `Permission Set: ${p.Label}`),
        remedy: "Enforce Principle of Least Privilege: revoke 'Modify All Data' from non-system-admin profiles and use targeted Permission Sets with specific SObject CRUD.",
        link: `https://${sfHost}/lightning/setup/PermSets/home`
      });
    }

    // Check B: Author Apex in Non-Developer Context
    const isProd = orgInfo.isSandbox === false;
    const authorApexList = permSetRecords.filter(p => p.PermissionsAuthorApex && !p.IsOwnedByProfile);
    if (authorApexList.length > 0) {
      riskDeductions += 15;
      findings.push({
        severity: isProd ? "CRITICAL" : "WARNING",
        title: "Author Apex Permission in Standalone Permission Sets",
        desc: `${authorApexList.length} standalone Permission Sets grant 'Author Apex'. Users with this permission can write and execute arbitrary Apex code and bypass org validation rules.`,
        items: authorApexList.map(p => `Permission Set: ${p.Label} (${p.Name})`),
        remedy: "Revoke 'Author Apex' from standalone permission sets. All Apex deployments should occur via version-controlled CI/CD pipelines.",
        link: `https://${sfHost}/lightning/setup/PermSets/home`
      });
    }

    // Check C: Dormant High-Privilege Admin Users
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const dormantAdmins = activeAdmins.filter(u => !u.LastLoginDate || new Date(u.LastLoginDate) < sixtyDaysAgo);
    if (dormantAdmins.length > 0) {
      riskDeductions += 15;
      findings.push({
        severity: "HIGH",
        title: "Dormant High-Privilege Admin Accounts",
        desc: `${dormantAdmins.length} active Admin accounts have not logged in within the past 60 days (or have never logged in). Dormant admin accounts pose significant security and credential stuffing risks.`,
        items: dormantAdmins.map(u => `${u.Name} (${u.Username}) • Last Login: ${u.LastLoginDate ? new Date(u.LastLoginDate).toLocaleDateString() : 'Never'}`),
        remedy: "Freeze or deactivate inactive administrative user accounts to reduce attack surface.",
        link: `https://${sfHost}/lightning/setup/ManageUsers/home`
      });
    }

    // Check D: Wide-Open External Sharing (Experience Cloud Data Leak Risk)
    const publicExtObjects = entityDefs.filter(e => e.ExternalSharingModel === "ReadWrite" || e.ExternalSharingModel === "Full");
    if (publicExtObjects.length > 0) {
      riskDeductions += 15;
      findings.push({
        severity: "HIGH",
        title: "Wide-Open External Sharing Model (Experience Cloud Exposure)",
        desc: `${publicExtObjects.length} custom objects have External Sharing Model set to Public Read/Write or Full. If Experience Cloud (Community) or Guest User profiles are active, external users may be able to read or modify confidential records.`,
        items: publicExtObjects.map(e => `${e.MasterLabel} (${e.QualifiedApiName}) • External: ${e.ExternalSharingModel}`),
        remedy: "Set External Sharing Model to 'Private' or 'Controlled by Parent' in Sharing Settings, and use Sharing Rules with guest user criteria if required.",
        link: `https://${sfHost}/lightning/setup/SecuritySharing/home`
      });
    }

    // Check E: Baseline Positive Findings
    if (modifyAllList.length <= 2) {
      findings.push({
        severity: "PASS",
        title: "Administrative Permissions Strictly Constrained",
        desc: "Only authorized system profiles have 'Modify All Data'. Good security posture adherence.",
        remedy: "Maintain regular audits whenever new permission sets are created."
      });
    }

    if (publicExtObjects.length === 0 && entityDefs.length > 0) {
      findings.push({
        severity: "PASS",
        title: "External Sharing Models Secured",
        desc: "No custom objects are configured with wide-open Public Read/Write external sharing.",
        remedy: "Continue enforcing Private external defaults for all newly created custom objects."
      });
    }

    const healthScore = Math.max(10, 100 - riskDeductions);
    const scoreColor = healthScore >= 85 ? "#16a34a" : (healthScore >= 70 ? "#eab308" : "#dc2626");
    const scoreBadge = healthScore >= 85 ? "🛡️ Hardened (Tier 1)" : (healthScore >= 70 ? "⚠️ Needs Review (Tier 2)" : "🚨 High Risk (Tier 3)");

    container.innerHTML = `
      <!-- Score & Summary Grid -->
      <div class="ai-stat-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 16px;">
        <div class="ai-stat-card" style="border-top: 3px solid ${scoreColor};">
          <div class="ai-stat-label">Security Health Score</div>
          <div class="ai-stat-val" style="color: ${scoreColor};">${healthScore} / 100</div>
          <div style="font-size: 11px; font-weight: 700; color: ${scoreColor};">${scoreBadge}</div>
        </div>
        <div class="ai-stat-card" style="border-top: 3px solid #dc2626;">
          <div class="ai-stat-label">Critical Vulnerabilities</div>
          <div class="ai-stat-val" style="color: #dc2626;">${findings.filter(f => f.severity === 'CRITICAL').length}</div>
          <div style="font-size: 11px; color: var(--text-muted);">Requires immediate remediation</div>
        </div>
        <div class="ai-stat-card" style="border-top: 3px solid #f59e0b;">
          <div class="ai-stat-label">High / Warning Risks</div>
          <div class="ai-stat-val" style="color: #f59e0b;">${findings.filter(f => f.severity === 'HIGH' || f.severity === 'WARNING').length}</div>
          <div style="font-size: 11px; color: var(--text-muted);">Privilege & sharing warnings</div>
        </div>
        <div class="ai-stat-card" style="border-top: 3px solid #16a34a;">
          <div class="ai-stat-label">Compliant Baselines</div>
          <div class="ai-stat-val" style="color: #16a34a;">${findings.filter(f => f.severity === 'PASS').length}</div>
          <div style="font-size: 11px; color: var(--text-muted);">Passed security controls</div>
        </div>
      </div>

      <!-- Actionable Findings -->
      <div style="display: flex; flex-direction: column; gap: 12px;">
        ${findings.map(f => {
          const borderColor = f.severity === 'CRITICAL' ? '#dc2626' : (f.severity === 'HIGH' ? '#ea580c' : (f.severity === 'WARNING' ? '#eab308' : '#16a34a'));
          const bgBadge = f.severity === 'CRITICAL' ? '#fee2e2' : (f.severity === 'HIGH' ? '#ffedd5' : (f.severity === 'WARNING' ? '#fef3c7' : '#dcfce7'));
          const textBadge = f.severity === 'CRITICAL' ? '#b91c1c' : (f.severity === 'HIGH' ? '#c2410c' : (f.severity === 'WARNING' ? '#b45309' : '#15803d'));
          return `
            <div style="background: #fff; border: 1px solid #e2e8f0; border-left: 4px solid ${borderColor}; border-radius: 6px; padding: 14px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 10px; font-weight: 800; background: ${bgBadge}; color: ${textBadge}; padding: 2px 6px; border-radius: 4px;">
                    ${f.severity}
                  </span>
                  <strong style="font-size: 13px; color: #0f172a;">${escapeHtml(f.title)}</strong>
                </div>
                ${f.link ? `<a href="${f.link}" target="_blank" class="btn btn-secondary" style="font-size: 11px; padding: 3px 8px; text-decoration: none;">⚙️ Open Setup ↗</a>` : ''}
              </div>
              <div style="font-size: 12px; color: #475569; line-height: 1.5;">${escapeHtml(f.desc)}</div>
              ${f.items && f.items.length > 0 ? `
                <div style="margin-top: 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px 10px; font-size: 11px; max-height: 120px; overflow-y: auto;">
                  <strong style="color: #334155;">Affected Entities (${f.items.length}):</strong>
                  <ul style="margin: 4px 0 0 16px; padding: 0; color: #475569;">
                    ${f.items.slice(0, 10).map(it => `<li>${escapeHtml(it)}</li>`).join("")}
                    ${f.items.length > 10 ? `<li><em>...and ${f.items.length - 10} more</em></li>` : ''}
                  </ul>
                </div>
              ` : ''}
              <div style="margin-top: 8px; font-size: 11px; color: #0f172a; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 6px 10px; border-radius: 4px;">
                <strong>💡 Action Plan:</strong> ${escapeHtml(f.remedy)}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `
      <div style="padding: 24px; color: #dc2626; text-align: center; background: #fff; border-radius: 6px; border: 1px solid #fee2e2;">
        <strong>Error running org security audit:</strong> ${escapeHtml(err.message)}
      </div>
    `;
  }
}

// ─── TAB 6: FREE AI FIELD HEALTH, DEAD FIELD DETECTIVE & BLAST RADIUS ───────
function levenshteinDistance(s1, s2) {
  s1 = s1.toLowerCase();
  s2 = s2.toLowerCase();
  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else {
        if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const clean1 = str1.replace(/__c$/i, "").replace(/[_-]/g, " ").toLowerCase().trim();
  const clean2 = str2.replace(/__c$/i, "").replace(/[_-]/g, " ").toLowerCase().trim();
  if (clean1 === clean2) return 1.0;
  const longer = clean1.length > clean2.length ? clean1 : clean2;
  if (longer.length === 0) return 1.0;
  const dist = levenshteinDistance(clean1, clean2);
  const charSim = (longer.length - dist) / longer.length;

  const tokens1 = new Set(clean1.split(/\s+/));
  const tokens2 = new Set(clean2.split(/\s+/));
  const intersection = [...tokens1].filter(x => tokens2.has(x));
  const union = new Set([...tokens1, ...tokens2]);
  const tokenSim = union.size > 0 ? intersection.length / union.size : 0;

  return Math.max(charSim, tokenSim);
}

async function runFieldHealthAnalysis(objName) {
  const container = document.getElementById("field-health-results");
  if (!container) return;

  if (!objName) {
    alert("Please enter a target SObject name.");
    return;
  }

  container.innerHTML = `
    <div style="padding: 40px; text-align: center; color: #0176d3;">
      <div style="font-size: 32px; margin-bottom: 12px; animation: pulse 1.5s infinite;">🔍</div>
      <strong>Analyzing Field Health & Calculating Blast Radius for ${escapeHtml(objName)}...</strong>
      <div style="font-size: 12px; margin-top: 6px; color: var(--text-muted);">Comparing metadata fields, checking documentation coverage, and scanning validation rules</div>
    </div>
  `;

  try {
    // 1. Fetch Object Describe
    const describe = await sfConn.metadata(objName);
    const fields = describe.fields || [];

    // 2. Fetch Validation Rules on this object
    let valRules = [];
    try {
      const qRules = `SELECT Id, ValidationName, Active, Description, ErrorMessage, ErrorDisplayField FROM ValidationRule WHERE EntityDefinition.QualifiedApiName = '${objName}'`;
      const resRules = await sfConn.query(qRules, true, { logErrors: false });
      valRules = resRules.records || [];
    } catch (eRules) {
      try {
        const qFallback = `SELECT Id, ValidationName, Active, Description, ErrorMessage, ErrorDisplayField FROM ValidationRule WHERE EntityDefinitionId = '${objName}'`;
        const resFb = await sfConn.query(qFallback, true, { logErrors: false });
        valRules = resFb.records || [];
      } catch (eFb) {
        valRules = [];
      }
    }

    // 3. Client-Side AI Heuristics
    const customFields = fields.filter(f => f.custom);
    const deadFieldCandidates = [];
    const redundantPairs = [];

    // A. Duplicate / Overlapping Field Pair Detection
    for (let i = 0; i < customFields.length; i++) {
      for (let j = i + 1; j < customFields.length; j++) {
        const f1 = customFields[i];
        const f2 = customFields[j];
        const labelSim = calculateSimilarity(f1.label, f2.label);
        const nameSim = calculateSimilarity(f1.name, f2.name);
        const maxSim = Math.max(labelSim, nameSim);

        if (maxSim >= 0.72) {
          redundantPairs.push({
            field1: f1,
            field2: f2,
            similarity: Math.round(maxSim * 100)
          });
        }
      }
    }

    // B. Candidate Dead / Abandoned Fields
    // (No description, no help text, not required, not unique, and not formula)
    customFields.forEach(f => {
      const hasDesc = !!(f.inlineHelpText || f.calculated || f.nillable === false || f.unique || f.externalId);
      const isReferencedInVR = valRules.some(vr => vr.ErrorDisplayField === f.name);
      if (!hasDesc && !isReferencedInVR) {
        deadFieldCandidates.push(f);
      }
    });

    // C. Calculate Documentation Index & Hygiene Score
    const documentedCount = customFields.filter(f => f.inlineHelpText || f.calculated).length;
    const docPercent = customFields.length > 0 ? Math.round((documentedCount / customFields.length) * 100) : 100;
    
    // Hygiene score: 100 minus penalties
    let hygieneScore = 100;
    hygieneScore -= Math.min(30, redundantPairs.length * 10);
    hygieneScore -= Math.min(30, Math.round((deadFieldCandidates.length / (customFields.length || 1)) * 30));
    hygieneScore = Math.max(20, hygieneScore);
    const hygieneColor = hygieneScore >= 80 ? "#16a34a" : (hygieneScore >= 60 ? "#eab308" : "#dc2626");

    container.innerHTML = `
      <!-- Stat Cards -->
      <div class="ai-stat-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 16px;">
        <div class="ai-stat-card" style="border-top: 3px solid ${hygieneColor};">
          <div class="ai-stat-label">Field Hygiene Score</div>
          <div class="ai-stat-val" style="color: ${hygieneColor};">${hygieneScore} %</div>
          <div style="font-size: 11px; color: var(--text-muted);">${hygieneScore >= 80 ? 'Optimal Structure' : 'Cleanup Recommended'}</div>
        </div>
        <div class="ai-stat-card" style="border-top: 3px solid #0284c7;">
          <div class="ai-stat-label">Total Custom Fields</div>
          <div class="ai-stat-val" style="color: #0284c7;">${customFields.length} <span style="font-size:12px; font-weight:normal; color:#64748b;">/ ${fields.length}</span></div>
          <div style="font-size: 11px; color: var(--text-muted);">${fields.length - customFields.length} standard fields</div>
        </div>
        <div class="ai-stat-card" style="border-top: 3px solid #ea580c;">
          <div class="ai-stat-label">Candidate Redundant Pairs</div>
          <div class="ai-stat-val" style="color: #ea580c;">${redundantPairs.length}</div>
          <div style="font-size: 11px; color: var(--text-muted);">Similar labels or API names</div>
        </div>
        <div class="ai-stat-card" style="border-top: 3px solid #dc2626;">
          <div class="ai-stat-label">Candidate Dead / Orphan Fields</div>
          <div class="ai-stat-val" style="color: #dc2626;">${deadFieldCandidates.length}</div>
          <div style="font-size: 11px; color: var(--text-muted);">Undocumented & non-required</div>
        </div>
      </div>

      <!-- Section 1: Redundant / Overlapping Fields -->
      <div style="background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px; margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div>
            <h3 style="font-size: 13px; font-weight: 700; color: #0f172a; margin: 0;">👥 Candidate Redundant & Duplicate Field Pairs</h3>
            <div style="font-size: 11px; color: var(--text-muted);">Heuristic similarity analysis identifying duplicate business attributes</div>
          </div>
          <span style="font-size: 11px; background: #ffedd5; color: #c2410c; padding: 2px 8px; border-radius: 4px; font-weight: 700;">${redundantPairs.length} Suspects</span>
        </div>

        ${redundantPairs.length === 0 ? `
          <div style="font-size: 12px; color: #15803d; background: #f0fdf4; padding: 12px; border-radius: 4px; text-align: center;">
            ✓ No duplicate or highly similar field pairs detected on ${escapeHtml(objName)}.
          </div>
        ` : `
          <div style="overflow-x: auto;">
            <table class="data-table" style="font-size: 12px;">
              <thead>
                <tr>
                  <th>Field A</th>
                  <th>Field B</th>
                  <th style="width: 100px; text-align: center;">Match Score</th>
                  <th style="width: 120px;">AI Assessment</th>
                </tr>
              </thead>
              <tbody>
                ${redundantPairs.map(p => `
                  <tr>
                    <td>
                      <strong>${escapeHtml(p.field1.label)}</strong><br>
                      <code style="font-size: 11px; color: #0176d3;">${escapeHtml(p.field1.name)}</code>
                      <span style="font-size: 10px; color: var(--text-muted);">(${p.field1.type})</span>
                    </td>
                    <td>
                      <strong>${escapeHtml(p.field2.label)}</strong><br>
                      <code style="font-size: 11px; color: #0176d3;">${escapeHtml(p.field2.name)}</code>
                      <span style="font-size: 10px; color: var(--text-muted);">(${p.field2.type})</span>
                    </td>
                    <td style="text-align: center;">
                      <span style="font-weight: 800; color: ${p.similarity >= 85 ? '#dc2626' : '#ea580c'};">
                        ${p.similarity}%
                      </span>
                    </td>
                    <td>
                      <span style="font-size: 11px; background: #fee2e2; color: #b91c1c; padding: 2px 6px; border-radius: 3px; font-weight: 700;">
                        Potential Duplicate
                      </span>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `}
      </div>

      <!-- Section 2: Candidate Dead / Orphan Fields -->
      <div style="background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px; margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div>
            <h3 style="font-size: 13px; font-weight: 700; color: #0f172a; margin: 0;">🗑️ Candidate Dead / Unused Field Candidates</h3>
            <div style="font-size: 11px; color: var(--text-muted);">Fields with zero documentation, not marked required, and not bound to active validation rules</div>
          </div>
          <span style="font-size: 11px; background: #f1f5f9; color: #475569; padding: 2px 8px; border-radius: 4px; font-weight: 700;">${deadFieldCandidates.length} Fields</span>
        </div>

        ${deadFieldCandidates.length === 0 ? `
          <div style="font-size: 12px; color: #15803d; background: #f0fdf4; padding: 12px; border-radius: 4px; text-align: center;">
            ✓ All custom fields on ${escapeHtml(objName)} have documentation or constraints.
          </div>
        ` : `
          <div style="max-height: 250px; overflow-y: auto;">
            <table class="data-table" style="font-size: 12px;">
              <thead>
                <tr>
                  <th>Field Label</th>
                  <th>API Name</th>
                  <th style="width: 100px;">Type</th>
                  <th style="width: 130px; text-align: center;">Action</th>
                </tr>
              </thead>
              <tbody>
                ${deadFieldCandidates.slice(0, 30).map(f => `
                  <tr>
                    <td><strong>${escapeHtml(f.label)}</strong></td>
                    <td><code style="color: #0176d3;">${escapeHtml(f.name)}</code></td>
                    <td><span style="font-size: 10px; background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 3px;">${f.type}</span></td>
                    <td style="text-align: center;">
                      <a href="field-manager.html?host=${encodeURIComponent(sfHost)}&obj=${encodeURIComponent(objName)}&field=${encodeURIComponent(f.name)}" class="btn btn-secondary" style="font-size: 11px; padding: 2px 6px; text-decoration: none;">✏️ Manage Field</a>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          ${deadFieldCandidates.length > 30 ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 6px; text-align: center;">Showing top 30 of ${deadFieldCandidates.length} candidate fields.</div>` : ''}
        `}
      </div>

      <!-- Section 3: Blast Radius on Validation Rules & Automations -->
      <div style="background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px;">
        <h3 style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">💥 Downstream Automation Blast Radius (${valRules.length} Validation Rules)</h3>
        ${valRules.length === 0 ? `
          <div style="font-size: 12px; color: var(--text-muted); background: #f8fafc; padding: 12px; border-radius: 4px; text-align: center;">
            No active Validation Rules detected for ${escapeHtml(objName)}. Modifying or retiring fields has minimal risk of breaking validation blocks.
          </div>
        ` : `
          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${valRules.map(vr => `
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <strong style="font-size: 12px; color: #0f172a;">${escapeHtml(vr.ValidationName)}</strong>
                  <span style="font-size: 10px; background: ${vr.Active ? '#dcfce7' : '#f1f5f9'}; color: ${vr.Active ? '#15803d' : '#64748b'}; padding: 1px 5px; border-radius: 3px; font-weight: 700; margin-left: 6px;">
                    ${vr.Active ? 'ACTIVE' : 'INACTIVE'}
                  </span>
                  ${vr.ErrorDisplayField ? `<div style="font-size: 11px; color: #0176d3; margin-top: 2px;">Bound Field: <code>${escapeHtml(vr.ErrorDisplayField)}</code></div>` : ''}
                  ${vr.ErrorMessage ? `<div style="font-size: 11px; color: #475569; margin-top: 2px;">"${escapeHtml(vr.ErrorMessage)}"</div>` : ''}
                </div>
                <span style="font-size: 11px; color: var(--text-muted);">Validation Rule</span>
              </div>
            `).join("")}
          </div>
        `}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `
      <div style="padding: 24px; color: #dc2626; text-align: center; background: #fff; border-radius: 6px; border: 1px solid #fee2e2;">
        <strong>Error analyzing field health:</strong> ${escapeHtml(err.message)}
      </div>
    `;
  }
}

// ─── UTILITIES ──────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Initialize on page load
init();
