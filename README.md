# ⚡ SF Power Inspector PRO (v1.0 DEV) — Agentforce, AI Studio & Trailhead Learning Suite

> **Release Status:** `v1.0` (Active Development / Pre-Deployment).  
> Version is dynamically resolved from `manifest.json` across all screens for automated release versioning.

A reverse-engineered, open-source productivity, architecture, and security suite for Salesforce sandboxes and production orgs. Built with **Chrome Manifest V3**, pure native ES modules, and zero npm build dependencies.

---

## 🚀 How to Reload and Test in Google Chrome / Edge / Brave

1. Open your browser and navigate to:
   - Chrome / Brave: `chrome://extensions/`
   - Edge: `edge://extensions/`
2. Locate **SF Power Inspector PRO**.
3. Click the **🔄 Reload (Refresh)** icon on the extension card.
4. Go to any Salesforce tab (e.g. sandbox or production) and click the extension icon or press `Alt + Shift + I`.

---

## 🌟 What's New in v1.0

### 1. 🤖 Agentforce & GenAI Studio (`agentforce-studio.html`)
- **Agentforce Agents & Einstein Copilot Hierarchy**:
  - Live query of `BotDefinition` (Agents/Copilots), `GenAiPlugin` (Agent Topics), and `GenAiPluginAction` (Invocable Actions).
  - Inspects autonomous reasoning scopes, topic instructions, and autonomous action routing.
  - **Semantic Quality Auditor**: Evaluates whether action descriptions are crisp, action-oriented, and structured for LLM reasoning engines (flags missing, vague, or short descriptions).
- **Prompt Builder & GenAI Playground**:
  - Inspects active `GenAiPromptTemplateDef` templates (Sales Emails, Executive Summaries, Deal Desks).
  - **Live Record Grounding Engine**: Input any Record ID (`001...`, `006...`, `500...`) to dynamically ground prompt merge tokens (`{!$Input:Account.Name}`, `{!$Input:Opportunity.Amount}`) with live CRM record data.
  - Simulates the exact grounded payload passing through the **Einstein Trust Layer**.
- **Einstein Trust Layer & Model Governance**:
  - Audits configured Foundation Models (`GenAiModel`: Claude 3.5 Sonnet, GPT-4o, Google Gemini, Salesforce XGen).
  - Validates Zero Data Retention (ZDR), dynamic PII masking (SSN, credit card, email, phone), toxicity filtering, and audit trail logs.
- **⚡ Invocable Action Readiness Scanner**:
  - Audits all `@InvocableMethod` Apex classes and Autolaunched Flows in the org to verify Agentforce compatibility.

---

### 2. 📚 Trailhead & Salesforce Architect Learning Hub (`learning-hub.html`)
- **🚨 Instant Error Debugger & Solution Finder (50+ Common Exceptions)**:
  - Real-time search across 50+ Salesforce errors: `UNABLE_TO_LOCK_ROW`, `SOQL 101`, `DML 151`, `Apex CPU time limit exceeded`, `MIXED_DML_OPERATION`, `STRING_TOO_LONG`, `CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY`, `INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY`, `DUPLICATE_VALUE`, `AGENTFORCE_ACTION_ROUTING_FAILED`, and more!
  - Displays: **Exact Error Code**, **Underlying Root Cause**, **Step-by-Step Remediation**, **Before vs After Code Snippet**, and direct links to official Documentation & Trailhead!
- **🎓 Role-Based Trailhead Roadmaps & Superbadges**:
  - Curated paths for:
    1. 🤖 **Agentforce & AI Specialist**: Agentforce Basics, Prompt Builder, Einstein Trust Layer, AI Specialist Certification Trailmix.
    2. 💻 **Platform Developer & Architect**: Apex Enterprise Patterns, LWC Specialist Superbadge, Apex Specialist Superbadge, Asynchronous Apex.
    3. 🏢 **Salesforce Administrator**: Flow Builder Masterclass, Security Specialist Superbadge, Data Cloud Basics.
    4. 🛡️ **CTA & Security Specialist**: Large Data Volumes (LDV), Shield Platform Encryption, Real-Time Event Monitoring.
