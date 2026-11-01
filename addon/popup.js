/**
 * SF Power Inspector — Main Popup Controller
 * Pure vanilla JS — no React dependency required.
 */

import { sfConn, apiVersion, extractSandboxDetails, getOrgEnvironmentDetails, extensionVersion, resolveSfHost, isExcludedSfHost } from "./sf-connection.js";
import { recordHeartbeat, isExperienceDue } from "./telemetry-service.js";

// Apply saved theme immediately to prevent light-theme flash
const savedTheme = localStorage.getItem("sfpi_theme") || "light";
document.documentElement.setAttribute("data-theme", savedTheme);

const app = document.getElementById("app");
let sfHost = resolveSfHost();
let orgInfo = null;
let currentRecordId = null;
let showingApiNames = false;

// ─── State for Tabs & User Management ──────────────────────────────
let activeTab = "objects"; // "objects" (default), "users", or "org"
let allUsers = [];
let selectedUser = null;
let excludeInactive = localStorage.getItem("sfpi_exclude_inactive") !== "false";
let cachedUserLanguages = null;
let cachedUserLocales = null;
let traceFlagEnabledUsers = new Set();
let activeDropdownIndex = -1;

// ─── State for Org Tab ──────────────────────────────────────────────
let orgExtendedData = null;
let orgLimitsData = null;
let orgTrustData = null;
let isEditingOrgDetails = false;

// ─── Initialize ─────────────────────────────────────────────────────
async function init() {
  if (!sfHost || isExcludedSfHost(sfHost)) {
    app.innerHTML = `<div class="sfpi-error" style="padding:20px; text-align:center; color:var(--sfpi-text-muted);">Please open SF Power Inspector from an active Salesforce org tab.</div>`;
    return;
  }

  // Pre-load preliminary info from hostname so initial render is instantaneous
  orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
  const preliminary = extractSandboxDetails(sfHost, orgInfo);
  if (!orgInfo.isSandbox && preliminary.isSandbox) {
    orgInfo.isSandbox = true;
    orgInfo.sandboxName = preliminary.sandboxName;
  }

  // Load cached users immediately for 0ms user search responsiveness
  loadCachedUsers();
  recordHeartbeat();

  // Load cached extended org data immediately for 0ms org tab responsiveness
  try {
    const cachedExt = localStorage.getItem(sfHost + "_orgExtended");
    if (cachedExt) orgExtendedData = JSON.parse(cachedExt);
    const cachedLim = localStorage.getItem(sfHost + "_orgLimits");
    if (cachedLim) orgLimitsData = JSON.parse(cachedLim);
  } catch (e) {}

  render();

  // Request immediate context from parent content script if embedded in iframe
  try {
    parent.postMessage({ sfpiGetContext: true }, "*");
  } catch (e) {}

  try {
    await sfConn.getSession(sfHost);
    orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
    render();

    // Background fetch fresh users for instant local filtering only when authenticated
    if (sfConn.sessionId && !isExcludedSfHost(sfHost)) {
      fetchAndCacheUsers();
    }
  } catch (err) {
    // Non-fatal session restore fallback
  }
}

// ─── User Cache Management ──────────────────────────────────────────
function loadCachedUsers() {
  try {
    const raw = localStorage.getItem(sfHost + "_users_cache");
    if (raw) {
      allUsers = JSON.parse(raw);
      if (!selectedUser && allUsers.length > 0) {
        // Pick current user if known, else first active user
        const currentUserId = orgInfo?.userId;
        selectedUser = (currentUserId && allUsers.find(u => u.Id === currentUserId)) || allUsers.find(u => u.IsActive) || allUsers[0];
      }
    }
  } catch (e) {
    // Cache loading fallback
  }
}

async function fetchAndCacheUsers() {
  if (!sfConn.sessionId || !sfHost || isExcludedSfHost(sfHost)) {
    return;
  }

  try {
    const q = "SELECT Id, Name, Email, Username, UserRole.Name, Alias, LocaleSidKey, LanguageLocaleKey, IsActive, ProfileId, Profile.Name, UserPreferencesUserDebugModePref, (SELECT Id, IsFrozen FROM UserLogins LIMIT 1) FROM User ORDER BY IsActive DESC, LastLoginDate DESC NULLS LAST LIMIT 500";
    const res = await sfConn.query(q, false, { logErrors: false });
    if (res?.records?.length > 0) {
      allUsers = res.records;
      localStorage.setItem(sfHost + "_users_cache", JSON.stringify(allUsers));
      
      // If no selected user or selected user was temporary, update with rich record
      if (!selectedUser || (selectedUser && !selectedUser.Profile)) {
        const currentUserId = orgInfo?.userId;
        selectedUser = (currentUserId && allUsers.find(u => u.Id === currentUserId)) || allUsers.find(u => u.IsActive) || allUsers[0];
      } else {
        const refreshed = allUsers.find(u => u.Id === selectedUser.Id);
        if (refreshed) selectedUser = refreshed;
      }

      if (activeTab === "users") {
        updateSelectedUserCard();
      }
    }
  } catch (err) {
    const userCountStatus = document.getElementById("sfpi-user-count-status");
    if (userCountStatus) {
      userCountStatus.textContent = allUsers.length > 0 
        ? `${allUsers.length} users (cached)`
        : "Session expired / offline";
      userCountStatus.style.color = "var(--sfpi-warning, #f59e0b)";
    }
  }
}

