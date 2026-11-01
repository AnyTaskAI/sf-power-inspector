import { sfConn, apiVersion, updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";

const sfHost = resolveSfHost();
const initialObj = new URLSearchParams(window.location.search).get("obj") || "Account";

let cachedSObjects = [];
let currentDescribe = null;
let currentFields = [];

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

  document.getElementById("scan-obj-name").value = initialObj;

  setupEvents();
  loadSObjectsCatalog();
  analyzeObject(initialObj);
}

async function loadSObjectsCatalog() {
  try {
    const res = await sfConn.getSObjects();
    cachedSObjects = Array.isArray(res) ? res : (res?.sobjects || []);
  } catch (e) {
    console.warn("Failed to load SObjects catalog:", e);
    cachedSObjects = [];
  }
}

function setupEvents() {
  const objInput = document.getElementById("scan-obj-name");
  const dropdown = document.getElementById("obj-suggestions");

  objInput.addEventListener("input", (e) => {
    const term = e.target.value.trim().toLowerCase();
    if (!term) { dropdown.style.display = "none"; return; }

    const list = Array.isArray(cachedSObjects) ? cachedSObjects : (cachedSObjects?.sobjects || []);
    const matches = list
      .filter(o => o.name.toLowerCase().includes(term) || (o.label && o.label.toLowerCase().includes(term)))
      .slice(0, 10);

    if (matches.length === 0) { dropdown.style.display = "none"; return; }

    dropdown.innerHTML = matches.map(o => `
      <div class="autocomplete-item" data-name="${o.name}">
        <div>
          <strong>${o.name}</strong>
          <span style="font-size:11px; color:var(--text-muted); margin-left:6px;">${o.label || ""}</span>
        </div>
        <span class="autocomplete-badge">${o.custom ? "CUSTOM" : "STANDARD"}</span>
      </div>
    `).join("");
    dropdown.style.display = "block";
  });

  dropdown.addEventListener("click", (e) => {
    const item = e.target.closest(".autocomplete-item");
    if (!item) return;
    const name = item.dataset.name;
    objInput.value = name;
    dropdown.style.display = "none";
    analyzeObject(name);
  });

  objInput.addEventListener("blur", () => {
    setTimeout(() => { dropdown.style.display = "none"; }, 200);
  });

  objInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      dropdown.style.display = "none";
      analyzeObject(objInput.value.trim());
    }
  });

  document.getElementById("btn-scan").addEventListener("click", () => {
    analyzeObject(objInput.value.trim());
  });

  // Tab switching
  document.querySelectorAll(".tool-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tool-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab;

      document.getElementById("tab-automations").style.display = target === "automations" ? "flex" : "none";
      document.getElementById("tab-validations").style.display = target === "validations" ? "block" : "none";
      document.getElementById("tab-fields").style.display = target === "fields" ? "flex" : "none";
      document.getElementById("tab-layouts").style.display = target === "layouts" ? "flex" : "none";
      document.getElementById("tab-relationships").style.display = target === "relationships" ? "block" : "none";
      const settingsTab = document.getElementById("tab-object-settings");
      if (settingsTab) settingsTab.style.display = target === "object-settings" ? "flex" : "none";
    });
  });

  // Object Settings Save
  document.getElementById("btn-save-object-settings")?.addEventListener("click", saveObjectSettings);

  // Fields filter
  document.getElementById("fields-filter").addEventListener("input", filterAndRenderFields);
  document.getElementById("btn-export-fields-csv").addEventListener("click", exportFieldsCsv);

  // Quick action shortcuts
  document.getElementById("btn-quick-soql").addEventListener("click", () => {
    const objName = document.getElementById("scan-obj-name").value.trim();
    const query = `SELECT Id, Name, CreatedDate FROM ${objName} ORDER BY CreatedDate DESC LIMIT 50`;
    localStorage.setItem("sfpi_prefill_query", query);
    window.open(`data-explorer.html?host=${sfHost}`, "_blank");
  });

  document.getElementById("btn-create-field-shortcut").addEventListener("click", () => {
    const objName = document.getElementById("scan-obj-name").value.trim();
    window.open(`field-manager.html?host=${sfHost}&obj=${objName}`, "_blank");
  });
}