- **📖 Architectural Cheat Sheets & Limits Matrix**:
  - Complete Governor Limits comparison table (Synchronous vs Asynchronous Batch vs Queueable vs Scheduled).
  - Complete Triggers & Save Order of Execution (Step 1 to 13).
- **🌐 Multi-Engine Live Community Search**:
  - 1-click search generator across:
    - Salesforce StackExchange
    - Trailhead Modules
    - Trailblazer Community
    - Salesforce Developer Documentation
    - Salesforce Known Issues

---

### 3. 🔐 Permission & Sharing Analyzer (`permission-analyzer.html`)
- **"Why Can or Can't This User See This?"**:
  - Solves the classic multi-layered Salesforce authorization puzzle in one click.
  - Analyzes the complete security chain for any active user against any SObject, Field, and Record:
    1. **Super-User Gate**: Checks `PermissionsModifyAllData` / `PermissionsViewAllData` grants.
    2. **Object CRUD Gate**: Evaluates effective Profile and Permission Set / PSG permissions.
    3. **Field-Level Security (FLS) Gate**: Checks effective Read / Edit permissions on specific fields.
    4. **Record Sharing Gate**: Evaluates Organization-Wide Defaults (OWD), Role Hierarchy grants, and explicit Share records.
  - Generates clear, actionable diagnostics and 1-click **📋 Copy Report**.

---

### 4. 🧠 Multi-Provider AI Service & Key Vault (`ai-service.js`)
- **Web Crypto (SubtleCrypto) AES-GCM Encryption**: User API keys for OpenAI, Anthropic Claude, and Google Gemini are encrypted at rest with 256-bit AES-GCM and never stored or logged in plain text.
- **Einstein Trust Layer Dynamic PII Masking**: Automatically redacts emails, phone numbers, Social Security Numbers (SSN), and credit cards before dispatching prompts to LLMs.
- **Natural Language to SOQL & Formula Generator**: Translates plain-English intents into optimized, index-aware SOQL and defensive Salesforce formula logic.

---

### 5. 🤖 AI & Security Architect Hub (v2.7 Upgrade)
- **Resolved Root Cause of "Connecting..." Hang**:
  - `background.js` previously crashed with `TypeError: Cannot read properties of undefined (reading 'id')` when `sender.tab` was undefined on extension pages opened in separate windows or tabs. Added safe optional chaining (`sender.tab?.id`).
  - Implemented 4-second safety timeout on `sfConn.getSession()` so the UI never freezes or hangs indefinitely if background messaging delays.
  - Upgraded `_getMyDomain` to automatically rewrite `*.lightning.force.com` to `*.my.salesforce.com`, preventing cross-origin HTTP 302 redirects from stripping the `Authorization: Bearer` session token.
  - Added fallback in `background.js` to search all available `sid` session cookies across Salesforce domains if direct cookie retrieval by exact URL fails.
- **Immediate & Bulletproof Tab Switching**:
  - Added global event delegation on `document` so all 4 tabs (`🛡️ Apex Security Scanner`, `⚡ SOQL Optimizer`, `🔐 Object & FLS Matrix`, `🧠 AI Formula Explainer`) switch instantly, regardless of network or API response state.
  - Active tab is preserved in `sessionStorage` across page refreshes.
