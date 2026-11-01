import { sfConn, apiVersion, updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";

const sfHost = resolveSfHost();

let rawLogContent = "";
let apexHistory = JSON.parse(localStorage.getItem(`sfpi_apex_history_${sfHost}`) || "[]");

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

  document.getElementById("link-dev-console").href = `https://${sfHost}/_ui/common/apex/debug/ApexCSIPage`;

  setupEvents();
  renderHistoryDropdown();

  // Deep-linking support: if class or name is in URL, prefill editor
  const params = new URLSearchParams(window.location.search);
  const targetClass = params.get("class") || params.get("name");
  if (targetClass) {
    const codeArea = document.getElementById("apex-code");
    if (codeArea) {
      codeArea.value = `// Inspecting ${targetClass}\n${targetClass} obj = new ${targetClass}();\nSystem.debug(obj);`;
    }
  }
}

function setupEvents() {
  document.getElementById("btn-execute").addEventListener("click", executeApex);
  document.getElementById("btn-enable-trace").addEventListener("click", enableTraceFlag);

  // Tab switching
  document.querySelectorAll(".tool-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tool-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab;
      document.getElementById("summary-view").style.display = target === "summary" ? "block" : "none";
      document.getElementById("log-view").style.display = target === "log" ? "block" : "none";
      document.getElementById("log-toolbar").style.display = target === "log" ? "flex" : "none";
    });
  });

  // Log filter checkbox & export buttons
  document.getElementById("chk-user-debug").addEventListener("change", renderLogOutput);
  document.getElementById("btn-copy-log").addEventListener("click", copyDebugLog);
  document.getElementById("btn-download-log").addEventListener("click", downloadDebugLog);

  // History selector
  document.getElementById("select-history").addEventListener("change", (e) => {
    const val = e.target.value;
    if (val) {
      document.getElementById("apex-code").value = decodeURIComponent(val);
    }
  });

  // Ctrl+Enter / Cmd+Enter
  document.getElementById("apex-code").addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      executeApex();
    }
  });

  // Sample snippets
  document.getElementById("btn-sample-code").addEventListener("click", () => {
    document.getElementById("apex-code").value = `// Clean inactive scratch data or test query
Integer userCount = [SELECT count() FROM User WHERE IsActive = true];
System.debug('Total Active Users: ' + userCount);

// Inspect governor limits in current transaction
System.debug('SOQL Queries Used: ' + Limits.getQueries() + ' of ' + Limits.getLimitQueries());
System.debug('Heap Size Used: ' + Limits.getHeapSize() + ' of ' + Limits.getLimitHeapSize());
System.debug('DML Rows Used: ' + Limits.getDmlRows() + ' of ' + Limits.getLimitDmlRows());
`;
  });
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
}

async function executeApex() {
  const code = document.getElementById("apex-code").value.trim();
  if (!code) {
    alert("Please enter Apex code to execute.");
    return;
  }

  const statsEl = document.getElementById("execution-stats");
  const statusCard = document.getElementById("status-card");
  const errorDetails = document.getElementById("error-details");
  const limitsContainer = document.getElementById("limits-container");

  statsEl.textContent = "⏳ Executing via SOAP Apex API...";
  errorDetails.style.display = "none";
  errorDetails.textContent = "";
  limitsContainer.style.display = "none";

  const startTime = performance.now();
  saveToHistory(code);

  try {
    let result = null;
    rawLogContent = "";

    // 1. Primary Engine: Execute via Apex SOAP API to synchronously capture the exact log with DebuggingHeader
    try {
      result = await executeAnonymousSoap(code);
    } catch (soapErr) {
      console.warn("SOAP executeAnonymous failed, falling back to Tooling REST:", soapErr);
      result = await executeAnonymousRest(code);
    }

    const duration = ((performance.now() - startTime) / 1000).toFixed(2);
    statsEl.textContent = `Completed in ${duration}s`;

    rawLogContent = result.debugLog || "";
    renderLogOutput();

    // Parse and render governor limits from the execution log
    if (rawLogContent) {
      renderGovernorLimits(rawLogContent);
    }

    if (result.compiled && result.success) {
      statusCard.style.background = "#f0fdf4";
      statusCard.style.borderColor = "#bbf7d0";
      statusCard.innerHTML = `
        <div style="color: #16a34a; font-weight:700; font-size:14px; margin-bottom: 4px;">✓ Execution Successful</div>
        <div style="font-size:12px; color:#374151;">Script compiled and executed with zero unhandled exceptions in ${duration}s.</div>
      `;
    } else if (!result.compiled) {
      statusCard.style.background = "#fef2f2";
      statusCard.style.borderColor = "#fecaca";
      statusCard.innerHTML = `
        <div style="color: #dc2626; font-weight:700; font-size:14px; margin-bottom: 4px;">❌ Compilation Error</div>
        <div style="font-size:12px; color:#374151;">Line ${result.line}, Column ${result.column}: ${result.compileProblem}</div>
      `;
      errorDetails.style.display = "block";
      errorDetails.textContent = `Line ${result.line}:${result.column} - ${result.compileProblem}`;
    } else {
      statusCard.style.background = "#fef2f2";
      statusCard.style.borderColor = "#fecaca";
      statusCard.innerHTML = `
        <div style="color: #dc2626; font-weight:700; font-size:14px; margin-bottom: 4px;">❌ Runtime Exception</div>
        <div style="font-size:12px; color:#374151;">${result.exceptionMessage}</div>
      `;
      errorDetails.style.display = "block";
      errorDetails.textContent = `${result.exceptionMessage}\n${result.exceptionStackTrace || ""}`;
    }

  } catch (err) {
    statsEl.textContent = `❌ Execution failed: ${err.message}`;
    statusCard.style.background = "#fef2f2";
    statusCard.style.borderColor = "#fecaca";
    statusCard.innerHTML = `<div style="color: #dc2626; font-weight:700;">Execution Error: ${err.message}</div>`;
  }
}