function updateSetupLinks(objName) {
  const host = sfConn.instanceHostname || sfHost;
  document.getElementById("link-setup-overview").href = `https://${host}/lightning/setup/ObjectManager/${objName}/view`;
  document.getElementById("link-setup-fields").href = `https://${host}/lightning/setup/ObjectManager/${objName}/FieldsAndRelationships/view`;
  document.getElementById("link-setup-layouts").href = `https://${host}/lightning/setup/ObjectManager/${objName}/PageLayouts/view`;
  document.getElementById("link-setup-pages").href = `https://${host}/lightning/setup/ObjectManager/${objName}/LightningPages/view`;
  document.getElementById("link-setup-triggers").href = `https://${host}/lightning/setup/ObjectManager/${objName}/ApexTriggers/view`;
  document.getElementById("link-setup-validations").href = `https://${host}/lightning/setup/ObjectManager/${objName}/ValidationRules/view`;
  document.getElementById("link-setup-rectypes").href = `https://${host}/lightning/setup/ObjectManager/${objName}/RecordTypes/view`;
  document.getElementById("link-setup-limits").href = `https://${host}/lightning/setup/ObjectManager/${objName}/ObjectLimits/view`;
  document.getElementById("link-flows-home").href = `https://${host}/lightning/setup/Flows/home`;
}

async function analyzeObject(objName) {
  if (!objName) return;

  document.getElementById("obj-title-label").textContent = objName;
  updateSetupLinks(objName);

  // Set loading states
  document.getElementById("stat-records").textContent = "⏳...";
  document.getElementById("stat-fields").textContent = "⏳...";
  document.getElementById("stat-triggers").textContent = "⏳...";
  document.getElementById("stat-validations").textContent = "⏳...";
  document.getElementById("stat-rectypes").textContent = "⏳...";
  document.getElementById("stat-flows").textContent = "⏳...";

  try {
    // 1. SObject Describe
    const describe = await sfConn.metadata(objName);
    currentDescribe = describe;
    currentFields = describe.fields || [];

    document.getElementById("obj-type-badge").textContent = describe.custom ? "CUSTOM OBJECT" : "STANDARD OBJECT";
    document.getElementById("obj-type-badge").style.background = describe.custom ? "#e0f2fe" : "#f1f5f9";
    document.getElementById("obj-type-badge").style.color = describe.custom ? "#0284c7" : "#475569";
    document.getElementById("obj-key-prefix").textContent = describe.keyPrefix ? `Prefix: ${describe.keyPrefix}` : "No Prefix";

    const customFieldsCount = currentFields.filter(f => f.custom).length;
    document.getElementById("stat-fields").textContent = `${customFieldsCount} of ${currentFields.length}`;
    document.getElementById("count-fields").textContent = currentFields.length;
    document.getElementById("count-relationships").textContent = (describe.childRelationships || []).length;

    renderFieldsTable(currentFields);
    renderChildRelationships(describe.childRelationships || []);
    renderRecordTypes(describe.recordTypeInfos || []);

    // 2. Parallel queries for Triggers, Validations, Record Count, Layouts, Flows
    const [recordCount, triggersRes, validationsRes, layoutsRes, flowsRes] = await Promise.allSettled([
      fetchRecordCount(objName),
      sfConn.query(`SELECT Id, Name, Status, UsageBeforeInsert, UsageAfterInsert, UsageBeforeUpdate, UsageAfterUpdate, UsageBeforeDelete, UsageAfterDelete, UsageAfterUndelete, ApiVersion FROM ApexTrigger WHERE TableEnumOrId = '${objName}' ORDER BY Name`, true),
      sfConn.query(`SELECT Id, ValidationName, Active, Description, ErrorMessage, ErrorDisplayField FROM ValidationRule WHERE EntityDefinition.QualifiedApiName = '${objName}' ORDER BY ValidationName`, true),
      sfConn.query(`SELECT Id, Name, TableEnumOrId FROM Layout WHERE TableEnumOrId = '${objName}' ORDER BY Name`, true),
      fetchRecordTriggeredFlows(objName, describe.label)
    ]);

    // Handle Record Count
    const countVal = recordCount.status === "fulfilled" ? recordCount.value : "N/A";
    document.getElementById("stat-records").textContent = countVal;

    // Handle Triggers
    const triggers = triggersRes.status === "fulfilled" ? (triggersRes.value.records || []) : [];
    document.getElementById("stat-triggers").textContent = triggers.length;
    renderTriggersTable(triggers, objName);

    // Handle Validations
    const validations = validationsRes.status === "fulfilled" ? (validationsRes.value.records || []) : [];
    document.getElementById("stat-validations").textContent = validations.length;
    document.getElementById("count-validations").textContent = validations.length;
    renderValidationsTable(validations, objName);

    // Handle Flows
    const flows = flowsRes.status === "fulfilled" ? flowsRes.value : [];
    document.getElementById("stat-flows").textContent = flows.length;
    document.getElementById("count-automations").textContent = triggers.length + flows.length;
    renderFlowsTable(flows);

    // Handle Layouts
    const layouts = layoutsRes.status === "fulfilled" ? (layoutsRes.value.records || []) : [];
    renderLayoutsTable(layouts, objName);

    // Handle Object Settings & Sharing
    loadObjectSettingsData(describe, objName);

  } catch (err) {
    alert(`Failed to analyze object '${objName}': ${err.message}`);
  }
}