// ─── Render Main UI ─────────────────────────────────────────────────
function render() {
  const details = getOrgEnvironmentDetails(sfHost, orgInfo);
  const { isSandbox, envType, environment, sandboxName, edition, companyName, instance } = details;

  let envBadge;
  let showEditionPill = true;

  if (isSandbox) {
    envBadge = `<span class="sfpi-badge sfpi-badge-sandbox" title="Environment: Sandbox (${sandboxName})">SANDBOX : ${sandboxName}</span>`;
  } else if (envType === "DEVELOPER EDITION") {
    envBadge = `<span class="sfpi-badge sfpi-badge-dev" title="Environment: Developer Edition Org">DEVELOPER EDITION</span>`;
    showEditionPill = false;
  } else if (envType === "SCRATCH ORG") {
    envBadge = `<span class="sfpi-badge sfpi-badge-scratch" title="Environment: Scratch Org">SCRATCH ORG</span>`;
    showEditionPill = false;
  } else if (envType === "TRIAL ORG") {
    envBadge = `<span class="sfpi-badge sfpi-badge-scratch" title="Environment: Trial Org">TRIAL ORG</span>`;
    showEditionPill = false;
  } else if (envType === "TRAILBLAZE ORG") {
    envBadge = `<span class="sfpi-badge sfpi-badge-dev" title="Environment: Trailhead Playground">PLAYGROUND</span>`;
    showEditionPill = false;
  } else {
    envBadge = `<span class="sfpi-badge sfpi-badge-prod" title="Environment: Production">PRODUCTION</span>`;
  }

  if (edition && (edition.toUpperCase() === envType || (envType === "DEVELOPER EDITION" && edition.toUpperCase().includes("DEVELOPER")))) {
    showEditionPill = false;
  }

  app.innerHTML = `
    <div class="sfpi-container">
      <!-- Pinned Org Header -->
      <div class="sfpi-header">
        <div class="sfpi-header-top">
          <h1 class="sfpi-title">⚡ SF Power Inspector</h1>
          <div style="display:flex; align-items:center; gap:8px;">
            <button id="btn-toggle-theme" style="background:none; border:none; cursor:pointer; font-size:15px;" title="Toggle Light / Dark Theme">🌓</button>
            <span class="sfpi-version" title="Release Version: ${extensionVersion}">${extensionVersion}</span>
          </div>
        </div>
        <div class="sfpi-org-info">
          ${envBadge}
          <span class="sfpi-org-name" title="Company / Org: ${companyName}">${companyName}</span>
          ${showEditionPill && edition ? `<span class="sfpi-badge sfpi-badge-edition" title="Edition: ${edition}">${edition}</span>` : ""}
        </div>
      </div>

      ${isExperienceDue() ? `
        <div class="sfpi-experience-banner" style="background: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; padding: 7px 12px; border-radius: 8px; margin: 8px 0; display: flex; align-items: center; justify-content: space-between; font-size: 11px;">
          <span style="color: #fbbf24; font-weight: 700;">⭐ 2 Hours with SF Power Inspector!</span>
          <a href="#" id="btn-banner-experience" style="color: #38bdf8; text-decoration: underline; font-weight: 600;">Share Experience & Review</a>
        </div>
      ` : ''}

      <!-- Tab Switcher (Objects by default | Users | Org) -->
      <div class="sfpi-tab-bar">
        <button class="sfpi-tab-btn ${activeTab === 'objects' ? 'active' : ''}" id="tab-btn-objects" data-tab="objects">📦 Objects</button>
        <button class="sfpi-tab-btn ${activeTab === 'users' ? 'active' : ''}" id="tab-btn-users" data-tab="users">👤 Users</button>
        <button class="sfpi-tab-btn ${activeTab === 'org' ? 'active' : ''}" id="tab-btn-org" data-tab="org">🏢 Org</button>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════ -->
      <!-- TAB PANE: OBJECTS (DEFAULT)                                     -->
      <!-- ═══════════════════════════════════════════════════════════════ -->
      <div class="sfpi-tab-pane" id="tab-pane-objects" style="${activeTab === 'objects' ? '' : 'display:none;'}">
        <!-- Quick Actions (Record Context) — ALWAYS on Objects Tab -->
        <div class="sfpi-section" id="record-section" style="display:none">
          <div class="sfpi-section-title">📋 Current Record Detected</div>
          <div class="sfpi-record-actions" id="record-actions"></div>
        </div>

        <!-- Search -->
        <div class="sfpi-search-container">
          <input type="text" id="sfpi-search" class="sfpi-search" placeholder="🔍 Search tools, objects, records..." autocomplete="off">
        </div>

        <!-- Quick Setup Links -->
        <div class="sfpi-section">
          <div class="sfpi-section-title">🔗 Quick Links</div>
          <div class="sfpi-quick-links">
            ${quickLink("Setup Home", "/lightning/setup/SetupOneHome/home")}
            ${quickLink("Agentforce Setup", "/lightning/setup/CopilotPlanner/home")}
            ${quickLink("Prompt Builder", "/lightning/setup/PromptBuilderTemplates/home")}
            ${quickLink("Object Manager", "/lightning/setup/ObjectManager/home")}
            ${quickLink("Permission Sets", "/lightning/setup/PermSets/home")}
            ${quickLink("Profiles", "/lightning/setup/EnhancedProfiles/home")}
            ${quickLink("Users", "/lightning/setup/ManageUsers/home")}
            ${quickLink("Dev Console", "/_ui/common/apex/debug/ApexCSIPage")}
            ${quickLink("Flows", "/lightning/setup/Flows/home")}
            ${quickLink("Debug Logs", "/lightning/setup/ApexDebugLogs/home")}
            ${quickLink("Deployment Status", "/lightning/setup/DeployStatus/home")}
          </div>
        </div>

        <!-- AI & Architecture Tools -->
        <div class="sfpi-section sfpi-section-ai">
          <div class="sfpi-section-title">🤖 Agentforce & AI Suite</div>
          <div class="sfpi-tools-grid">
            ${toolButton("agentforce-studio", "🤖", "Agentforce Studio", "Inspect Agentforce Agents, Einstein Copilots, Prompt Builder & Trust Layer")}
            ${toolButton("ai-analyzer", "🧠", "AI Security Hub", "Audit Apex, SOQL injection, FLS matrix, and code security")}
            ${toolButton("flow-analyzer", "🌊", "Flow Scanner", "Scan Flows for loops, hardcoded IDs & governor risks")}
          </div>
        </div>

        <!-- Data Tools -->
        <div class="sfpi-section">
          <div class="sfpi-section-title">📊 Data Tools</div>
          <div class="sfpi-tools-grid">
            ${toolButton("data-explorer", "📤", "Data Explorer", "SOQL / SOSL / GraphQL multi-tab query editor")}
            ${toolButton("inspect-record", "🔍", "Show All Data", "Inspect all fields, edit values, or browse any record")}
            ${toolButton("data-import", "📥", "Data Import", "Insert, Update, Upsert, Delete records in bulk")}
            ${toolButton("schema-viewer", "🗺️", "Schema Studio", "Salesforce-style Schema Builder, ERD & SOQL Generator")}
          </div>
        </div>

        <!-- Developer Tools -->
        <div class="sfpi-section">
          <div class="sfpi-section-title">🛠️ Developer Tools</div>
          <div class="sfpi-tools-grid">
            ${toolButton("changeset", "📦", "Change Set Studio", "Prepare, filter, deploy change sets & export package.xml")}
            ${toolButton("apex-runner", "⚡", "Apex Runner", "Execute anonymous Apex with compile & log output")}
            ${toolButton("rest-console", "🌐", "REST Console", "Execute any Salesforce REST API call (Postman-style)")}
            ${toolButton("debug-console", "📋", "Debug Logs", "View, filter, delete logs, and 1-click enable trace flags")}
            ${toolButton("event-monitor", "📡", "Event Monitor", "Subscribe to Platform Events and CDC")}
          </div>
        </div>

        <!-- Admin & Governance -->
        <div class="sfpi-section">
          <div class="sfpi-section-title">🔧 Admin & Governance</div>
          <div class="sfpi-tools-grid">
            ${toolButton("permission-analyzer", "🔐", "Permission Analyzer", "Why can or can't this user see this field or record? Diagnose FLS, OWD & Sharing")}
            ${toolButton("field-manager", "📝", "Field Manager", "Create custom fields with automatic FLS & Permission Sets")}
            ${toolButton("dependencies", "🔗", "Dependencies", "Metadata dependency & impact analysis (where is it used?)")}
            ${toolButton("object-scanner", "🔬", "Object 360° Studio", "Deep dive into object automations, triggers, validation rules & direct setup links")}
            ${toolButton("org-health", "❤️", "Org Health", "Security audit, deprecated API versions & admin check")}
          </div>
        </div>

        <!-- Org Limits & Metadata -->
        <div class="sfpi-section">
          <div class="sfpi-section-title">🏢 Org Limits & Metadata</div>
          <div class="sfpi-tools-grid">
            ${toolButton("org-limits", "📈", "Org Limits", "Real-time governor limits & API call quotas")}
            ${toolButton("storage-cleaner", "🧹", "Storage Cleaner", "Free up sandbox storage: clear Apex logs, custom logs, email attachments & files by date")}
            ${toolButton("metadata-browser", "📦", "Metadata", "Inspect metadata components count and catalog")}
            ${toolButton("options", "⚙️", "Settings", "Extension preferences, colors, and cache")}
          </div>
        </div>

        <!-- Documentation & Help Suite -->
        <div class="sfpi-section sfpi-section-learn">
          <div class="sfpi-section-title">📚 Documentation & Help Suite</div>
          <div class="sfpi-tools-grid">
            ${toolButton("inspector-guide", "📖", "Inspector Guide", "14 Tools Architecture, User Manual, Features, CRUD & Shortcuts")}
            ${toolButton("learning-hub", "🎓", "Trailhead Help & Learning", "Official Salesforce Tools, Instant 50+ Error Debugger, Certifications & Limits")}
          </div>
        </div>

        <!-- Org Dark Mode Toggle -->
        <div class="sfpi-section sfpi-section-darkmode">
          <div class="sfpi-section-title">🌑 Salesforce Org Dark Mode</div>
          <div class="sfpi-darkmode-controls">
            <label class="sfpi-toggle-switch" title="Enable dark mode for the entire Salesforce org in this browser">
              <input type="checkbox" id="toggle-org-darkmode">
              <span class="sfpi-toggle-slider"></span>
              <span class="sfpi-toggle-label" id="lbl-org-darkmode">Off</span>
            </label>
          </div>
        </div>

        <!-- Footer -->
        <div class="sfpi-footer">
          <a href="#" id="btn-api-version" title="Change API Version">API v${apiVersion}</a>
          <span>•</span>
          <a href="#" id="btn-open-welcome" title="Live Community & Subscribers Hub (Login Not Required)">🟢 Live Hub</a>
          <span>•</span>
          <a href="#" id="btn-open-experience" title="2-Hour Experience Feedback">⭐ Review</a>
          <span>•</span>
          <a href="#" id="btn-open-settings" title="Extension Settings">⚙️ Settings</a>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════ -->
      <!-- TAB PANE: USERS (SALESFORCE INSPECTOR RELOADED FEATURE)         -->
      <!-- ═══════════════════════════════════════════════════════════════ -->
      <div class="sfpi-tab-pane" id="tab-pane-users" style="${activeTab === 'users' ? '' : 'display:none;'}">
        
        <!-- User Search Input & Autocomplete Container -->
        <div class="sfpi-user-search-wrap">
          <div class="sfpi-user-search-box">
            <input type="text" id="sfpi-user-search" class="sfpi-search" placeholder="🔍 Name, username, email or alias..." autocomplete="off">
            <div class="sfpi-user-search-tools">
              <button id="sfpi-user-search-clear" class="sfpi-btn-icon-subtle" style="display:none;" title="Clear search">✕</button>
              <button id="sfpi-user-filter-toggle" class="sfpi-btn-icon-subtle" title="Search Filters">⚙️</button>
            </div>
          </div>

          <!-- Filter Popup Panel -->
          <div id="sfpi-user-filter-panel" class="sfpi-user-filter-panel" style="display:none;">
            <label class="sfpi-filter-label">
              <input type="checkbox" id="chk-exclude-inactive" ${excludeInactive ? 'checked' : ''}> Exclude inactive users
            </label>
          </div>

          <!-- Autocomplete Dropdown List -->
          <div id="sfpi-user-dropdown" class="sfpi-user-dropdown" style="display:none;"></div>
        </div>

        <!-- Selected User Details Card Component -->
        <div class="sfpi-section sfpi-user-card" id="sfpi-selected-user-card">
          <!-- Rendered dynamically by updateSelectedUserCard() -->
        </div>

        <!-- Users Tab Footer -->
        <div class="sfpi-footer">
          <a href="#" id="btn-api-version-user" title="Change API Version">API v${apiVersion}</a>
          <span>•</span>
          <a href="#" id="btn-open-welcome-user" title="Live Community & Subscribers Hub">🟢 Live Hub</a>
          <span>•</span>
          <a href="#" id="btn-open-experience-user" title="2-Hour Experience Feedback">⭐ Review</a>
          <span>•</span>
          <a href="#" id="btn-open-settings-user" title="Extension Settings">⚙️ Settings</a>
        </div>

      </div>

      <!-- ═══════════════════════════════════════════════════════════════ -->
      <!-- TAB PANE: ORG (ORGANIZATION DETAILS, LIMITS & FAST ACTIONS)     -->
      <!-- ═══════════════════════════════════════════════════════════════ -->
      <div class="sfpi-tab-pane" id="tab-pane-org" style="${activeTab === 'org' ? '' : 'display:none;'}">
        <div class="sfpi-org-content" id="sfpi-org-content">
          <!-- Rendered dynamically by updateOrgTabContent() -->
        </div>

        <!-- Org Tab Footer -->
        <div class="sfpi-footer">
          <a href="#" id="btn-api-version-org" title="Change API Version">API v${apiVersion}</a>
          <span>•</span>
          <a href="#" id="btn-open-welcome-org" title="Live Community & Subscribers Hub">🟢 Live Hub</a>
          <span>•</span>
          <a href="#" id="btn-open-experience-org" title="2-Hour Experience Feedback">⭐ Review</a>
          <span>•</span>
          <a href="#" id="btn-open-settings-org" title="Extension Settings">⚙️ Settings</a>
        </div>
      </div>
    </div>
  `;

  bindEvents();
  updateRecordSection();
  updateSelectedUserCard();
  if (activeTab === "org") {
    updateOrgTabContent();
  }
}

// ─── Tool Button & Quick Link Templates ─────────────────────────────
function toolButton(page, icon, label, description) {
  return `
    <button class="sfpi-tool-btn" data-page="${page}" title="${description}">
      <span class="sfpi-tool-icon">${icon}</span>
      <span class="sfpi-tool-label">${label}</span>
    </button>
  `;
}

function quickLink(label, path) {
  const targetHost = sfConn.instanceHostname || sfHost;
  return `<a class="sfpi-quick-link" href="https://${targetHost}${path}" target="_blank" rel="noopener">${label}</a>`;
}

// ─── Event Bindings ─────────────────────────────────────────────────
function bindEvents() {
  // Tab Switching (Objects vs Users vs Org)
  document.getElementById("tab-btn-objects")?.addEventListener("click", () => switchMainTab("objects"));
  document.getElementById("tab-btn-users")?.addEventListener("click", () => switchMainTab("users"));
  document.getElementById("tab-btn-org")?.addEventListener("click", () => switchMainTab("org"));

  // Tool buttons → open in new tab
  document.querySelectorAll(".sfpi-tool-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.page;
      const targetHost = sfConn.instanceHostname || sfHost;
      let url = chrome.runtime.getURL(`${page}.html?host=${targetHost}`);
      if (page === "inspect-record" && currentRecordId) {
        url += `&id=${currentRecordId}`;
      }
      window.open(url, "_blank");
    });
  });

  // Search filter (Objects Tab)
  const search = document.getElementById("sfpi-search");
  search?.addEventListener("input", () => {
    const q = search.value.toLowerCase();
    document.querySelectorAll(".sfpi-tool-btn").forEach((btn) => {
      const text = btn.textContent.toLowerCase() + " " + (btn.title || "").toLowerCase();
      btn.style.display = text.includes(q) ? "" : "none";
    });
    document.querySelectorAll(".sfpi-quick-link").forEach((link) => {
      link.style.display = link.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  });

  // Copy Org ID (Header)
  document.getElementById("btn-copy-org-id")?.addEventListener("click", async () => {
    try {
      const res = await sfConn.query("SELECT Id FROM Organization", false, { logErrors: false });
      const orgId = res.records[0]?.Id;
      if (orgId) {
        copyText(orgId);
      } else {
        showToast("Could not retrieve Org ID");
      }
    } catch (e) {
      showToast("Error: " + e.message);
    }
  });

  // Theme toggle
  document.getElementById("btn-toggle-theme")?.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("sfpi_theme", next);
  });

  // Hotkey: Ctrl+K / Cmd+K focuses current search
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (activeTab === "users") {
        const uSearch = document.getElementById("sfpi-user-search");
        uSearch?.focus();
        uSearch?.select();
      } else {
        const search = document.getElementById("sfpi-search");
        search?.focus();
        search?.select();
      }
    }
  });

  // API Version click handlers
  const handleApiVerPrompt = (e) => {
    e.preventDefault();
    const newVersion = prompt("Enter API version:", apiVersion);
    if (newVersion) {
      localStorage.setItem("sfpi_apiVersion", newVersion);
      location.reload();
    }
  };
  document.getElementById("btn-api-version")?.addEventListener("click", handleApiVerPrompt);
  document.getElementById("btn-api-version-user")?.addEventListener("click", handleApiVerPrompt);
  document.getElementById("btn-api-version-org")?.addEventListener("click", handleApiVerPrompt);

  // Open Full Settings Page
  const handleOpenSettings = (e) => {
    e.preventDefault();
    const targetHost = sfConn.instanceHostname || sfHost;
    window.open(chrome.runtime.getURL(`options.html?host=${targetHost}`), "_blank");
  };
  document.getElementById("btn-open-settings")?.addEventListener("click", handleOpenSettings);
  document.getElementById("btn-open-settings-user")?.addEventListener("click", handleOpenSettings);
  document.getElementById("btn-open-settings-org")?.addEventListener("click", handleOpenSettings);

  // Open Live Welcome & Subscribers Hub (No Login Required)
  const handleOpenWelcome = (e) => {
    e.preventDefault();
    window.open(chrome.runtime.getURL("welcome.html"), "_blank");
  };
  document.getElementById("btn-open-welcome")?.addEventListener("click", handleOpenWelcome);
  document.getElementById("btn-open-welcome-user")?.addEventListener("click", handleOpenWelcome);
  document.getElementById("btn-open-welcome-org")?.addEventListener("click", handleOpenWelcome);

  // Open 2-Hour Post-Install Experience Review
  const handleOpenExperience = (e) => {
    e.preventDefault();
    window.open(chrome.runtime.getURL("experience.html?ref=popup"), "_blank");
  };
  document.getElementById("btn-open-experience")?.addEventListener("click", handleOpenExperience);
  document.getElementById("btn-open-experience-user")?.addEventListener("click", handleOpenExperience);
  document.getElementById("btn-open-experience-org")?.addEventListener("click", handleOpenExperience);
  document.getElementById("btn-banner-experience")?.addEventListener("click", handleOpenExperience);

  // ── Org Dark Mode Toggle ──
  const orgDarkToggle = document.getElementById("toggle-org-darkmode");
  const orgDarkLabel = document.getElementById("lbl-org-darkmode");
  if (orgDarkToggle) {
    chrome.storage.local.get(["sfpi_orgDarkMode"], (result) => {
      const isEnabled = result.sfpi_orgDarkMode === true;
      orgDarkToggle.checked = isEnabled;
      if (orgDarkLabel) orgDarkLabel.textContent = isEnabled ? "On" : "Off";
    });

    orgDarkToggle.addEventListener("change", () => {
      const enabled = orgDarkToggle.checked;
      if (orgDarkLabel) orgDarkLabel.textContent = enabled ? "On" : "Off";
      chrome.storage.local.set({ sfpi_orgDarkMode: enabled });
      chrome.runtime.sendMessage({ message: "setOrgDarkMode", enabled: enabled });
    });
  }

  // ── Bind User Tab Specific Events ──
  bindUserTabEvents();
}

