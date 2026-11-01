import { sfConn, apiVersion, updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";

const sfHost = resolveSfHost();

// Format bytes for static resources
function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// Format ISO date
function formatDate(isoStr) {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return String(isoStr);
  }
}

// Security: escape HTML entities
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─── COMPLETE METADATA CATALOG (31 Metadata Types) ────────────────────
const METADATA_CATALOG = [
  // --- Category: standard (Standard Metadata) ---
  {
    key: "StandardObject",
    name: "Standard Objects",
    category: "standard",
    tooling: true,
    countQuery: "SELECT count() FROM EntityDefinition WHERE IsCustomSetting = false AND IsCustomizable = true AND (NOT QualifiedApiName LIKE '%__c')",
    componentQuery: "SELECT QualifiedApiName, Label, KeyPrefix, DurableId FROM EntityDefinition WHERE IsCustomSetting = false AND IsCustomizable = true AND (NOT QualifiedApiName LIKE '%__c') ORDER BY Label ASC",
    desc: "Standard Salesforce CRM Objects (Account, Contact, Case, Opportunity, Lead, etc.)",
    getName: r => r.Label || r.QualifiedApiName,
    getApiName: r => r.QualifiedApiName,
    getId: r => r.DurableId || r.KeyPrefix || "",
    getExtra: r => r.KeyPrefix ? `Prefix: ${r.KeyPrefix}` : "Standard",
    getOrgLink: (r, host) => `https://${host}/lightning/setup/ObjectManager/${r.QualifiedApiName}/view`,
    getRouterLinks: (r, host) => [
      { label: "🔍 Inspect", url: `inspect-record.html?sobject=${r.QualifiedApiName}&host=${host}`, title: "Inspect object schema and records" },
      { label: "⚙️ Fields & FLS", url: `field-manager.html?obj=${r.QualifiedApiName}&host=${host}`, title: "Manage fields, metadata & FLS" },
      { label: "📊 Query", url: `data-explorer.html?sobject=${r.QualifiedApiName}&host=${host}`, title: "Query data" },
      { label: "📐 Schema", url: `schema-viewer.html?sobject=${r.QualifiedApiName}&host=${host}`, title: "View object ERD & schema" }
    ]
  },
  {
    key: "CustomMetadata",
    name: "Custom Metadata Types",
    category: "standard",
    tooling: true,
    countQuery: "SELECT count() FROM EntityDefinition WHERE QualifiedApiName LIKE '%__mdt'",
    componentQuery: "SELECT QualifiedApiName, Label, DeveloperName, DurableId FROM EntityDefinition WHERE QualifiedApiName LIKE '%__mdt' ORDER BY Label ASC",
    desc: "Custom Metadata Types (__mdt) for application configuration and rules",
    getName: r => r.Label || r.QualifiedApiName,
    getApiName: r => r.QualifiedApiName,
    getId: r => r.DurableId || "",
    getExtra: r => "Custom Metadata",
    getOrgLink: (r, host) => `https://${host}/lightning/setup/CustomMetadata/home`,
    getRouterLinks: (r, host) => [
      { label: "🔍 Inspect", url: `inspect-record.html?sobject=${r.QualifiedApiName}&host=${host}`, title: "Inspect schema" },
      { label: "⚙️ Fields", url: `field-manager.html?obj=${r.QualifiedApiName}&host=${host}`, title: "Manage fields" },
      { label: "📊 Records", url: `data-explorer.html?sobject=${r.QualifiedApiName}&host=${host}`, title: "Query metadata records" }
    ]
  },
  {
    key: "CustomSetting",
    name: "Custom Settings",
    category: "standard",
    tooling: true,
    countQuery: "SELECT count() FROM EntityDefinition WHERE IsCustomSetting = true",
    componentQuery: "SELECT QualifiedApiName, Label, DeveloperName, DurableId FROM EntityDefinition WHERE IsCustomSetting = true ORDER BY Label ASC",
    desc: "Hierarchy and List Custom Settings cached in application memory",
    getName: r => r.Label || r.QualifiedApiName,
    getApiName: r => r.QualifiedApiName,
    getId: r => r.DurableId || "",
    getExtra: r => "Custom Setting",
    getOrgLink: (r, host) => `https://${host}/lightning/setup/CustomSettings/home`,
    getRouterLinks: (r, host) => [
      { label: "🔍 Inspect", url: `inspect-record.html?sobject=${r.QualifiedApiName}&host=${host}`, title: "Inspect schema" },
      { label: "📊 Records", url: `data-explorer.html?sobject=${r.QualifiedApiName}&host=${host}`, title: "Query custom settings" }
    ]
  },
  {
    key: "PlatformEvent",
    name: "Platform Events",
    category: "standard",
    tooling: true,
    countQuery: "SELECT count() FROM EntityDefinition WHERE QualifiedApiName LIKE '%__e'",
    componentQuery: "SELECT QualifiedApiName, Label, DeveloperName, DurableId FROM EntityDefinition WHERE QualifiedApiName LIKE '%__e' ORDER BY Label ASC",
    desc: "Event-driven pub/sub messaging event definitions (__e)",
    getName: r => r.Label || r.QualifiedApiName,
    getApiName: r => r.QualifiedApiName,
    getId: r => r.DurableId || "",
    getExtra: r => "Platform Event",
    getOrgLink: (r, host) => `https://${host}/lightning/setup/EventObjects/home`,
    getRouterLinks: (r, host) => [
      { label: "📡 Event Monitor", url: `event-monitor.html?host=${host}`, title: "Subscribe & stream platform events in real-time" },
      { label: "🔍 Inspect", url: `inspect-record.html?sobject=${r.QualifiedApiName}&host=${host}`, title: "Inspect schema" }
    ]
  },
  {
    key: "CustomApplication",
    name: "Standard & Custom Apps",
    category: "standard",
    tooling: true,
    countQuery: "SELECT count() FROM CustomApplication",
    componentQuery: "SELECT Id, DeveloperName, Label, Description, UiType, NavType, LastModifiedDate FROM CustomApplication ORDER BY Label ASC",
    desc: "Lightning and Classic Applications (CustomApplication)",
    getName: r => r.Label || r.DeveloperName,
    getApiName: r => r.DeveloperName,
    getId: r => r.Id,
    getExtra: r => `${r.NavType || ''} ${r.UiType || ''}`.trim() || "App",
    getOrgLink: (r, host) => `https://${host}/lightning/setup/AppManager/home`,
    getRouterLinks: () => []
  },
  {
    key: "EmailTemplate",
    name: "Email Templates",
    category: "standard",
    tooling: false,
    countQuery: "SELECT count() FROM EmailTemplate",
    componentQuery: "SELECT Id, Name, DeveloperName, Subject, FolderName, TemplateType, LastModifiedDate FROM EmailTemplate ORDER BY Name ASC",
    desc: "HTML, Text, and Visualforce Email Communication Templates",
    getName: r => r.Name || r.DeveloperName,
    getApiName: r => r.DeveloperName || r.Name,
    getId: r => r.Id,
    getExtra: r => `${r.TemplateType || 'Email'} (${r.FolderName || 'Unfiled'})`,
    getOrgLink: (r, host) => `https://${host}/lightning/setup/CommunicationTemplatesEmail/page?address=%2F${r.Id}`,
    getRouterLinks: () => []
  },

  // --- Category: code (Custom Code & LWC) ---
  {
    key: "ApexClass",
    name: "Apex Classes",
    category: "code",
    tooling: true,
    countQuery: "SELECT count() FROM ApexClass",
    componentQuery: "SELECT Id, Name, ApiVersion, Status, LengthWithoutComments, NamespacePrefix, LastModifiedDate FROM ApexClass ORDER BY Name ASC",
    desc: "Apex Classes, Controllers, Batchables, Schedulables, and Services",
    getName: r => r.Name,
    getApiName: r => r.Name,
    getId: r => r.Id,
    getExtra: r => `v${r.ApiVersion || '62.0'} ${r.Status === 'Active' ? '🟢 Active' : (r.Status || '')} ${r.NamespacePrefix ? `(${r.NamespacePrefix})` : ''}`,
    getOrgLink: (r, host) => `https://${host}/lightning/setup/ApexClasses/page?address=%2F${r.Id}`,
    getRouterLinks: (r, host) => [
      { label: "⚡ Apex Runner", url: `apex-runner.html?class=${r.Name}&host=${host}`, title: "Execute anonymous or test class" }
    ]
  },
  {
    key: "ApexTrigger",
    name: "Apex Database Triggers",
    category: "code",
    tooling: true,
    countQuery: "SELECT count() FROM ApexTrigger",
    componentQuery: "SELECT Id, Name, TableEnumOrId, Status, ApiVersion, NamespacePrefix, LastModifiedDate FROM ApexTrigger ORDER BY Name ASC",
    desc: "Apex Database Event Triggers on Standard and Custom SObjects",
    getName: r => r.Name,
    getApiName: r => r.TableEnumOrId ? `${r.TableEnumOrId}.${r.Name}` : r.Name,
    getId: r => r.Id,
    getExtra: r => `On: ${r.TableEnumOrId || 'Object'} • ${r.Status === 'Active' ? '🟢 Active' : (r.Status || '')}`,
    getOrgLink: (r, host) => `https://${host}/lightning/setup/ApexTriggers/page?address=%2F${r.Id}`,
    getRouterLinks: (r, host) => [
      { label: "📐 Schema", url: `schema-viewer.html?sobject=${r.TableEnumOrId}&host=${host}`, title: "View target object schema" },
      { label: "⚙️ Fields", url: `field-manager.html?obj=${r.TableEnumOrId}&host=${host}`, title: "Manage fields of target object" }
    ]
  },
  {
    key: "LightningComponentBundle",
    name: "Lightning Web Components (LWC)",
    category: "code",
    tooling: true,
    countQuery: "SELECT count() FROM LightningComponentBundle",
    componentQuery: "SELECT Id, DeveloperName, MasterLabel, Description, ApiVersion, NamespacePrefix, LastModifiedDate FROM LightningComponentBundle ORDER BY DeveloperName ASC",
    desc: "Lightning Web Components (LWC) Bundles",
    getName: r => r.MasterLabel || r.DeveloperName,
    getApiName: r => r.DeveloperName,
    getId: r => r.Id,
    getExtra: r => `v${r.ApiVersion || '62.0'} ${r.NamespacePrefix ? `(${r.NamespacePrefix})` : 'c'}`,
    getOrgLink: (r, host) => `https://${host}/lightning/setup/LightningComponentBundles/home`,
    getRouterLinks: () => []
  },
  {
    key: "AuraDefinitionBundle",
    name: "Aura Components",
    category: "code",
    tooling: true,
    countQuery: "SELECT count() FROM AuraDefinitionBundle",
    componentQuery: "SELECT Id, DeveloperName, MasterLabel, Description, ApiVersion, NamespacePrefix, LastModifiedDate FROM AuraDefinitionBundle ORDER BY DeveloperName ASC",
    desc: "Aura Component Framework Bundles",
    getName: r => r.MasterLabel || r.DeveloperName,
    getApiName: r => r.DeveloperName,
    getId: r => r.Id,
    getExtra: r => `v${r.ApiVersion || '62.0'} ${r.NamespacePrefix ? `(${r.NamespacePrefix})` : 'c'}`,
    getOrgLink: (r, host) => `https://${host}/lightning/setup/LightningComponentBundles/home`,
    getRouterLinks: () => []
  },
  {
    key: "ApexPage",
    name: "Visualforce Pages",
    category: "code",
    tooling: true,
    countQuery: "SELECT count() FROM ApexPage",
    componentQuery: "SELECT Id, Name, MasterLabel, ApiVersion, NamespacePrefix, LastModifiedDate FROM ApexPage ORDER BY Name ASC",
    desc: "Visualforce Web Pages (ApexPage)",
    getName: r => r.MasterLabel || r.Name,
    getApiName: r => r.Name,
    getId: r => r.Id,
    getExtra: r => `v${r.ApiVersion || '62.0'}`,
    getOrgLink: (r, host) => `https://${host}/lightning/setup/ApexPages/page?address=%2F${r.Id}`,
    getRouterLinks: (r, host) => [
      { label: "↗ View Page", url: `https://${host}/apex/${r.Name}`, title: "Open Visualforce page in org", external: true }
    ]
  },
  {
    key: "ApexComponent",
    name: "Visualforce Components",
    category: "code",
    tooling: true,
    countQuery: "SELECT count() FROM ApexComponent",
    componentQuery: "SELECT Id, Name, MasterLabel, ApiVersion, NamespacePrefix, LastModifiedDate FROM ApexComponent ORDER BY Name ASC",
    desc: "Visualforce Custom Components (ApexComponent)",
    getName: r => r.MasterLabel || r.Name,
    getApiName: r => r.Name,
    getId: r => r.Id,
    getExtra: r => `v${r.ApiVersion || '62.0'}`,
    getOrgLink: (r, host) => `https://${host}/lightning/setup/ApexComponents/page?address=%2F${r.Id}`,
    getRouterLinks: () => []
  },
  {
    key: "StaticResource",
    name: "Static Resources",
    category: "code",
    tooling: true,
    countQuery: "SELECT count() FROM StaticResource",
    componentQuery: "SELECT Id, Name, ContentType, BodyLength, Description, NamespacePrefix, LastModifiedDate FROM StaticResource ORDER BY Name ASC",
    desc: "Static CSS, JS, image, and zip archives (StaticResource)",
    getName: r => r.Name,
    getApiName: r => r.Name,
    getId: r => r.Id,
    getExtra: r => `${r.ContentType || 'asset'} (${formatBytes(r.BodyLength || 0)})`,
    getOrgLink: (r, host) => `https://${host}/lightning/setup/StaticPR/page?address=%2F${r.Id}`,
    getRouterLinks: () => []
  },

  // --- Category: objects (Objects & Schema) ---
  {
    key: "CustomObject",
    name: "Custom Database Objects",
    category: "objects",
    tooling: true,
    countQuery: "SELECT count() FROM CustomObject",
    componentQuery: "SELECT Id, DeveloperName, NamespacePrefix, CreatedDate, LastModifiedDate FROM CustomObject ORDER BY DeveloperName ASC",
    desc: "Custom Database Entities and Data Models (__c)",
    getName: r => `${r.DeveloperName}__c`,
    getApiName: r => `${r.DeveloperName}__c`,
    getId: r => r.Id,
    getExtra: r => r.NamespacePrefix ? `Prefix: ${r.NamespacePrefix}` : "Custom SObject",
    getOrgLink: (r, host) => `https://${host}/lightning/setup/ObjectManager/${r.DeveloperName}__c/view`,
    getRouterLinks: (r, host) => [
      { label: "🔍 Inspect", url: `inspect-record.html?sobject=${r.DeveloperName}__c&host=${host}`, title: "Inspect schema & records" },
      { label: "⚙️ Fields & FLS", url: `field-manager.html?obj=${r.DeveloperName}__c&host=${host}`, title: "Manage fields and FLS" },
      { label: "📊 Query", url: `data-explorer.html?sobject=${r.DeveloperName}__c&host=${host}`, title: "Query records" },
      { label: "📐 Schema", url: `schema-viewer.html?sobject=${r.DeveloperName}__c&host=${host}`, title: "View ERD" }
    ]
  },
  {
    key: "CustomField",
    name: "Custom Fields",
    category: "objects",
    tooling: true,
    countQuery: "SELECT count() FROM CustomField",
    componentQuery: "SELECT Id, DeveloperName, TableEnumOrId, Description, NamespacePrefix, LastModifiedDate FROM CustomField ORDER BY TableEnumOrId ASC, DeveloperName ASC",
    desc: "Custom Fields across Standard & Custom Objects",
    getName: r => `${r.TableEnumOrId}.${r.DeveloperName}__c`,
    getApiName: r => `${r.DeveloperName}__c`,
    getId: r => r.Id,
    getExtra: r => `${r.NamespacePrefix ? `[${r.NamespacePrefix}] ` : ''}Custom Field on ${r.TableEnumOrId || 'Object'}`,
    getOrgLink: (r, host) => `https://${host}/lightning/setup/ObjectManager/${r.TableEnumOrId}/FieldsAndRelationships/home`,
    getRouterLinks: (r, host) => [
      { label: "⚙️ Field Manager", url: `field-manager.html?obj=${r.TableEnumOrId}&field=${r.DeveloperName}__c&host=${host}`, title: "Edit field properties & FLS" }
    ]
  },
  {
    key: "Layout",
    name: "Page Layouts",
    category: "objects",
    tooling: true,
    countQuery: "SELECT count() FROM Layout",
    componentQuery: "SELECT Id, Name, TableEnumOrId, LayoutType, NamespacePrefix, LastModifiedDate FROM Layout ORDER BY TableEnumOrId ASC, Name ASC",
    desc: "Standard and Custom Page Layouts (Layout)",
    getName: r => r.Name,
    getApiName: r => `${r.TableEnumOrId}-${r.Name}`,
    getId: r => r.Id,
    getExtra: r => `On: ${r.TableEnumOrId || 'Object'}`,
    getOrgLink: (r, host) => `https://${host}/lightning/setup/ObjectManager/${r.TableEnumOrId}/PageLayouts/${r.Id}/view`,
    getRouterLinks: (r, host) => [
      { label: "⚙️ Fields", url: `field-manager.html?obj=${r.TableEnumOrId}&host=${host}`, title: "Manage fields of object" }
    ]
  },
  {
    key: "FlexiPage",
    name: "Lightning Pages (FlexiPages)",
    category: "objects",
    tooling: true,
    countQuery: "SELECT count() FROM FlexiPage",
    componentQuery: "SELECT Id, DeveloperName, MasterLabel, Type, Description, NamespacePrefix, LastModifiedDate FROM FlexiPage ORDER BY MasterLabel ASC",
    desc: "Lightning App Builder Pages (Record, App, and Home Pages)",
    getName: r => r.MasterLabel || r.DeveloperName,
    getApiName: r => r.DeveloperName,
    getId: r => r.Id,
    getExtra: r => `${r.Type || 'Page'}${r.Description ? ` — ${r.Description}` : ''}`,
    getOrgLink: (r, host) => `https://${host}/visualEditor/appBuilder.app?pageId=${r.Id}`,
    getRouterLinks: () => []
  },
  {
    key: "RecordType",
    name: "Record Types",
    category: "objects",
    tooling: false,
    countQuery: "SELECT count() FROM RecordType",
    componentQuery: "SELECT Id, Name, DeveloperName, SobjectType, IsActive, Description, NamespacePrefix FROM RecordType ORDER BY SobjectType ASC, Name ASC",
    desc: "Object Record Types and Business Processes",
    getName: r => r.Name,
    getApiName: r => `${r.SobjectType}.${r.DeveloperName || r.Name}`,
    getId: r => r.Id,
    getExtra: r => `On: ${r.SobjectType || 'Object'} • ${r.IsActive ? '🟢 Active' : '⚪ Inactive'}`,
    getOrgLink: (r, host) => `https://${host}/lightning/setup/ObjectManager/${r.SobjectType}/RecordTypes/${r.Id}/view`,
    getRouterLinks: (r, host) => [
      { label: "⚙️ Fields", url: `field-manager.html?obj=${r.SobjectType}&host=${host}`, title: "Manage fields of object" }
    ]
  },
  {
    key: "GlobalValueSet",
    name: "Global Value Sets (Picklists)",
    category: "objects",
    tooling: true,
    countQuery: "SELECT count() FROM GlobalValueSet",
    componentQuery: "SELECT Id, DeveloperName, MasterLabel, Description, NamespacePrefix, LastModifiedDate FROM GlobalValueSet ORDER BY MasterLabel ASC",
    desc: "Shared Global Picklist Value Sets",
    getName: r => r.MasterLabel || r.DeveloperName,
    getApiName: r => r.DeveloperName,
    getId: r => r.Id,
    getExtra: r => "Global Picklist",
    getOrgLink: (r, host) => `https://${host}/lightning/setup/Picklists/page?address=%2F${r.Id}`,
    getRouterLinks: () => []
  },
  {
    key: "ExternalString",
    name: "Custom Labels",
    category: "objects",
    tooling: true,
    countQuery: "SELECT count() FROM ExternalString",
    componentQuery: "SELECT Id, Name, Value, NamespacePrefix, LastModifiedDate FROM ExternalString ORDER BY Name ASC",
    desc: "Multilingual UI text strings (CustomLabel)",
    getName: r => r.Name,
    getApiName: r => r.Name,
    getId: r => r.Id,
    getExtra: r => r.Value ? (r.Value.length > 40 ? r.Value.slice(0, 40) + '...' : r.Value) : "Label",
    getOrgLink: (r, host) => `https://${host}/lightning/setup/ExternalStrings/page?address=%2F${r.Id}`,
    getRouterLinks: () => []
  },
  {
    key: "QuickActionDefinition",
    name: "Quick Actions",
    category: "objects",
    tooling: true,
    countQuery: "SELECT count() FROM QuickActionDefinition",
    componentQuery: "SELECT Id, DeveloperName, MasterLabel, TargetSobjectType, Type, LastModifiedDate FROM QuickActionDefinition ORDER BY DeveloperName ASC",
    desc: "Object-specific and Global Quick Actions",
    getName: r => r.MasterLabel || r.DeveloperName,
    getApiName: r => r.TargetSobjectType ? `${r.TargetSobjectType}.${r.DeveloperName}` : r.DeveloperName,
    getId: r => r.Id,
    getExtra: r => `${r.Type || 'Action'} ${r.TargetSobjectType ? `on ${r.TargetSobjectType}` : ''}`,
    getOrgLink: (r, host) => `https://${host}/lightning/setup/GlobalActions/home`,
    getRouterLinks: () => []
  },

  // --- Category: automation (Automation & Flows) ---
  {
    key: "FlowDefinition",
    name: "Flows & Process Builders",
    category: "automation",
    tooling: true,
    countQuery: "SELECT count() FROM FlowDefinition",
    componentQuery: "SELECT Id, DeveloperName, MasterLabel, ActiveVersionId, LatestVersionId, Description, LastModifiedDate FROM FlowDefinition ORDER BY MasterLabel ASC",
    desc: "Screen Flows, Autolaunched Flows, Subflows & Processes",
    getName: r => r.MasterLabel || r.DeveloperName,
    getApiName: r => r.DeveloperName,
    getId: r => r.Id,
    getExtra: r => r.ActiveVersionId ? "🟢 Active Version" : "⚪ Draft Only",
    getOrgLink: (r, host) => `https://${host}/builder_platform_interaction/flowBuilder.app?flowId=${r.ActiveVersionId || r.LatestVersionId || r.Id}`,
    getRouterLinks: (r, host) => [
      { label: "🌊 Flow Analyzer", url: `flow-analyzer.html?flowId=${r.ActiveVersionId || r.LatestVersionId || r.Id}&host=${host}`, title: "Analyze flow structure, DML & queries" }
    ]
  },
  {
    key: "ValidationRule",
    name: "Field Validation Rules",
    category: "automation",
    tooling: true,
    countQuery: "SELECT count() FROM ValidationRule",
    componentQuery: "SELECT Id, ValidationName, EntityDefinition.DeveloperName, EntityDefinition.QualifiedApiName, Active, Description, ErrorMessage, LastModifiedDate FROM ValidationRule ORDER BY ValidationName ASC",
    desc: "Formula-based business validation logic on SObjects",
    getName: r => r.ValidationName,
    getApiName: r => `${r.EntityDefinition?.QualifiedApiName || r.EntityDefinition?.DeveloperName || 'Object'}.${r.ValidationName}`,
    getId: r => r.Id,
    getExtra: r => `On: ${r.EntityDefinition?.QualifiedApiName || r.EntityDefinition?.DeveloperName || 'Object'} • ${r.Active ? '🟢 Active' : '⚪ Inactive'}`,
    getOrgLink: (r, host) => `https://${host}/lightning/setup/ObjectManager/${r.EntityDefinition?.QualifiedApiName || r.EntityDefinition?.DeveloperName || ''}/ValidationRules/${r.Id}/view`,
    getRouterLinks: (r, host) => [
      { label: "⚙️ Fields", url: `field-manager.html?obj=${r.EntityDefinition?.QualifiedApiName || ''}&host=${host}`, title: "Inspect object fields" }
    ]
  },
  {
    key: "WorkflowRule",
    name: "Workflow Rules",
    category: "automation",
    tooling: true,
    countQuery: "SELECT count() FROM WorkflowRule",
    componentQuery: "SELECT Id, Name, TableEnumOrId, NamespacePrefix, LastModifiedDate FROM WorkflowRule ORDER BY TableEnumOrId ASC, Name ASC",
    desc: "Legacy workflow automation rules (WorkflowRule)",
    getName: r => r.Name,
    getApiName: r => `${r.TableEnumOrId}.${r.Name}`,
    getId: r => r.Id,
    getExtra: r => `On: ${r.TableEnumOrId || 'Object'}`,
    getOrgLink: (r, host) => `https://${host}/lightning/setup/WorkflowRules/page?address=%2F${r.Id}`,
    getRouterLinks: () => []
  },
  {
    key: "WorkflowFieldUpdate",
    name: "Workflow Field Updates",
    category: "automation",
    tooling: true,
    countQuery: "SELECT count() FROM WorkflowFieldUpdate",
    componentQuery: "SELECT Id, Name, SourceTableEnumOrId, LastModifiedDate FROM WorkflowFieldUpdate ORDER BY Name ASC",
    desc: "Automated field update actions used by workflows",
    getName: r => r.Name,
    getApiName: r => `${r.SourceTableEnumOrId}.${r.Name}`,
    getId: r => r.Id,
    getExtra: r => `On: ${r.SourceTableEnumOrId || 'Object'}`,
    getOrgLink: (r, host) => `https://${host}/lightning/setup/WorkflowFieldUpdates/page?address=%2F${r.Id}`,
    getRouterLinks: () => []
  },

  // --- Category: security (Security & Access) ---
  {
    key: "Profile",
    name: "User Profiles",
    category: "security",
    tooling: false,
    countQuery: "SELECT count() FROM Profile",
    componentQuery: "SELECT Id, Name, UserType, Description, CreatedDate, LastModifiedDate FROM Profile ORDER BY Name ASC",
    desc: "Standard and Custom User Security Profiles",
    getName: r => r.Name,
    getApiName: r => r.Name,
    getId: r => r.Id,
    getExtra: r => `Type: ${r.UserType || 'Standard'}`,
    getOrgLink: (r, host) => `https://${host}/lightning/setup/EnhancedProfiles/page?address=%2F${r.Id}`,
    getRouterLinks: (r, host) => [
      { label: "🛡️ Check Access", url: `permission-analyzer.html?type=profile&id=${r.Id}&host=${host}`, title: "Analyze profile permissions & FLS" }
    ]
  },
  {
    key: "PermissionSet",
    name: "Permission Sets",
    category: "security",
    tooling: false,
    countQuery: "SELECT count() FROM PermissionSet WHERE IsOwnedByProfile = false",
    componentQuery: "SELECT Id, Name, Label, IsCustom, HasActivationRequired, Type, Description, LastModifiedDate FROM PermissionSet WHERE IsOwnedByProfile = false ORDER BY Label ASC",
    desc: "Custom and Standard Add-on Permission Sets",
    getName: r => r.Label || r.Name,
    getApiName: r => r.Name,
    getId: r => r.Id,
    getExtra: r => `${r.IsCustom ? 'Custom' : 'Standard'} • ${r.Type || 'Regular'}`,
    getOrgLink: (r, host) => `https://${host}/lightning/setup/PermSets/page?address=%2F${r.Id}`,
    getRouterLinks: (r, host) => [
      { label: "🛡️ Check Access", url: `permission-analyzer.html?type=permset&id=${r.Id}&host=${host}`, title: "Analyze permission set entitlements" }
    ]
  },
  {
    key: "PermissionSetGroup",
    name: "Permission Set Groups",
    category: "security",
    tooling: true,
    countQuery: "SELECT count() FROM PermissionSetGroup",
    componentQuery: "SELECT Id, DeveloperName, MasterLabel, Status, Description, LastModifiedDate FROM PermissionSetGroup ORDER BY MasterLabel ASC",
    desc: "Bundled groups of permission sets",
    getName: r => r.MasterLabel || r.DeveloperName,
    getApiName: r => r.DeveloperName,
    getId: r => r.Id,
    getExtra: r => `Status: ${r.Status || 'Updated'}`,
    getOrgLink: (r, host) => `https://${host}/lightning/setup/PermSetGroups/page?address=%2F${r.Id}`,
    getRouterLinks: (r, host) => [
      { label: "🛡️ Check Access", url: `permission-analyzer.html?type=permsetgroup&id=${r.Id}&host=${host}`, title: "Analyze permission set group" }
    ]
  },
  {
    key: "UserRole",
    name: "User Hierarchy Roles",
    category: "security",
    tooling: false,
    countQuery: "SELECT count() FROM UserRole",
    componentQuery: "SELECT Id, Name, DeveloperName, RollupDescription, ParentRoleId, LastModifiedDate FROM UserRole ORDER BY Name ASC",
    desc: "Record-level sharing role hierarchy (UserRole)",
    getName: r => r.Name,
    getApiName: r => r.DeveloperName || r.Name,
    getId: r => r.Id,
    getExtra: r => r.ParentRoleId ? "Sub-role" : "Top-level Role",
    getOrgLink: (r, host) => `https://${host}/lightning/setup/Roles/home`,
    getRouterLinks: () => []
  },
  {
    key: "CustomPermission",
    name: "Custom Permissions",
    category: "security",
    tooling: false,
    countQuery: "SELECT count() FROM CustomPermission",
    componentQuery: "SELECT Id, DeveloperName, MasterLabel, Description, LastModifiedDate FROM CustomPermission ORDER BY MasterLabel ASC",
    desc: "Custom security permissions for Apex and UI access",
    getName: r => r.MasterLabel || r.DeveloperName,
    getApiName: r => r.DeveloperName,
    getId: r => r.Id,
    getExtra: r => "Custom Permission",
    getOrgLink: (r, host) => `https://${host}/lightning/setup/CustomPermissions/page?address=%2F${r.Id}`,
    getRouterLinks: () => []
  },
  {
    key: "Group",
    name: "Public Groups & Queues",
    category: "security",
    tooling: false,
    countQuery: "SELECT count() FROM Group WHERE Type IN ('Regular', 'Queue')",
    componentQuery: "SELECT Id, Name, DeveloperName, Type, LastModifiedDate FROM Group WHERE Type IN ('Regular', 'Queue') ORDER BY Type ASC, Name ASC",
    desc: "Public Sharing Groups and Assignment Queues",
    getName: r => r.Name,
    getApiName: r => r.DeveloperName || r.Name,
    getId: r => r.Id,
    getExtra: r => r.Type === 'Queue' ? '📬 Queue' : '👥 Public Group',
    getOrgLink: (r, host) => `https://${host}/lightning/setup/PublicGroups/home`,
    getRouterLinks: () => []
  }
];