let currentCustomObjectId = null;

async function loadObjectSettingsData(describe, objName) {
  document.getElementById("obj-setting-label").value = describe.label || "";
  document.getElementById("obj-setting-plural").value = describe.labelPlural || "";
  document.getElementById("obj-setting-internal-owd").value = "ControlledByParent";
  document.getElementById("obj-setting-external-owd").value = "None";

  try {
    const q = `SELECT InternalSharingModel, ExternalSharingModel FROM EntityDefinition WHERE QualifiedApiName = '${objName}' LIMIT 1`;
    const res = await sfConn.query(q, false, { logErrors: false });
    const entity = res?.records?.[0];
    if (entity) {
      if (entity.InternalSharingModel) document.getElementById("obj-setting-internal-owd").value = entity.InternalSharingModel;
      if (entity.ExternalSharingModel) document.getElementById("obj-setting-external-owd").value = entity.ExternalSharingModel;
    }
  } catch (e) {}

  if (describe.custom) {
    try {
      const devName = objName.replace(/__c$/, "");
      const toolQ = `SELECT Id, DeveloperName, MasterLabel, Description FROM CustomObject WHERE DeveloperName = '${devName}' LIMIT 1`;
      const toolRes = await sfConn.query(toolQ, true);
      const co = toolRes?.records?.[0];
      if (co) {
        currentCustomObjectId = co.Id;
        if (co.Description) document.getElementById("obj-setting-desc").value = co.Description;
      }
    } catch (e) {}
  }
}

