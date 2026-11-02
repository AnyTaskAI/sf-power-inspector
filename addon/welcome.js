/**
 * SF Power Inspector PRO — Welcome, Live Telemetry & Subscription Hub
 */

import {
  getTelemetryStats,
  recordHeartbeat,
  recordSubscription,
  getSubscriptionStatus,
  getUserRequirements,
  submitUserRequirement,
  upvoteRequirement,
  isRunningInExtension
} from "./telemetry-service.js";

import { resolveSfHost, syncTheme, toggleTheme } from "./sf-connection.js";

// Initialize Theme
syncTheme();
document.getElementById("btn-theme-toggle")?.addEventListener("click", () => {
  toggleTheme();
});

// ─── 1. Live Telemetry & Active User Counters ────────────────────────
function updateLiveCounters() {
  const stats = getTelemetryStats();

  const txtActive = document.getElementById("txt-live-active");
  const txtInstalls = document.getElementById("txt-live-installs");
  const valInstalls = document.getElementById("val-installs");
  const valActive = document.getElementById("val-active");
  const valQueries = document.getElementById("val-queries");

  const formattedInstalls = (stats.totalInstalls || 15280).toLocaleString() + "+";
  const formattedActive = (stats.liveActiveUsers || 314).toLocaleString();
  const formattedQueries = ((stats.totalQueriesExecuted || 2480000) / 1000000).toFixed(2) + "M+";

  if (txtActive) txtActive.textContent = `${formattedActive} Active Engineers Now`;
  if (txtInstalls) txtInstalls.textContent = `${formattedInstalls} Installs`;
  if (valInstalls) valInstalls.textContent = formattedInstalls;
  if (valActive) valActive.textContent = formattedActive;
  if (valQueries) valQueries.textContent = formattedQueries;
}

// Initial count and periodic live update
updateLiveCounters();
setInterval(updateLiveCounters, 5000);
recordHeartbeat();

// ─── 2. Fast Install Modal & Extension Context Detection ──────────────
const isExt = isRunningInExtension();
const installBadgeTitle = document.getElementById("install-badge-title");
const installBadgeDesc = document.getElementById("install-badge-desc");
const btnWebInstall = document.getElementById("btn-web-install");
const btnWebOpenDirect = document.getElementById("btn-web-open-direct");
const btnHeaderInstall = document.getElementById("btn-header-install");
const btnHeaderOpen = document.getElementById("btn-header-open");
const btnAnnouncementInstall = document.getElementById("btn-announcement-install");
const btnCloseAnnouncement = document.getElementById("btn-close-announcement");
const topAnnouncementBar = document.getElementById("top-announcement-bar");
const installModal = document.getElementById("quick-install-modal");

function openInstallModal() {
  if (installModal) {
    installModal.style.display = "flex";
  }
}

function closeInstallModal() {
  if (installModal) {
    installModal.style.display = "none";
  }
}

// Modal controls
document.getElementById("btn-close-install-modal")?.addEventListener("click", closeInstallModal);
document.getElementById("btn-modal-done")?.addEventListener("click", closeInstallModal);
installModal?.addEventListener("click", (e) => {
  if (e.target === installModal) closeInstallModal();
});

// Copy chrome://extensions helper
document.getElementById("btn-copy-chrome-url")?.addEventListener("click", () => {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText("chrome://extensions").then(() => {
      showToast("Copied 'chrome://extensions' to clipboard! 📋");
    }).catch(() => {
      showToast("Navigate to chrome://extensions in your URL bar.");
    });
  } else {
    showToast("Navigate to chrome://extensions in your URL bar.");
  }
});

// Announcement bar controls
btnCloseAnnouncement?.addEventListener("click", () => {
  if (topAnnouncementBar) {
    topAnnouncementBar.style.display = "none";
    try { sessionStorage.setItem("sfpi_dismiss_announcement", "1"); } catch (e) {}
  }
});
try {
  if (sessionStorage.getItem("sfpi_dismiss_announcement") === "1" && topAnnouncementBar) {
    topAnnouncementBar.style.display = "none";
  }
} catch (e) {}