// ─── Tab Switching Logic ────────────────────────────────────────────
function switchMainTab(tab) {
  activeTab = tab;

  const btnObjects = document.getElementById("tab-btn-objects");
  const btnUsers = document.getElementById("tab-btn-users");
  const btnOrg = document.getElementById("tab-btn-org");
  const paneObjects = document.getElementById("tab-pane-objects");
  const paneUsers = document.getElementById("tab-pane-users");
  const paneOrg = document.getElementById("tab-pane-org");

  // Reset active classes
  btnObjects?.classList.remove("active");
  btnUsers?.classList.remove("active");
  btnOrg?.classList.remove("active");

  // Hide all tab panes
  if (paneObjects) paneObjects.style.display = "none";
  if (paneUsers) paneUsers.style.display = "none";
  if (paneOrg) paneOrg.style.display = "none";

  if (tab === "objects") {
    btnObjects?.classList.add("active");
    if (paneObjects) paneObjects.style.display = "";
  } else if (tab === "users") {
    btnUsers?.classList.add("active");
    if (paneUsers) paneUsers.style.display = "";

    // If no user selected yet, load current or first
    if (!selectedUser && allUsers.length > 0) {
      selectedUser = allUsers.find(u => u.IsActive) || allUsers[0];
    }
    updateSelectedUserCard();

    // Auto-focus user search input
    setTimeout(() => {
      const uSearch = document.getElementById("sfpi-user-search");
      uSearch?.focus();
    }, 50);
  } else if (tab === "org") {
    btnOrg?.classList.add("active");
    if (paneOrg) paneOrg.style.display = "";

    updateOrgTabContent();
    loadExtendedOrgData();
  }
}

// ─── User Search & Dropdown Handlers ────────────────────────────────
function bindUserTabEvents() {
  const userSearch = document.getElementById("sfpi-user-search");
  const clearBtn = document.getElementById("sfpi-user-search-clear");
  const filterBtn = document.getElementById("sfpi-user-filter-toggle");
  const filterPanel = document.getElementById("sfpi-user-filter-panel");
  const chkExcludeInactive = document.getElementById("chk-exclude-inactive");
  const dropdown = document.getElementById("sfpi-user-dropdown");

  // Toggle filter panel
  filterBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!filterPanel) return;
    const isShown = filterPanel.style.display !== "none";
    filterPanel.style.display = isShown ? "none" : "block";
  });

  // Filter checkbox change
  chkExcludeInactive?.addEventListener("change", (e) => {
    excludeInactive = e.target.checked;
    localStorage.setItem("sfpi_exclude_inactive", excludeInactive);
    handleUserSearchInput(userSearch?.value || "");
  });

  // Clear search input
  clearBtn?.addEventListener("click", () => {
    if (userSearch) {
      userSearch.value = "";
      userSearch.focus();
    }
    if (clearBtn) clearBtn.style.display = "none";
    if (dropdown) dropdown.style.display = "none";
  });

  // User input filtering (Instant client-side filter)
  userSearch?.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    if (clearBtn) clearBtn.style.display = val ? "inline-flex" : "none";
    handleUserSearchInput(val);
  });

  // Keyboard navigation for user dropdown
  userSearch?.addEventListener("keydown", (e) => {
    if (!dropdown || dropdown.style.display === "none") return;
    const items = dropdown.querySelectorAll(".sfpi-user-dropdown-item");
    if (!items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeDropdownIndex = (activeDropdownIndex + 1) % items.length;
      highlightDropdownItem(items);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeDropdownIndex = (activeDropdownIndex - 1 + items.length) % items.length;
      highlightDropdownItem(items);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeDropdownIndex >= 0 && activeDropdownIndex < items.length) {
        items[activeDropdownIndex].click();
      }
    } else if (e.key === "Escape") {
      dropdown.style.display = "none";
    }
  });

  // Close dropdown and filter panel on outside click
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".sfpi-user-search-wrap")) {
      if (dropdown) dropdown.style.display = "none";
      if (filterPanel) filterPanel.style.display = "none";
    }
  });
}

function highlightDropdownItem(items) {
  items.forEach((item, idx) => {
    if (idx === activeDropdownIndex) {
      item.classList.add("active");
      item.scrollIntoView({ block: "nearest" });
    } else {
      item.classList.remove("active");
    }
  });
}

let serverSearchTimeout = null;

function handleUserSearchInput(query) {
  const dropdown = document.getElementById("sfpi-user-dropdown");
  if (!dropdown) return;

  if (!query) {
    dropdown.style.display = "none";
    activeDropdownIndex = -1;
    return;
  }

  const q = query.toLowerCase();
  let matches = allUsers.filter(u => {
    if (excludeInactive && !u.IsActive) return false;
    const name = (u.Name || "").toLowerCase();
    const username = (u.Username || "").toLowerCase();
    const email = (u.Email || "").toLowerCase();
    const alias = (u.Alias || "").toLowerCase();
    const profile = (u.Profile?.Name || "").toLowerCase();
    return name.includes(q) || username.includes(q) || email.includes(q) || alias.includes(q) || profile.includes(q);
  });

  renderDropdownMatches(matches, query);

  // If local search found few results and query >= 3 chars, perform debounced server query fallback
  if (matches.length < 3 && query.length >= 3) {
    clearTimeout(serverSearchTimeout);
    serverSearchTimeout = setTimeout(() => {
      fetchUsersFromServer(query);
    }, 350);
  }
}

function renderDropdownMatches(matches, query) {
  const dropdown = document.getElementById("sfpi-user-dropdown");
  if (!dropdown) return;

  if (!matches.length) {
    dropdown.innerHTML = `<div style="padding:10px; font-size:11.5px; color:var(--sfpi-text-muted); text-align:center;">No matching users found</div>`;
    dropdown.style.display = "block";
    return;
  }

  activeDropdownIndex = -1;
  const topMatches = matches.slice(0, 15);

  dropdown.innerHTML = topMatches.map((u, i) => {
    const nameHighlight = highlightMatch(u.Name || "", query);
    const userHighlight = highlightMatch(u.Username || "", query);
    const profileName = u.Profile?.Name || "User";
    const isInactive = !u.IsActive;

    return `
      <div class="sfpi-user-dropdown-item" data-index="${i}" data-id="${u.Id}">
        <div class="sfpi-user-dd-primary">
          <span class="sfpi-user-dd-name">${isInactive ? '<span style="color:#e11d48;" title="Inactive">⚠️ </span>' : ''}${nameHighlight}</span>
          <span class="sfpi-user-dd-alias">(${escapeHtml(u.Alias || "")})</span>
        </div>
        <div class="sfpi-user-dd-secondary">
          <span class="sfpi-user-dd-profile" title="${escapeHtml(profileName)}">${escapeHtml(profileName)}</span>
          <span class="sfpi-user-dd-username" title="${escapeHtml(u.Username || "")}">${userHighlight}</span>
        </div>
      </div>
    `;
  }).join("");

  dropdown.style.display = "block";

  // Item click handlers
  dropdown.querySelectorAll(".sfpi-user-dropdown-item").forEach((item) => {
    item.addEventListener("click", () => {
      const userId = item.dataset.id;
      const found = allUsers.find(u => u.Id === userId);
      if (found) {
        selectedUser = found;
        updateSelectedUserCard();
      }
      dropdown.style.display = "none";
      const uSearch = document.getElementById("sfpi-user-search");
      if (uSearch && found) {
        uSearch.value = found.Name;
      }
    });
  });
}

async function fetchUsersFromServer(term) {
  try {
    const escaped = term.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    let whereClause = `(Name LIKE '%${escaped}%' OR Username LIKE '%${escaped}%' OR Email LIKE '%${escaped}%' OR Alias LIKE '%${escaped}%')`;
    if (excludeInactive) whereClause += " AND IsActive = true";

    const soql = `SELECT Id, Name, Email, Username, UserRole.Name, Alias, LocaleSidKey, LanguageLocaleKey, IsActive, ProfileId, Profile.Name, UserPreferencesUserDebugModePref, (SELECT Id, IsFrozen FROM UserLogins LIMIT 1) FROM User WHERE ${whereClause} ORDER BY IsActive DESC, LastLoginDate DESC NULLS LAST LIMIT 25`;
    const res = await sfConn.query(soql, false, { logErrors: false });

    if (res?.records?.length > 0) {
      // Merge unique into allUsers
      const existingIds = new Set(allUsers.map(u => u.Id));
      res.records.forEach(r => {
        if (!existingIds.has(r.Id)) allUsers.push(r);
      });
      renderDropdownMatches(res.records, term);
    }
  } catch (e) {
    const msg = e?.message || "";
    const dropdown = document.getElementById("sfpi-user-dropdown");
    if (dropdown) {
      dropdown.innerHTML = `<div style="padding:10px; font-size:11.5px; color:#f59e0b; text-align:center;">User search unavailable. Please check Salesforce connection.</div>`;
      dropdown.style.display = "block";
    }
  }
}

function highlightMatch(text, query) {
  if (!text || !query) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  const before = text.substring(0, idx);
  const match = text.substring(idx, idx + query.length);
  const after = text.substring(idx + query.length);
  return `${escapeHtml(before)}<strong style="color:var(--sfpi-primary);">${escapeHtml(match)}</strong>${escapeHtml(after)}`;
}