// In-memory cache for counts & components
const countsCache = new Map();
const componentsCache = new Map();
let activeCategory = "all";
let activeTypeFilter = "";
const expandedRows = new Set();

// Category pill styling helper
function getCategoryPill(category) {
  const map = {
    standard: { label: "Standard", cls: "cat-pill-standard" },
    code: { label: "Code & LWC", cls: "cat-pill-code" },
    objects: { label: "Objects", cls: "cat-pill-objects" },
    automation: { label: "Automation", cls: "cat-pill-automation" },
    security: { label: "Security", cls: "cat-pill-security" }
  };
  const c = map[category] || { label: category, cls: "cat-pill-standard" };
  return `<span class="cat-pill ${c.cls}">${c.label}</span>`;
}

// ─── INITIALIZATION ───────────────────────────────────────────────────
async function init() {
  if (!sfHost) {
    alert("Salesforce host not found. Please open from a Salesforce page or extension popup.");
    return;
  }

  // Pre-render immediately with cached info
  let orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
  updateNavbarOrgBadge(sfHost, orgInfo);

  await sfConn.getSession(sfHost);

  // Re-render with live org session details
  orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
  updateNavbarOrgBadge(sfHost, orgInfo);

  setupEvents();
  renderCatalogTable();
  loadAllCounts();
}