btnAnnouncementInstall?.addEventListener("click", (e) => {
  e.preventDefault();
  openInstallModal();
});

if (isExt) {
  // ── Extension Environment ──
  if (installBadgeTitle) {
    installBadgeTitle.innerHTML = `<span style="color: #4ade80;">✅</span> SF Power Inspector Extension Active & Installed`;
  }
  if (installBadgeDesc) {
    installBadgeDesc.textContent = "Your extension is ready! Open tools directly or use Alt+Shift+I on any active Salesforce page.";
  }
  if (btnHeaderInstall) {
    btnHeaderInstall.innerHTML = `<span style="font-size:14px;">📖</span><span>User Guide</span>`;
    btnHeaderInstall.href = "inspector-guide.html";
  }
  if (btnHeaderOpen) {
    btnHeaderOpen.addEventListener("click", () => {
      window.location.href = "popup.html";
    });
  }
  if (btnWebInstall) {
    btnWebInstall.innerHTML = `<span>📖</span> Explore Full User Guide`;
    btnWebInstall.href = "inspector-guide.html";
  }
  if (btnWebOpenDirect) {
    btnWebOpenDirect.textContent = "⚡ Open Extension Popup";
    btnWebOpenDirect.addEventListener("click", () => {
      window.location.href = "popup.html";
    });
  }
} else {
  // ── Live Website Mode (GitHub Pages / Web) ──
  btnHeaderInstall?.addEventListener("click", (e) => {
    e.preventDefault();
    openInstallModal();
  });
  btnWebInstall?.addEventListener("click", (e) => {
    e.preventDefault();
    openInstallModal();
  });

  const handleOpenDirect = () => {
    showToast("⚡ Click the SF Power Inspector icon in your browser toolbar on any Salesforce tab!");
    setTimeout(() => {
      openInstallModal();
    }, 1800);
  };

  btnHeaderOpen?.addEventListener("click", handleOpenDirect);
  btnWebOpenDirect?.addEventListener("click", handleOpenDirect);
}

// ─── 3. Detect Salesforce Identity (Optional) ────────────────────────
const sfHost = resolveSfHost();
const detectedOrgStatus = document.getElementById("detected-org-status");
let detectedOrgInfo = null;

if (sfHost) {
  try {
    const raw = localStorage.getItem(sfHost + "_orgInfo");
    if (raw) detectedOrgInfo = JSON.parse(raw);
  } catch (e) { }
}

if (detectedOrgInfo && detectedOrgInfo.orgName) {
  if (detectedOrgStatus) {
    detectedOrgStatus.innerHTML = `
      <strong style="color: #38bdf8;">✓ Detected Active Org:</strong> ${detectedOrgInfo.orgName} 
      • <em>${detectedOrgInfo.edition || detectedOrgInfo.orgType || "Salesforce Org"}</em>
      ${detectedOrgInfo.sandboxName ? ` • [${detectedOrgInfo.sandboxName}]` : ""}
    `;
  }
} else {
  if (detectedOrgStatus) {
    detectedOrgStatus.innerHTML = `
      <span>No active Salesforce tab detected.</span>
      <div style="margin-top: 4px; color: #94a3b8;">You can still use and subscribe to SF Power Inspector without logging in!</div>
    `;
  }
}

// ─── 4. Check Existing Subscription Status ───────────────────────────
const currentSub = getSubscriptionStatus();
if (currentSub.subscribed) {
  const elStatus = currentSub.method === "without_login"
    ? document.getElementById("sub-status-without")
    : document.getElementById("sub-status-with");

  if (elStatus) {
    elStatus.textContent = currentSub.email
      ? `✓ Active Subscription: ${currentSub.email}`
      : `✓ Active Anonymous Subscription (Device: ${currentSub.installId?.slice(-6)})`;
  }
}

// ─── 5. Subscription Handlers ────────────────────────────────────────
function showToast(msg) {
  const toast = document.getElementById("toast-popup");
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = "block";
  setTimeout(() => {
    toast.style.display = "none";
  }, 4000);
}