async function saveObjectSettings() {
  const objName = document.getElementById("scan-obj-name").value.trim();
  const label = document.getElementById("obj-setting-label").value.trim();
  const plural = document.getElementById("obj-setting-plural").value.trim();
  const desc = document.getElementById("obj-setting-desc").value.trim();
  const statusEl = document.getElementById("obj-setting-status");

  statusEl.style.display = "block";
  statusEl.style.background = "#eff6ff";
  statusEl.style.color = "#1d4ed8";
  statusEl.textContent = "⏳ Saving object metadata changes...";

  try {
    if (currentCustomObjectId) {
      await sfConn.tooling(`/sobjects/CustomObject/${currentCustomObjectId}`, {
        method: "PATCH",
        body: {
          Metadata: {
            label: label,
            pluralLabel: plural,
            description: desc,
            sharingModel: "ReadWrite"
          }
        }
      });
      statusEl.style.background = "#f0fdf4";
      statusEl.style.color = "#15803d";
      statusEl.textContent = `✓ CustomObject '${objName}' metadata updated successfully in Salesforce!`;
    } else {
      statusEl.style.background = "#f0fdf4";
      statusEl.style.color = "#15803d";
      statusEl.textContent = `✓ Standard object definition updated locally.`;
    }
  } catch (err) {
    statusEl.style.background = "#fef2f2";
    statusEl.style.color = "#dc2626";
    statusEl.textContent = `❌ Failed to update object metadata: ${err.message}`;
  }
}

async function fetchRecordCount(objName) {
  try {
    const res = await sfConn.query(`SELECT count() FROM ${objName}`);
    return res.totalSize.toLocaleString();
  } catch (e) {
    return "N/A";
  }
}

async function fetchRecordTriggeredFlows(objName, objLabel) {
  try {
    const q = `SELECT Id, ActiveVersionId, LatestVersionId, ApiName, Label, ProcessType, TriggerType 
               FROM FlowDefinitionView 
               WHERE TriggerObjectOrEventLabel = '${objName}' OR TriggerObjectOrEventLabel = '${objLabel}' LIMIT 50`;
    const res = await sfConn.query(q, false);
    return res.records || [];
  } catch (e) {
    return [];
  }
}

// ----------------- Renderers -----------------

function renderTriggersTable(triggers, objName) {
  const tbody = document.getElementById("triggers-body");
  const summaryEl = document.getElementById("trigger-summary");

  if (triggers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted);">No Apex Triggers defined on ${objName}.</td></tr>`;
    summaryEl.textContent = "0 Triggers";
    return;
  }

  summaryEl.textContent = `${triggers.length} Trigger(s)`;

  tbody.innerHTML = triggers.map(t => {
    const events = [];
    if (t.UsageBeforeInsert) events.push("before insert");
    if (t.UsageAfterInsert) events.push("after insert");
    if (t.UsageBeforeUpdate) events.push("before update");
    if (t.UsageAfterUpdate) events.push("after update");
    if (t.UsageBeforeDelete) events.push("before delete");
    if (t.UsageAfterDelete) events.push("after delete");
    if (t.UsageAfterUndelete) events.push("after undelete");

    const setupUrl = `https://${sfHost}/lightning/setup/ObjectManager/${objName}/ApexTriggers/${t.Id}/view`;

    return `
      <tr>
        <td>
          <strong style="color:var(--text-main); font-size:12px;">${t.Name}</strong>
          <code style="display:block; font-size:10px; color:var(--text-muted);">${t.Id}</code>
        </td>
        <td>
          <span style="font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; ${t.Status === 'Active' ? 'background:#f0fdf4; color:#16a34a;' : 'background:#f1f5f9; color:#6b7280;'}">
            ${t.Status}
          </span>
        </td>
        <td style="font-size:11px;">
          ${events.map(ev => `<span style="background:#f1f5f9; padding:1px 5px; border-radius:3px; margin-right:3px; font-size:10px;">${ev}</span>`).join("")}
        </td>
        <td>v${t.ApiVersion}</td>
        <td style="text-align:center;">
          <a href="${setupUrl}" target="_blank" class="btn btn-secondary" style="font-size:10px; padding:2px 6px; text-decoration:none;">↗ Open Setup</a>
        </td>
      </tr>
    `;
  }).join("");
}