// ─── RENDER MAIN CATALOG TABLE ────────────────────────────────────────
function renderCatalogTable() {
  const tbody = document.getElementById("meta-body");
  if (!tbody) return;

  const filtered = METADATA_CATALOG.filter(item => {
    if (activeCategory !== "all" && item.category !== activeCategory) return false;
    if (activeTypeFilter) {
      const q = activeTypeFilter.toLowerCase();
      const matchName = item.name.toLowerCase().includes(q);
      const matchDesc = item.desc.toLowerCase().includes(q);
      const matchKey = item.key.toLowerCase().includes(q);
      if (!matchName && !matchDesc && !matchKey) return false;
    }
    return true;
  });

  const visibleCountEl = document.getElementById("visible-types-count");
  if (visibleCountEl) visibleCountEl.textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">No metadata types match the filter.</td></tr>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  filtered.forEach(item => {
    const isExpanded = expandedRows.has(item.key);
    const countVal = countsCache.has(item.key) ? countsCache.get(item.key) : "⏳";

    // Parent Type Row
    const tr = document.createElement("tr");
    tr.className = `meta-type-row ${isExpanded ? 'is-expanded' : ''}`;
    tr.setAttribute("data-key", item.key);

    tr.innerHTML = `
      <td>
        <span class="toggle-arrow ${isExpanded ? 'rotated' : ''}" id="arrow-${item.key}">▶</span>
        <strong>${escapeHtml(item.name)}</strong>
        <span style="font-size:11px; color:var(--text-muted); margin-left:6px; font-family:var(--font-mono);">(${escapeHtml(item.key)})</span>
      </td>
      <td>${getCategoryPill(item.category)}</td>
      <td style="text-align: center;">
        <span id="count-badge-${item.key}" style="font-size:12px; font-weight:700; color:var(--primary);">${escapeHtml(countVal)}</span>
      </td>
      <td style="font-size:12px; color:var(--text-muted);">${escapeHtml(item.desc)}</td>
      <td style="text-align: center;">
        <div class="action-links-wrap" style="justify-content: center;">
          <button type="button" class="btn btn-secondary btn-xs btn-toggle-comp" data-key="${item.key}" title="Inspect all components">
            ${isExpanded ? '▲ Hide' : '▼ Components'}
          </button>
        </div>
      </td>
    `;

    fragment.appendChild(tr);

    // Sub-Row for Expanded Components
    if (isExpanded) {
      const subTr = document.createElement("tr");
      subTr.className = "meta-sub-row";
      subTr.id = `subrow-${item.key}`;
      const subTd = document.createElement("td");
      subTd.colSpan = 5;
      subTd.innerHTML = renderSubPanelPlaceholder(item);
      subTr.appendChild(subTd);
      fragment.appendChild(subTr);

      // Async load components if not yet loaded
      setTimeout(() => loadComponentsForType(item), 10);
    }
  });

  tbody.innerHTML = "";
  tbody.appendChild(fragment);

  attachRowClickEvents();
}