/**
 * Execute Anonymous Apex using Salesforce SOAP API (/services/Soap/s/)
 * Returns execution result and exact debug log synchronously via DebuggingHeader
 */
async function executeAnonymousSoap(code) {
  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:apex="http://soap.sforce.com/2006/08/apex">
  <soapenv:Header>
    <apex:SessionHeader>
      <apex:sessionId>${sfConn.sessionId}</apex:sessionId>
    </apex:SessionHeader>
    <apex:DebuggingHeader>
      <apex:categories>
        <apex:category>Apex_code</apex:category>
        <apex:level>FINEST</apex:level>
      </apex:categories>
      <apex:categories>
        <apex:category>System</apex:category>
        <apex:level>DEBUG</apex:level>
      </apex:categories>
      <apex:debugLevel>DETAIL</apex:debugLevel>
    </apex:DebuggingHeader>
  </soapenv:Header>
  <soapenv:Body>
    <apex:executeAnonymous>
      <apex:String>${escapeXml(code)}</apex:String>
    </apex:executeAnonymous>
  </soapenv:Body>
</soapenv:Envelope>`;

  const res = await fetch(`https://${sfConn.instanceHostname}/services/Soap/s/${apiVersion}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=UTF-8",
      "SOAPAction": '""',
      "Accept": "text/xml"
    },
    body: soapEnvelope
  });

  const xmlText = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "text/xml");

  // Check SOAP Fault
  const faultString = doc.querySelector("faultstring")?.textContent;
  if (faultString) {
    throw new Error(`SOAP Fault: ${faultString}`);
  }

  // 1. Extract Synchronous Debug Log from Header
  const debugLog = doc.querySelector("debugLog")?.textContent || "";

  // 2. Extract Execution Result from Body
  const compiled = doc.querySelector("compiled")?.textContent === "true";
  const success = doc.querySelector("success")?.textContent === "true";
  const compileProblem = doc.querySelector("compileProblem")?.textContent || "";
  const line = parseInt(doc.querySelector("line")?.textContent || "-1", 10);
  const column = parseInt(doc.querySelector("column")?.textContent || "-1", 10);
  const exceptionMessage = doc.querySelector("exceptionMessage")?.textContent || "";
  const exceptionStackTrace = doc.querySelector("exceptionStackTrace")?.textContent || "";

  return {
    compiled,
    success,
    compileProblem,
    line,
    column,
    exceptionMessage,
    exceptionStackTrace,
    debugLog
  };
}

/**
 * Fallback to Tooling REST API
 */
async function executeAnonymousRest(code) {
  const url = `/services/data/v${apiVersion}/tooling/executeAnonymous/?anonymousBody=${encodeURIComponent(code)}`;
  const res = await sfConn.rest(url);

  let debugLog = "";
  try {
    const logsRes = await sfConn.tooling(`/query/?q=SELECT+Id,Status,DurationMilliseconds,StartTime+FROM+ApexLog+WHERE+Request='API'+ORDER+BY+StartTime+DESC+LIMIT+1`);
    if (logsRes.records?.length > 0) {
      const logId = logsRes.records[0].Id;
      debugLog = await sfConn.rest(`/services/data/v${apiVersion}/tooling/sobjects/ApexLog/${logId}/Body/`, { responseType: "text" });
    }
  } catch (e) {
    debugLog = "Could not fetch log via REST: " + e.message;
  }

  return {
    compiled: res.compiled,
    success: res.success,
    compileProblem: res.compileProblem,
    line: res.line,
    column: res.column,
    exceptionMessage: res.exceptionMessage,
    exceptionStackTrace: res.exceptionStackTrace,
    debugLog
  };
}