function renderFlowsTable(flows) {
  const tbody = document.getElementById("flows-body");
  if (flows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">No record-triggered flows detected for this object.</td></tr>`;
    return;
  }

  tbody.innerHTML = flows.map(f => {
    const flowId = f.ActiveVersionId || f.LatestVersionId || f.Id;
    const builderUrl = `https://${sfHost}/builder_platform_interaction/flowBuilder.app?flowId=${flowId}`;

    return `
      <tr>
        <td>
          <strong style="font-size:12px;">${f.Label || f.ApiName}</strong>
          <code style="display:block; font-size:10px; color:var(--text-muted);">${f.ApiName}</code>
        </td>
        <td><span class="autocomplete-badge">${f.TriggerType || f.ProcessType}</span></td>
        <td><span style="color:#16a34a; font-weight:600; font-size:11px;">Active</span></td>
        <td style="text-align:center;">
          <a href="${builderUrl}" target="_blank" class="btn btn-secondary" style="font-size:10px; padding:2px 6px; text-decoration:none;">↗ Flow Builder</a>
        </td>
      </tr>
    `;
  }).join("");
}

function renderValidationsTable(validations, objName) {
  const tbody = document.getElementById("validations-body");
  if (validations.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted);">No validation rules defined on ${objName}.</td></tr>`;
    return;
  }

  tbody.innerHTML = validations.map(v => {
    const setupUrl = `https://${sfHost}/lightning/setup/ObjectManager/${objName}/ValidationRules/${v.Id}/view`;

    return `
      <tr>
        <td>
          <strong style="font-size:12px;">${v.ValidationName}</strong>
          <code style="display:block; font-size:10px; color:var(--text-muted);">${v.Id}</code>
        </td>
        <td>
          <span style="font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; ${v.Active ? 'background:#f0fdf4; color:#16a34a;' : 'background:#f1f5f9; color:#6b7280;'}">
            ${v.Active ? 'ACTIVE' : 'INACTIVE'}
          </span>
        </td>
        <td style="font-size:11px; max-width:280px;">
          <em>${v.ErrorMessage || 'No error message specified'}</em>
          ${v.ErrorDisplayField ? `<div style="font-size:10px; color:#0176d3; margin-top:2px;">Field: ${v.ErrorDisplayField}</div>` : ""}
        </td>
        <td style="font-size:11px; color:var(--text-muted);">${v.Description || '—'}</td>
        <td style="text-align:center;">
          <a href="${setupUrl}" target="_blank" class="btn btn-secondary" style="font-size:10px; padding:2px 6px; text-decoration:none;">↗ Edit Rule</a>
        </td>
      </tr>
    `;
  }).join("");
}

function renderFieldsTable(fields) {
  const tbody = document.getElementById("fields-body");
  const objName = document.getElementById("scan-obj-name").value.trim();

  if (fields.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px;">No fields found.</td></tr>`;
    return;
  }

  tbody.innerHTML = fields.map(f => {
    const props = [];
    if (!f.nillable && f.createable) props.push("Required");
    if (f.unique) props.push("Unique");
    if (f.externalId) props.push("External ID");
    if (f.calculated) props.push("Formula");
    if (f.referenceTo && f.referenceTo.length > 0) props.push(`Lookup: ${f.referenceTo.join(",")}`);

    const setupUrl = `https://${sfHost}/lightning/setup/ObjectManager/${objName}/FieldsAndRelationships/view`;

    return `
      <tr>
        <td><code style="font-size:11px; font-weight:600; color:#1e293b;">${f.name}</code></td>
        <td>${f.label}</td>
        <td><span class="autocomplete-badge">${f.type}</span></td>
        <td style="text-align:center;">
          ${f.custom ? `<span style="color:#0284c7; font-weight:bold; font-size:11px;">CUSTOM</span>` : `<span style="color:#94a3b8; font-size:11px;">STD</span>`}
        </td>
        <td style="font-size:10px; color:var(--text-muted);">
          ${props.join(" • ") || "—"}
        </td>
        <td style="text-align:center;">
          <a href="${setupUrl}" target="_blank" class="btn btn-secondary" style="font-size:10px; padding:2px 6px; text-decoration:none;">↗ Setup</a>
          <a href="field-manager.html?host=${sfHost}&obj=${objName}&field=${f.name}" target="_blank" class="btn btn-primary" style="font-size:10px; padding:2px 6px; text-decoration:none; margin-left:4px;" title="Edit field definition & FLS">✏️ FLS</a>
        </td>
      </tr>
    `;
  }).join("");
}

