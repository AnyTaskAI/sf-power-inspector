import { updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";

// ─── 1. ERROR DATABASE (Comprehensive Salesforce Exceptions) ────────
const ERROR_DATABASE = [
  {
    code: "UNABLE_TO_LOCK_ROW",
    category: "DML",
    title: "Unable to Lock Row (Record Locking Contention)",
    rootCause: "Two or more concurrent transactions (e.g. Apex triggers, batch jobs, integration callouts, or automated flows) attempted to update the same record or its parent record simultaneously. Salesforce places an exclusive lock on records and their parents during DML.",
    remediation: "1. Order your DML statements deterministically (sort IDs before updating).\n2. Reduce transaction duration by moving heavy computation or callouts to Asynchronous Apex (`Queueable` / `@future`).\n3. In Apex, use `FOR UPDATE` SOQL sparingly to reserve locks explicitly.\n4. Avoid updating master records (e.g. parent Account or master-detail parent) in high-volume concurrent child updates.",
    codeSnippet: `// ❌ Contention Risk: Updating accounts without ordering\nupdate unsortedAccounts;\n\n// ✅ Solution: Sort records deterministically by Id before DML\nList<Account> sortedAccs = new List<Account>(accountsToUpdate);\nsortedAccs.sort(); // Consistent lock acquisition order\nupdate sortedAccs;`,
    helpUrl: "https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_transaction_locking.htm",
    trailheadUrl: "https://trailhead.salesforce.com/content/learn/modules/asynchronous_apex"
  },
  {
    code: "System.LimitException: Too many SOQL queries: 101",
    category: "GOV",
    title: "Too Many SOQL Queries (Governor Limit: 100 Synchronous Queries)",
    rootCause: "A SOQL query statement (`[SELECT ...]` or `Database.query(...)`) was executed inside a loop. The synchronous transaction limit is strictly 100 SOQL queries.",
    remediation: "1. Extract the query completely outside the `for` or `while` loop.\n2. Collect target IDs in a `Set<Id>` and use an `IN :ids` query.\n3. Cache results in a `Map<Id, sObject>` for $O(1)$ constant time lookup inside the loop.",
    codeSnippet: `// ❌ SOQL 101 Bug:\nfor (Contact c : conList) {\n    Account a = [SELECT Id, Name FROM Account WHERE Id = :c.AccountId]; // 🚨 In loop!\n}\n\n// ✅ Bulkified Solution:\nSet<Id> accIds = new Set<Id>();\nfor (Contact c : conList) { if (c.AccountId != null) accIds.add(c.AccountId); }\nMap<Id, Account> accMap = new Map<Id, Account>([SELECT Id, Name FROM Account WHERE Id IN :accIds]);`,
    helpUrl: "https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm",
    trailheadUrl: "https://trailhead.salesforce.com/content/learn/modules/apex_database/apex_database_soql"
  },
  {
    code: "System.LimitException: Too many DML statements: 151",
    category: "GOV",
    title: "Too Many DML Statements (Governor Limit: 150 DMLs)",
    rootCause: "A DML operation (`insert`, `update`, `delete`, `upsert`) was executed inside a loop. In Salesforce, any bulk transaction processing up to 200 trigger records easily breaches the 150 DML limit.",
    remediation: "1. Instantiate a `List<sObject>` outside the loop.\n2. Inside the loop, append modified records to the list.\n3. Execute a single bulk DML statement after the loop terminates.",
    codeSnippet: `// ❌ DML 151 Bug:\nfor (Opportunity opp : oppList) {\n    Task t = new Task(WhatId = opp.Id, Subject = 'Follow up');\n    insert t; // 🚨 Fails on bulk records!\n}\n\n// ✅ Bulkified Solution:\nList<Task> tasksToInsert = new List<Task>();\nfor (Opportunity opp : oppList) {\n    tasksToInsert.add(new Task(WhatId = opp.Id, Subject = 'Follow up'));\n}\ninsert tasksToInsert; // 1 single DML!`,
    helpUrl: "https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm",
    trailheadUrl: "https://trailhead.salesforce.com/content/learn/modules/apex_database/apex_database_dml"
  },
  {
    code: "System.LimitException: Apex CPU time limit exceeded",
    category: "GOV",
    title: "Apex CPU Time Limit Exceeded (10,000ms Sync / 60,000ms Async)",
    rootCause: "The cumulative execution time spent by the Salesforce server CPU executing Apex logic, heavy loops, RegEx matching, formula evaluations, and trigger recursion exceeded 10,000 milliseconds.",
    remediation: "1. Eliminate nested loops ($O(n^2)$) by using Sets and Maps ($O(1)$ lookups).\n2. Prevent trigger recursion using static boolean flags or Trigger Handler frameworks.\n3. Defer non-critical logic to a `Queueable` job.\n4. Avoid complex JSON serialization of massive objects in loops.",
    codeSnippet: `// ❌ $O(n^2)$ Nested Loop:\nfor (Account a : accounts) {\n    for (Contact c : allContacts) { if (c.AccountId == a.Id) { ... } }\n}\n\n// ✅ $O(n)$ Map Indexing:\nMap<Id, List<Contact>> contactsByAcc = new Map<Id, List<Contact>>();\n// Group once, lookup in $O(1)$!`,
    helpUrl: "https://help.salesforce.com/s/articleView?id=000384752&type=1",
    trailheadUrl: "https://trailhead.salesforce.com/content/learn/modules/asynchronous_apex"
  },
  {
    code: "MIXED_DML_OPERATION",
    category: "DML",
    title: "Mixed DML Operation (DML on Setup and Non-Setup Objects)",
    rootCause: "Salesforce prevents performing DML on a Setup object (User, Group, PermissionSet, UserRole, Queue) and a Non-Setup object (Account, Contact, Custom Objects) within the same transaction to maintain database integrity.",
    remediation: "1. Separate the operations by moving the Setup DML into an asynchronous `@future` method or `Queueable` class.\n2. In Apex test classes, isolate the Setup DML inside a `System.runAs(user) { ... }` block.",
    codeSnippet: `// ❌ Mixed DML Bug:\ninsert new Account(Name='Acme');\ninsert new User(Username='test@acme.com', ...); // 🚨 MIXED DML EXCEPTION!\n\n// ✅ Solution: Isolate in @future or System.runAs:\n@future\npublic static void insertUserAsync(...) {\n    insert new User(...);\n}`,
    helpUrl: "https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_dml_non_mix_dml.htm",
    trailheadUrl: "https://trailhead.salesforce.com/content/learn/modules/apex_testing"
  },
  {
    code: "CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY",
    category: "DML",
    title: "Cannot Insert/Update/Activate Entity (Trigger / Flow Execution Failure)",
    rootCause: "A record-triggered Flow, Process Builder, or Apex Trigger associated with the sObject threw an unhandled exception (e.g. NullPointerException, custom validation rule, or governor limit violation) during transaction execution.",
    remediation: "1. Check the Apex Debug Log for the transaction to see the specific inner exception.\n2. Look for null pointer errors on relationship traversals (`record.Parent.Name`).\n3. Check if multiple triggers exist on the same object fighting for precedence.",
    codeSnippet: `// ✅ Defensive Apex Guard against NullPointerException:\nif (opp.Account != null && opp.Account.Industry != null) {\n    // Safe to access!\n}`,
    helpUrl: "https://help.salesforce.com/s/articleView?id=000385686&type=1",
    trailheadUrl: "https://trailhead.salesforce.com/content/learn/modules/apex_triggers"
  },
  {
    code: "STRING_TOO_LONG",
    category: "SCHEMA",
    title: "String Too Long (Field Length Exceeded)",
    rootCause: "A string payload exceeds the maximum length configured for the custom field (e.g. assigning a 300-character description into a `Text(255)` field).",
    remediation: "1. In Field Manager / Setup, upgrade the field data type to `LongTextArea` (up to 131,072 characters).\n2. If assigning programmatically, truncate the string safely before saving.",
    codeSnippet: `// ✅ Safe Truncation Guard:\npublic static String truncate(String val, Integer maxLen) {\n    return (val != null && val.length() > maxLen) ? val.substring(0, maxLen) : val;\n}`,
    helpUrl: "https://help.salesforce.com/s/articleView?id=000385203&type=1",
    trailheadUrl: "https://trailhead.salesforce.com/content/learn/modules/data_modeling"
  },
  {
    code: "FIELD_CUSTOM_VALIDATION_EXCEPTION",
    category: "SCHEMA",
    title: "Field Custom Validation Exception",
    rootCause: "A custom Validation Rule formula evaluated to TRUE when the record was saved, blocking the insert or update operation.",
    remediation: "1. Verify the validation error condition formula in Object Manager -> Validation Rules.\n2. In integration or batch payloads, supply the mandatory fields required by the rule.\n3. Consider adding a bypass mechanism using Custom Permissions (`$Permission.Bypass_Validation_Rules`).",
    codeSnippet: `// ✅ Best Practice Validation Rule Bypass Formula:\n// AND(\n//   ISBLANK(Tax_Number__c),\n//   NOT($Permission.Bypass_Validation_Rules)\n// )`,
    helpUrl: "https://help.salesforce.com/s/articleView?id=sf.fields_validation_rules_defining.htm&type=5",
    trailheadUrl: "https://trailhead.salesforce.com/content/learn/modules/point_click_business_logic/validation_rules"
  },
  {
    code: "INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY",
    category: "SEC",
    title: "Insufficient Access on Cross-Reference Entity",
    rootCause: "The running user or automated process does not have read or edit access to a referenced parent record (e.g. AccountId, Master-Detail parent, RecordTypeId, or PricebookEntry).",
    remediation: "1. Check the Organization-Wide Default (OWD) sharing settings for the referenced object.\n2. Verify the user has Read access on the parent record via Sharing Rules or Permission Sets.\n3. If executing via custom integration, ensure the Integration User profile has Read access to the referenced master entity.",
    helpUrl: "https://help.salesforce.com/s/articleView?id=000385311&type=1",
    trailheadUrl: "https://trailhead.salesforce.com/content/learn/modules/data_security"
  },
  {
    code: "DUPLICATE_VALUE",
    category: "SCHEMA",
    title: "Duplicate Value on Unique Field or External ID",
    rootCause: "An insert or update attempted to write a value into a field marked with `Unique: Case Sensitive` or `Unique: Case Insensitive` that already exists on another record in the database.",
    remediation: "1. In SOQL / REST, perform an `Upsert` using the External ID rather than an `Insert`.\n2. Query the database before creating to verify whether an existing record should be updated instead.",
    helpUrl: "https://help.salesforce.com/s/articleView?id=000385368&type=1",
    trailheadUrl: "https://trailhead.salesforce.com/content/learn/modules/data_modeling"
  },
  {
    code: "REQUEST_LIMIT_EXCEEDED",
    category: "GOV",
    title: "Total 24-Hour REST/SOAP API Request Limit Exceeded",
    rootCause: "Your organization has consumed its allocated 24-hour rolling API request limit (visible in Org Limits). External integrations and third-party tools are blocked until the oldest requests expire.",
    remediation: "1. Use Composite REST API (`/composite/batch`) to bundle up to 25 requests into a single API call.\n2. For data loading, switch to Salesforce Bulk API 2.0 (handles up to 150 million records daily without consuming normal REST limits).\n3. Use Change Data Capture (CDC) or Platform Events to subscribe rather than polling.",
    helpUrl: "https://developer.salesforce.com/docs/atlas.en-us.salesforce_app_limits_cheatsheet.meta/salesforce_app_limits_cheatsheet/salesforce_app_limits_platform_api.htm",
    trailheadUrl: "https://trailhead.salesforce.com/content/learn/modules/api_basics"
  },
  {
    code: "MALFORMED_QUERY",
    category: "SCHEMA",
    title: "Malformed Query / Single Row Retrieval Constraint",
    rootCause: "1. Querying non-filterable or compound fields in the `WHERE` clause.\n2. In Tooling API, querying `Metadata` or `FullName` without filtering to exactly one row (e.g. `SELECT Metadata FROM Flow`).",
    remediation: "In Tooling API queries on `Flow` or `CustomField`: query header fields first (`SELECT Id, MasterLabel FROM FlowDefinition`), then fetch individual metadata records by ID.",
    helpUrl: "https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/intro_rest_overview.htm",
    trailheadUrl: "https://trailhead.salesforce.com/content/learn/modules/apex_database/apex_database_soql"
  },
  {
    code: "AGENTFORCE_ACTION_ROUTING_FAILED",
    category: "AI",
    title: "Agentforce Action Semantic Routing Failure",
    rootCause: "The Agentforce autonomous agent reasoning engine was unable to select or trigger an Invocable Action in response to user conversation prompt.",
    remediation: "1. Review the Action Description in Agentforce Setup: descriptions must be crisp, action-oriented, and specify exactly when to invoke the tool (e.g. 'Use this tool when user asks to calculate warranty refunds...').\n2. Verify all required input parameters have detailed descriptions.\n3. Check Topic Instructions to ensure the topic explicitly authorizes calling this action.",
    helpUrl: "https://help.salesforce.com/s/articleView?id=sf.einstein_copilot_actions.htm&type=5",
    trailheadUrl: "https://trailhead.salesforce.com/content/learn/modules/agentforce-basics"
  },
  {
    code: "PROMPT_TEMPLATE_EXECUTION_ERROR",
    category: "AI",
    title: "Prompt Builder Grounding & Template Execution Fault",
    rootCause: "Prompt Template failed during execution because an input merge field evaluated to null or an Apex Grounding Class threw an unhandled exception.",
    remediation: "1. Ensure all merge fields have fallback values or null guards.\n2. If using Apex Grounding, annotate with `@InvocableMethod(CapabilityType='PromptTemplate')` and handle empty collections defensively.\n3. Check Einstein Trust Layer toxicity and PII masking configurations.",
    helpUrl: "https://help.salesforce.com/s/articleView?id=sf.prompt_builder_overview.htm&type=5",
    trailheadUrl: "https://trailhead.salesforce.com/content/learn/modules/prompt-builder-basics"
  }
];

// ─── 2. TRAILHEAD ROADMAPS DATABASE ─────────────────────────────────
const ROADMAP_DATA = {
  ai: [
    {
      title: "Agentforce Basics",
      type: "Module",
      points: "500 pts",
      time: "45 mins",
      desc: "Learn how autonomous AI agents work, how topics route intents, and how Einstein Trust Layer protects enterprise data.",
      url: "https://trailhead.salesforce.com/content/learn/modules/agentforce-basics"
    },
    {
      title: "Prompt Builder: Quick Look",
      type: "Module",
      points: "300 pts",
      time: "20 mins",
      desc: "Create prompt templates grounded in CRM data to generate personalized customer emails, case summaries, and field values.",
      url: "https://trailhead.salesforce.com/content/learn/modules/prompt-builder-basics"
    },
    {
      title: "Einstein Trust Layer Fundamentals",
      type: "Module",
      points: "500 pts",
      time: "40 mins",
      desc: "Deep dive into dynamic PII masking, Zero Data Retention (ZDR) architecture, toxicity filtering, and audit trail compliance.",
      url: "https://trailhead.salesforce.com/content/learn/modules/einstein-trust-layer"
    },
    {
      title: "Build an Agentforce Agent for Service",
      type: "Project",
      points: "800 pts",
      time: "1 hr",
      desc: "Hands-on project to configure Agentforce topics, integrate autolaunched flows as actions, and test autonomous conversational experiences.",
      url: "https://trailhead.salesforce.com/content/learn/projects/build-an-agentforce-agent-for-service"
    },
    {
      title: "Salesforce Certified AI Specialist Credential Prep",
      type: "Trailmix",
      points: "5,000 pts",
      time: "12 hrs",
      desc: "Comprehensive preparation guide for the official Salesforce AI Specialist Certification covering Agentforce, Prompt Builder, and Data Cloud.",
      url: "https://trailhead.salesforce.com/users/strailhead/trailmixes/prepare-for-your-salesforce-ai-specialist-credential"
    }
  ],

  dev: [
    {
      title: "Apex Enterprise Patterns: Service & Selector Layer",
      type: "Module",
      points: "1,000 pts",
      time: "1.5 hrs",
      desc: "Architect clean, maintainable enterprise code using the separation of concerns (SoC), unit of work, and selector patterns.",
      url: "https://trailhead.salesforce.com/content/learn/modules/apex_patterns_sl"
    },
    {
      title: "Lightning Web Components Specialist",
      type: "Superbadge",
      points: "5,000 pts",
      time: "6 hrs",
      desc: "Prove your hands-on mastery of LWC reactive properties, Lightning Data Service, wire adapters, and component communication.",
      url: "https://trailhead.salesforce.com/content/learn/superbadges/superbadge_lwc_specialist"
    },
    {
      title: "Apex Specialist Superbadge",
      type: "Superbadge",
      points: "5,000 pts",
      time: "6 hrs",
      desc: "Build bulkified triggers, asynchronous queueable pipelines, scheduled jobs, and rigorous unit testing with 100% code coverage.",
      url: "https://trailhead.salesforce.com/content/learn/superbadges/superbadge_apex"
    },
    {
      title: "Asynchronous Apex: Queueable, Batch & Future",
      type: "Module",
      points: "600 pts",
      time: "50 mins",
      desc: "Master asynchronous processing patterns, higher governor limits (60s CPU, 12MB heap), and chained queueable jobs.",
      url: "https://trailhead.salesforce.com/content/learn/modules/asynchronous_apex"
    }
  ],

  admin: [
    {
      title: "Flow Builder Masterclass & Orchestrator",
      type: "Module",
      points: "800 pts",
      time: "1 hr",
      desc: "Design scalable record-triggered, screen, and schedule-triggered flows with fault paths and error handling.",
      url: "https://trailhead.salesforce.com/content/learn/modules/record-triggered-flows"
    },
    {
      title: "Security Specialist Superbadge",
      type: "Superbadge",
      points: "5,000 pts",
      time: "5 hrs",
      desc: "Configure role hierarchies, Organization-Wide Defaults, permission set groups, and field-level security for enterprise compliance.",
      url: "https://trailhead.salesforce.com/content/learn/superbadges/superbadge_security_specialist"
    },
    {
      title: "Data Cloud for Admins: Ingestion & Modeling",
      type: "Module",
      points: "600 pts",
      time: "45 mins",
      desc: "Learn how Data Cloud connects external data lakes, creates Data Model Objects (DMOs), and grounds Agentforce with real-time profiles.",
      url: "https://trailhead.salesforce.com/content/learn/modules/data-cloud-basics"
    }
  ],

  cta: [
    {
      title: "Large Data Volumes (LDV) Architecture",
      type: "Module",
      points: "800 pts",
      time: "1 hr",
      desc: "Architect databases for 10M+ records: custom skinning, index selectivity, skinny tables, and data archiving strategies.",
      url: "https://trailhead.salesforce.com/content/learn/modules/large_data_volumes"
    },
    {
      title: "Shield Platform Encryption Architecture",
      type: "Module",
      points: "600 pts",
      time: "50 mins",
      desc: "Protect sensitive data at rest using Bring Your Own Key (BYOK), probabilistic vs deterministic encryption, and audit considerations.",
      url: "https://trailhead.salesforce.com/content/learn/modules/shield_platform_encryption"
    },
    {
      title: "Real-Time Event Monitoring & Threat Detection",
      type: "Module",
      points: "800 pts",
      time: "1 hr",
      desc: "Detect credential stuffing, report anomalous data exfiltration, and analyze transaction security policies using Event Monitoring.",
      url: "https://trailhead.salesforce.com/content/learn/modules/event_monitoring"
    }
  ]
};

// ─── 3. INSPECTOR USER GUIDE & TOOL DIRECTORY ───────────────────────
const INSPECTOR_TOOLS_DIRECTORY = [
  {
    id: "inspect-record",
    name: "Show All Data & Record Inspector",
    icon: "🔍",
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

// ─── 4. OFFICIAL SALESFORCE TOOLS & DEVELOPER SITES ───────────────────
const OFFICIAL_SF_SITES = [
  {
    category: "Developer Tools & CLIs",
    items: [
      {
        title: "Salesforce Workbench",
        icon: "🛠️",
        badge: "WEB TOOL",
        url: "https://workbench.developerforce.com",
        desc: "Powerful web-based developer tool designed for administrators and developers to interact with Salesforce.com orgs via Force.com APIs.",
        keyCapabilities: ["Direct SOQL & SOSL Queries", "Metadata Deploy & Retrieve", "Bulk API 2.0 Ingestion", "REST Explorer"]
      },
      {
        title: "Salesforce CLI (sf / sfdx)",
        icon: "💻",
        badge: "OFFICIAL CLI",
        url: "https://developer.salesforce.com/tools/salesforcecli",
        desc: "The foundational command-line interface for modern Salesforce development. Powers scratch orgs, source-tracking deployments, unit testing, and CI/CD automation.",
        keyCapabilities: ["sf project deploy start", "sf org create scratch", "sf apex run test", "CI/CD Pipeline Automation"]
      },
      {
        title: "Salesforce Code Builder & VS Code Extensions",
        icon: "⚡",
        badge: "OFFICIAL IDE",
        url: "https://developer.salesforce.com/tools/vscode",
        desc: "The official development environment for Salesforce, providing rich language support for Apex, LWC, Aura, Visualforce, and SOQL with syntax checking and debugging.",
        keyCapabilities: ["Apex Replay Debugger", "LWC Local Development Server", "Schema Browser", "Interactive SOQL Builder"]
      },
      {
        title: "Lightning Web Components (LWC) Component Library",
        icon: "🎨",
        badge: "COMPONENT LIBRARY",
        url: "https://developer.salesforce.com/docs/component-library/overview/components",
        desc: "Interactive documentation and live preview playground for all standard Lightning Base Components (lightning-button, lightning-datatable, lightning-record-edit-form).",
        keyCapabilities: ["Live Component Previews", "Attribute & Event Specifications", "SLDS Accessibility Standards", "Code Snippets"]
      }
    ]
  },
  {
    category: "Official Documentation & API Guides",
    items: [
      {
        title: "Salesforce Developer Documentation Portal",
        icon: "📖",
        badge: "CENTRAL DOCS",
        url: "https://developer.salesforce.com/docs",
        desc: "The central home for all official Salesforce developer documentation, technical manuals, release notes, architectural guides, and SDK references across all clouds.",
        keyCapabilities: ["All Cloud API Specs", "Release Notes Archive", "Platform Developer Guides", "Integration Patterns"]
      },
      {
        title: "SOQL and SOSL Reference Guide",
        icon: "🔍",
        badge: "QUERY GUIDE",
        url: "https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/",
        desc: "Complete formal grammar and reference for Salesforce Object Query Language (SOQL) and Search Language (SOSL).",
        keyCapabilities: ["Aggregate Functions & GROUP BY", "Date Literals (LAST_N_DAYS)", "Polymorphic TYPEOF Queries", "Child Relationship Subqueries"]
      },
      {
        title: "Tooling API Developer Guide",
        icon: "🔧",
        badge: "TOOLING API",
        url: "https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/",
        desc: "Deep-dive guide into the Tooling API, exposing fine-grained metadata objects (CustomField, ValidationRule, ApexClass, SymbolTable) for custom developer tools.",
        keyCapabilities: ["Execute Anonymous Apex", "Code Coverage Inspection", "TraceFlag & Debug Logging", "Fine-grained Metadata CRUD"]
      },
      {
        title: "REST API Developer Guide",
        icon: "🌐",
        badge: "REST API",
        url: "https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/",
        desc: "Official documentation for the Salesforce REST API. Simple, REST-based programmatic access to records, search, metadata, and composite resources.",
        keyCapabilities: ["SObject CRUD Operations", "Composite Graph API", "SObject Collections", "Describe Metadata Endpoints"]
      },
      {
        title: "Metadata API Developer Guide",
        icon: "📦",
        badge: "METADATA API",
        url: "https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/",
        desc: "Definitive guide for managing customizations and deploying metadata between orgs. Describes all metadata types and the package.xml manifest structure.",
        keyCapabilities: ["retrieve() and deploy() Operations", "package.xml Manifest Syntax", "Custom Object & Field Definitions", "DevOps Deployment Automation"]
      },
      {
        title: "Apex Developer Guide & Reference",
        icon: "⚡",
        badge: "APEX GUIDE",
        url: "https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/",
        desc: "Complete API reference for every standard Apex class, method, interface, and namespace (System, Database, ConnectApi, EventBus, Schema).",
        keyCapabilities: ["Governor Limits Rules", "Trigger Execution Context", "Asynchronous Processing", "Database Locking & Transactions"]
      }
    ]
  },
  {
    category: "Architecture & Best Practices",
    items: [
      {
        title: "Salesforce Architects Framework (Well-Architected)",
        icon: "🏛️",
        badge: "ARCHITECTURE",
        url: "https://architect.salesforce.com",
        desc: "The definitive architecture framework created by Salesforce CTA leaders. Covers Trusted, Easy, and Adaptable architecture patterns, anti-patterns, and decision matrices.",
        keyCapabilities: ["Large Data Volume (LDV) Patterns", "Enterprise Integration Decision Guides", "Security & Encryption Blueprints", "Multi-Org Strategy"]
      },
      {
        title: "Salesforce Trailhead & Superbadge Hub",
        icon: "🎓",
        badge: "TRAILHEAD",
        url: "https://trailhead.salesforce.com",
        desc: "The official gamified learning platform for mastering Salesforce skills, earning certifications, and completing hands-on Superbadges.",
        keyCapabilities: ["Developer & Architect Trails", "Hands-on Superbadge Masterclasses", "Certification Study Guides", "Release Modules"]
      }
    ]
  },
  {
    category: "System Health & Community",
    items: [
      {
        title: "Salesforce Trust & System Status",
        icon: "🛡️",
        badge: "TRUST STATUS",
        url: "https://status.salesforce.com",
        desc: "Real-time health, uptime, and performance metrics for the Salesforce cloud platform. Displays active incidents, maintenance windows, and security notices.",
        keyCapabilities: ["Instance Health (NA, AP, EU)", "Degradation & Outage Alerts", "Scheduled Maintenance Times", "Security Advisories"]
      },
      {
        title: "Salesforce Known Issues Tracker",
        icon: "🐛",
        badge: "KNOWN ISSUES",
        url: "https://issues.salesforce.com",
        desc: "Official bug tracker maintained by Salesforce Engineering detailing verified platform defects, regression issues, release impacts, and recommended workarounds.",
        keyCapabilities: ["Search Known GACKs and Defects", "Workarounds & Remediation Steps", "Track Resolution Status", "Click 'This Issue Impacts Me'"]
      },
      {
        title: "Salesforce StackExchange",
        icon: "💬",
        badge: "COMMUNITY Q&A",
        url: "https://salesforce.stackexchange.com",
        desc: "The premier peer-to-peer technical Q&A community for Salesforce developers, administrators, and architects worldwide.",
        keyCapabilities: ["Complex Apex & SOQL Debugging", "Architecture Discussions", "Obscure Error Solutions", "Over 200,000 Verified Answers"]
      },
      {
        title: "Salesforce IdeaExchange",
        icon: "💡",
        badge: "PRODUCT FEEDBACK",
        url: "https://ideas.salesforce.com",
        desc: "Official co-creation platform where Trailblazers submit feature requests, prioritize the product roadmap, and vote on upcoming platform releases.",
        keyCapabilities: ["Submit Feature Requests", "Vote on Upcoming Releases", "Direct Feedback to Product PMs", "Track Implementation Status"]
      }
    ]
  }
];

// ─── 5. INSPECTOR GUIDE & SF SITES RENDERERS ─────────────────────────
function renderInspectorGuide(filterText = "") {
  const container = document.getElementById("guide-tools-list");
  if (!container) return;
  const q = filterText.trim().toLowerCase();

  const filtered = INSPECTOR_TOOLS_DIRECTORY.filter(t => {
    if (!q) return true;
    return t.name.toLowerCase().includes(q) ||
      t.summary.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q) ||
      t.features.some(f => f.toLowerCase().includes(q)) ||
      t.howToUse.toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 24px; text-align: center;">
        <div style="font-size: 24px; margin-bottom: 6px;">🔍</div>
        <strong>No inspector tools match "${escapeHtml(filterText)}"</strong>
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

function renderSalesforceSites(filterText = "") {
  const container = document.getElementById("sf-sites-list");
  if (!container) return;
  const q = filterText.trim().toLowerCase();

  let html = "";
  for (const group of OFFICIAL_SF_SITES) {
    const matchingItems = group.items.filter(item => {
      if (!q) return true;
      return item.title.toLowerCase().includes(q) ||
        item.desc.toLowerCase().includes(q) ||
        item.keyCapabilities.some(c => c.toLowerCase().includes(q));
    });

    if (matchingItems.length === 0) continue;

    html += `
      <div>
        <div class="category-header">
          <span>📁</span> ${escapeHtml(group.category)}
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${matchingItems.map(site => `
            <div class="sf-site-card">
              <div class="sf-site-info">
                <div class="sf-site-title">
                  <span>${site.icon}</span>
                  <a href="${site.url}" target="_blank" style="color: var(--primary); text-decoration: none;">${escapeHtml(site.title)} ↗</a>
                  <span class="guide-pill">${site.badge}</span>
                </div>
                <div class="sf-site-desc">
                  ${escapeHtml(site.desc)}
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px;">
                  ${site.keyCapabilities.map(cap => `
                    <span style="font-size: 10px; background: rgba(0,0,0,0.04); border: 1px solid var(--border); padding: 1px 6px; border-radius: 4px; color: var(--text-muted);">
                      ✓ ${escapeHtml(cap)}
                    </span>
                  `).join("")}
                </div>
                <div class="sf-site-url" style="margin-top: 3px;">
                  ${site.url}
                </div>
              </div>
              <div style="flex-shrink: 0;">
                <a href="${site.url}" target="_blank" class="btn btn-secondary" style="font-size: 11px; text-decoration: none; padding: 5px 10px;">
                  Open Site ↗
                </a>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  container.innerHTML = html || `
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 24px; text-align: center;">
      <strong>No Salesforce tools match your search.</strong>
    </div>
  `;
}

// ─── 3. TAB SWITCHING & INITIALIZATION ──────────────────────────────
function initTabSwitching() {
  document.addEventListener("click", (e) => {
    const tabBtn = e.target.closest("#learning-tabs .tool-tab");
    if (!tabBtn) return;
    e.preventDefault();
    switchTab(tabBtn.dataset.tab);
  });
}

function switchTab(tabId) {
  document.querySelectorAll("#learning-tabs .tool-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.tab === tabId);
  });

  document.querySelectorAll(".tab-content").forEach(v => {
    v.style.display = "none";
  });

  const targetView = document.getElementById(`view-${tabId}`);
  if (targetView) {
    targetView.style.display = (tabId === "debugger" || tabId === "roadmaps") ? "flex" : "block";
  }
}

function init() {
  const sfHost = resolveSfHost();
  if (sfHost) {
    const badge = document.getElementById("env-badge");
    if (badge) badge.style.display = "";
    const orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
    updateNavbarOrgBadge(sfHost, orgInfo);

    const navGuide = document.getElementById("link-nav-guide");
    if (navGuide) {
      navGuide.href = `inspector-guide.html?host=${encodeURIComponent(sfHost)}`;
    }
  }
  initTabSwitching();
  setupEvents();

  // Read URL query params for initial tab
  const params = new URLSearchParams(window.location.search);
  const initialTab = params.get("tab") || "roadmaps";
  switchTab(initialTab);

  renderSalesforceSites("");
  renderErrorCards(ERROR_DATABASE);
  renderRoadmaps("ai");
}

// ─── 4. TAB 1: ERROR DEBUGGER RENDERER ──────────────────────────────
function renderErrorCards(errors) {
  const container = document.getElementById("error-cards-container");
  const countBadge = document.getElementById("error-count-badge");
  countBadge.textContent = `Showing ${errors.length} of ${ERROR_DATABASE.length} Common Errors`;

  if (errors.length === 0) {
    container.innerHTML = `
      <div style="background:#fff; border:1px solid #e2e8f0; border-radius:6px; padding:30px; text-align:center;">
        <div style="font-size:24px; margin-bottom:6px;">🔍</div>
        <strong>No error matches found.</strong>
        <div style="font-size:12px; color:#64748b; margin-top:4px;">Try searching for error keywords like "locking", "101", "CPU", "DML", or "Validation".</div>
      </div>
    `;
    return;
  }

  container.innerHTML = errors.map(err => {
    const catClass = `tag-${err.category.toLowerCase()}`;
    return `
      <div class="error-card">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="tag-badge ${catClass}">${err.category}</span>
            <strong style="font-size: 13px; color: #dc2626; font-family: var(--font-mono);">${escapeHtml(err.code)}</strong>
            <span style="font-size: 13px; color: #0f172a; font-weight: 600;">— ${escapeHtml(err.title)}</span>
          </div>
          <div style="display: flex; gap: 6px;">
            ${err.helpUrl ? `<a href="${err.helpUrl}" target="_blank" class="pill-btn" style="color:#0176d3; text-decoration:none;">📖 Official Help</a>` : ''}
            ${err.trailheadUrl ? `<a href="${err.trailheadUrl}" target="_blank" class="pill-btn" style="color:#16a34a; text-decoration:none;">🎓 Trailhead</a>` : ''}
          </div>
        </div>

        <div style="font-size: 12px; color: #334151; margin-top: 4px; line-height: 1.5;">
          <strong>Root Cause:</strong> ${escapeHtml(err.rootCause)}
        </div>

        <div style="font-size: 11px; background: #f8fafc; border-left: 3px solid #0176d3; padding: 8px 10px; border-radius: 4px; margin-top: 4px; color: #1e293b; line-height: 1.5; white-space: pre-line;">
          <strong>💡 Recommended Resolution:</strong>\n${escapeHtml(err.remediation)}
        </div>

        ${err.codeSnippet ? `
          <div style="margin-top: 6px;">
            <pre style="background: #1e293b; color: #f8fafc; padding: 10px; border-radius: 4px; font-family: var(--font-mono); font-size: 11px; overflow-x: auto;"><code>${escapeHtml(err.codeSnippet)}</code></pre>
          </div>
        ` : ''}
      </div>
    `;
  }).join("");
}

function filterErrors() {
  const query = document.getElementById("search-errors").value.trim().toLowerCase();
  const category = document.getElementById("filter-error-category").value;

  const filtered = ERROR_DATABASE.filter(err => {
    const matchCat = category === "ALL" || err.category === category;
    const matchQ = !query ||
      err.code.toLowerCase().includes(query) ||
      err.title.toLowerCase().includes(query) ||
      err.rootCause.toLowerCase().includes(query) ||
      err.remediation.toLowerCase().includes(query);
    return matchCat && matchQ;
  });

  renderErrorCards(filtered);
}

// ─── 5. TAB 2: TRAILHEAD ROADMAPS RENDERER ──────────────────────────
function renderRoadmaps(role) {
  const container = document.getElementById("roadmaps-list-container");
  const items = ROADMAP_DATA[role] || [];

  container.innerHTML = items.map((item, idx) => `
    <div class="roadmap-card">
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 10px; font-weight: 700; background: #ede9fe; color: #6d28d9; padding: 2px 6px; border-radius: 3px; text-transform: uppercase;">
            ${item.type}
          </span>
          <a href="${item.url}" target="_blank" class="roadmap-link">
            #${idx + 1}. ${escapeHtml(item.title)} ↗
          </a>
        </div>
        <div style="font-size: 12px; color: #64748b;">
          ${escapeHtml(item.desc)}
        </div>
      </div>
      <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0;">
        <span style="font-size: 11px; font-weight: 700; color: #16a34a;">${item.points}</span>
        <span style="font-size: 10px; color: #94a3b8;">⏱️ ${item.time}</span>
      </div>
    </div>
  `).join("");
}

// ─── 6. TAB 4: COMMUNITY SEARCH LAUNCHER ────────────────────────────
function launchCommunitySearch(site) {
  const query = document.getElementById("community-search-input").value.trim();
  if (!query) {
    alert("Please enter a search topic or error code above.");
    return;
  }

  let url = "";
  const encoded = encodeURIComponent(query);

  switch (site) {
    case "stackexchange":
      url = `https://salesforce.stackexchange.com/search?q=${encoded}`;
      break;
    case "trailhead":
      url = `https://trailhead.salesforce.com/en/search?keywords=${encoded}`;
      break;
    case "trailblazer":
      url = `https://trailhead.salesforce.com/trailblazer-community/feed?tag=${encoded}`;
      break;
    case "docs":
      url = `https://developer.salesforce.com/docs?search=${encoded}`;
      break;
    case "issues":
      url = `https://issues.salesforce.com/?q=${encoded}`;
      break;
  }

  if (url) {
    window.open(url, "_blank");
  }
}

// ─── 7. EVENT BINDINGS ───────────────────────────────────────────────
function setupEvents() {
  document.getElementById("guide-search")?.addEventListener("input", (e) => {
    renderInspectorGuide(e.target.value);
  });

  document.getElementById("sf-tools-search")?.addEventListener("input", (e) => {
    renderSalesforceSites(e.target.value);
  });

  document.getElementById("guide-tools-list")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-launch-tool");
    if (!btn) return;
    const toolId = btn.dataset.tool;
    const sfHost = resolveSfHost();
    const url = `${toolId}.html${sfHost ? `?host=${encodeURIComponent(sfHost)}` : ""}`;
    window.open(url, "_blank");
  });

  document.getElementById("search-errors")?.addEventListener("input", filterErrors);
  document.getElementById("filter-error-category")?.addEventListener("change", filterErrors);

  document.getElementById("select-role-roadmap")?.addEventListener("change", (e) => {
    renderRoadmaps(e.target.value);
  });

  document.querySelectorAll(".btn-comm-search").forEach(btn => {
    btn.addEventListener("click", () => {
      launchCommunitySearch(btn.dataset.site);
    });
  });

  document.getElementById("community-search-input")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      launchCommunitySearch("stackexchange");
    }
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

init();