/**
 * 1-Click TraceFlag Setup for 24h FINEST debugging in Dev Console and org
 */
async function enableTraceFlag() {
  const btn = document.getElementById("btn-enable-trace");
  const origText = btn.textContent;
  btn.textContent = "⏳ Setting TraceFlag...";

  try {
    // 1. Get current user ID
    const userRes = await sfConn.query("SELECT Id FROM User WHERE Id = '" + (await getCurrentUserId()) + "'");
    const userId = userRes.records[0]?.Id;

    if (!userId) throw new Error("Could not detect current User ID");

    // 2. Check for existing DebugLevel or create one
    let debugLevelId = null;
    const dlQuery = await sfConn.tooling("/query/?q=SELECT+Id+FROM+DebugLevel+WHERE+DeveloperName='SFPI_Debug'+LIMIT+1");
    if (dlQuery.records?.length > 0) {
      debugLevelId = dlQuery.records[0].Id;
    } else {
      const newDl = await sfConn.tooling("/sobjects/DebugLevel/", {
        method: "POST",
        body: {
          DeveloperName: "SFPI_Debug",
          MasterLabel: "SFPI Debug Level",
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
      debugLevelId = newDl.id;
    }

    // 3. Create TraceFlag valid for 24 hours
    const startDate = new Date();
    const expirationDate = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await sfConn.tooling("/sobjects/TraceFlag/", {
      method: "POST",
      body: {
        TracedEntityId: userId,
        LogType: "USER_DEBUG",
        DebugLevelId: debugLevelId,
        StartDate: startDate.toISOString(),
        ExpirationDate: expirationDate.toISOString()
      }
    });

    btn.textContent = "✓ TraceFlag Active (24h)";
    btn.style.color = "#16a34a";
    alert("✓ 24-Hour FINEST TraceFlag successfully enabled for your user!\nDeveloper Console and org transactions will now actively capture full debug logs.");
    setTimeout(() => { btn.textContent = origText; btn.style.color = ""; }, 4000);

  } catch (err) {
    btn.textContent = "❌ Trace Error";
    alert(`Could not set TraceFlag: ${err.message}\nMake sure your user has 'View Setup and Configuration' or Dev permissions.`);
    setTimeout(() => { btn.textContent = origText; }, 3000);
  }
}

async function getCurrentUserId() {
  const session = await sfConn.getSession(sfHost);
  const match = session.match(/!([a-zA-Z0-9]+)\./);
  if (match) return match[1];

  const res = await sfConn.query("SELECT Id FROM User WHERE Username = '" + (localStorage.getItem(sfHost + "_userName") || "") + "'");
  return res.records[0]?.Id;
}

// ----------------- Output & Limits Rendering -----------------

function renderLogOutput() {
  const onlyUserDebug = document.getElementById("chk-user-debug").checked;
  const logOutput = document.getElementById("log-output");
  const countEl = document.getElementById("log-line-count");

  if (!rawLogContent) {
    logOutput.textContent = "No debug log output available.";
    countEl.textContent = "0 lines";
    return;
  }

  const allLines = rawLogContent.split(/\r?\n/);
  countEl.textContent = `${allLines.length} lines`;

  if (!onlyUserDebug) {
    logOutput.textContent = rawLogContent;
    return;
  }

  // Filter and extract USER_DEBUG lines
  const userDebugStatements = [];
  allLines.forEach(line => {
    if (line.includes("|USER_DEBUG|")) {
      // Format: timestamp (nano)|USER_DEBUG|[lineNumber]|LEVEL|message
      const parts = line.split("|USER_DEBUG|");
      if (parts.length > 1) {
        const detail = parts[1]; // e.g. [4]|DEBUG|Total Active Users: 14
        const subParts = detail.split("|");
        const lineNum = subParts[0] || "[?]";
        const msg = subParts.slice(2).join("|") || subParts[1] || "";
        userDebugStatements.push(`${lineNum}  ${msg}`);
      }
    } else if (line.includes("EXCEPTION_THROWN") || line.includes("FATAL_ERROR")) {
      userDebugStatements.push(`⚠️  ${line}`);
    }
  });

  if (userDebugStatements.length === 0) {
    logOutput.textContent = `=== NO USER_DEBUG STATEMENTS FOUND IN EXECUTION LOG ===\n(Displaying full log below)\n\n` + rawLogContent;
  } else {
    logOutput.textContent = `=== USER_DEBUG STATEMENTS (${userDebugStatements.length} captured) ===\n\n` + userDebugStatements.join("\n");
  }
}

function renderGovernorLimits(log) {
  const limitsContainer = document.getElementById("limits-container");
  const limitsGrid = document.getElementById("limits-grid");

  // Regex parser for Salesforce cumulative limits block
  const parseLimit = (nameRegex) => {
    const match = log.match(new RegExp(nameRegex + ":\\s*(\\d+)\\s*out of\\s*(\\d+)", "i"));
    if (match) {
      const used = parseInt(match[1], 10);
      const max = parseInt(match[2], 10);
      return { used, max, pct: max > 0 ? Math.round((used / max) * 100) : 0 };
    }
    return null;
  };

  const limits = [
    { label: "SOQL Queries", data: parseLimit("Number of SOQL queries") },
    { label: "Query Rows", data: parseLimit("Number of query rows") },
    { label: "DML Statements", data: parseLimit("Number of DML statements") },
    { label: "DML Rows", data: parseLimit("Number of DML rows") },
    { label: "Maximum CPU Time", data: parseLimit("Maximum CPU time"), unit: "ms" },
    { label: "Maximum Heap Size", data: parseLimit("Maximum heap size"), unit: "bytes" }
  ];

  const hasAnyLimits = limits.some(l => l.data !== null);
  if (!hasAnyLimits) {
    limitsContainer.style.display = "none";
    return;
  }

  limitsContainer.style.display = "block";
  limitsGrid.innerHTML = limits.map(l => {
    if (!l.data) return "";
    let color = "#16a34a"; // green
    if (l.data.pct >= 60) color = "#d97706"; // orange
    if (l.data.pct >= 85) color = "#dc2626"; // red

    const formattedUsed = l.unit === "bytes" ? (l.data.used / 1024).toFixed(1) + " KB" : l.data.used.toLocaleString();
    const formattedMax = l.unit === "bytes" ? (l.data.max / (1024 * 1024)).toFixed(0) + " MB" : l.data.max.toLocaleString();

    return `
      <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:6px; padding:10px;">
        <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
          <strong style="color:var(--text-main);">${l.label}</strong>
          <span style="font-weight:600; color:${color};">${formattedUsed} / ${formattedMax} (${l.data.pct}%)</span>
        </div>
        <div style="width:100%; height:6px; background:#f1f5f9; border-radius:3px; overflow:hidden;">
          <div style="width:${Math.min(l.data.pct, 100)}%; height:100%; background:${color};"></div>
        </div>
      </div>
    `;
  }).join("");
}

function copyDebugLog() {
  const content = document.getElementById("log-output").textContent;
  copyToClipboardFallback(content, document.getElementById("btn-copy-log"), "✓ Copied!");
}

function downloadDebugLog() {
  if (!rawLogContent) return;
  const blob = new Blob([rawLogContent], { type: "text/plain;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `apex-execution-${Date.now()}.log`;
  a.click();
  URL.revokeObjectURL(url);
}

function copyToClipboardFallback(text, btnEl, successMsg) {
  const origText = btnEl.textContent;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    document.execCommand("copy");
    btnEl.textContent = successMsg;
    setTimeout(() => { btnEl.textContent = origText; }, 2000);
  } catch (err) {
    alert("Copy failed.");
  } finally {
    document.body.removeChild(textarea);
  }
}

function saveToHistory(code) {
  apexHistory = [code, ...apexHistory.filter(c => c !== code)].slice(0, 20);
  localStorage.setItem(`sfpi_apex_history_${sfHost}`, JSON.stringify(apexHistory));
  renderHistoryDropdown();
}

function renderHistoryDropdown() {
  const select = document.getElementById("select-history");
  if (apexHistory.length === 0) {
    select.innerHTML = `<option value="">Recent Scripts...</option>`;
    return;
  }

  select.innerHTML = `<option value="">Recent Scripts (${apexHistory.length})...</option>` +
    apexHistory.map((code, idx) => {
      const firstLine = code.split("\n")[0].slice(0, 30) || `Script #${idx + 1}`;
      return `<option value="${encodeURIComponent(code)}">${idx + 1}. ${firstLine}</option>`;
    }).join("");
}

init();