// ─── ROW CLICK & TOGGLE HANDLER ───────────────────────────────────────
function attachRowClickEvents() {
  const tbody = document.getElementById("meta-body");
  if (!tbody) return;

  tbody.querySelectorAll(".meta-type-row").forEach(row => {
    row.addEventListener("click", (e) => {
      // Don't toggle if clicking a link or inside an input
      if (e.target.closest("a") || e.target.closest("input")) return;
      const key = row.getAttribute("data-key");
      toggleRow(key);
    });
  });

  tbody.querySelectorAll(".btn-toggle-comp").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.getAttribute("data-key");
      toggleRow(key);
    });
  });
}

function toggleRow(typeKey) {
  if (expandedRows.has(typeKey)) {
    expandedRows.delete(typeKey);
  } else {
    expandedRows.add(typeKey);
  }
  renderCatalogTable();
}

// ─── LOAD COUNTS IN PARALLEL ──────────────────────────────────────────
async function loadAllCounts() {
  const totalEl = document.getElementById("total-components-sum");
  if (totalEl) totalEl.textContent = "Querying org...";

  let totalSum = 0;
  let successCount = 0;

  // Process in chunks of 4 concurrent queries to respect governor limits & responsiveness
  const chunkSize = 4;
  for (let i = 0; i < METADATA_CATALOG.length; i += chunkSize) {
    const chunk = METADATA_CATALOG.slice(i, i + chunkSize);
    await Promise.allSettled(chunk.map(async (item) => {
      try {
        let count = 0;
        if (item.tooling) {
          const res = await sfConn.query(item.countQuery, true, { logErrors: false });
          count = res.totalSize !== undefined ? res.totalSize : (res.records ? res.records.length : 0);
        } else {
          const res = await sfConn.query(item.countQuery, false, { logErrors: false });
          count = res.totalSize !== undefined ? res.totalSize : (res.records ? res.records.length : 0);
        }
        countsCache.set(item.key, count.toLocaleString());
        totalSum += count;
        successCount++;
      } catch (err) {
        // Fallback: try reverse API (REST if Tooling failed or vice versa)
        try {
          const resFallback = await sfConn.query(item.countQuery, !item.tooling, { logErrors: false });
          const count = resFallback.totalSize !== undefined ? resFallback.totalSize : (resFallback.records ? resFallback.records.length : 0);
          countsCache.set(item.key, count.toLocaleString());
          totalSum += count;
          successCount++;
        } catch {
          countsCache.set(item.key, "N/A");
        }
      }

      // Live update badge in DOM if visible
      const badge = document.getElementById(`count-badge-${item.key}`);
      if (badge) {
        badge.textContent = countsCache.get(item.key);
      }
    }));
  }

  if (totalEl) {
    totalEl.textContent = totalSum > 0 ? `${totalSum.toLocaleString()} components` : "Completed";
  }

  // Update tab counts
  updateTabCounts();
}