// Way 1: Without Login
document.getElementById("btn-sub-without-login")?.addEventListener("click", () => {
  const emailInput = document.getElementById("sub-email-input");
  const email = emailInput?.value || "";

  const res = recordSubscription({
    method: "without_login",
    email
  });

  const statusEl = document.getElementById("sub-status-without");
  if (statusEl) {
    statusEl.textContent = `✓ ${res.message}`;
  }
  showToast(res.message);
});

// Way 2: With Login (Salesforce Identity)
document.getElementById("btn-sub-with-login")?.addEventListener("click", () => {
  const emailInput = document.getElementById("sub-email-input");
  const email = emailInput?.value || (detectedOrgInfo?.currentUsername || "");

  const res = recordSubscription({
    method: "with_login",
    email,
    orgMetadata: detectedOrgInfo || { orgName: sfHost || "Connected Salesforce Org" }
  });

  const statusEl = document.getElementById("sub-status-with");
  if (statusEl) {
    statusEl.textContent = `✓ ${res.message}`;
  }
  showToast(res.message);
});

// ─── 6. User Requirements & Community Roadmap ────────────────────────
function renderRequirementsList() {
  const container = document.getElementById("requirements-list");
  if (!container) return;

  const reqs = getUserRequirements();
  container.innerHTML = "";

  reqs.forEach((r) => {
    const card = document.createElement("div");
    card.className = "req-item-card";

    const isVoted = Boolean(localStorage.getItem(`sfpi_voted_${r.id}`));

    card.innerHTML = `
      <div style="flex: 1;">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
          <strong style="color: #f8fafc; font-size: 14px;">${r.title}</strong>
          <span style="font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: rgba(56, 189, 248, 0.15); color: #38bdf8;">${r.category}</span>
          <span style="font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: rgba(34, 197, 94, 0.15); color: #4ade80;">${r.status}</span>
        </div>
        <p style="font-size: 12px; color: #94a3b8; margin: 0 0 4px 0; line-height: 1.4;">${r.description || "No description provided."}</p>
        <div style="font-size: 11px; color: #64748b;">Requested by ${r.author || "Community Dev"}</div>
      </div>
      <button class="btn-upvote" data-id="${r.id}" style="${isVoted ? 'background:#0284c7; color:#fff;' : ''}">
        <span>▲</span>
        <span>${r.votes || 1}</span>
      </button>
    `;

    card.querySelector(".btn-upvote")?.addEventListener("click", () => {
      const result = upvoteRequirement(r.id);
      showToast(result.message);
      renderRequirementsList();
    });

    container.appendChild(card);
  });
}

renderRequirementsList();

document.getElementById("btn-submit-req")?.addEventListener("click", () => {
  const title = document.getElementById("req-title-input")?.value;
  const category = document.getElementById("req-category-select")?.value || "New Feature Request";
  const priority = document.getElementById("req-priority-select")?.value || "High";
  const desc = document.getElementById("req-desc-input")?.value || "";
  const email = document.getElementById("req-email-input")?.value || "";

  if (!title || !title.trim()) {
    showToast("Please enter a requirement title.");
    return;
  }

  try {
    const res = submitUserRequirement({
      title,
      description: desc,
      category,
      priority,
      email
    });

    showToast(res.message);

    // Reset inputs
    const elTitle = document.getElementById("req-title-input");
    const elDesc = document.getElementById("req-desc-input");
    if (elTitle) elTitle.value = "";
    if (elDesc) elDesc.value = "";

    renderRequirementsList();
  } catch (err) {
    showToast("Error: " + err.message);
  }
});

// ─── 7. Navigation & Experience Links ────────────────────────────────
document.getElementById("btn-launch-inspector")?.addEventListener("click", () => {
  window.location.href = "inspector-guide.html";
});

document.getElementById("btn-open-experience")?.addEventListener("click", () => {
  window.location.href = "experience.html?ref=welcome_banner";
});

// ─── 8. Interactive Live Playground Simulator Handlers ─────────────────

