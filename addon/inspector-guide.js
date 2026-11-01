import { updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";

// ─── 1. INSPECTOR USER GUIDE & TOOL DIRECTORY ───────────────────────
const INSPECTOR_TOOLS_DIRECTORY = [
  {
    id: "inspect-record",
    name: "Show All Data & Record Inspector",
    icon: "🔍",
    categoryGroup: "DATA",
    category: "Data Inspection & Live Editing",
    badge: "CORE INSPECTOR",
    tagClass: "tag-schema",
    summary: "Deep inspection of all standard & custom fields (including fields hidden from page layouts), live inline editing, field searching, hiding null values, inspecting FLS/metadata, and deleting or cloning records.",
    features: [
      "<strong>Inspect Any SObject or Record ID:</strong> Paste any 15 or 18-character Salesforce record ID, or select any standard or custom object to instantly load its latest modified record.",
      "<strong>Inline Value Editing:</strong> Click ✏️ Edit on any field to modify values inline, complete with data type validation (dates, numbers, booleans, references).",
      "<strong>Live Field Filtering & Hide Nulls:</strong> Real-time search filter across API names and labels. Toggle 'Hide empty/null fields' to focus on populated data.",
      "<strong>FLS & Field Metadata Deep Links:</strong> Jump straight into the Field-Level Security matrix in Field Manager for any custom field.",
      "<strong>Export JSON & Open in SF:</strong> 1-click Copy full JSON payload or jump directly to the Lightning record page."
    ],
    howToUse: "1. Paste a Record ID (e.g., 001...) or pick an SObject from the dropdown.\n2. Use the filter bar to isolate fields.\n3. Click ✏️ Edit to modify a field value and hit OK to save directly to Salesforce.\n4. Use 'Open in SF' to view in Lightning Experience.",
    sfReference: "Salesforce REST SObject API (`/services/data/vXX.0/sobjects/{sObject}/{id}`)"
  },
  {
    id: "data-explorer",
    name: "Data Explorer & SOQL Query Studio",
    icon: "📤",
    categoryGroup: "DATA",
    category: "Query & AI Studio",
    badge: "PRO STUDIO",
    tagClass: "tag-ai",
    summary: "High-performance SOQL, SOSL, and GraphQL data query environment featuring 🤖 AI Prompt-to-SOQL Studio (100% Free heuristic engine + BYOK), multi-object parent/child relationship visualizer, multi-format export, and soft-deleted querying.",
    features: [
      "<strong>🤖 AI Query Studio (Prompt-to-SOQL):</strong> Write complex SOQL queries from plain English prompts without any org cost or mandatory API keys.",
      "<strong>🌲 Relations Tree (Parent & Child):</strong> Visually inspect lookup relationships (`Account.Owner.Name`) and child subqueries (`(SELECT LastName FROM Contacts)`) and inject them into queries with 1 click.",
      "<strong>📋 Multi-Format Export:</strong> Copy for Excel (TSV with headers), Copy CSV, Copy JSON, and Copy `IN ('...')` clause for easy chaining.",
      "<strong>🗑️ Include Deleted (queryAll):</strong> Query soft-deleted records in the Recycle Bin and archived Activity records with a single toggle.",
      "<strong>⚡ Auto-Pagination & Real-Time Filter:</strong> Stream large result sets with cursor-based pagination and filter visible rows instantly."
    ],
    howToUse: "1. Enter a SOQL query or use the 🤖 AI Studio to generate one from a prompt.\n2. Click 'Run Query (Ctrl+Enter)' to fetch records.\n3. Filter results in the Data Grid using the real-time filter.\n4. Click '📋 Copy (Excel)' to paste formatted data directly into spreadsheets.",
    sfReference: "Salesforce SOQL & SOSL Reference Guide, Query / QueryAll REST API"
  },
  {
    id: "field-manager",
    name: "Field Manager, Editor & FLS Studio",
    icon: "📝",
    categoryGroup: "ADMIN",
    category: "Field & Security Governance",
    badge: "ADMIN PRO",
    tagClass: "tag-sec",
    summary: "Create and configure custom fields on standard and custom objects, modify field definitions, and manage Field-Level Security (FLS) permissions across 260+ Profiles and Permission Sets with 1-click bulk toggles.",
    features: [
      "<strong>1-Click Bulk FLS Matrix:</strong> Set Visible (Edit), Read-Only, or Clear Across All 260+ Profiles & Permission Sets instantly.",
      "<strong>Create Custom Fields:</strong> Provision new fields (Text, Number, Currency, Checkbox, Picklist, Date, Lookup) via Tooling API without multi-step Setup pages.",
      "<strong>Edit Field Metadata:</strong> Update Help Text (inlineHelpText) and Description for org documentation directly.",
      "<strong>Direct Setup Links:</strong> 1-click jump to the Salesforce Setup page for the specific field or object."
    ],
    howToUse: "1. Select target SObject (e.g. Account, Custom_Obj__c).\n2. Select a field on the left panel.\n3. Modify Field-Level Security in the matrix on the right (use 'Visible to All' or individual checkboxes).\n4. Click '💾 Save FLS Matrix' to deploy permissions to the org.",
    sfReference: "Tooling API (`CustomField`), FieldPermissions SObject, Profiles & PermSets"
  },
  {
    id: "data-import",
    name: "Data Import & Bulk DataStream Studio",
    icon: "📥",
    categoryGroup: "DATA",
    category: "Bulk Data Operations",
    badge: "HIGH SPEED",
    tagClass: "tag-schema",
    summary: "High-speed record ingestion and manipulation engine. Insert, Update, Upsert, Delete, and Hard Delete thousands of records. Direct copy-paste from Excel or Google Sheets (TSV/CSV) with automatic header-to-field mapping.",
    features: [
      "<strong>📋 Copy-Paste Spreadsheet Ingestion:</strong> Copy rows from Excel or Google Sheets and paste directly into the browser.",
      "<strong>Intelligent Header Auto-Mapping:</strong> Automatically detects column names and pairs them with SObject API names.",
      "<strong>Bulk DML Operations:</strong> Supports Insert, Update, Upsert (with External ID), Delete, and Hard Delete.",
      "<strong>Governor Safe Chunking:</strong> Batches payloads into 200-record chunks to prevent CPU and DML limit exceptions.",
      "<strong>⚠️ Failure CSV Export:</strong> Exports failed rows with detailed error messages for quick remediation."
    ],
    howToUse: "1. Select target SObject and operation (Insert/Update/Upsert/Delete).\n2. Paste TSV/CSV data into the input box.\n3. Verify auto-mapped columns and map any unmatched fields.\n4. Click 'Run Import' and monitor real-time batch progress.",
    sfReference: "Composite SObject Collections API, Bulk API 2.0 Guide"
  },
  {
    id: "schema-viewer",
    name: "Schema Studio & ERD Builder",
    icon: "🗺️",
    categoryGroup: "DATA",
    category: "Schema & Data Modeling",
    badge: "VISUAL ERD",
    tagClass: "tag-schema",
    summary: "Interactive visual Entity-Relationship Diagram (ERD) canvas and data dictionary. Explore schemas, zoom/pan entity nodes, inspect lookup and master-detail connections, and auto-generate SOQL queries by checking fields.",
    features: [
      "<strong>Interactive Relationship Graph:</strong> Visualizes connections between master and child entities.",
      "<strong>1-Click SOQL Query Generator:</strong> Tick field checkboxes to automatically generate complete SELECT statements.",
      "<strong>Schema Exploration:</strong> View field types, lengths, calculated formulas, and relationship names.",
      "<strong>Cross-Tool Deep Links:</strong> Jump from any entity directly into Record Inspector or Data Explorer."
    ],
    howToUse: "1. Select objects to load onto the canvas.\n2. Drag entity cards to arrange your ERD.\n3. Click on fields to inspect details or check boxes to construct SOQL queries.\n4. Click 'Open in Data Explorer' to execute the generated query.",
    sfReference: "Describe Global & Describe SObject REST APIs, EntityDefinition"
  },
  {
    id: "metadata-browser",
    name: "Metadata Browser & Package Explorer",
    icon: "📦",
    categoryGroup: "ADMIN",
    category: "Metadata & Org Architecture",
    badge: "CATALOG",
    tagClass: "tag-schema",
    summary: "Deep exploration of 31+ Salesforce metadata categories (Apex Classes, Custom Objects, Flows, Permission Sets, Lightning Web Components, Aura, Validation Rules) with real-time component counts, drill-downs, and deep links.",
    features: [
      "<strong>Complete Org Inventory:</strong> Live counts across 28,000+ metadata components in the organization.",
      "<strong>Expandable Component Drill-down:</strong> Click any metadata row to inspect individual component names, IDs, and last modified dates.",
      "<strong>Direct Action Router:</strong> 1-click deep links: 'Inspect' records/schema, 'Query' in Data Explorer, 'Fields & FLS', and 'Open in SF'.",
      "<strong>Quick Copy:</strong> Copy all component names or IDs to clipboard with a single click."
    ],
    howToUse: "1. Filter metadata types using the search bar or category tabs.\n2. Click any metadata row (e.g. Standard Objects) to expand its components.\n3. Click 'Inspect' or 'Query' on any component to launch dedicated tools.",
    sfReference: "Salesforce Tooling API, Metadata API `describeMetadata` / `listMetadata`"
  },
  {
    id: "agentforce-studio",
    name: "Agentforce Studio & GenAI Hub",
    icon: "🤖",
    categoryGroup: "AI",
    category: "Agentforce & GenAI",
    badge: "AI SPECIALIST",
    tagClass: "tag-ai",
    summary: "Dedicated command center for Salesforce Agentforce, Einstein Copilots, Autonomous Agents, Agent Actions, Prompt Builder Templates, and the Einstein Trust Layer audit policies.",
    features: [
      "<strong>Autonomous Agent Inspection:</strong> Inspect GenAI agent configurations, instructions, topics, and actions.",
      "<strong>Prompt Builder Templates:</strong> Review prompt templates, grounding inputs, and version histories.",
      "<strong>Einstein Trust Layer Audit:</strong> Monitor data masking, zero retention agreements, and toxicity guardrails.",
      "<strong>Direct Setup Router:</strong> Jump directly to Agentforce Setup and Copilot Planner in Salesforce."
    ],
    howToUse: "1. Browse active Agentforce agents and Copilot planners.\n2. Inspect prompt templates and grounding instructions.\n3. Click 'Agentforce Setup' to open native configuration in Salesforce.",
    sfReference: "Salesforce Agentforce Architecture, GenAiPlanner, Connect REST API"
  },
  {
    id: "flow-analyzer",
    name: "Flow Analyzer & Architecture Scanner",
    icon: "🌊",
    categoryGroup: "DEV",
    category: "Automation & Code Quality",
    badge: "HEALTH SCANNER",
    tagClass: "tag-gov",
    summary: "Automated architecture scanner for Active and Inactive Salesforce Flows and Process Builders. Identifies anti-patterns, DML and SOQL inside loops, hardcoded IDs, unhandled fault connectors, and recursion risks.",
    features: [
      "<strong>Governor Limit Detection:</strong> Flags SOQL queries and DML updates inside Flow loop elements.",
      "<strong>Hardcoded ID Detection:</strong> Detects hardcoded 15/18-character IDs in decisions and assignments.",
      "<strong>Fault Path Verification:</strong> Alerts when database elements lack fault connectors.",
      "<strong>1-Click Open in Flow Builder:</strong> Jump directly into Flow Builder to fix flagged elements."
    ],
    howToUse: "1. Select a Flow from the list to scan.\n2. Review identified risks categorized by severity (Critical, Warning, Info).\n3. Click 'Open in Flow Builder' to navigate directly to the canvas in Salesforce.",
    sfReference: "FlowDefinitionView, FlowView Tooling objects, Well-Architected Automation"
  },
  {
    id: "permission-analyzer",
    name: "Permission Analyzer & Security Matrix",
    icon: "🔐",
    categoryGroup: "ADMIN",
    category: "Security & Access Governance",
    badge: "SECURITY AUDIT",
    tagClass: "tag-sec",
    summary: "Diagnose and explain end-to-end user permissions. Answers 'Why can or can't this user see this field or record?' by analyzing combined access across Profiles, Permission Sets, Permission Set Groups, Object CRUD, FLS, and OWD.",
    features: [
      "<strong>Net Effective Access:</strong> Aggregates permissions from all assigned permission sets and profiles.",
      "<strong>Field & Object Access Breakdown:</strong> Identifies exactly which permission set grants read or edit access.",
      "<strong>OWD & Sharing Analysis:</strong> Inspects organization-wide default sharing settings.",
      "<strong>User Comparison:</strong> Compare permissions between two users to identify discrepancies."
    ],
    howToUse: "1. Select a User or Profile.\n2. Select target SObject and Field.\n3. Review the diagnostic breakdown showing Profile permissions vs Permission Set grants.",
    sfReference: "UserEntityAccess, FieldPermissions, ObjectPermissions, PermissionSetAssignment"
  },
  {
    id: "apex-runner",
    name: "Apex Runner & Log Inspector",
    icon: "⚡",
    categoryGroup: "DEV",
    category: "Developer Execution",
    badge: "DEV TOOLS",
    tagClass: "tag-gov",
    summary: "Execute Anonymous Apex code with syntax validation, execution timing, and formatted debug log streaming. Filter logs by USER_DEBUG, Exceptions, or Governor Limit utilization summaries.",
    features: [
      "<strong>Instant Anonymous Apex:</strong> Execute any valid Apex block directly via Tooling API.",
      "<strong>Color-Coded Debug Log:</strong> Filters out system noise to highlight USER_DEBUG and exceptions.",
      "<strong>Governor Limits Consumption:</strong> Visual meters showing percentage of SOQL, DML, and CPU time used.",
      "<strong>Execution History:</strong> Save and reuse frequent code snippets."
    ],
    howToUse: "1. Type or paste your Apex script in the code editor.\n2. Click 'Execute Anonymous (Ctrl+Enter)'.\n3. View the formatted debug log and limit consumption on the right panel.",
    sfReference: "Tooling API `executeAnonymous`, ApexExecutionOverlayResult, Apex CSI"
  },
  {
    id: "changeset",
    name: "Change Set Studio & Package.xml Builder",
    icon: "📦",
    categoryGroup: "DEV",
    category: "DevOps & Deployment",
    badge: "DEVOPS",
    tagClass: "tag-schema",
    summary: "Outbound change set manager and manifest generator. Search, filter, and add metadata components across any type, then generate clean, formatted package.xml manifests for Salesforce CLI and VS Code.",
    features: [
      "<strong>Fast Metadata Search:</strong> Search and add components across types in a fraction of native Setup time.",
      "<strong>Formatted package.xml Export:</strong> 1-click generation of manifest files ready for SF CLI deployment.",
      "<strong>Dependencies Detection:</strong> Suggests required dependencies before deployment.",
      "<strong>Direct Deployment Router:</strong> Deep link to Deployment Status in Salesforce Setup."
    ],
    howToUse: "1. Select metadata types and choose components to add.\n2. Click 'Generate package.xml' to review the manifest.\n3. Copy the XML or download the file for use with `sf project deploy start`.",
    sfReference: "Salesforce Metadata API, package.xml Specification, SF CLI Deploy"
  },
  {
    id: "rest-console",
    name: "REST Console & API Postman",
    icon: "🌐",
    categoryGroup: "DEV",
    category: "API Testing & Integration",
    badge: "INTEGRATION",
    tagClass: "tag-schema",
    summary: "In-browser Postman-style REST client authenticated automatically with the active Salesforce session. Send GET, POST, PATCH, PUT, and DELETE calls to SObject REST, Tooling API, Composite API, or custom Apex REST endpoints.",
    features: [
      "<strong>Zero Auth Setup:</strong> Seamlessly uses current browser session credentials without API tokens.",
      "<strong>Composite API Testing:</strong> Execute batch and composite tree requests directly.",
      "<strong>Formatted JSON & Timing:</strong> Syntax-highlighted response bodies with HTTP status codes and millisecond response times.",
      "<strong>Quick Template Requests:</strong> 1-click presets for Describe, Limits, Query, and SObject endpoints."
    ],
    howToUse: "1. Select HTTP Method (GET, POST, PATCH, DELETE).\n2. Enter API endpoint path (e.g. `/services/data/v63.0/limits`).\n3. Add JSON body if applicable and click 'Send Request'.",
    sfReference: "Salesforce REST API Developer Guide, Composite REST API"
  },
  {
    id: "event-monitor",
    name: "Event Monitor & CDC Streamer",
    icon: "📡",
    categoryGroup: "AI",
    category: "Streaming & Event Architecture",
    badge: "STREAMING",
    tagClass: "tag-gov",
    summary: "Real-time event subscription console. Connect to CometD / Streaming API to listen to custom Platform Events, Change Data Capture (CDC) events, and push topics with live payload inspection.",
    features: [
      "<strong>Live Streaming Client:</strong> Subscribes to `/event/...` and `/data/ChangeEvents` channels in real time.",
      "<strong>Payload & Diff Inspector:</strong> Expand event messages to inspect changed fields and replay IDs.",
      "<strong>Publish Event Tester:</strong> Publish test Platform Event messages directly to the bus."
    ],
    howToUse: "1. Select event channel or type custom `/event/My_Event__e`.\n2. Click 'Subscribe' to begin listening.\n3. Incoming events appear in the live feed with detailed payload inspection.",
    sfReference: "Salesforce Streaming API, Pub/Sub API, Change Data Capture Developer Guide"
  },
  {
    id: "org-limits",
    name: "Org Limits & Quota Dashboard",
    icon: "📈",
    categoryGroup: "ADMIN",
    category: "Governor Limits & Quotas",
    badge: "MONITORING",
    tagClass: "tag-gov",
    summary: "Real-time visual monitoring dashboard of all Salesforce organization limits. Gauge meters for daily REST API calls, SingleEmail, Streaming API, Concurrent Apex, Data Storage (MB), and File Storage (MB).",
    features: [
      "<strong>Visual Health Gauges:</strong> Color-coded progress meters (green, amber, red) for all major limits.",
      "<strong>Storage Utilization Breakdown:</strong> Displays Data Storage and File Storage consumption and percentages.",
      "<strong>Exhaustion Warnings:</strong> Proactive alerts when limits approach 80%+ consumption."
    ],
    howToUse: "1. Open the dashboard to view current limit utilization.\n2. Click 'Refresh Limits' to fetch the latest counts from `/services/data/vXX.0/limits`.",
    sfReference: "Salesforce Governor Limits, `/services/data/vXX.0/limits` API resource"
  }
];

let activeCategory = "ALL";
let activeQuery = "";

// ─── 2. RENDER INSPECTOR TOOLS ──────────────────────────────────────
function renderTools() {
  const container = document.getElementById("guide-tools-list");
  if (!container) return;

  const q = activeQuery.trim().toLowerCase();

  const filtered = INSPECTOR_TOOLS_DIRECTORY.filter(tool => {
    const matchCat = activeCategory === "ALL" || tool.categoryGroup === activeCategory;
    const matchQ = !q ||
      tool.name.toLowerCase().includes(q) ||
      tool.summary.toLowerCase().includes(q) ||
      tool.category.toLowerCase().includes(q) ||
      tool.features.some(f => f.toLowerCase().includes(q)) ||
      tool.howToUse.toLowerCase().includes(q);

    return matchCat && matchQ;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 24px; text-align: center;">
        <div style="font-size: 24px; margin-bottom: 6px;">🔍</div>
        <strong>No inspector tools match your search.</strong>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">Try searching for "SOQL", "FLS", "Export", "Record", "Flow", or "AI".</div>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(tool => `
    <div class="guide-tool-card">
      <div class="guide-tool-header">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 20px;">${tool.icon}</span>
          <div>
            <div style="font-size: 14px; font-weight: 800; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
              ${escapeHtml(tool.name)}
              <span class="tag-badge ${tool.tagClass}">${tool.badge}</span>
            </div>
            <div style="font-size: 11px; color: var(--text-muted); font-weight: 500;">
              Category: ${escapeHtml(tool.category)} • <em>${tool.sfReference}</em>
            </div>
          </div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="btn btn-primary btn-launch-tool" data-tool="${tool.id}" style="font-size: 11px; padding: 4px 10px;">
            🚀 Open Tool
          </button>
        </div>
      </div>

      <div style="font-size: 12px; color: var(--text-main); line-height: 1.5; font-weight: 500;">
        ${escapeHtml(tool.summary)}
      </div>

      <div style="background: rgba(0,0,0,0.02); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px;">
        <div style="font-size: 11px; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 4px;">
          Key Features & Capabilities:
        </div>
        <ul class="guide-feature-list">
          ${tool.features.map(f => `<li>${f}</li>`).join("")}
        </ul>
      </div>

      <div style="font-size: 11px; background: rgba(1, 118, 211, 0.05); border-left: 3px solid var(--primary); padding: 8px 12px; border-radius: 4px; color: var(--text-main); line-height: 1.5; white-space: pre-line;">
        <strong>📘 Quick Start Guide:</strong>\n${escapeHtml(tool.howToUse)}
      </div>
    </div>
  `).join("");
}

// ─── 3. TAB SWITCHING ───────────────────────────────────────────────
function initTabSwitching() {
  document.addEventListener("click", (e) => {
    const tabBtn = e.target.closest("#guide-tabs .tool-tab");
    if (!tabBtn) return;
    e.preventDefault();
    switchTab(tabBtn.dataset.tab);
  });
}

function switchTab(tabId) {
  document.querySelectorAll("#guide-tabs .tool-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.tab === tabId);
  });

  document.querySelectorAll(".tab-content").forEach(v => {
    v.style.display = "none";
  });

  const targetView = document.getElementById(`view-${tabId}`);
  if (targetView) {
    targetView.style.display = tabId === "directory" ? "flex" : "block";
  }
}

// ─── 4. INITIALIZATION & EVENTS ─────────────────────────────────────
function init() {
  const sfHost = resolveSfHost();
  if (sfHost) {
    const badge = document.getElementById("env-badge");
    if (badge) badge.style.display = "";
    const orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
    updateNavbarOrgBadge(sfHost, orgInfo);

    // Sync navbar link to Trailhead Help Center
    const navLink = document.getElementById("link-nav-trailhead");
    if (navLink) {
      navLink.href = `learning-hub.html?host=${encodeURIComponent(sfHost)}`;
    }
  }

  initTabSwitching();
  setupEvents();
  renderTools();
}

function setupEvents() {
  document.getElementById("guide-search")?.addEventListener("input", (e) => {
    activeQuery = e.target.value;
    renderTools();
  });

  document.querySelectorAll(".category-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".category-filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeCategory = btn.dataset.cat;
      renderTools();
    });
  });

  document.getElementById("guide-tools-list")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-launch-tool");
    if (!btn) return;
    const toolId = btn.dataset.tool;
    const sfHost = resolveSfHost();
    const url = `${toolId}.html${sfHost ? `?host=${encodeURIComponent(sfHost)}` : ""}`;
    window.open(url, "_blank");
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

init();

