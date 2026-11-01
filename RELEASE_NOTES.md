# ⚡ SF Power Inspector PRO — Release Notes & Changelog

**Architect & Founder**: **ParrotRakhy**  
**Repository**: [https://github.com/AnyTaskAI/sf-power-inspector](https://github.com/AnyTaskAI/sf-power-inspector)  
**Live Web Hub**: [https://anytaskai.github.io/sf-power-inspector/](https://anytaskai.github.io/sf-power-inspector/)

---

## 🚀 Release v1.0.0 (Production Release — November 2026)

### 🌟 New Features & Major Additions

#### 1. 🔍 Show All Data & Record Inspector
- Inspect all fields on any record (custom, standard, formula, and system audit fields).
- Fast inline editing of text, numbers, picklists, and booleans with immediate REST API `PATCH`.
- 1-click **📋 Copy Record ID**, Copy SObject API Name, and Open in Setup shortcuts.

#### 2. 🧹 1-Click Sandbox Storage Cleaner
- Automated cleanup tool for sandbox storage exhaustion.
- Purges old **Apex Debug Logs** (`ApexLog`), **Setup Audit Trails**, and heavy attachments.
- Time-period filters: **All Time**, **Last 7 Days**, **Last 1 Month**, **Last 3 Months**, and **Custom Date Range**.
- Pre-deletion confirmation dialogs with exact record counts and storage impact preview.

#### 3. 📊 Advanced SOQL & SOSL Explorer
- Multi-tab query editor with smart field auto-complete.
- Direct integration with Salesforce **Query Plan API** (`explain=...`) to audit query selectivity and prevent full-table scans on Large Data Volumes (LDV).
- 1-click export to **Excel (.xlsx)**, **CSV**, or formatted **JSON**.

#### 4. 👤 Incognito User Login (Impersonation)
- Impersonate any active user in your Salesforce org.
- Automatically launches in an isolated Incognito window so your admin session remains active.

#### 5. 🔐 Field-Level Security (FLS) & Permission Matrix
- Diagnoses *"Why can't User A edit this field?"* across Profiles, Permission Sets, and Permission Set Groups in under 2 seconds.

#### 6. 🤖 Agentforce & AI Security Hub
- Live audit of **Agentforce Agents**, Einstein Copilots, Agent Topics, and Invocable Actions.
- Dynamic Prompt Template Record Grounding Simulator.
- AES-GCM encrypted Web Crypto vault for OpenAI, Anthropic Claude, and Google Gemini API keys.
- Client-side dynamic PII masking complying with the Einstein Trust Layer.

#### 7. 🏢 Organization Profile & Health Hub
- Real-time display of Org Name, Org ID, Salesforce Edition, Environment badge, and Pod/Instance.
- Live Salesforce Trust health indicator for your active instance (e.g. `CAN98`).
- Real-time tracking of Daily API Requests, Data Storage MB, and File Storage MB with color-coded progress meters.

#### 8. 🌐 Live Web Hub & Real-Time Google Sheets Integration
- Published on GitHub Pages at [https://anytaskai.github.io/sf-power-inspector/](https://anytaskai.github.io/sf-power-inspector/).
- Live active engineer counters and total verified installs.
- Dual subscription pathways: **Without Login** (anonymous) and **With Login** (Salesforce identity).
- Community Feature Roadmap & Upvoting connected to automated Google Sheets tracking.

---

## 🔒 Security & Privacy Commitments
- **Zero Login Required**: Use without creating an account or providing third-party credentials.
- **Client-Side Sandbox**: All CRM communication is direct between your browser and Salesforce.
- **Enterprise Compliance**: GDPR and CCPA compliant with zero data retention.

---

© 2026 **ParrotRakhy** (Developer & Founder). All rights reserved.