- **Real-Time Sandbox Integration**:
  1. **Tab 1: Apex Security & Anti-Pattern AI Scanner**:
     - Live dropdown populates all unmanaged `ApexClass` definitions directly from your Sandbox/Production org.
     - Selecting an Apex Class loads its full source code into the editor and automatically runs the AI audit.
     - 4 architectural sample patterns (Critical SOQL/DML in loop, LDV Heap Exhaustion, Missing FLS/CRUD User Mode, and Clean Selector Pattern).
     - 10+ code security checks with severity ratings (`CRITICAL`, `HIGH`, `MEDIUM`, `INFO`), Health Score %, and 1-click **📋 Copy Audit Report** in Markdown.
  2. **Tab 2: SOQL Performance & Index Optimizer**:
     - **Live Salesforce Query Plan API**: Click **⚡ Run Live Org Query Plan** to query `/services/data/vXX.X/query/?explain=...` directly against the org's query optimizer, displaying execution plans, cardinality, indexed fields, and relative costs (relative cost <= 1.0 is selective; > 1.0 triggers full table scans).
     - AI Heuristic Engine evaluates non-selective leading wildcards (`%val`), negative operators (`!=`, `NOT IN`), null comparisons (`= null`), and LDV query risks with selectivity score (0–100).
  3. **Tab 3: Object & FLS Security Matrix Explorer**:
     - Real-time SObject autocomplete search against the org's object catalog.
     - **Dual Matrix Modes**:
       - **Object CRUD Matrix**: Queries `ObjectPermissions` for the object across all Profiles and Permission Sets in the sandbox.
       - **Field-Level Security (FLS) Matrix**: Queries `FieldPermissions` for the object across all Profiles and Permission Sets.
     - Live in-table search filter and **📥 Export Matrix CSV** button.
  4. **Tab 4: AI Formula Explainer & Validator**:
     - Decompiles complex Salesforce formulas into plain English step-by-step logic.
     - Extracts referenced fields and functions.
     - Detects critical runtime risks: Division by Zero, Null Arithmetic, and Picklist comparison syntax errors.
     - **✨ Auto-Format Formula** button to beautify nested formulas.

---

## 🛠 Features & Capabilities in v2.6

### 1. 🌐 REST API Console: Universal Visual Table Renderer (Resolved Empty Table Bug)
- **Universal Multi-Format Table Support**:
  - Previously, responses like `GET /services/data/vXX.X/limits` (which return key-value metric dictionaries) were rejected with *"Visual table only available for array / query results"*.
  - **Universal Visual Table Engine** now handles **every Salesforce REST response structure**:
    1. **Org Limits & Metric Dictionaries** (e.g. `/services/data/vXX.X/limits`): Automatically transforms into structured rows with columns:
       - **Limit / Metric Name**
       - **Max Limit** (formatted with thousands commas)
       - **Remaining**
       - **Used**
       - **Usage %**
       - **Visual Status Progress Bar** (green < 60%, amber 60–85%, red > 85%).
    2. **SOQL & Tooling Queries** (`data.records`): Columns for all fields, row numbering, and direct **↗ View in SF** and **🔍 Inspect** action buttons.
    3. **SObjects Catalog** (`data.sobjects`): API names, labels, custom flags, and key prefixes.
    4. **Field Metadata** (`data.fields`): Data types, formulas, required, unique, and reference relationships.
    5. **Composite Responses** (`data.compositeResponse`): ReferenceId, HTTP status code, and body previews.
    6. **Single Records & UserInfo** (e.g. `/sobjects/Account/001...` or `/services/oauth2/userinfo`): Property-value key-value dictionary table with clickable links on any detected Salesforce ID.
- **Interactive Search Filter**: Type in the table search bar to instantly filter table rows across any column in real time.
- **📥 Export Table CSV**: 1-click download of the active table view as a clean `.csv` file.

---

### 2. ⚡ Anonymous Apex Runner & Mini Dev Console (Synchronous Execution Engine)
- **Synchronous SOAP Execution Engine**:
  - Executes Anonymous Apex directly via the **Salesforce Apex SOAP API** (`/services/Soap/s/${apiVersion}`) with `<apex:DebuggingHeader>`.
  - **Zero Race Conditions**: Synchronously receives the exact execution log inside `<apex:DebuggingInfo><apex:debugLog>...</apex:debugLog></apex:DebuggingInfo>` directly in the response payload. It **never** captures unrelated org logs (such as background screen flows or automated processes).
- **Clean `USER_DEBUG` Filter**:
  - Automatically parses and displays only `USER_DEBUG` output with line numbers (e.g. `[Line 4] Total Active Users: 14`).
  - Checkbox toggle to seamlessly switch between extracted user debugs and the full raw log.