// ─── Selected User Details Card Component ───────────────────────────
function updateSelectedUserCard() {
  const card = document.getElementById("sfpi-selected-user-card");
  if (!card) return;

  if (!selectedUser) {
    card.innerHTML = `
      <div style="text-align:center; padding:20px; color:var(--sfpi-text-muted); font-size:12px;">
        <span>🔍 Search or select a user above to view and manage details</span>
      </div>
    `;
    return;
  }

  const u = selectedUser;
  const isInactive = !u.IsActive;
  const isFrozen = Boolean(u.UserLogins?.records?.[0]?.IsFrozen);
  const hasDebugMode = Boolean(u.UserPreferencesUserDebugModePref);
  const hasLogsEnabled = traceFlagEnabledUsers.has(u.Id);
  const targetHost = sfConn.instanceHostname || sfConn._getMyDomain(sfHost) || sfHost;
  let orgId = orgInfo?.orgId;
  if (!orgId && sfConn.sessionId && sfConn.sessionId.includes("!")) {
    orgId = sfConn.sessionId.split("!")[0];
  }

  // Country Flags for Language and Locale
  const langCountryCode = sfLocaleKeyToCountryCode(u.LanguageLocaleKey);
  const localeCountryCode = sfLocaleKeyToCountryCode(u.LocaleSidKey);
  const langFlag = countryCodeToFlagEmoji(langCountryCode);
  const localeFlag = countryCodeToFlagEmoji(localeCountryCode);

  // URLs
  const userSummaryUrl = `https://${targetHost}/lightning/setup/ManageUsers/${u.Id}/summary`;
  const userDetailUrl = `https://${targetHost}/lightning/setup/ManageUsers/page?address=%2F${u.Id}%3Fnoredirect%3D1%26isUserEntityOverride%3D1`;
  const psetUrl = `https://${targetHost}/lightning/setup/PermSets/page?address=%2Fudd%2FPermissionSet%2FassignPermissionSet.apexp%3FuserId%3D${u.Id}`;
  const psetgUrl = `https://${targetHost}/lightning/setup/PermSetGroups/page?address=%2Fudd%2FPermissionSetGroup%2FassignPermissionSet.apexp%3FuserId%3D${u.Id}%26isPermsetGroup%3D1`;
  const profileUrl = u.ProfileId ? `https://${targetHost}/lightning/setup/EnhancedProfiles/page?address=%2F${u.ProfileId}` : "#";
  const loginAsUrl = `https://${targetHost}/servlet/servlet.su?oid=${encodeURIComponent(orgId)}&suorgadminid=${encodeURIComponent(u.Id)}&retURL=%2F&targetURL=%2F`;
  const showDataUrl = chrome.runtime.getURL(`inspect-record.html?host=${targetHost}&id=${u.Id}`);
  const checkAccessUrl = chrome.runtime.getURL(`permission-analyzer.html?host=${targetHost}&userId=${u.Id}`);

  card.innerHTML = `
    <!-- User Information Table -->
    <table class="sfpi-user-table">
      <tbody>
        <tr>
          <th>Name</th>
          <td class="sfpi-user-val">
            ${isInactive ? '<span style="color:#e11d48; margin-right:4px;" title="User is Inactive">⚠️</span>' : ''}
            <a href="${userSummaryUrl}" target="_blank" class="sfpi-user-link" title="Open User Summary in Salesforce">${escapeHtml(u.Name)}</a>
            <span class="sfpi-user-alias">(${escapeHtml(u.Alias || "")})</span>
            ${isInactive ? '<span class="sfpi-badge sfpi-badge-prod" style="margin-left:6px; font-size:9px;">Inactive</span>' : ''}
            ${isFrozen ? '<span class="sfpi-badge sfpi-badge-prod" style="margin-left:6px; font-size:9px; background:#ffe4e6; color:#be123c;">Frozen</span>' : ''}
          </td>
        </tr>
        <tr>
          <th>Username</th>
          <td class="sfpi-user-val" title="${escapeHtml(u.Username)}">${escapeHtml(u.Username)}</td>
        </tr>
        <tr>
          <th>Id</th>
          <td class="sfpi-user-val sfpi-user-id-row">
            <a href="${showDataUrl}" target="_blank" class="sfpi-user-link" title="Inspect Record in Show All Data">${u.Id}</a>
            <button class="sfpi-copy-btn" id="btn-copy-u-id" title="Copy User ID">📋</button>
          </td>
        </tr>
        <tr>
          <th>E-mail</th>
          <td class="sfpi-user-val" title="${escapeHtml(u.Email || '')}">${escapeHtml(u.Email || "—")}</td>
        </tr>
        <tr>
          <th>Profile</th>
          <td class="sfpi-user-val">
            ${u.Profile ? `<a href="${profileUrl}" target="_blank" class="sfpi-user-link" title="Open Profile in Salesforce Setup">${escapeHtml(u.Profile.Name)}</a>` : '<em style="color:var(--sfpi-text-muted);">Unknown</em>'}
          </td>
        </tr>
        ${u.UserRole ? `
          <tr>
            <th>Role</th>
            <td class="sfpi-user-val" title="${escapeHtml(u.UserRole.Name)}">${escapeHtml(u.UserRole.Name)}</td>
          </tr>
        ` : ""}
        <tr>
          <th>Language</th>
          <td class="sfpi-user-val">
            <span class="sfpi-lang-display" id="u-lang-display" title="Click to view or edit user Language & Locale">
              <span id="u-lang-flag">${langFlag}</span> <span style="font-size:10px; color:var(--sfpi-text-muted);">${escapeHtml(u.LanguageLocaleKey || "en_US")}</span>
              <span>|</span>
              <span id="u-locale-flag">${localeFlag}</span> <span style="font-size:10px; color:var(--sfpi-text-muted);">${escapeHtml(u.LocaleSidKey || "en_US")}</span>
            </span>
            <div id="u-lang-edit-box" style="display:none; margin-top:6px; padding:6px; background:rgba(0,0,0,0.03); border-radius:4px;">
              <div style="display:flex; flex-direction:column; gap:4px;">
                <label style="font-size:10px; font-weight:600;">Change Language:</label>
                <select id="sel-user-language" class="sfpi-select-small"></select>
                <label style="font-size:10px; font-weight:600;">Change Locale:</label>
                <select id="sel-user-locale" class="sfpi-select-small"></select>
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Action Group 1: Setup Details & Permissions -->
    <div class="sfpi-user-btn-row">
      <a href="${userDetailUrl}" target="_blank" class="sfpi-user-btn" title="Open Salesforce User Setup Details">Details</a>
      <a href="${psetUrl}" target="_blank" class="sfpi-user-btn" title="Assign / View Permission Sets">PSet</a>
      <a href="${psetgUrl}" target="_blank" class="sfpi-user-btn" title="Assign / View Permission Set Groups">PSetG</a>
    </div>

    <!-- Action Group 2: Logging & Debugging -->
    <div class="sfpi-user-btn-row sfpi-user-btn-row-2col">
      <button id="btn-u-logs" class="sfpi-user-btn ${hasLogsEnabled ? 'active-enabled' : ''}" title="Enable user TraceFlag for Apex debug logs via Tooling API">
        ${hasLogsEnabled ? "✓ Logs Enabled" : "Enable Logs"}
      </button>
      <button id="btn-u-debugmode" class="sfpi-user-btn ${hasDebugMode ? 'active-enabled' : ''}" title="Toggle Lightning Component Debug Mode for this user">
        ${hasDebugMode ? "Disable Debug Mode" : "Enable Debug Mode"}
      </button>
    </div>

    <!-- Action Group 3: Login & Access -->
    <div class="sfpi-user-btn-row sfpi-user-btn-row-2col">
      <a href="${loginAsUrl}" target="_blank" class="sfpi-user-btn sfpi-btn-login" title="Login as this user in Salesforce">Login As</a>
      <button id="btn-u-incognito" class="sfpi-user-btn sfpi-btn-incognito" title="Login as this user in a clean Incognito window (Single Access API)">🕵️ Incognito</button>
    </div>

    <!-- Action Group 4: Inspection & Security -->
    <div class="sfpi-user-btn-row">
      <a href="${showDataUrl}" target="_blank" class="sfpi-user-btn" title="Show all fields and values for this User">🔍 Show Data</a>
      <a href="${checkAccessUrl}" target="_blank" class="sfpi-user-btn" title="Analyze permissions and access for this User">🔐 Check Access</a>
      <button id="btn-u-resetpwd" class="sfpi-user-btn" title="Send Password Reset Email">Reset Pwd</button>
      ${isFrozen ? '<button id="btn-u-unfreeze" class="sfpi-user-btn sfpi-btn-danger" title="Unfreeze this User">Unfreeze</button>' : ''}
    </div>
  `;

  // Bind Selected User Card Actions
  document.getElementById("btn-copy-u-id")?.addEventListener("click", () => copyText(u.Id));

  // Language & Locale toggle
  document.getElementById("u-lang-display")?.addEventListener("click", () => {
    const editBox = document.getElementById("u-lang-edit-box");
    if (!editBox) return;
    const isShown = editBox.style.display !== "none";
    editBox.style.display = isShown ? "none" : "block";
    if (!isShown) loadAndPopulateLocales(u);
  });

  // Enable Logs (TraceFlag via Tooling API)
  document.getElementById("btn-u-logs")?.addEventListener("click", async () => {
    const btn = document.getElementById("btn-u-logs");
    if (btn) btn.disabled = true;
    try {
      await enableDebugLogForUser(u.Id);
      traceFlagEnabledUsers.add(u.Id);
      if (btn) {
        btn.textContent = "✓ Logs Enabled";
        btn.classList.add("active-enabled");
      }
      showToast("✓ Apex debug logs enabled for 30 min");
    } catch (err) {
      showToast("Logs Error: " + err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Enable / Disable Debug Mode (REST PATCH)
  document.getElementById("btn-u-debugmode")?.addEventListener("click", async () => {
    const btn = document.getElementById("btn-u-debugmode");
    if (btn) btn.disabled = true;
    try {
      const currentVal = Boolean(u.UserPreferencesUserDebugModePref);
      const nextVal = !currentVal;
      await sfConn.rest(`/services/data/v${apiVersion}/sobjects/User/${u.Id}`, {
        method: "PATCH",
        body: { UserPreferencesUserDebugModePref: nextVal }
      });
      u.UserPreferencesUserDebugModePref = nextVal;
      if (btn) {
        btn.textContent = nextVal ? "Disable Debug Mode" : "Enable Debug Mode";
        btn.classList.toggle("active-enabled", nextVal);
      }
      showToast(`✓ Debug Mode ${nextVal ? "enabled" : "disabled"} successfully`);
    } catch (err) {
      showToast("Debug Mode Error: " + err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Login As in Incognito Mode
  document.getElementById("btn-u-incognito")?.addEventListener("click", async () => {
    await loginAsInIncognito(u.Id);
  });

  // Reset Password
  document.getElementById("btn-u-resetpwd")?.addEventListener("click", async () => {
    if (!confirm(`Are you sure you want to send a password reset email to ${u.Name} (${u.Email})?`)) return;
    try {
      await sfConn.rest(`/services/data/v${apiVersion}/sobjects/User/${u.Id}/password`, {
        method: "DELETE"
      });
      showToast(`✓ Password reset email sent to ${u.Email}`);
    } catch (err) {
      showToast("Reset Error: " + err.message);
    }
  });

  // Unfreeze User (if applicable)
  document.getElementById("btn-u-unfreeze")?.addEventListener("click", async () => {
    try {
      let loginId = u.UserLogins?.records?.[0]?.Id;
      if (!loginId) {
        const q = await sfConn.query(`SELECT Id, IsFrozen FROM UserLogin WHERE UserId = '${u.Id}' LIMIT 1`, false, { logErrors: false });
        loginId = q.records?.[0]?.Id;
      }
      if (!loginId) throw new Error("UserLogin record not found");
      await sfConn.rest(`/services/data/v${apiVersion}/sobjects/UserLogin/${loginId}`, {
        method: "PATCH",
        body: { IsFrozen: false }
      });
      if (u.UserLogins?.records?.[0]) u.UserLogins.records[0].IsFrozen = false;
      showToast(`✓ User ${u.Name} unfrozen successfully`);
      updateSelectedUserCard();
    } catch (err) {
      showToast("Unfreeze Error: " + err.message);
    }
  });
}

// ─── Incognito Login Implementation ─────────────────────────────────
async function loginAsInIncognito(userId) {
  showToast("Launching Incognito window...");

  // 1. Ensure we have a valid, active session token
  let sid = sfConn.sessionId;
  if (!sid) {
    sid = await sfConn.getSession(sfHost);
  }

  // 2. Resolve authoritative My Domain hostname (MUST be *.my.salesforce.com, NEVER *.lightning.force.com)
  const myDomainHost = sfConn.instanceHostname || sfConn._getMyDomain(sfHost) || sfHost;

  // 3. Resolve Organization ID (from orgInfo, sessionId split, or query)
  let orgId = orgInfo?.orgId;
  if (!orgId && sid && sid.includes("!")) {
    orgId = sid.split("!")[0];
  }
  if (!orgId) {
    try {
      const orgRes = await sfConn.query("SELECT Id FROM Organization LIMIT 1", false, { logErrors: false });
      orgId = orgRes?.records?.[0]?.Id;
      if (orgId && orgInfo) orgInfo.orgId = orgId;
    } catch (e) {}
  }

  // 4. Determine target relative path (servlet.su for another user, home page if self)
  const currentUserId = orgInfo?.userId;
  const isSelf = Boolean(currentUserId && userId === currentUserId);
  const targetPath = isSelf 
    ? "/lightning/page/home"
    : `/servlet/servlet.su?oid=${encodeURIComponent(orgId || "")}&suorgadminid=${encodeURIComponent(userId)}&retURL=%2F&targetURL=%2F`;

  // 5. Try Salesforce Single Access UI bridge first (mints one-time frontdoor URL)
  let targetWindowUrl = null;
  try {
    const redirectUri = targetPath.replace(/^\//, "");
    const singleAccess = await sfConn.rest(`/services/oauth2/singleaccess?redirect_uri=${encodeURIComponent(redirectUri)}`, {
      method: "GET",
      suppressSessionError: true,
      logErrors: false
    });

    if (singleAccess && singleAccess.frontdoor_uri) {
      targetWindowUrl = singleAccess.frontdoor_uri;
    }
  } catch (e) {
    // Normal fallback when singleaccess endpoint is unavailable in org
  }

  // 6. Direct frontdoor.jsp fallback on the canonical My Domain host
  if (!targetWindowUrl) {
    const fullDestination = isSelf 
      ? `https://${myDomainHost}/lightning/page/home`
      : `https://${myDomainHost}${targetPath}`;
    targetWindowUrl = `https://${myDomainHost}/secur/frontdoor.jsp?sid=${encodeURIComponent(sid)}&retURL=${encodeURIComponent(fullDestination)}`;
  }

  // 7. Request background to open the incognito window directly
  chrome.runtime.sendMessage({
    message: "createWindow",
    url: targetWindowUrl,
    incognito: true,
    type: "normal"
  }, (res) => {
    if (chrome.runtime.lastError || res?.error) {
      showToast("⚠️ Enable 'Allow in Incognito' for SF Power Inspector in chrome://extensions");
    } else {
      showToast("🚀 Logged in to Incognito window");
    }
  });
}

// ─── Debug Log & TraceFlag Tooling API ───────────────────────────────
async function enableDebugLogForUser(userId) {
  const DTnow = new Date();
  const debugMinutes = 30;
  const expirationDate = new Date(DTnow.getTime() + debugMinutes * 60 * 1000);

  // 1. Resolve DebugLevel
  let debugLevelId = null;
  try {
    const dlRes = await sfConn.query("SELECT Id FROM DebugLevel WHERE DeveloperName = 'SFDC_DevConsole' LIMIT 1", true, { logErrors: false });
    if (dlRes?.records?.length > 0) {
      debugLevelId = dlRes.records[0].Id;
    }
  } catch (e) {}

  if (!debugLevelId) {
    try {
      const sfirRes = await sfConn.query("SELECT Id FROM DebugLevel WHERE DeveloperName = 'sfir' LIMIT 1", true, { logErrors: false });
      if (sfirRes?.records?.length > 0) {
        debugLevelId = sfirRes.records[0].Id;
      } else {
        const newDl = await sfConn.tooling("/sobjects/DebugLevel", {
          method: "POST",
          body: {
            DeveloperName: "sfir",
            MasterLabel: "sfir",
            ApexCode: "FINEST",
            ApexProfiling: "FINEST",
            Callout: "FINEST",
            Database: "FINEST",
            System: "FINEST",
            Validation: "FINEST",
            Visualforce: "FINEST",
            Workflow: "FINEST"
          }
        });
        debugLevelId = newDl.id;
      }
    } catch (e) {
      const anyDl = await sfConn.query("SELECT Id FROM DebugLevel LIMIT 1", true, { logErrors: false });
      debugLevelId = anyDl?.records?.[0]?.Id;
    }
  }

  if (!debugLevelId) {
    throw new Error("No DebugLevel found. Open Dev Console once to initialize.");
  }

  // 2. Query existing TraceFlag
  const tfRes = await sfConn.query(`SELECT Id, ExpirationDate FROM TraceFlag WHERE TracedEntityId = '${userId}' AND LogType = 'USER_DEBUG' LIMIT 1`, true, { logErrors: false });
  if (tfRes?.records?.length > 0) {
    await sfConn.tooling(`/sobjects/TraceFlag/${tfRes.records[0].Id}`, {
      method: "PATCH",
      body: {
        StartDate: DTnow.toISOString(),
        ExpirationDate: expirationDate.toISOString(),
        DebugLevelId: debugLevelId
      }
    });
  } else {
    await sfConn.tooling("/sobjects/TraceFlag", {
      method: "POST",
      body: {
        TracedEntityId: userId,
        DebugLevelId: debugLevelId,
        LogType: "USER_DEBUG",
        StartDate: DTnow.toISOString(),
        ExpirationDate: expirationDate.toISOString()
      }
    });
  }
}

// ─── Language & Locale Helpers ──────────────────────────────────────
async function loadAndPopulateLocales(user) {
  const selLang = document.getElementById("sel-user-language");
  const selLocale = document.getElementById("sel-user-locale");
  if (!selLang || !selLocale) return;

  if (!cachedUserLanguages || !cachedUserLocales) {
    try {
      const desc = await sfConn.rest(`/services/data/v${apiVersion}/sobjects/User/describe`, { logErrors: false });
      const langField = desc.fields.find(f => f.name === "LanguageLocaleKey");
      const localeField = desc.fields.find(f => f.name === "LocaleSidKey");
      cachedUserLanguages = langField?.picklistValues?.filter(p => p.active) || [];
      cachedUserLocales = localeField?.picklistValues?.filter(p => p.active) || [];
    } catch (e) {
      // Picklists fallback to standard options
    }
  }

  if (cachedUserLanguages) {
    selLang.innerHTML = cachedUserLanguages.map(p => `
      <option value="${p.value}" ${p.value === user.LanguageLocaleKey ? 'selected' : ''}>${escapeHtml(p.label)} (${p.value})</option>
    `).join("");
    selLang.onchange = async () => {
      try {
        await sfConn.rest(`/services/data/v${apiVersion}/sobjects/User/${user.Id}`, {
          method: "PATCH",
          body: { LanguageLocaleKey: selLang.value }
        });
        user.LanguageLocaleKey = selLang.value;
        showToast("✓ Updated language to " + selLang.value);
        updateSelectedUserCard();
      } catch (err) {
        showToast("Error updating language: " + err.message);
      }
    };
  }

  if (cachedUserLocales) {
    selLocale.innerHTML = cachedUserLocales.map(p => `
      <option value="${p.value}" ${p.value === user.LocaleSidKey ? 'selected' : ''}>${escapeHtml(p.label)} (${p.value})</option>
    `).join("");
    selLocale.onchange = async () => {
      try {
        await sfConn.rest(`/services/data/v${apiVersion}/sobjects/User/${user.Id}`, {
          method: "PATCH",
          body: { LocaleSidKey: selLocale.value }
        });
        user.LocaleSidKey = selLocale.value;
        showToast("✓ Updated locale to " + selLocale.value);
        updateSelectedUserCard();
      } catch (err) {
        showToast("Error updating locale: " + err.message);
      }
    };
  }
}

function sfLocaleKeyToCountryCode(localeKey) {
  if (!localeKey) return "us";
  const splitted = localeKey.split("_");
  const code = splitted[splitted.length > 1 && !localeKey.includes("_LATN_") ? 1 : 0].toLowerCase();
  return code || "us";
}

function countryCodeToFlagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return "🌐";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map(c => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
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

// ─── Org Tab Management & Controllers ───────────────────────────────
async function loadExtendedOrgData() {
  if (!orgExtendedData) {
    try {
      const cached = localStorage.getItem(sfHost + "_orgExtended");
      if (cached) orgExtendedData = JSON.parse(cached);
    } catch (e) {}
  }
  if (!orgLimitsData) {
    try {
      const cachedLimits = localStorage.getItem(sfHost + "_orgLimits");
      if (cachedLimits) orgLimitsData = JSON.parse(cachedLimits);
    } catch (e) {}
  }

  // Fast initial render from cached data (0ms)
  updateOrgTabContent();

  // Async query full Organization details
  try {
    const q = "SELECT Id, Name, OrganizationType, InstanceName, IsSandbox, PrimaryContact, Division, Street, City, State, PostalCode, Country, Phone, Fax, DefaultLocaleSidKey, LanguageLocaleKey, FiscalYearStartMonth, UsesStartDateAsFiscalYearName, CreatedDate, TrialExpirationDate FROM Organization LIMIT 1";
    const res = await sfConn.query(q, false, { logErrors: false });
    if (res?.records?.length > 0) {
      orgExtendedData = res.records[0];
      localStorage.setItem(sfHost + "_orgExtended", JSON.stringify(orgExtendedData));
      updateOrgTabContent();
    }
  } catch (err) {
    // Non-fatal Organization query
  }

  // Async query Salesforce limits
  try {
    const limits = await sfConn.rest(`/services/data/v${apiVersion}/limits`, { logErrors: false });
    if (limits && typeof limits === "object") {
      orgLimitsData = limits;
      localStorage.setItem(sfHost + "_orgLimits", JSON.stringify(orgLimitsData));
      const limitsStatusEl = document.getElementById("org-limits-status");
      if (limitsStatusEl) limitsStatusEl.textContent = "Limits synced";
      updateOrgTabContent();
    }
  } catch (err) {
    // Non-fatal limits query
  }
}

function updateOrgTabContent() {
  const container = document.getElementById("sfpi-org-content");
  if (!container) return;

  const data = orgExtendedData || {};
  const targetHost = sfConn.instanceHostname || sfHost;
  const orgId = data.Id || orgInfo?.orgId || orgInfo?.id || "Unknown";
  const orgName = data.Name || orgInfo?.companyName || orgInfo?.name || "Salesforce Organization";
  const primaryContact = data.PrimaryContact || "";
  const division = data.Division || "";

  // Environment and Edition details
  const envDetails = getOrgEnvironmentDetails(sfHost, { ...orgInfo, ...data });
  const edition = data.OrganizationType || orgInfo?.edition || orgInfo?.organizationType || envDetails.environment;
  const instance = data.InstanceName || orgInfo?.instanceName || (sfHost.match(/^([a-z0-9]+)\./i) ? sfHost.match(/^([a-z0-9]+)\./i)[1].toUpperCase() : "");

  // Fiscal Year
  const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const fiscalMonth = data.FiscalYearStartMonth ? (monthNames[data.FiscalYearStartMonth] || `Month ${data.FiscalYearStartMonth}`) : "January";

  // Locales & Flags
  const langKey = data.LanguageLocaleKey || "en_US";
  const localeKey = data.DefaultLocaleSidKey || "en_US";
  const langCountry = sfLocaleKeyToCountryCode(langKey);
  const localeCountry = sfLocaleKeyToCountryCode(localeKey);
  const langFlag = countryCodeToFlagEmoji(langCountry);
  const localeFlag = countryCodeToFlagEmoji(localeCountry);

  // Dates
  const createdDateStr = data.CreatedDate ? new Date(data.CreatedDate).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
  const trialExpiryStr = data.TrialExpirationDate ? new Date(data.TrialExpirationDate).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";

  // Storage Quota Analysis & Proactive 1-Day Warning
  const dataLim = orgLimitsData?.DataStorageMB;
  const fileLim = orgLimitsData?.FileStorageMB;
  const dataMax = dataLim?.Max || 0;
  const dataRem = dataLim?.Remaining !== undefined ? dataLim.Remaining : dataMax;
  const dataUsed = Math.max(0, dataMax - dataRem);
  const dataPct = dataMax > 0 ? Math.round((dataUsed / dataMax) * 100) : 0;

  const fileMax = fileLim?.Max || 0;
  const fileRem = fileLim?.Remaining !== undefined ? fileLim.Remaining : fileMax;
  const fileUsed = Math.max(0, fileMax - fileRem);
  const filePct = fileMax > 0 ? Math.round((fileUsed / fileMax) * 100) : 0;

  const isStorageCritical = dataPct >= 100 || filePct >= 100;
  const isStorageWarning = dataPct >= 80 || filePct >= 80;

  container.innerHTML = `
    <!-- Card 1: 🏢 Organization Profile -->
    <div class="sfpi-section" style="padding:10px 12px; margin-bottom:8px;">
      <div class="sfpi-org-card-header">
        <div class="sfpi-org-card-title">
          <span>🏢</span>
          <span>Organization Profile</span>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <button id="btn-copy-org-tab-btn" class="sfpi-copy-org-btn" title="Copy 15/18-character Salesforce Organization ID">📋 Copy Org ID</button>
          ${!isEditingOrgDetails ? `
            <button id="btn-edit-org-details" class="sfpi-btn-icon-subtle" title="Edit Organization details (Name, Contact, Division)" style="font-size:11px; padding:3px 8px; gap:4px; display:inline-flex; align-items:center;">
              ✏️ Edit
            </button>
          ` : `
            <button id="btn-cancel-org-details" class="sfpi-btn-icon-subtle" title="Cancel editing" style="font-size:11px; padding:3px 8px;">✕ Cancel</button>
          `}
        </div>
      </div>

      <table class="sfpi-user-table sfpi-org-table">
        <tbody>
          <tr>
            <th>Org</th>
            <td>
              ${isEditingOrgDetails ? `
                <input type="text" id="sfpi-edit-org-name" class="sfpi-edit-input" value="${escapeHtml(orgName)}" placeholder="Organization Name">
              ` : `
                <strong style="color:var(--sfpi-text); font-size:12px;" title="${escapeHtml(orgName)}">${escapeHtml(orgName)}</strong>
              `}
            </td>
          </tr>
          <tr>
            <th>Org ID</th>
            <td class="sfpi-user-id-row">
              <a href="${chrome.runtime.getURL(`inspect-record.html?host=${targetHost}&id=${orgId}`)}" target="_blank" class="sfpi-user-link" title="Inspect Organization record in Show All Data">${orgId}</a>
              <button class="sfpi-copy-btn" id="btn-copy-org-tab-id" title="Copy Organization ID">📋</button>
            </td>
          </tr>
          <tr>
            <th>Edition</th>
            <td>
              <span style="font-weight:600; color:var(--sfpi-text);">${escapeHtml(edition)}</span>
            </td>
          </tr>
          <tr>
            <th>Environment</th>
            <td>
              <span class="sfpi-badge ${envDetails.badgeClass}">${envDetails.environment}</span>
            </td>
          </tr>
          <tr>
            <th>Instance / Pod</th>
            <td>
              ${instance ? `
                <a href="https://status.salesforce.com/instances/${instance}" target="_blank" class="sfpi-user-link" title="Check live Salesforce Trust status for ${instance}">
                  ${instance}
                </a>
                <span class="sfpi-instance-status-pill" style="background:rgba(16,185,129,0.15); color:#10b981;" title="Salesforce Trust Pod status">🟢 Available</span>
              ` : `<span style="color:var(--sfpi-text-muted);">Unknown</span>`}
            </td>
          </tr>
          <tr>
            <th>Release & API</th>
            <td>
              <span style="font-weight:600;">v${apiVersion}</span>
              <span style="font-size:10.5px; color:var(--sfpi-text-muted); margin-left:4px;">(REST & Tooling)</span>
            </td>
          </tr>
          <tr>
            <th>Primary Contact</th>
            <td>
              ${isEditingOrgDetails ? `
                <input type="text" id="sfpi-edit-org-contact" class="sfpi-edit-input" value="${escapeHtml(primaryContact)}" placeholder="Primary Contact Name">
              ` : `
                <span title="${escapeHtml(primaryContact || '—')}">${escapeHtml(primaryContact || "—")}</span>
              `}
            </td>
          </tr>
          <tr>
            <th>Division</th>
            <td>
              ${isEditingOrgDetails ? `
                <input type="text" id="sfpi-edit-org-division" class="sfpi-edit-input" value="${escapeHtml(division)}" placeholder="Division / Business Unit">
              ` : `
                <span title="${escapeHtml(division || '—')}">${escapeHtml(division || "—")}</span>
              `}
            </td>
          </tr>
          <tr>
            <th>Fiscal Year</th>
            <td>
              <span>${fiscalMonth}</span>
            </td>
          </tr>
          <tr>
            <th>Locale / Lang</th>
            <td>
              <span title="Language: ${escapeHtml(langKey)}">${langFlag} <span style="font-size:10px; color:var(--sfpi-text-muted);">${escapeHtml(langKey)}</span></span>
              <span style="color:var(--sfpi-text-muted); margin:0 4px;">|</span>
              <span title="Default Locale: ${escapeHtml(localeKey)}">${localeFlag} <span style="font-size:10px; color:var(--sfpi-text-muted);">${escapeHtml(localeKey)}</span></span>
            </td>
          </tr>
          ${createdDateStr ? `
            <tr>
              <th>Created Date</th>
              <td style="font-size:11px; color:var(--sfpi-text-muted);">${createdDateStr}</td>
            </tr>
          ` : ""}
          ${trialExpiryStr ? `
            <tr>
              <th>Trial Expires</th>
              <td style="font-size:11px; color:#e11d48; font-weight:600;">${trialExpiryStr}</td>
            </tr>
          ` : ""}
        </tbody>
      </table>

      ${isEditingOrgDetails ? `
        <div style="margin-top:8px; display:flex; gap:6px;">
          <button id="btn-save-org-details" class="sfpi-user-btn sfpi-btn-login" style="flex:1; justify-content:center; padding:6px 12px; font-weight:700;">
            💾 Save Organization Changes
          </button>
        </div>
      ` : `
        <div class="sfpi-user-btn-row" style="margin-top:8px;">
          <a href="${chrome.runtime.getURL(`inspect-record.html?host=${targetHost}&id=${orgId}`)}" target="_blank" class="sfpi-user-btn" style="flex:1; text-align:center;" title="Show All Data and fields for Organization record">
            🔍 Inspect All Org Fields (Show All Data)
          </a>
        </div>
      `}
    </div>

    <!-- Card 2: 📊 Critical Org Limits & Storage -->
    <div class="sfpi-section" style="padding:10px 12px; margin-bottom:8px;">
      
      <!-- Proactive Storage Alert Banner (Highlighter / Reminder before limit exceeded) -->
      ${isStorageCritical ? `
        <div class="sfpi-storage-alert sfpi-storage-alert-critical">
          <div>
            <strong>🚨 Storage Exceeded (${dataPct}% Data)!</strong>
            <div style="font-size:10px; opacity:0.9;">Salesforce operations will fail. Clean logs & files now.</div>
          </div>
          <button class="sfpi-alert-btn" id="btn-open-storage-cleaner-alert">🧹 Clean Storage</button>
        </div>
      ` : isStorageWarning ? `
        <div class="sfpi-storage-alert sfpi-storage-alert-warning">
          <div>
            <strong>⚠️ Storage Warning: Nearing Limit (${dataPct}%)</strong>
            <div style="font-size:10px; opacity:0.9;">Projected limit breach in &lt; 24h. Safe cleanup recommended.</div>
          </div>
          <button class="sfpi-alert-btn" id="btn-open-storage-cleaner-alert" style="background:#f59e0b;">🧹 Clean</button>
        </div>
      ` : ""}

      <div class="sfpi-org-card-header">
        <div class="sfpi-org-card-title">
          <span>📊</span>
          <span>Critical Org Limits & Storage</span>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <button id="btn-card-clean-storage" class="sfpi-btn-icon-subtle" title="Open Storage Cleaner & Optimizer" style="font-size:10.5px; padding:2px 6px; font-weight:600; color:#0176d3; display:inline-flex; align-items:center; gap:3px;">
            🧹 Clean Storage
          </button>
          <a href="${chrome.runtime.getURL(`org-limits.html?host=${targetHost}`)}" target="_blank" class="sfpi-user-link" style="font-size:11px; font-weight:600;" title="Open All 100+ Salesforce Limits Analyzer">
            Limits ↗
          </a>
        </div>
      </div>

      <div class="sfpi-limit-box">
        ${getLimitBar("Daily API Requests", orgLimitsData?.DailyApiRequests, false)}
        ${getLimitBar("Data Storage", orgLimitsData?.DataStorageMB, true)}
        ${getLimitBar("File Storage", orgLimitsData?.FileStorageMB, true)}
      </div>
    </div>

    <!-- Card 3: ⚡ Fast Actions & Administration -->
    <div class="sfpi-section" style="padding:10px 12px; margin-bottom:8px;">
      <div class="sfpi-org-card-header">
        <div class="sfpi-org-card-title">
          <span>⚡</span>
          <span>Fast Actions & Administration</span>
        </div>
        <button id="btn-refresh-org-cache" class="sfpi-btn-icon-subtle" title="Refresh Org Details & Limits Cache" style="font-size:11px; padding:2px 6px;">
          🔄 Refresh
        </button>
      </div>

      <div class="sfpi-user-btn-row sfpi-user-btn-row-2col" style="margin-bottom:8px;">
        <button id="btn-open-storage-studio" class="sfpi-user-btn sfpi-btn-login" style="font-weight:700;" title="Free up sandbox storage with selective time period filters">
          🧹 Clean Storage
        </button>
        <button id="btn-delete-apex-logs" class="sfpi-user-btn sfpi-btn-danger" title="Quick delete all Apex debug logs via Tooling API to free up storage">
          🗑️ Delete ApexLogs
        </button>
      </div>

      <div style="font-size:10.5px; font-weight:700; color:var(--sfpi-text-muted); margin-bottom:5px; text-transform:uppercase; letter-spacing:0.5px;">
        Direct Setup Shortcuts
      </div>
      <div class="sfpi-quick-links">
        ${quickLink("Company Info", "/lightning/setup/CompanyProfileInfo/home")}
        ${quickLink("Session Settings", "/lightning/setup/SecuritySession/home")}
        ${quickLink("Sharing Settings", "/lightning/setup/SecuritySharing/home")}
        ${quickLink("Storage Usage", "/lightning/setup/CompanyResourceDisk/home")}
        ${quickLink("Manage Users", "/lightning/setup/ManageUsers/home")}
        ${quickLink("My Domain", "/lightning/setup/OrgDomain/home")}
      </div>
    </div>
  `;

  // Bind Events for Org Card
  document.getElementById("btn-copy-org-tab-id")?.addEventListener("click", () => copyText(orgId));
  document.getElementById("btn-copy-org-tab-btn")?.addEventListener("click", () => copyText(orgId));
  document.getElementById("btn-edit-org-details")?.addEventListener("click", () => {
    isEditingOrgDetails = true;
    updateOrgTabContent();
  });
  document.getElementById("btn-cancel-org-details")?.addEventListener("click", () => {
    isEditingOrgDetails = false;
    updateOrgTabContent();
  });
  document.getElementById("btn-save-org-details")?.addEventListener("click", (e) => saveOrgDetails(e.currentTarget));
  document.getElementById("btn-delete-apex-logs")?.addEventListener("click", (e) => deleteApexLogs(e.currentTarget));
  document.getElementById("btn-refresh-org-cache")?.addEventListener("click", () => refreshOrgCache());
  document.getElementById("btn-open-storage-cleaner-alert")?.addEventListener("click", () => openStorageCleanerModal());
  document.getElementById("btn-card-clean-storage")?.addEventListener("click", () => openStorageCleanerModal());
  document.getElementById("btn-open-storage-studio")?.addEventListener("click", () => openStorageCleanerModal());
}

function getLimitBar(label, limitObj, isMb = false) {
  if (!limitObj) {
    return `
      <div class="sfpi-limit-row">
        <div class="sfpi-limit-header">
          <span class="sfpi-limit-title">${label}</span>
          <span class="sfpi-limit-val">Loading...</span>
        </div>
        <div class="sfpi-progress-bar"><div class="sfpi-progress-fill" style="width:0%;"></div></div>
      </div>
    `;
  }

  const max = limitObj.Max || 0;
  const remaining = limitObj.Remaining !== undefined ? limitObj.Remaining : max;
  const used = Math.max(0, max - remaining);
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const fillClass = pct >= 90 ? "sfpi-progress-red" : pct >= 75 ? "sfpi-progress-orange" : "sfpi-progress-green";

  const formatNum = (n) => {
    if (isMb) {
      return n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n.toLocaleString()} MB`;
    }
    return n.toLocaleString();
  };

  const valText = `${formatNum(used)} / ${formatNum(max)} (${pct}%)`;

  return `
    <div class="sfpi-limit-row">
      <div class="sfpi-limit-header">
        <span class="sfpi-limit-title">${label}</span>
        <span class="sfpi-limit-val">${valText}</span>
      </div>
      <div class="sfpi-progress-bar">
        <div class="sfpi-progress-fill ${fillClass}" style="width:${pct}%;"></div>
      </div>
    </div>
  `;
}

async function saveOrgDetails(btnEl) {
  const orgId = orgExtendedData?.Id || orgInfo?.orgId || orgInfo?.id;
  if (!orgId) {
    showToast("Error: No Org ID found to update.");
    return;
  }

  const nameInput = document.getElementById("sfpi-edit-org-name");
  const contactInput = document.getElementById("sfpi-edit-org-contact");
  const divisionInput = document.getElementById("sfpi-edit-org-division");

  const newName = nameInput ? nameInput.value.trim() : null;
  const newContact = contactInput ? contactInput.value.trim() : null;
  const newDivision = divisionInput ? divisionInput.value.trim() : null;

  const payload = {};
  if (newName !== null) payload.Name = newName;
  if (newContact !== null) payload.PrimaryContact = newContact;
  if (newDivision !== null) payload.Division = newDivision;

  if (Object.keys(payload).length === 0) {
    isEditingOrgDetails = false;
    updateOrgTabContent();
    return;
  }

  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = "Saving...";
  }

  try {
    await sfConn.rest(`/services/data/v${apiVersion}/sobjects/Organization/${orgId}`, {
      method: "PATCH",
      body: payload
    });

    if (orgExtendedData) {
      Object.assign(orgExtendedData, payload);
      localStorage.setItem(sfHost + "_orgExtended", JSON.stringify(orgExtendedData));
    }
    if (payload.Name && orgInfo) {
      orgInfo.companyName = payload.Name;
      orgInfo.name = payload.Name;
      localStorage.setItem(sfHost + "_orgInfo", JSON.stringify(orgInfo));
    }

    showToast("✓ Organization details updated successfully!");
    isEditingOrgDetails = false;
    updateOrgTabContent();

    // Update header org name dynamically
    const orgNameEl = document.querySelector(".sfpi-org-name");
    if (orgNameEl && payload.Name) orgNameEl.textContent = payload.Name;
  } catch (err) {
    console.error("Failed to update organization:", err);
    showToast("Update failed: " + (err.message || err));
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = "💾 Save Organization Changes";
    }
  }
}

async function deleteApexLogs(btnEl) {
  if (!confirm("Are you sure you want to delete all Apex debug logs in this org?\nThis will permanently delete records in the ApexLog object to free up storage.")) {
    return;
  }

  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = "Querying logs...";
  }

  try {
    const res = await sfConn.query("SELECT Id FROM ApexLog LIMIT 200", true, { logErrors: false });
    const records = res?.records || [];
    if (records.length === 0) {
      showToast("No Apex logs found to delete.");
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.textContent = "🗑️ Delete All ApexLogs";
      }
      return;
    }

    if (btnEl) btnEl.textContent = `Deleting ${records.length} logs...`;

    const requests = records.map((r, i) => ({
      method: "DELETE",
      url: `/services/data/v${apiVersion}/tooling/sobjects/ApexLog/${r.Id}`,
      referenceId: `log_${i}`
    }));

    await sfConn.composite(requests);
    showToast(`✓ Deleted ${records.length} Apex debug logs!`);
  } catch (err) {
    console.error("Failed to delete Apex logs:", err);
    showToast("Delete failed: " + (err.message || err));
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = "🗑️ Delete All ApexLogs";
    }
  }
}

async function refreshOrgCache() {
  localStorage.removeItem(sfHost + "_orgExtended");
  localStorage.removeItem(sfHost + "_orgLimits");
  orgExtendedData = null;
  orgLimitsData = null;
  updateOrgTabContent();
  showToast("Refreshing Org data...");
  await loadExtendedOrgData();
  showToast("✓ Org data refreshed!");
}

// ─── Interactive Storage Cleaner & Sandbox Optimizer Modal ───────────
function openStorageCleanerModal() {
  const existing = document.getElementById("sfpi-storage-modal-overlay");
  if (existing) existing.remove();

  const targetHost = sfConn.instanceHostname || sfHost;
  const overlay = document.createElement("div");
  overlay.id = "sfpi-storage-modal-overlay";
  overlay.className = "sfpi-modal-overlay";

  overlay.innerHTML = `
    <div class="sfpi-modal">
      <div class="sfpi-modal-header">
        <div class="sfpi-modal-title">
          <span>🧹</span>
          <span>Storage Cleaner & Sandbox Optimizer</span>
        </div>
        <button id="btn-close-storage-modal" class="sfpi-btn-icon-subtle" style="font-size:14px; padding:2px 6px;">✕</button>
      </div>

      <div class="sfpi-modal-body">
        <!-- Storage Quota Status -->
        <div style="background:rgba(0,0,0,0.03); border-radius:6px; padding:8px 10px; font-size:11px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <span>Data Storage:</span>
            <strong id="modal-data-storage-val">Calculating...</strong>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span>File Storage:</span>
            <strong id="modal-file-storage-val">Calculating...</strong>
          </div>
        </div>

        <!-- Step 1: Selective Time Period Filter -->
        <div>
          <label style="font-weight:700; font-size:11px; display:block; margin-bottom:4px;">
            📅 Selective Time Period (Preserves Recent Records):
          </label>
          <select id="modal-clean-period-select" class="sfpi-select-small" style="width:100%; font-size:11px; padding:4px 6px;">
            <option value="7" selected>Older than 7 Days (Recommended & Safe)</option>
            <option value="30">Older than 30 Days (1 Month)</option>
            <option value="90">Older than 90 Days (3 Months)</option>
            <option value="custom_date">Custom Date Picker (Calendar)...</option>
            <option value="all">⚠️ All Time (Delete All Historical Records)</option>
          </select>
          <div id="modal-custom-date-wrap" style="display:none; margin-top:6px;">
            <input type="date" id="modal-clean-date-input" class="sfpi-edit-input">
          </div>
        </div>

        <!-- Step 2: Categories Selection -->
        <div>
          <label style="font-weight:700; font-size:11px; display:block; margin-bottom:4px;">
            📦 Select Categories to Clean:
          </label>
          <div style="display:flex; flex-direction:column; gap:5px;">
            <label class="sfpi-clean-item" style="cursor:pointer;">
              <div style="display:flex; align-items:center; gap:6px;">
                <input type="checkbox" id="mchk-apexlog" checked>
                <div>
                  <strong>Apex Debug Logs</strong>
                  <span class="sfpi-clean-badge-rec">🔥 Recommended</span>
                </div>
              </div>
              <span id="mcount-apexlog" style="color:var(--sfpi-text-muted); font-size:10px;">—</span>
            </label>

            <label class="sfpi-clean-item" style="cursor:pointer;">
              <div style="display:flex; align-items:center; gap:6px;">
                <input type="checkbox" id="mchk-emailattach" checked>
                <div>
                  <strong>Email Attachments</strong>
                  <span class="sfpi-clean-badge-high">🔥 High Size</span>
                </div>
              </div>
              <span id="mcount-emailattach" style="color:var(--sfpi-text-muted); font-size:10px;">—</span>
            </label>

            <label class="sfpi-clean-item" style="cursor:pointer;">
              <div style="display:flex; align-items:center; gap:6px;">
                <input type="checkbox" id="mchk-files">
                <div>
                  <strong>Stale Files (ContentDocument)</strong>
                </div>
              </div>
              <span id="mcount-files" style="color:var(--sfpi-text-muted); font-size:10px;">—</span>
            </label>

            <label class="sfpi-clean-item" style="cursor:pointer;">
              <div style="display:flex; align-items:center; gap:6px;">
                <input type="checkbox" id="mchk-attach">
                <div>
                  <strong>Classic Attachments</strong>
                </div>
              </div>
              <span id="mcount-attach" style="color:var(--sfpi-text-muted); font-size:10px;">—</span>
            </label>
          </div>
        </div>

        <!-- Action / Status -->
        <div style="display:flex; gap:6px;">
          <button id="btn-modal-count" class="sfpi-user-btn" style="flex:1; justify-content:center;">
            🔍 Scan Counts
          </button>
          <button id="btn-modal-clean-now" class="sfpi-user-btn sfpi-btn-danger" style="flex:1; justify-content:center; font-weight:700;" disabled>
            🧹 Clean Selected
          </button>
        </div>

        <!-- Progress Box -->
        <div id="modal-progress-wrap" style="display:none; padding:8px; background:rgba(0,0,0,0.03); border-radius:6px;">
          <div style="display:flex; justify-content:space-between; font-size:10.5px; font-weight:600; margin-bottom:4px;">
            <span id="modal-progress-msg">Cleaning...</span>
            <span id="modal-progress-pct">0%</span>
          </div>
          <div class="sfpi-progress-bar"><div id="modal-progress-fill" class="sfpi-progress-fill" style="width:0%; background:#2563eb;"></div></div>
        </div>
      </div>

      <div class="sfpi-modal-footer">
        <a href="${chrome.runtime.getURL(`storage-cleaner.html?host=${targetHost}`)}" target="_blank" class="sfpi-user-link" style="font-size:11px; margin-right:auto;">
          Open Full Storage Studio ↗
        </a>
        <button id="btn-close-storage-modal-foot" class="sfpi-user-btn">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close bindings
  const closeModal = () => overlay.remove();
  document.getElementById("btn-close-storage-modal")?.addEventListener("click", closeModal);
  document.getElementById("btn-close-storage-modal-foot")?.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  // Populate limits
  const dataLim = orgLimitsData?.DataStorageMB;
  const fileLim = orgLimitsData?.FileStorageMB;
  const dataMax = dataLim?.Max || 0;
  const dataRem = dataLim?.Remaining !== undefined ? dataLim.Remaining : dataMax;
  const dataUsed = Math.max(0, dataMax - dataRem);
  const dataPct = dataMax > 0 ? Math.round((dataUsed / dataMax) * 100) : 0;
  const fileMax = fileLim?.Max || 0;
  const fileRem = fileLim?.Remaining !== undefined ? fileLim.Remaining : fileMax;
  const fileUsed = Math.max(0, fileMax - fileRem);
  const filePct = fileMax > 0 ? Math.round((fileUsed / fileMax) * 100) : 0;

  const dataValEl = document.getElementById("modal-data-storage-val");
  const fileValEl = document.getElementById("modal-file-storage-val");
  if (dataValEl) dataValEl.textContent = `${dataUsed}/${dataMax} MB (${dataPct}%)`;
  if (fileValEl) fileValEl.textContent = `${fileUsed}/${fileMax} MB (${filePct}%)`;

  // Handle custom date select
  const selectEl = document.getElementById("modal-clean-period-select");
  const customWrap = document.getElementById("modal-custom-date-wrap");
  selectEl?.addEventListener("change", () => {
    if (customWrap) customWrap.style.display = selectEl.value === "custom_date" ? "block" : "none";
  });

  // Scan counts
  const btnCount = document.getElementById("btn-modal-count");
  const btnClean = document.getElementById("btn-modal-clean-now");
  let modalCounts = {};

  const scanModalCounts = async () => {
    if (btnCount) { btnCount.disabled = true; btnCount.textContent = "Scanning..."; }
    const selVal = selectEl?.value || "7";
    let whereClause = "CreatedDate < LAST_N_DAYS:7";
    if (selVal === "30") whereClause = "CreatedDate < LAST_N_DAYS:30";
    else if (selVal === "90") whereClause = "CreatedDate < LAST_N_DAYS:90";
    else if (selVal === "custom_date") {
      const d = document.getElementById("modal-clean-date-input")?.value;
      whereClause = d ? `CreatedDate < ${d}T00:00:00Z` : "CreatedDate < LAST_N_DAYS:7";
    } else if (selVal === "all") whereClause = "";

    modalCounts = {};
    let total = 0;

    // ApexLog
    if (document.getElementById("mchk-apexlog")?.checked) {
      try {
        const q = whereClause ? `SELECT count() FROM ApexLog WHERE ${whereClause}` : "SELECT count() FROM ApexLog";
        const res = await sfConn.query(q, true, { logErrors: false });
        const c = res.totalSize || 0;
        modalCounts["ApexLog"] = c;
        total += c;
        const el = document.getElementById("mcount-apexlog");
        if (el) el.textContent = `${c} recs`;
      } catch (e) {}
    }

    // Email Attachments
    if (document.getElementById("mchk-emailattach")?.checked) {
      try {
        const q = whereClause ? `SELECT count() FROM Attachment WHERE ParentId IN (SELECT Id FROM EmailMessage) AND ${whereClause}` : "SELECT count() FROM Attachment WHERE ParentId IN (SELECT Id FROM EmailMessage)";
        const res = await sfConn.query(q, false, { logErrors: false });
        const c = res.totalSize || 0;
        modalCounts["EmailAttach"] = c;
        total += c;
        const el = document.getElementById("mcount-emailattach");
        if (el) el.textContent = `${c} recs`;
      } catch (e) {}
    }

    // Files
    if (document.getElementById("mchk-files")?.checked) {
      try {
        const q = whereClause ? `SELECT count() FROM ContentDocument WHERE ${whereClause}` : "SELECT count() FROM ContentDocument";
        const res = await sfConn.query(q, false, { logErrors: false });
        const c = res.totalSize || 0;
        modalCounts["Files"] = c;
        total += c;
        const el = document.getElementById("mcount-files");
        if (el) el.textContent = `${c} recs`;
      } catch (e) {}
    }

    // Attachments
    if (document.getElementById("mchk-attach")?.checked) {
      try {
        const q = whereClause ? `SELECT count() FROM Attachment WHERE (NOT ParentId IN (SELECT Id FROM EmailMessage)) AND ${whereClause}` : "SELECT count() FROM Attachment WHERE (NOT ParentId IN (SELECT Id FROM EmailMessage))";
        const res = await sfConn.query(q, false, { logErrors: false });
        const c = res.totalSize || 0;
        modalCounts["Attach"] = c;
        total += c;
        const el = document.getElementById("mcount-attach");
        if (el) el.textContent = `${c} recs`;
      } catch (e) {}
    }

    if (btnCount) { btnCount.disabled = false; btnCount.textContent = "🔍 Scan Counts"; }
    if (btnClean) {
      btnClean.disabled = total === 0;
      btnClean.textContent = `🧹 Clean (${total} records)`;
    }
  };

  btnCount?.addEventListener("click", scanModalCounts);
  scanModalCounts();

  // Run cleanup
  btnClean?.addEventListener("click", async () => {
    const total = Object.values(modalCounts).reduce((a, b) => a + b, 0);
    if (!confirm(`⚠️ Confirm Permanent Storage Cleanup:\n\nYou are about to permanently delete ${total} records from this Salesforce org.\n\nCriteria: ${selectEl?.selectedOptions[0]?.text}\n\nAre you sure you want to proceed? This cannot be undone.`)) {
      return;
    }

    btnClean.disabled = true;
    if (btnCount) btnCount.disabled = true;
    const progressWrap = document.getElementById("modal-progress-wrap");
    const progressMsg = document.getElementById("modal-progress-msg");
    const progressFill = document.getElementById("modal-progress-fill");
    const progressPct = document.getElementById("modal-progress-pct");
    if (progressWrap) progressWrap.style.display = "block";

    const selVal = selectEl?.value || "7";
    let whereClause = "CreatedDate < LAST_N_DAYS:7";
    if (selVal === "30") whereClause = "CreatedDate < LAST_N_DAYS:30";
    else if (selVal === "90") whereClause = "CreatedDate < LAST_N_DAYS:90";
    else if (selVal === "custom_date") {
      const d = document.getElementById("modal-clean-date-input")?.value;
      whereClause = d ? `CreatedDate < ${d}T00:00:00Z` : "CreatedDate < LAST_N_DAYS:7";
    } else if (selVal === "all") whereClause = "";

    let totalDeleted = 0;

    // Delete ApexLog
    if (modalCounts["ApexLog"] > 0) {
      if (progressMsg) progressMsg.textContent = "Deleting Apex debug logs...";
      while (true) {
        const q = whereClause ? `SELECT Id FROM ApexLog WHERE ${whereClause} LIMIT 200` : "SELECT Id FROM ApexLog LIMIT 200";
        const r = await sfConn.query(q, true, { logErrors: false });
        const recs = r?.records || [];
        if (recs.length === 0) break;
        const requests = recs.map((rec, i) => ({
          method: "DELETE",
          url: `/services/data/v${apiVersion}/tooling/sobjects/ApexLog/${rec.Id}`,
          referenceId: `del_${i}`
        }));
        await sfConn.composite(requests);
        totalDeleted += recs.length;
        const pct = Math.min(100, Math.round((totalDeleted / total) * 100));
        if (progressPct) progressPct.textContent = `${pct}%`;
        if (progressFill) progressFill.style.width = `${pct}%`;
      }
    }

    // Delete Email Attachments
    if (modalCounts["EmailAttach"] > 0) {
      if (progressMsg) progressMsg.textContent = "Deleting email attachments...";
      const emailClause = whereClause ? `ParentId IN (SELECT Id FROM EmailMessage) AND ${whereClause}` : "ParentId IN (SELECT Id FROM EmailMessage)";
      while (true) {
        const q = `SELECT Id FROM Attachment WHERE ${emailClause} LIMIT 200`;
        const r = await sfConn.query(q, false, { logErrors: false });
        const recs = r?.records || [];
        if (recs.length === 0) break;
        const ids = recs.map(rec => rec.Id).join(",");
        await sfConn.rest(`/services/data/v${apiVersion}/composite/sobjects?ids=${ids}&allOrNone=false`, { method: "DELETE" });
        totalDeleted += recs.length;
        const pct = Math.min(100, Math.round((totalDeleted / total) * 100));
        if (progressPct) progressPct.textContent = `${pct}%`;
        if (progressFill) progressFill.style.width = `${pct}%`;
      }
    }

    if (progressMsg) progressMsg.textContent = `✓ Deleted ${totalDeleted} records! Storage freed.`;
    showToast(`✓ Successfully freed storage: ${totalDeleted} records deleted!`);
    await loadExtendedOrgData();
    setTimeout(() => closeModal(), 1500);
  });
}

// ─── Record Context (Objects Tab) ───────────────────────────────────
function updateRecordSection() {
  const section = document.getElementById("record-section");
  const actions = document.getElementById("record-actions");
  if (!section || !actions) return;

  if (!currentRecordId) {
    section.style.display = "block";
    actions.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <span style="font-size:11px; color:var(--sfpi-text-muted);">No active record in view</span>
        <button class="sfpi-record-btn" id="btn-show-api-names" style="max-width:140px; padding:4px 10px;">${showingApiNames ? "Hide API Names" : "Show API Names"}</button>
      </div>
    `;
    document.getElementById("btn-show-api-names")?.addEventListener("click", (e) => {
      showingApiNames = !showingApiNames;
      e.target.textContent = showingApiNames ? "Hide API Names" : "Show API Names";
      parent.postMessage({ sfpiToggleApiNames: showingApiNames ? "show" : "hide" }, "*");
    });
    return;
  }

  const targetHost = sfConn.instanceHostname || sfHost;
  section.style.display = "block";
  actions.innerHTML = `
    <div class="sfpi-record-id">
      <code>${currentRecordId}</code>
      <button class="sfpi-copy-btn" id="btn-copy-cur-id" title="Copy Record ID">📋</button>
    </div>
    <div class="sfpi-record-tools-bar">
      <button class="sfpi-record-btn" id="btn-show-api-names">${showingApiNames ? "Hide API Names" : "Show API Names"}</button>
      <button class="sfpi-record-btn" id="btn-copy-record-id">Copy Record ID</button>
    </div>
    <div class="sfpi-record-links">
      <a href="https://${targetHost}/${currentRecordId}" target="_blank" class="sfpi-record-link-pill sfpi-link-open" title="Open Record in Salesforce">Open Record</a>
      <a href="${chrome.runtime.getURL(`inspect-record.html?host=${targetHost}&id=${currentRecordId}`)}" target="_blank" class="sfpi-record-link-pill sfpi-link-show-data" title="Inspect All Fields & Values (Show All Data)">🔍 Show Data</a>
      <a href="${chrome.runtime.getURL(`permission-analyzer.html?host=${targetHost}&id=${currentRecordId}`)}" target="_blank" class="sfpi-record-link-pill sfpi-link-check-access" title="Check Permissions & FLS Access">🔐 Check Access</a>
    </div>
  `;

  document.getElementById("btn-copy-cur-id")?.addEventListener("click", () => copyText(currentRecordId));
  document.getElementById("btn-copy-record-id")?.addEventListener("click", () => copyText(currentRecordId));

  document.getElementById("btn-show-api-names")?.addEventListener("click", (e) => {
    showingApiNames = !showingApiNames;
    e.target.textContent = showingApiNames ? "Hide API Names" : "Show API Names";
    parent.postMessage({ sfpiToggleApiNames: showingApiNames ? "show" : "hide" }, "*");
  });
}

function copyText(text) {
  if (!text) return;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const successful = document.execCommand("copy");
    document.body.removeChild(ta);
    if (successful) {
      showToast("✓ Copied: " + text);
      return;
    }
  } catch (err) {
    // execCommand fallback
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast("✓ Copied: " + text);
    }).catch(() => {
      parent.postMessage({ sfpiCopyToClipboard: text }, "*");
      showToast("✓ Copied: " + text);
    });
  } else {
    parent.postMessage({ sfpiCopyToClipboard: text }, "*");
    showToast("✓ Copied: " + text);
  }
}

// ─── Toast Notification ─────────────────────────────────────────────
function showToast(msg) {
  const toast = document.createElement("div");
  toast.className = "sfpi-toast";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("sfpi-toast-show"), 10);
  setTimeout(() => {
    toast.classList.remove("sfpi-toast-show");
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}

// ─── Listen for context updates from content script ─────────────────
window.addEventListener("message", (e) => {
  if (e.data?.sfpiUpdate) {
    currentRecordId = e.data.recordId;
    updateRecordSection();
  }
});

// ─── Boot ───────────────────────────────────────────────────────────
init();