function updateTabCounts() {
  const cats = ["all", "standard", "code", "objects", "automation", "security"];
  cats.forEach(c => {
    const el = document.getElementById(`tab-count-${c}`);
    if (el) {
      if (c === "all") {
        el.textContent = METADATA_CATALOG.length;
      } else {
        const count = METADATA_CATALOG.filter(m => m.category === c).length;
        el.textContent = count;
      }
    }
  });
}

// ─── SUB-PANEL: COMPONENT EXPLORER ────────────────────────────────────
function renderSubPanelPlaceholder(item) {
  return `
    <div class="sub-panel-box" id="subpanel-${item.key}">
      <div class="sub-ctrl-bar">
        <div class="sub-ctrl-search">
          <strong style="color:var(--primary); font-size:13px;">${escapeHtml(item.name)} Components</strong>
          <span id="sub-status-${item.key}" style="font-size:11px; color:var(--text-muted); margin-left:8px;">Loading components...</span>
        </div>
      </div>
      <div style="text-align:center; padding:25px; color:var(--text-muted);" id="sub-content-${item.key}">
        <span style="font-size:13px;">⏳ Querying ${escapeHtml(item.name)} from Salesforce ${item.tooling ? 'Tooling' : 'REST'} API...</span>
      </div>
    </div>
  `;
}