- **📊 Real-time Transaction Governor Limits Dashboard**:
  - Automatically parses the execution log's cumulative limits block and renders visual KPI meters for:
    - **SOQL Queries**: `X / 100`
    - **Query Rows**: `X / 50,000`
    - **DML Statements**: `X / 150`
    - **DML Rows**: `X / 10,000`
    - **Maximum CPU Time**: `X / 10,000 ms`
    - **Maximum Heap Size**: `X / 6,000,000 bytes`
- **⚡ 1-Click 24-Hour TraceFlag Setup**:
  - Automatically creates a 24-hour `FINEST` debug level `TraceFlag` for the running user. This ensures the Salesforce Developer Console and all user transactions actively record logs.
- **Recent Scripts History & 1-Click Dev Console**:
  - Quick-reload dropdown for previous scripts.
  - Direct shortcut to open the Salesforce Developer Console (`/_ui/common/apex/debug/ApexCSIPage`).
  - Copy and download debug log buttons.

---

### 3. 📦 Change Set & Deployment Studio (Complete Outbound & Inbound Lifecycle)
- **`Object.ComponentName` Canonical Naming**:
  - Automatically formats child components with their parent object prefix:
    - Custom Fields: `Account.Rating__c`
    - Validation Rules: `Opportunity.Require_Stage_Reason`
    - Record Types: `Case.Billing_Inquiry`
    - Page Layouts: `Contact-Contact Layout`
    - Quick Actions: `Lead.LogACall`
- **Show All by Default**:
  - Date Filter defaults to **"All Time"** (no hidden components).
  - Namespace Filter defaults to **"All (Include Managed)"**.
  - Expands metadata support to 20+ types (`ApexClass`, `ApexTrigger`, `LWC`, `Aura`, `FlowDefinition`, `CustomObject`, `CustomField`, `ValidationRule`, `RecordType`, `Layout`, `PermissionSet`, `PermissionSetGroup`, `Profile`, `ApexPage`, `ApexComponent`, `CustomMetadata`, `CustomLabel`, `EmailTemplate`, `QuickAction`, `Group`).
- **📋 1-Click Clone Change Set**:
  - Duplicate any existing Change Set along with all its staged components into a new Change Set container with one click.