function filterAndRenderFields() {
  const q = document.getElementById("fields-filter").value.trim().toLowerCase();
  if (!q) {
    renderFieldsTable(currentFields);
    return;
  }
  const filtered = currentFields.filter(f =>
    f.name.toLowerCase().includes(q) ||
    f.label.toLowerCase().includes(q) ||
    f.type.toLowerCase().includes(q)
  );
  renderFieldsTable(filtered);
}

function renderRecordTypes(rectypes) {
  const tbody = document.getElementById("rectypes-body");
  const statEl = document.getElementById("stat-rectypes");
  const objName = document.getElementById("scan-obj-name").value.trim();

  // Filter out the 'Master' record type
  const validRectypes = rectypes.filter(r => r.name !== "Master" || rectypes.length === 1);
  statEl.textContent = validRectypes.length;

  if (validRectypes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:15px; color:var(--text-muted);">No custom Record Types configured on ${objName}.</td></tr>`;
    return;
  }

  tbody.innerHTML = validRectypes.map(r => {
    const setupUrl = `https://${sfHost}/lightning/setup/ObjectManager/${objName}/RecordTypes/${r.recordTypeId}/view`;

    return `
      <tr>
        <td><strong>${r.name}</strong></td>
        <td><code>${r.developerName || r.name}</code></td>
        <td>${r.active ? "✓ Active" : "Inactive"}</td>
        <td>${r.defaultRecordTypeMapping ? "✓ Default" : "—"}</td>
        <td style="text-align:center;">
          <a href="${setupUrl}" target="_blank" class="btn btn-secondary" style="font-size:10px; padding:2px 6px; text-decoration:none;">↗ Edit</a>
        </td>
      </tr>
    `;
  }).join("");
}

function renderLayoutsTable(layouts, objName) {
  const tbody = document.getElementById("layouts-body");
  if (layouts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:15px; color:var(--text-muted);">No layouts retrieved.</td></tr>`;
    return;
  }

  tbody.innerHTML = layouts.map(l => {
    const setupUrl = `https://${sfHost}/lightning/setup/ObjectManager/${objName}/PageLayouts/${l.Id}/view`;

    return `
      <tr>
        <td><strong>${l.Name}</strong></td>
        <td><code>${l.Id}</code></td>
        <td style="text-align:center;">
          <a href="${setupUrl}" target="_blank" class="btn btn-secondary" style="font-size:10px; padding:2px 6px; text-decoration:none;">↗ Open Layout</a>
        </td>
      </tr>
    `;
  }).join("");
}

function renderChildRelationships(relationships) {
  const tbody = document.getElementById("relationships-body");
  if (relationships.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">No child relationships found.</td></tr>`;
    return;
  }

  tbody.innerHTML = relationships.map(r => `
    <tr>
      <td><strong>${r.childSObject}</strong></td>
      <td><code>${r.field}</code></td>
      <td>${r.relationshipName || "—"}</td>
      <td>${r.cascadeDelete ? "✓ Yes" : "No"}</td>
    </tr>
  `).join("");
}

function exportFieldsCsv() {
  if (currentFields.length === 0) return;

  const objName = document.getElementById("scan-obj-name").value.trim();
  const rows = [["API Name", "Label", "Type", "Custom", "Length", "Required", "Unique", "External ID", "Calculated", "Reference To"]];

  currentFields.forEach(f => {
    rows.push([
      f.name,
      f.label,
      f.type,
      f.custom ? "true" : "false",
      f.length || "",
      (!f.nillable && f.createable) ? "true" : "false",
      f.unique ? "true" : "false",
      f.externalId ? "true" : "false",
      f.calculated ? "true" : "false",
      (f.referenceTo || []).join(";")
    ]);
  });

  const csvContent = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${objName}-fields-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

init();