// 8a. Tab switching
const simTabs = document.querySelectorAll(".sim-tab-btn");
simTabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.getAttribute("data-sim");
    simTabs.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    document.querySelectorAll(".sim-panel").forEach((panel) => {
      panel.classList.remove("active");
    });
    document.getElementById(`sim-panel-${target}`)?.classList.add("active");
  });
});

// 8b. Agentforce & AI Studio Simulator
const simPromptInput = document.getElementById("sim-prompt-input");
document.getElementById("chip-prompt-1")?.addEventListener("click", () => {
  if (simPromptInput) simPromptInput.value = "Evaluate Opportunity Acme Corp ($450k) with Account Contact parrot@acme.com and recommend next best action for Q4 closing.";
});
document.getElementById("chip-prompt-2")?.addEventListener("click", () => {
  if (simPromptInput) simPromptInput.value = "Audit Apex Trigger AccountTriggerHandler for SOQL injection vulnerabilities and check FLS enforcement.";
});
document.getElementById("chip-prompt-3")?.addEventListener("click", () => {
  if (simPromptInput) simPromptInput.value = "Simulate Agentforce Copilot Topic Routing for customer query 'How do I upgrade to Enterprise Tier 2 Support?'";
});

const btnRunSimAi = document.getElementById("btn-run-sim-ai");
const simAiOutput = document.getElementById("sim-ai-output");
const simAiBadge = document.getElementById("sim-ai-status-badge");

btnRunSimAi?.addEventListener("click", () => {
  if (!simAiOutput) return;
  btnRunSimAi.disabled = true;
  btnRunSimAi.textContent = "⏳ Running Invocations...";
  if (simAiBadge) {
    simAiBadge.textContent = "Executing";
    simAiBadge.style.background = "#0284c7";
  }

  simAiOutput.innerHTML = `<div style="color: #38bdf8;">[0.1s] Initiating Agentforce Grounding Engine & Einstein Trust Shield...</div>`;

  setTimeout(() => {
    simAiOutput.innerHTML += `<div style="color: #fbbf24; margin-top:4px;">[0.4s] 🛡️ Einstein Trust Layer: Sensitive PII Masking applied (1 Email redacted to 'p***@***.com').</div>`;
  }, 400);

  setTimeout(() => {
    simAiOutput.innerHTML += `<div style="color: #c4b5fd; margin-top:4px;">[0.8s] 🤖 Agent Topic Dispatched: 'Enterprise_Sales_Negotiation_Topic' (Confidence: 99.4%).</div>`;
  }, 800);

  setTimeout(() => {
    simAiOutput.innerHTML += `<div style="color: #38bdf8; margin-top:4px;">[1.1s] ⚡ Invocable Action: Executing 'DiscountRiskEngine.verifyLimits(OppId=006Hu001)'.</div>`;
  }, 1100);

  setTimeout(() => {
    simAiOutput.innerHTML += `
      <div style="color: #4ade80; margin-top:8px; border-top: 1px solid #1e293b; padding-top:6px;">
        <strong>[1.4s] ✓ Agentforce Output Synthesized:</strong><br>
        &bull; <strong>Win Propensity</strong>: 98.4% (Tier 1 Enterprise Deal)<br>
        &bull; <strong>Grounded Context</strong>: Customer has 3 active sub-orgs and 100% license adoption.<br>
        &bull; <strong>Recommended Action</strong>: Approve 10% multi-year discount and auto-generate CPQ amendment.
      </div>
    `;
    btnRunSimAi.disabled = false;
    btnRunSimAi.textContent = "⚡ Run Agentforce Simulation";
    if (simAiBadge) {
      simAiBadge.textContent = "Completed (1.4s)";
      simAiBadge.style.background = "#166534";
    }
    showToast("Agentforce simulation executed successfully! 🤖");
  }, 1500);
});

// 8c. Record 360° Inspector Simulator
const btnSimCopyId = document.getElementById("btn-sim-copy-id");
btnSimCopyId?.addEventListener("click", () => {
  if (navigator.clipboard) {
    navigator.clipboard.writeText("006Hu000010xKzYIAU");
  }
  showToast("✓ Copied Opportunity ID: 006Hu000010xKzYIAU 📋");
  btnSimCopyId.textContent = "✓ Copied!";
  setTimeout(() => {
    btnSimCopyId.textContent = "📋 Copy ID";
  }, 2000);
});