async function loadComponentsForType(item, forceRefresh = false) {
  const statusEl = document.getElementById(`sub-status-${item.key}`);
  const contentEl = document.getElementById(`sub-content-${item.key}`);
  if (!contentEl) return;

  // Check cache first
  if (!forceRefresh && componentsCache.has(item.key)) {
    renderSubPanelComponents(item, componentsCache.get(item.key));
    return;
  }

  try {
    if (statusEl) statusEl.textContent = "Querying components...";

    // For very large entities (like CustomField with 25k records), query with safe limit or page
    let queryToRun = item.componentQuery;
    let records = [];

    if (item.key === "CustomField") {
      // Limit initial fetch for massive custom field sets to avoid browser memory freeze
      queryToRun = `${item.componentQuery} LIMIT 300`;
    }

    let res = null;
    try {
      res = await sfConn.query(queryToRun, item.tooling, { logErrors: false });
    } catch (e1) {
      // Fallback
      res = await sfConn.query(queryToRun, !item.tooling, { logErrors: false });
    }

    records = res?.records || [];
    componentsCache.set(item.key, {
      allRecords: records,
      displayedRecords: records,
      query: item.componentQuery
    });

    renderSubPanelComponents(item, componentsCache.get(item.key));
  } catch (err) {
    contentEl.innerHTML = `
      <div style="color:#dc2626; padding:15px; text-align:center;">
        <strong>Error loading components:</strong> ${escapeHtml(err.message)}
      </div>
    `;
    if (statusEl) statusEl.textContent = "Failed to load";
  }
}