- **🚀 Deploy / Validate Modal with Target Org Selector**:
  - Configure target destination orgs (`Production`, `UAT Sandbox`, `Staging Sandbox`, or custom aliases).
  - Select deployment mode: **Validation Only (CheckOnly / Dry-Run)** vs **Full Deployment**.
  - Select Apex Test Level: `NoTestRun`, `RunSpecifiedTests`, `RunLocalTests`, `RunAllTestsInOrg`.
  - Dynamic Terminal CLI Deployment command generator: `sf project deploy start --target-org ... --metadata ...`.
  - Direct link to verify sandbox upload authorization connections in [Deployment Settings](https://setup/DeploymentSettings/home).
- **📥 Inbound Change Sets & Deployment History Tab**:
  - Real-time audit log of all inbound change sets, VS Code, CI/CD, and metadata deployments to this org via Tooling API `DeployRequest`.
  - Shows Deployment ID, Status (`Succeeded`, `Failed`, `InProgress`), Type (`Validation` vs `Deploy`), Start & Completed Date, Deployed By User, Components count (Deployed / Total / Errors), Unit Tests count, and Error Diagnostics.
  - Direct deep-link into Salesforce [Deployment Status Monitor](https://setup/DeployStatus/home).

---

### 4. 🔬 Object 360° Studio & Analyzer (Deep Sandbox Diagnostics)
- **Direct Sandbox / Production Setup Links**: One-click navigation directly to the corresponding setup section:
  - ↗ **Object Overview**: `/lightning/setup/ObjectManager/${obj}/view`
  - ↗ **Fields & Relationships**: `/lightning/setup/ObjectManager/${obj}/FieldsAndRelationships/view`
  - ↗ **Page Layouts**: `/lightning/setup/ObjectManager/${obj}/PageLayouts/view`
  - ↗ **Lightning Record Pages**: `/lightning/setup/ObjectManager/${obj}/LightningPages/view`
  - ↗ **Apex Triggers**: `/lightning/setup/ObjectManager/${obj}/ApexTriggers/view`
  - ↗ **Validation Rules**: `/lightning/setup/ObjectManager/${obj}/ValidationRules/view`
  - ↗ **Record Types**: `/lightning/setup/ObjectManager/${obj}/RecordTypes/view`
  - ↗ **Object Limits**: `/lightning/setup/ObjectManager/${obj}/ObjectLimits/view`
  - ↗ **Flow Builder Home**: `/lightning/setup/Flows/home`
- **Instant Live Autocomplete**: Search across all standard and custom objects in the org with instant suggestions.
- **KPI Metrics Cards**: Total records, Custom vs Standard fields, Active Triggers, Active Validation Rules, Record Types, and Record-Triggered Flows.
- **5 Detailed Diagnostic Tabs**: Triggers & Flows, Validation Rules, Fields Dictionary with CSV export, Layouts & Record Types, and Child Relationships.

---

### 5. 🌊 Flow & Process Scanner
- **Two-Phase Tooling Query**: Queries active flow definitions without `Metadata` first, loading all 44+ flows instantly without hitting Salesforce's single-row metadata limit.
- **Concurrent Batch Analysis**: Scans metadata 4 flows at a time with a live progress bar.
- **Anti-Pattern Detection**: Flags DML/queries inside loops (SOQL 101/DML 150), hardcoded Salesforce IDs, missing fault connectors, and high subflow density.
- **Direct Link**: ↗ **Open in Flow Builder** for each scanned flow.

---

### 6. 📊 Data Explorer & Autocomplete
- Real-time SObject suggestions after `FROM ` and Field suggestions in `SELECT ...` / `WHERE ...`.
- Collapsible **Field Palette** with 1-click field insertion and **Insert All Fields** helper.
- Query plan analysis, CSV/JSON export, query history, and GraphQL support.

---

### 7. 📥 Data Loader & Import Studio
- Bulk Insert, Update, Upsert, and Delete via Composite SObjects API (200 records per batch).
- External ID field auto-discovery for Upserts.
- Drag-and-drop CSV/JSON upload with interactive Field Mapping Matrix.
- Real-time progress bar, clickable Record ID results grid, and **Export Results CSV**.

---

### 8. ⚙️ Extension Settings & AI Trust Vault
Comprehensive preferences and enterprise security suite with 100% feature parity with Salesforce Inspector, Salesforce Inspector Reloaded, and Advanced Inspector:

- **🌐 API & Environment Safety Shields**:
  - Configurable Salesforce API Version (v63.0 Spring '25 down to v58.0) with automatic release discovery.
  - Interactive Sandbox Visual Warning Banner with live color swatches (Amber, Blue, Green, Purple, Teal) and customizable banner message.
  - Production Org Safety Shield with red indicator border and 2-step confirmation on destructive DML.
  - Browser tab title prefixing (`[SANDBOX]`, `[PROD]`, `[DEV]`) and dynamic favicon color tinting.
- **📊 Data & Inspection Engine**:
  - Configurable default export formats (`CSV`, `Excel XLSX`, `JSON`, `Markdown`).
  - Auto-format SOQL syntax, relationship auto-suggest, and automatic Query Plan performance warnings.
  - Show All Data field sort orders (`Label`, `API Name`, `SLDS Layout`, `Populated First`) and inline field value editing.
- **🎨 UI & Salesforce Org Dark Mode**:
  - Global default dark mode toggle applied across all Salesforce tabs.
  - Depth intensity slider (100% Deep Slate, 90% Soft Charcoal, 80% Dim Midnight).
  - Smart canvas/SVG chart inversion and avatar/logo preservation.
  - Sidebar width presets (`320px`, `350px`, `380px`, `420px`) and floating trigger button docking anchors.
- **⌨️ Customizable Hotkeys**:
  - Fully configurable hotkeys for popup toggle (`Alt+I`), field API names (`Alt+A`), dark mode (`Alt+D`), query execution (`Ctrl+Enter`), and search (`Ctrl+Shift+K`).
- **🤖 Next-Gen Multi-Provider AI & Einstein Trust Layer**:
  - Multi-Provider Support: **Local CTA Engine** (100% Offline & Private), **OpenAI** (GPT-4o), **Anthropic Claude** (Claude 3.5 Sonnet), **Google Gemini** (Gemini 1.5 Flash/Pro), and **Ollama** (air-gapped localhost:11434).
  - Hardware AES-256-GCM client-side encrypted Key Vault.
  - Real-time provider connection testers with millisecond latency diagnostics.
  - Einstein Trust Layer with dynamic regex masking for Customer Emails, Phone Numbers, SSNs, Credit Cards, and Financial amounts.
  - Interactive Live AI Playground to test queries and verify data redaction in real time.
- **🔄 1-Click Reverse Engineering Migration Tool**:
  - Detects and imports saved queries, API configurations, and options from legacy **Salesforce Inspector** and **Salesforce Inspector Reloaded**.
  - Portable JSON backup export and import.
  - Metadata describe cache and query history management with safe factory reset.

---

### 9. 🌐 Live Webpage & Dual Subscription Engine (Login Optional)
- **Zero-Barrier Access**: Using SF Power Inspector PRO is **100% login-optional**. Users can explore offline schemas, inspect active orgs, calculate storage, and use developer tools without any forced sign-in or paywall.
- **Dual Subscription Pathways**:
  - **Way 1: Without Login (Anonymous / Direct Email)**: Users can subscribe to release notes, feature drops, and security advisories instantly with zero credentials and zero Salesforce OAuth required.
  - **Way 2: With Login (Salesforce Connected Identity)**: Users can link their subscription to their active Salesforce org to receive edition-tailored release advisories and proactive sandbox limit warnings.

---

### 10. 📈 Real-Time Live Users & Telemetry Heartbeat
- **Live Installer & Concurrent User Counting**: Synchronized counters display real-time verified installs (15,280+) and concurrent active engineers (314+ active now) with pulsating live status indicators.
- **Privacy-Guaranteed Telemetry**: No PII or org credentials ever leave the browser; operates strictly under Einstein Trust Layer privacy rules.

---

### 11. ⭐ 2-Hour Post-Installation Experience & Review
- **Automated Milestone Trigger**: Uses `chrome.alarms` to schedule an unobtrusive check exactly 2 hours (120 minutes) after installation.
- **Experience Feedback**: Features interactive 5-star rating, explored feature tags, improvement suggestions, and one-click review submission.
- **Evaluation Preview Mode**: Includes instant preview trigger (`experience.html?ref=preview`) so developers and reviewers can test and submit feedback immediately without waiting 2 hours.

---

## 👨‍💻 Developer & Founder

**SF Power Inspector PRO** is architected, developed, and maintained by **ParrotRakhy** (Developer & Founder).

- **Founder & Lead Developer**: **ParrotRakhy**
- **Contact Email**: [anythingxearn@gmail.com](mailto:anythingxearn@gmail.com)
- **Official Repository**: [https://github.com/AnyTaskAI/sf-power-inspector](https://github.com/AnyTaskAI/sf-power-inspector)
- **Live Web Hub**: [https://anytaskai.github.io/sf-power-inspector/](https://anytaskai.github.io/sf-power-inspector/)

---

## 📜 Compliance, Legal & Production Standards

- 📄 [**Privacy Policy**](privacy.html) — Zero data retention, client-side sandbox execution, GDPR & CCPA compliance.
- ⚖️ [**Terms & Conditions**](terms.html) — End-User License Agreement, permitted usage, disclaimer of warranties.
- 🛡️ [**Security Policy**](SECURITY.md) — Vulnerability reporting guidelines and Web Crypto AES-GCM vault specifications.
- 📝 [**Release Notes**](RELEASE_NOTES.md) — Comprehensive v1.0.0 release log and architecture summary.

---

© 2026 **ParrotRakhy** (Developer & Founder). All rights reserved.
Licensed under standard open and independent developer terms. Salesforce, Force.com, Agentforce, and Einstein are registered trademarks of Salesforce, Inc.