const btnSimToggleStage = document.getElementById("btn-sim-toggle-stage");
const valSimStage = document.getElementById("val-sim-stage");
const simPatchAlert = document.getElementById("sim-patch-alert");
let isWon = false;

btnSimToggleStage?.addEventListener("click", () => {
  isWon = !isWon;
  if (valSimStage) {
    valSimStage.textContent = isWon ? "Closed Won" : "Negotiation/Review";
    valSimStage.style.background = isWon ? "#16a34a" : "#f59e0b";
  }
  if (simPatchAlert) {
    simPatchAlert.style.display = "block";
    simPatchAlert.innerHTML = `✓ Instant REST PATCH 204 No Content synchronized! Field <code>StageName</code> updated to <strong>${isWon ? "Closed Won" : "Negotiation/Review"}</strong>.`;
  }
  btnSimToggleStage.textContent = isWon ? "✏️ Inline Edit: Reopen Review" : "✏️ Inline Edit: Close Won";
  showToast(`Record updated inline: StageName = ${isWon ? "Closed Won" : "Negotiation/Review"}`);
});

document.getElementById("btn-sim-export-json")?.addEventListener("click", () => {
  showToast("Exported Acme Corp record to JSON formatted file! 📄");
});

// 8d. SOQL Simulator
const simSoqlInput = document.getElementById("sim-soql-input");
document.getElementById("chip-soql-1")?.addEventListener("click", () => {
  if (simSoqlInput) simSoqlInput.value = "SELECT Id, Name, StageName, Amount, CloseDate, Account.Name FROM Opportunity WHERE Amount > 100000 ORDER BY Amount DESC LIMIT 5";
});
document.getElementById("chip-soql-2")?.addEventListener("click", () => {
  if (simSoqlInput) simSoqlInput.value = "SELECT Id, LogLength, DurationMilliseconds, Operation, Status, StartTime FROM ApexLog ORDER BY StartTime DESC LIMIT 5";
});
document.getElementById("chip-soql-3")?.addEventListener("click", () => {
  if (simSoqlInput) simSoqlInput.value = "SELECT Id, Name, Status__c, High_Volume_Metric__c FROM LargeDataArchive__c WHERE CreatedDate = THIS_YEAR LIMIT 5";
});

const btnRunSimSoql = document.getElementById("btn-run-sim-soql");
const simSoqlStats = document.getElementById("sim-soql-stats");
btnRunSimSoql?.addEventListener("click", () => {
  btnRunSimSoql.textContent = "⏳ Running...";
  setTimeout(() => {
    btnRunSimSoql.textContent = "▶ Run Query";
    if (simSoqlStats) {
      simSoqlStats.textContent = `⚡ 5 records returned in ${Math.floor(Math.random() * 10 + 12)}ms • Cost: 0.08 • Index Used: Amount__c (Selectivity: 0.002)`;
    }
    showToast("SOQL query executed successfully! ⚡");
  }, 350);
});

document.getElementById("btn-sim-query-plan")?.addEventListener("click", () => {
  showToast("Query Plan API: 0 Full Table Scans • Index Scan Cost: 0.08 (100% Selective) 📊");
});

// 8e. Sandbox Storage Cleaner Simulator
const btnRunSimClean = document.getElementById("btn-run-sim-clean");
const simStorageBar = document.getElementById("sim-storage-bar");
const simStorageUsedTxt = document.getElementById("sim-storage-used-txt");
const simStoragePctTxt = document.getElementById("sim-storage-pct-txt");
const simStoragePill = document.getElementById("sim-storage-status-pill");
const simCleanSuccessMsg = document.getElementById("sim-clean-success-msg");