function renderSubPanelComponents(item, cacheData) {
  const panel = document.getElementById(`subpanel-${item.key}`);
  if (!panel) return;

  const records = cacheData.displayedRecords || [];
  const totalLoaded = cacheData.allRecords?.length || 0;

  panel.innerHTML = `
    <div class="sub-ctrl-bar">
      <div class="sub-ctrl-search">
        <input type="text" id="input-sub-filter-${item.key}" class="input-text" placeholder="Filter ${escapeHtml(item.name)} by name, API name, ID..." style="width: 280px; padding: 4px 8px; font-size: 11px;">
        <span id="sub-status-${item.key}" style="font-size:11px; font-weight:600; color:var(--text-muted);">
          Showing ${records.length} of ${totalLoaded} components
        </span>
      </div>
      <div class="action-links-wrap">
        <button type="button" class="btn btn-secondary btn-xs btn-copy-names" data-key="${item.key}" title="Copy list of component names">📋 Copy Names</button>
        <button type="button" class="btn btn-secondary btn-xs btn-copy-ids" data-key="${item.key}" title="Copy list of component IDs">📋 Copy IDs</button>
        <button type="button" class="btn btn-secondary btn-xs btn-refresh-sub" data-key="${item.key}" title="Refresh components for this metadata type">🔄 Refresh</button>
      </div>
    </div>

    <div style="max-height: 380px; overflow-y: auto; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card);">
      <table class="sub-components-table">
        <thead>
          <tr>
            <th style="width: 250px;">Component Name / Label</th>
            <th style="width: 240px;">API / Developer Name</th>
            <th style="width: 170px;">Salesforce ID</th>
            <th style="width: 180px;">Details & Properties</th>
            <th style="width: 120px;">Last Modified</th>
            <th style="text-align: right; padding-right: 14px;">Actions & Deep Links</th>
          </tr>
        </thead>
        <tbody id="sub-body-${item.key}">
          ${records.length === 0 ? `
            <tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted);">No components found or match filter.</td></tr>
          ` : records.map(r => renderComponentRow(item, r)).join("")}
        </tbody>
      </table>
    </div>
  `;

  // Filter input event
  const filterInput = document.getElementById(`input-sub-filter-${item.key}`);
  if (filterInput) {
    filterInput.addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      const all = cacheData.allRecords || [];
      if (!q) {
        cacheData.displayedRecords = all;
      } else {
        cacheData.displayedRecords = all.filter(r => {
          const name = (item.getName(r) || "").toLowerCase();
          const apiName = (item.getApiName(r) || "").toLowerCase();
          const id = (item.getId(r) || "").toLowerCase();
          const extra = (item.getExtra(r) || "").toLowerCase();
          return name.includes(q) || apiName.includes(q) || id.includes(q) || extra.includes(q);
        });
      }
      const tbody = document.getElementById(`sub-body-${item.key}`);
      const status = document.getElementById(`sub-status-${item.key}`);
      if (tbody) {
        tbody.innerHTML = cacheData.displayedRecords.length === 0 ? `
          <tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted);">No components match "${escapeHtml(q)}".</td></tr>
        ` : cacheData.displayedRecords.map(r => renderComponentRow(item, r)).join("");
      }
      if (status) {
        status.textContent = `Showing ${cacheData.displayedRecords.length} of ${all.length} components`;
      }
      attachCopyEvents();
    });
  }

  // Copy buttons
  panel.querySelector(".btn-copy-names")?.addEventListener("click", () => {
    const list = (cacheData.displayedRecords || []).map(r => item.getApiName(r) || item.getName(r)).join("\n");
    navigator.clipboard.writeText(list).then(() => alert(`Copied ${cacheData.displayedRecords.length} component names to clipboard!`));
  });

  panel.querySelector(".btn-copy-ids")?.addEventListener("click", () => {
    const list = (cacheData.displayedRecords || []).map(r => item.getId(r)).filter(Boolean).join("\n");
    navigator.clipboard.writeText(list).then(() => alert(`Copied IDs to clipboard!`));
  });

  panel.querySelector(".btn-refresh-sub")?.addEventListener("click", () => {
    loadComponentsForType(item, true);
  });

  attachCopyEvents();
}