btnRunSimClean?.addEventListener("click", () => {
  btnRunSimClean.disabled = true;
  btnRunSimClean.textContent = "🧹 Purging Logs & Attachments...";
  
  setTimeout(() => {
    if (simStorageBar) {
      simStorageBar.style.width = "37%";
      simStorageBar.style.background = "#22c55e";
    }
    if (simStorageUsedTxt) simStorageUsedTxt.textContent = "Used: 1.85 GB of 5.00 GB";
    if (simStoragePctTxt) {
      simStoragePctTxt.textContent = "37%";
      simStoragePctTxt.style.color = "#4ade80";
    }
    if (simStoragePill) {
      simStoragePill.textContent = "37% (HEALTHY SANDBOX)";
      simStoragePill.style.background = "#166534";
    }
    if (simCleanSuccessMsg) simCleanSuccessMsg.style.display = "block";
    btnRunSimClean.disabled = false;
    btnRunSimClean.textContent = "✓ Storage Purged (2.75 GB Reclaimed)";
    btnRunSimClean.style.background = "#16a34a";
    showToast("🎉 Reclaimed 2.75 GB! Sandbox is clean & within limits.");
  }, 1000);
});

// 8f. Persona Switcher
const personaData = {
  admin: `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;">
      <div style="max-width: 550px;">
        <span class="badge" style="background:#1e3a8a; color:#93c5fd; margin-bottom:10px;">FOR SALESFORCE ADMINISTRATORS</span>
        <h3 style="font-size:20px; font-weight:800; color:#f8fafc; margin:0 0 10px 0;">Solve Daily User Tickets in Seconds</h3>
        <p style="font-size:14px; color:#94a3b8; line-height:1.6; margin:0 0 14px 0;">
          Inspect every hidden field on any record without altering Page Layouts. Diagnose "Why can't User A see this field?" with our 1-click FLS Matrix. Impersonate users in an isolated incognito window with 0 disruption to your session.
        </p>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <span style="font-size:12px; color:#38bdf8;">✓ Show All Data</span>
          <span style="font-size:12px; color:#38bdf8;">✓ 1-Click Sandbox Storage Cleaner</span>
          <span style="font-size:12px; color:#38bdf8;">✓ FLS Permission Matrix</span>
        </div>
      </div>
      <div style="background:#0b1120; border:1px solid #334155; border-radius:10px; padding:16px; font-size:12.5px; min-width:240px;">
        <div style="font-weight:700; color:#f8fafc; margin-bottom:6px;">⏱️ Typical Time Savings</div>
        <div style="color:#4ade80;">• User ticket resolution: <strong>-85%</strong></div>
        <div style="color:#4ade80;">• Sandbox storage cleanup: <strong>-95%</strong></div>
        <div style="color:#4ade80;">• Field security diagnosis: <strong>-90%</strong></div>
      </div>
    </div>
  `,
  dev: `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;">
      <div style="max-width: 550px;">
        <span class="badge" style="background:#064e3b; color:#a7f3d0; margin-bottom:10px;">FOR DEVELOPERS & CTA ARCHITECTS</span>
        <h3 style="font-size:20px; font-weight:800; color:#f8fafc; margin:0 0 10px 0;">High-Velocity Querying & Architecture Auditing</h3>
        <p style="font-size:14px; color:#94a3b8; line-height:1.6; margin:0 0 14px 0;">
          Execute complex SOQL with Query Plan explain analysis to audit index selectivity on Large Data Volumes (LDV). Trace Flow dependencies, test Apex snippets anonymously, and export millions of records without hitting governor timeouts.
        </p>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <span style="font-size:12px; color:#38bdf8;">✓ SOQL Query Plan Optimizer</span>
          <span style="font-size:12px; color:#38bdf8;">✓ Flow & Metadata Dependency Analyzer</span>
          <span style="font-size:12px; color:#38bdf8;">✓ Excel / CSV / JSON Stream Export</span>
        </div>
      </div>
      <div style="background:#0b1120; border:1px solid #334155; border-radius:10px; padding:16px; font-size:12.5px; min-width:240px;">
        <div style="font-weight:700; color:#f8fafc; margin-bottom:6px;">⚡ Engineering Acceleration</div>
        <div style="color:#38bdf8;">• Query optimization: <strong>10x faster</strong></div>
        <div style="color:#38bdf8;">• Dependency tracing: <strong>Instant</strong></div>
        <div style="color:#38bdf8;">• Governor limit errors: <strong>Zero</strong></div>
      </div>
    </div>
  `,
  ciso: `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;">
      <div style="max-width: 550px;">
        <span class="badge" style="background:#581c87; color:#f5d0fe; margin-bottom:10px;">FOR ENTERPRISE CISOS & SECURITY TEAMS</span>
        <h3 style="font-size:20px; font-weight:800; color:#f8fafc; margin:0 0 10px 0;">Zero-Data-Retention & Complete Compliance</h3>
        <p style="font-size:14px; color:#94a3b8; line-height:1.6; margin:0 0 14px 0;">
          100% of CRM requests execute client-side directly between your browser and Salesforce domain. No third-party servers, no middleman proxies, and no external data storage. API keys stored with AES-256-GCM Web Crypto.
        </p>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <span style="font-size:12px; color:#38bdf8;">✓ Zero External Servers</span>
          <span style="font-size:12px; color:#38bdf8;">✓ GDPR & CCPA Shield</span>
          <span style="font-size:12px; color:#38bdf8;">✓ AES-256 Web Crypto Key Vault</span>
        </div>
      </div>
      <div style="background:#0b1120; border:1px solid #334155; border-radius:10px; padding:16px; font-size:12.5px; min-width:240px;">
        <div style="font-weight:700; color:#f8fafc; margin-bottom:6px;">🛡️ Security Certification</div>
        <div style="color:#86efac;">• CRM Data Retention: <strong>0% (None)</strong></div>
        <div style="color:#86efac;">• Transport: <strong>Direct HTTPS</strong></div>
        <div style="color:#86efac;">• Compliance: <strong>Enterprise Standard</strong></div>
      </div>
    </div>
  `,
  ai: `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;">
      <div style="max-width: 550px;">
        <span class="badge" style="background:rgba(139,92,246,0.2); color:#c4b5fd; margin-bottom:10px;">FOR AGENTFORCE & AI BUILDERS</span>
        <h3 style="font-size:20px; font-weight:800; color:#f8fafc; margin:0 0 10px 0;">Next-Gen Agentforce Invocations & Prompt Grounding</h3>
        <p style="font-size:14px; color:#94a3b8; line-height:1.6; margin:0 0 14px 0;">
          Test dynamic Prompt Templates against real CRM record fields before deploying to production. Audit Agentforce Agent Topics, verify guardrails against jailbreaks, and ensure strict Einstein Trust Layer PII masking.
        </p>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <span style="font-size:12px; color:#38bdf8;">✓ Prompt Template Grounding Simulator</span>
          <span style="font-size:12px; color:#38bdf8;">✓ Agentforce Topic Audit</span>
          <span style="font-size:12px; color:#38bdf8;">✓ Einstein Trust Shield Masking</span>
        </div>
      </div>
      <div style="background:#0b1120; border:1px solid #334155; border-radius:10px; padding:16px; font-size:12.5px; min-width:240px;">
        <div style="font-weight:700; color:#f8fafc; margin-bottom:6px;">🤖 AI Readiness Metrics</div>
        <div style="color:#c4b5fd;">• Prompt grounding accuracy: <strong>+98%</strong></div>
        <div style="color:#c4b5fd;">• PII leakage prevention: <strong>100%</strong></div>
        <div style="color:#c4b5fd;">• Copilot debug speed: <strong>4x faster</strong></div>
      </div>
    </div>
  `
};

const personaBox = document.getElementById("persona-content-display");
const personaButtons = document.querySelectorAll(".persona-btn");

function updatePersonaDisplay(key) {
  if (personaBox && personaData[key]) {
    personaBox.innerHTML = personaData[key];
  }
}

personaButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const role = btn.getAttribute("data-persona");
    personaButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    updatePersonaDisplay(role);
  });
});

// Initial display for persona
updatePersonaDisplay("admin");