function renderComponentRow(item, r) {
  const name = item.getName(r) || "—";
  const apiName = item.getApiName(r) || name;
  const id = item.getId(r) || "—";
  const extra = item.getExtra(r) || "";
  const lastMod = formatDate(r.LastModifiedDate || r.CreatedDate);
  const orgLink = item.getOrgLink ? item.getOrgLink(r, sfHost) : null;
  const routerLinks = item.getRouterLinks ? item.getRouterLinks(r, sfHost) : [];

  return `
    <tr>
      <td>
        <strong style="color:var(--text-main); font-size:12px;">${escapeHtml(name)}</strong>
      </td>
      <td>
        <span class="copy-chip copy-val" data-val="${escapeHtml(apiName)}" title="Click to copy API Name">${escapeHtml(apiName)}</span>
      </td>
      <td>
        ${id && id !== "—" ? `<span class="copy-chip copy-val" data-val="${escapeHtml(id)}" title="Click to copy ID">${escapeHtml(id)}</span>` : '<span style="color:var(--text-muted);">—</span>'}
      </td>
      <td>
        <span style="font-size:11px; color:var(--text-muted);">${escapeHtml(extra)}</span>
      </td>
      <td>
        <span style="font-size:11px; color:var(--text-muted);">${escapeHtml(lastMod)}</span>
      </td>
      <td style="text-align: right;">
        <div class="action-links-wrap" style="justify-content: flex-end;">
          ${orgLink ? `
            <a href="${escapeHtml(orgLink)}" target="_blank" rel="noopener" class="org-link-btn" title="Open in Salesforce Org">
              ↗ Open in SF
            </a>
          ` : ''}
          ${routerLinks.map(link => `
            <a href="${escapeHtml(link.url)}" target="_blank" class="router-pill" title="${escapeHtml(link.title || '')}">
              ${escapeHtml(link.label)}
            </a>
          `).join("")}
        </div>
      </td>
    </tr>
  `;
}

// ─── CLICK TO COPY UTILITY ────────────────────────────────────────────
function attachCopyEvents() {
  document.querySelectorAll(".copy-val").forEach(chip => {
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      const val = chip.getAttribute("data-val");
      if (!val) return;
      navigator.clipboard.writeText(val).then(() => {
        const origText = chip.textContent;
        chip.textContent = "Copied!";
        chip.style.borderColor = "#16a34a";
        setTimeout(() => {
          chip.textContent = origText;
          chip.style.borderColor = "";
        }, 1200);
      });
    });
  });
}

// ─── EVENT LISTENERS ──────────────────────────────────────────────────
function setupEvents() {
  // Refresh button
  document.getElementById("btn-refresh")?.addEventListener("click", () => {
    countsCache.clear();
    componentsCache.clear();
    renderCatalogTable();
    loadAllCounts();
  });

  // Global search input
  document.getElementById("meta-filter")?.addEventListener("input", (e) => {
    activeTypeFilter = e.target.value.trim();
    renderCatalogTable();
  });

  // Category filter tabs
  document.querySelectorAll("#meta-cat-tabs .tool-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#meta-cat-tabs .tool-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      activeCategory = tab.getAttribute("data-cat");
      renderCatalogTable();
    });
  });

  // Expand All / Collapse All buttons
  document.getElementById("btn-expand-all")?.addEventListener("click", () => {
    METADATA_CATALOG.forEach(item => expandedRows.add(item.key));
    renderCatalogTable();
  });

  document.getElementById("btn-collapse-all")?.addEventListener("click", () => {
    expandedRows.clear();
    renderCatalogTable();
  });
}

init();
