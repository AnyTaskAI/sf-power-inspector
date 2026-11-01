import { sfConn, apiVersion, updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";

const params = new URLSearchParams(window.location.search);
let sfHost = resolveSfHost();
let recordId = params.get("id");
let targetSObject = params.get("sobject") || params.get("obj");

// Auto-heal: If recordId was passed as an SObject name (e.g. ?id=Account or not 15/18 chars)
if (recordId && recordId.length !== 15 && recordId.length !== 18) {
  targetSObject = recordId;
  recordId = null;
}

let sobjectName = targetSObject || null;
let fieldDescribes = [];
let recordData = {};
let modifiedFields = {};
let allSObjects = [];
let isEditMode = false;
let displayedRecordFieldCount = 50;

// Universal helper to identify whether a field can be edited via REST PATCH
function isFieldEditable(f) {
  if (!f) return false;
  // 1. Record ID is immutable
  if (f.name === "Id") return false;
  // 2. Formula fields are computed by Salesforce engine
  if (f.calculated) return false;
  // 3. Auto-numbers are system assigned
  if (f.autoNumber) return false;
  // 4. System timestamps, audit stamps, and read-only flags
  const systemAuditFields = [
    "CreatedDate", "CreatedById", "LastModifiedDate", "LastModifiedById",
    "SystemModstamp", "IsDeleted", "LastViewedDate", "LastReferencedDate", "LastActivityDate"
  ];
  if (systemAuditFields.includes(f.name)) return false;
  return true;
}

async function init() {
  if (!sfHost) {
    sfHost = resolveSfHost();
  }
  if (!sfHost) {
    const keys = Object.keys(localStorage).filter(k => k.includes("_orgInfo") || k.includes("_access_token"));
    if (keys.length > 0) {
      sfHost = keys[0].replace("_orgInfo", "").replace("_access_token", "");
    }
  }

  if (!sfHost) {
    document.getElementById("fields-body").innerHTML = `
      <tr><td colspan="6" style="text-align:center; padding:30px; color:#dc2626;">
        <strong>Salesforce host not connected.</strong><br>Please open the extension from an active Salesforce browser tab first.
      </td></tr>
    `;
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
  await loadSObjectsDropdown();
  loadRecentlyViewed();

  if (recordId) {
    document.getElementById("input-record-id").value = recordId;
    await loadRecord(recordId);
  } else if (targetSObject) {
    await inspectSObjectOrRecentRecord(targetSObject);
  }
}

async function inspectSObjectOrRecentRecord(objName) {
  if (!objName) return;
  objName = objName.trim();
  sobjectName = objName;

  const select = document.getElementById("select-sobject");
  if (select) select.value = objName;

  const tbody = document.getElementById("fields-body");
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px;">Finding records and resolving ${escapeHtml(objName)}...</td></tr>`;

  try {
    // 1. Attempt to find the most recently modified record of this SObject
    let foundId = null;
    try {
      const qRes = await sfConn.query(`SELECT Id FROM ${objName} ORDER BY LastModifiedDate DESC LIMIT 1`);
      if (qRes.records && qRes.records.length > 0) {
        foundId = qRes.records[0].Id;
      }
    } catch (e1) {
      try {
        // Fallback without ORDER BY (for objects like Custom Metadata or special entities without LastModifiedDate)
        const qResFallback = await sfConn.query(`SELECT Id FROM ${objName} LIMIT 1`);
        if (qResFallback.records && qResFallback.records.length > 0) {
          foundId = qResFallback.records[0].Id;
        }
      } catch (e2) {}
    }

    if (foundId) {
      document.getElementById("input-record-id").value = foundId;
      await loadRecord(foundId);
    } else {
      // If object has 0 records, immediately load its full schema view!
      await loadObjectSchemaOnly(objName);
    }
  } catch (err) {
    await loadObjectSchemaOnly(objName);
  }
}

async function loadSObjectsDropdown() {
  try {
    const res = await sfConn.getSObjects();
    allSObjects = res.sobjects || [];
    const select = document.getElementById("select-sobject");
    allSObjects.sort((a, b) => a.label.localeCompare(b.label));
    allSObjects.forEach(obj => {
      const opt = document.createElement("option");
      opt.value = obj.name;
      opt.textContent = `${obj.label} (${obj.name})`;
      select.appendChild(opt);
    });

    if (targetSObject || sobjectName) {
      select.value = targetSObject || sobjectName;
    }
  } catch (e) {
    console.warn("Could not load SObjects:", e);
  }
}

async function loadRecentlyViewed() {
  try {
    const q = `SELECT Id, Name, Type FROM RecentlyViewed WHERE Type != null ORDER BY LastReferencedDate DESC LIMIT 25`;
    const res = await sfConn.query(q);
    const select = document.getElementById("select-recent-records");
    (res.records || []).forEach(r => {
      if (r.Id) {
        const opt = document.createElement("option");
        opt.value = r.Id;
        opt.textContent = `${r.Type}: ${r.Name || r.Id}`;
        select.appendChild(opt);
      }
    });
  } catch (e) {
    console.warn("Could not load RecentlyViewed:", e);
  }
}

async function loadRecord(id) {
  id = (id || "").trim();
  if (!id) {
    const selObj = document.getElementById("select-sobject")?.value;
    if (selObj) {
      await inspectSObjectOrRecentRecord(selObj);
      return;
    }
    alert("Please enter a 15 or 18-character Salesforce Record ID or select an SObject to inspect.");
    return;
  }

  // If user entered an SObject name (e.g. "Account") instead of an ID
  if (id.length !== 15 && id.length !== 18) {
    await inspectSObjectOrRecentRecord(id);
    return;
  }

  recordId = id;
  modifiedFields = {};
  isEditMode = false;
  displayedRecordFieldCount = 50;

  const toggleBtn = document.getElementById("btn-toggle-edit-mode");
  if (toggleBtn) {
    toggleBtn.textContent = "✏️ Edit Mode";
    toggleBtn.classList.remove("btn-primary");
    toggleBtn.classList.add("btn-secondary");
    toggleBtn.style.display = "inline-flex";
  }

  updateSaveButtonState();
  document.getElementById("lbl-record-id").textContent = recordId;
  document.getElementById("btn-open-sf").style.display = "inline-flex";
  document.getElementById("btn-delete-record").style.display = "inline-flex";

  const tbody = document.getElementById("fields-body");
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px;">Resolving record and loading metadata...</td></tr>`;

  try {
    // 1. Resolve SObject from 3-char prefix
    const prefix = recordId.substring(0, 3);
    const match = allSObjects.find(s => s.keyPrefix === prefix);
    if (match) {
      sobjectName = match.name;
    } else {
      const toolingRes = await sfConn.query(`SELECT QualifiedApiName FROM EntityDefinition WHERE KeyPrefix = '${prefix}' LIMIT 1`, true);
      sobjectName = toolingRes.records[0]?.QualifiedApiName || "Record";
    }

    document.getElementById("lbl-object-name").textContent = sobjectName;
    document.getElementById("record-meta").textContent = `${sobjectName} (${recordId})`;

    // 2. Describe SObject & uncover hidden custom fields via Tooling API
    const describe = await sfConn.metadata(sobjectName);
    let fields = describe.fields || [];

    try {
      const q = `SELECT QualifiedApiName, Label, DataType, Length, Precision, Scale, IsCalculated, IsNillable, DeveloperName FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = '${sobjectName}' LIMIT 2000`;
      const toolRes = await sfConn.query(q, true);
      const toolFields = toolRes?.records || [];
      const fMap = new Map();
      fields.forEach(f => fMap.set(f.name.toLowerCase(), f));
      toolFields.forEach(tf => {
        const qName = tf.QualifiedApiName || "";
        const key = qName.toLowerCase();
        // Only uncover real custom fields ending with __c that were hidden from profile describe
        if (!qName.endsWith("__c")) return;
        if (!fMap.has(key)) {
          const newF = {
            name: qName,
            label: tf.Label || qName,
            type: (tf.DataType || "string").toLowerCase(),
            length: tf.Length || null,
            precision: tf.Precision || null,
            scale: tf.Scale || null,
            calculated: tf.IsCalculated === true,
            nillable: tf.IsNillable !== false,
            custom: true,
            _uncoveredViaTooling: true
          };
          fMap.set(key, newF);
          fields.push(newF);
        }
      });
    } catch (eTool) {
      console.warn("Tooling fields note:", eTool);
    }
    fieldDescribes = fields;

    // 3. Fetch record data using direct SObject retrieve endpoint (proven official pattern)
    // This avoids SOQL length limits and virtual field errors like CompareName
    let res = null;
    try {
      res = await sfConn.rest(`/services/data/v${apiVersion}/sobjects/${sobjectName}/${recordId}`);
    } catch (eRetrieve) {
      // Fallback to SOQL only using safe describe fields (filter out non-queryable virtual particles like CompareName, CompareSite)
      const NON_QUERYABLE = new Set(["comparename", "comparesite"]);
      const safeFields = describe.fields.filter(f => 
        !["address", "location", "base64"].includes(f.type) && 
        !NON_QUERYABLE.has(f.name.toLowerCase()) &&
        !f.extraTypeInfo?.includes("plaintextarea")
      ).map(f => f.name);
      const query = `SELECT ${safeFields.join(", ")} FROM ${sobjectName} WHERE Id = '${recordId}'`;
      const qRes = await sfConn.rest(`/services/data/v${apiVersion}/query/?q=${encodeURIComponent(query)}`, { logErrors: false });
      res = qRes.records?.[0] || {};
    }
    recordData = res || {};

    renderFields();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:#dc2626; text-align:center; padding:20px;"><strong>Error loading record:</strong> ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function loadObjectSchemaOnly(objName) {
  if (!objName) return;
  sobjectName = objName;
  recordId = null;
  recordData = {};
  modifiedFields = {};
  isEditMode = false;
  displayedRecordFieldCount = 50;

  document.getElementById("lbl-record-id").textContent = "Schema View (No Record)";
  document.getElementById("lbl-object-name").textContent = sobjectName;
  document.getElementById("record-meta").textContent = `${sobjectName} (Schema)`;

  const toggleBtn = document.getElementById("btn-toggle-edit-mode");
  if (toggleBtn) toggleBtn.style.display = "none";
  document.getElementById("btn-open-sf").style.display = "none";
  document.getElementById("btn-delete-record").style.display = "none";
  updateSaveButtonState();

  const tbody = document.getElementById("fields-body");
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px;">Fetching metadata for ${sobjectName}...</td></tr>`;

  try {
    const describe = await sfConn.metadata(sobjectName);
    let fields = describe.fields || [];

    try {
      const q = `SELECT QualifiedApiName, Label, DataType, Length, Precision, Scale, IsCalculated, IsNillable, DeveloperName FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = '${sobjectName}' LIMIT 2000`;
      const toolRes = await sfConn.query(q, true);
      const toolFields = toolRes?.records || [];
      const fMap = new Map();
      fields.forEach(f => fMap.set(f.name.toLowerCase(), f));
      toolFields.forEach(tf => {
        const qName = tf.QualifiedApiName || "";
        const key = qName.toLowerCase();
        // Only uncover real custom fields ending with __c that were hidden from profile describe
        if (!qName.endsWith("__c")) return;
        if (!fMap.has(key)) {
          const newF = {
            name: qName,
            label: tf.Label || qName,
            type: (tf.DataType || "string").toLowerCase(),
            length: tf.Length || null,
            precision: tf.Precision || null,
            scale: tf.Scale || null,
            calculated: tf.IsCalculated === true,
            nillable: tf.IsNillable !== false,
            custom: true,
            _uncoveredViaTooling: true
          };
          fMap.set(key, newF);
          fields.push(newF);
        }
      });
    } catch (eTool) {
      console.warn("Tooling fields note:", eTool);
    }
    fieldDescribes = fields;
    renderFields(true);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:#dc2626; text-align:center; padding:20px;">Failed to describe ${sobjectName}: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function getFilteredRecordFields(schemaOnly) {
  const filterText = document.getElementById("field-filter").value.toLowerCase();
  const hideEmpty = document.getElementById("chk-populated-only").checked;

  return fieldDescribes.filter(f => {
    const val = recordData[f.name];
    const isPopulated = val !== null && val !== undefined && val !== "";
    if (!schemaOnly && hideEmpty && !isPopulated) return false;

    return f.name.toLowerCase().includes(filterText) ||
           (f.label || "").toLowerCase().includes(filterText) ||
           (f.type || "").toLowerCase().includes(filterText);
  });
}

function renderFields(schemaOnly = false, append = false) {
  const tbody = document.getElementById("fields-body");
  const activeHost = sfHost || resolveSfHost() || sfConn.instanceHostname || "";
  const filtered = getFilteredRecordFields(schemaOnly);

  document.getElementById("lbl-field-count").textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px;">No matching fields found.</td></tr>`;
    return;
  }

  const startIdx = append ? tbody.children.length : 0;
  const batch = filtered.slice(startIdx, displayedRecordFieldCount);

  if (batch.length === 0 && append) return;

  const rows = [];

  for (const f of batch) {
    const val = recordData[f.name];
    const isUpdateable = isFieldEditable(f) && !schemaOnly;
    const editableClass = isUpdateable ? "editable-cell" : "";
    const isCustom = f.custom || f.name.endsWith("__c");

    let displayVal = schemaOnly ? `<span style="color:#6b7280; font-style:italic;">Schema Only</span>` : val;
    if (!schemaOnly && typeof val === "object" && val !== null) displayVal = JSON.stringify(val);
    if (!schemaOnly && (displayVal === null || displayVal === undefined)) {
      displayVal = `<span style="color:#9ca3af; font-style:italic;">null</span>`;
    }

    // Check if field was modified in this session
    const curModVal = modifiedFields[f.name];
    const isModified = curModVal !== undefined;

    if (!schemaOnly && isEditMode && isUpdateable) {
      const activeVal = isModified ? curModVal : val;
      const modClass = isModified ? "is-modified" : "";

      if (f.type === "boolean") {
        const bVal = activeVal === true || activeVal === "true";
        displayVal = `
          <select class="inline-edit-input ${modClass}" data-field="${f.name}">
            <option value="true" ${bVal ? 'selected' : ''}>true</option>
            <option value="false" ${!bVal ? 'selected' : ''}>false</option>
          </select>
        `;
      } else if (f.type === "picklist" && Array.isArray(f.picklistValues) && f.picklistValues.length > 0) {
        let opts = `<option value="">-- None / Set Null --</option>`;
        f.picklistValues.forEach(pv => {
          if (pv.active !== false) {
            const isSel = String(pv.value) === String(activeVal);
            opts += `<option value="${escapeHtml(pv.value)}" ${isSel ? 'selected' : ''}>${escapeHtml(pv.label)}${pv.value !== pv.label ? ` (${escapeHtml(pv.value)})` : ''}</option>`;
          }
        });
        displayVal = `<select class="inline-edit-input ${modClass}" data-field="${f.name}">${opts}</select>`;
      } else if (["integer", "double", "currency", "percent"].includes(f.type)) {
        displayVal = `<input type="number" step="any" class="inline-edit-input ${modClass}" data-field="${f.name}" value="${activeVal !== null && activeVal !== undefined ? escapeHtml(String(activeVal)) : ''}" placeholder="null">`;
      } else if (f.type === "date") {
        displayVal = `<input type="date" class="inline-edit-input ${modClass}" data-field="${f.name}" value="${activeVal || ''}">`;
      } else {
        displayVal = `<input type="text" class="inline-edit-input ${modClass}" data-field="${f.name}" value="${activeVal !== null && activeVal !== undefined ? escapeHtml(String(activeVal)) : ''}" placeholder="Enter text or null...">`;
      }
    } else if (!schemaOnly && isModified) {
      const modStr = curModVal === null ? '<span style="color:#9ca3af; font-style:italic;">null</span>' : escapeHtml(String(curModVal));
      displayVal = `<strong>${modStr}</strong> <span class="badge-modified">MODIFIED</span>`;
    }

    const props = [];
    if (isCustom) props.push("Custom");
    if (f.nillable === false) props.push("Required");
    if (f.unique) props.push("Unique");
    if (f.externalId) props.push("ExtId");
    if (f.calculated) props.push("Formula");
    if (f.autoNumber) props.push("AutoNum");

    let actionsHtml = `<div style="display:flex; gap:4px; justify-content:center; align-items:center;">`;
    if (isUpdateable) {
      actionsHtml += `<button type="button" class="btn btn-secondary btn-edit-field-val" data-field="${f.name}" style="padding:2px 7px; font-size:11px; cursor:pointer;" title="Click to edit value">✏️ Edit</button>`;
    }
    const canHaveFls = isCustom || f.permissionable || (!["Id", "SystemModstamp", "IsDeleted"].includes(f.name) && !f.name.endsWith("Date"));
    if (canHaveFls) {
      actionsHtml += `<a href="field-manager.html?host=${encodeURIComponent(activeHost)}&obj=${encodeURIComponent(sobjectName)}&field=${encodeURIComponent(f.name)}" class="btn btn-secondary" style="padding:2px 6px; font-size:11px; text-decoration:none;" title="Configure FLS and metadata in Field Manager">⚙️ FLS</a>`;
    }
    if (!isUpdateable && !isCustom) {
      const tag = f.calculated ? "Formula" : (f.autoNumber ? "AutoNum" : "System");
      actionsHtml += `<span style="font-size:10px; color:#94a3b8; font-weight:600;">${tag}</span>`;
    }
    actionsHtml += `</div>`;

    rows.push(`
      <tr data-field="${f.name}">
        <td><strong>${escapeHtml(f.label)}</strong></td>
        <td><code>${escapeHtml(f.name)}</code></td>
        <td><span style="font-size:11px; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px;">${f.type}${f.length ? ` (${f.length})` : ''}</span></td>
        <td class="${editableClass}" data-field="${f.name}" title="${isUpdateable ? (isEditMode ? 'Inline edit enabled' : 'Click Edit or double-click to modify value') : (schemaOnly ? '' : 'Read-only field')}">
          ${displayVal}
        </td>
        <td style="font-size:11px; color:#475569;">${props.join(", ")}</td>
        <td style="text-align:center;">${actionsHtml}</td>
      </tr>
    `);
  }

  if (append) {
    tbody.insertAdjacentHTML("beforeend", rows.join(""));
  } else {
    tbody.innerHTML = rows.join("");
  }

  if (!schemaOnly) {
    if (!isEditMode) {
      tbody.querySelectorAll(".editable-cell").forEach(cell => {
        if (!cell.dataset.bound) {
          cell.dataset.bound = "true";
          cell.addEventListener("dblclick", () => {
            const fieldName = cell.dataset.field;
            openEditModal(fieldName);
          });
        }
      });
    }

    tbody.querySelectorAll(".btn-edit-field-val").forEach(btn => {
      if (!btn.dataset.bound) {
        btn.dataset.bound = "true";
        btn.addEventListener("click", () => {
          const fieldName = btn.dataset.field;
          openEditModal(fieldName);
        });
      }
    });
  }
}

// ─── BEAUTIFUL IN-APP FIELD EDITOR MODAL CONTROLLER ───────────────────
let activeEditField = null;
let activeFieldDesc = null;

function openEditModal(fieldName) {
  const fieldDesc = fieldDescribes.find(f => f.name === fieldName);
  if (!fieldDesc || !isFieldEditable(fieldDesc)) {
    alert(`Field ${fieldName} is a system read-only field (${fieldDesc?.calculated ? 'Formula' : (fieldDesc?.autoNumber ? 'Auto-number' : 'System Timestamp')}) and cannot be edited.`);
    return;
  }

  activeEditField = fieldName;
  activeFieldDesc = fieldDesc;

  const currentVal = modifiedFields[fieldName] !== undefined ? modifiedFields[fieldName] : recordData[fieldName];
  const origVal = recordData[fieldName];

  // Header badges
  document.getElementById("modal-field-title").textContent = fieldDesc.label || fieldName;
  document.getElementById("modal-field-api").textContent = fieldDesc.name;
  document.getElementById("modal-field-type").textContent = `${fieldDesc.type}${fieldDesc.length ? ` (${fieldDesc.length})` : ''}`;

  const reqBadge = document.getElementById("modal-field-badge-required");
  if (reqBadge) reqBadge.style.display = fieldDesc.nillable === false ? "inline-block" : "none";

  // Description / Help text
  const helpBox = document.getElementById("modal-help-text");
  if (fieldDesc.inlineHelpText) {
    helpBox.textContent = fieldDesc.inlineHelpText;
    helpBox.style.display = "block";
  } else {
    helpBox.style.display = "none";
  }

  // Current value display
  const origDisplay = origVal === null || origVal === undefined ? "null" : (typeof origVal === "object" ? JSON.stringify(origVal) : String(origVal));
  document.getElementById("modal-current-display").textContent = origDisplay;

  // Type hint
  const hintEl = document.getElementById("modal-type-hint");
  if (fieldDesc.type === "reference") {
    hintEl.textContent = `References: ${(fieldDesc.referenceTo || []).join(", ") || 'Salesforce ID'}`;
  } else if (fieldDesc.type === "picklist") {
    hintEl.textContent = "Select from allowed picklist options";
  } else if (fieldDesc.type === "boolean") {
    hintEl.textContent = "Toggle boolean state";
  } else {
    hintEl.textContent = `Type: ${fieldDesc.type}`;
  }

  // Render input control
  const container = document.getElementById("modal-input-container");
  container.innerHTML = "";

  if (fieldDesc.type === "boolean") {
    const isTrue = currentVal === true || currentVal === "true";
    const isFalse = currentVal === false || currentVal === "false";
    container.innerHTML = `
      <div class="bool-toggle-group">
        <button type="button" class="bool-btn ${isTrue ? 'selected-true' : ''}" id="btn-bool-true" data-val="true">
          <span>✓</span> TRUE
        </button>
        <button type="button" class="bool-btn ${isFalse ? 'selected-false' : ''}" id="btn-bool-false" data-val="false">
          <span>✕</span> FALSE
        </button>
      </div>
    `;

    container.querySelector("#btn-bool-true").addEventListener("click", () => {
      container.querySelector("#btn-bool-true").classList.add("selected-true");
      container.querySelector("#btn-bool-false").classList.remove("selected-false");
    });
    container.querySelector("#btn-bool-false").addEventListener("click", () => {
      container.querySelector("#btn-bool-false").classList.add("selected-false");
      container.querySelector("#btn-bool-true").classList.remove("selected-true");
    });
  } else if (fieldDesc.type === "picklist") {
    const picklistVals = Array.isArray(fieldDesc.picklistValues) && fieldDesc.picklistValues.length > 0
      ? fieldDesc.picklistValues.filter(pv => pv.active !== false)
      : [];

    if (picklistVals.length > 0) {
      const select = document.createElement("select");
      select.id = "modal-val-input";
      select.className = "modal-input-control";

      const emptyOpt = document.createElement("option");
      emptyOpt.value = "";
      emptyOpt.textContent = "-- None / Set Null --";
      select.appendChild(emptyOpt);

      picklistVals.forEach(pv => {
        const opt = document.createElement("option");
        opt.value = pv.value;
        opt.textContent = `${pv.label}${pv.value !== pv.label ? ` (${pv.value})` : ''}`;
        if (String(pv.value) === String(currentVal)) opt.selected = true;
        select.appendChild(opt);
      });

      container.appendChild(select);
      setTimeout(() => select.focus(), 50);
    } else {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.id = "modal-val-input";
      inp.className = "modal-input-control";
      inp.placeholder = "Enter picklist value...";
      inp.value = currentVal === null || currentVal === undefined ? "" : currentVal;
      container.appendChild(inp);
      setTimeout(() => { inp.focus(); inp.select(); }, 50);
    }
  } else if (fieldDesc.type === "textarea" || (fieldDesc.length && fieldDesc.length > 255)) {
    const ta = document.createElement("textarea");
    ta.id = "modal-val-input";
    ta.className = "modal-input-control";
    ta.rows = 4;
    ta.style.fontFamily = "var(--font-mono)";
    ta.placeholder = "Enter text or leave empty...";
    ta.value = currentVal === null || currentVal === undefined ? "" : currentVal;
    container.appendChild(ta);
    setTimeout(() => { ta.focus(); ta.select(); }, 50);
  } else if (fieldDesc.type === "reference") {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.id = "modal-val-input";
    inp.className = "modal-input-control";
    inp.maxLength = 18;
    inp.placeholder = "Paste 15 or 18-char ID (e.g. 003...)";
    inp.style.fontFamily = "var(--font-mono)";
    inp.value = currentVal === null || currentVal === undefined ? "" : currentVal;
    container.appendChild(inp);
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  } else if (["integer", "double", "currency", "percent"].includes(fieldDesc.type)) {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = "any";
    inp.id = "modal-val-input";
    inp.className = "modal-input-control";
    inp.placeholder = "Enter numeric value...";
    inp.value = currentVal === null || currentVal === undefined ? "" : currentVal;
    container.appendChild(inp);
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  } else if (fieldDesc.type === "date") {
    const inp = document.createElement("input");
    inp.type = "date";
    inp.id = "modal-val-input";
    inp.className = "modal-input-control";
    inp.value = currentVal === null || currentVal === undefined ? "" : currentVal;
    container.appendChild(inp);
    setTimeout(() => inp.focus(), 50);
  } else {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.id = "modal-val-input";
    inp.className = "modal-input-control";
    inp.placeholder = "Enter value...";
    inp.value = currentVal === null || currentVal === undefined ? "" : currentVal;
    container.appendChild(inp);
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  }

  // Show modal
  const modal = document.getElementById("field-editor-modal");
  modal.style.display = "flex";
}

function closeEditModal() {
  const modal = document.getElementById("field-editor-modal");
  if (modal) modal.style.display = "none";
  activeEditField = null;
  activeFieldDesc = null;
}

function applyModalEdit() {
  if (!activeEditField || !activeFieldDesc) return;

  const fieldName = activeEditField;
  const fieldDesc = activeFieldDesc;
  let parsedVal;

  if (fieldDesc.type === "boolean") {
    const trueBtn = document.getElementById("btn-bool-true");
    const falseBtn = document.getElementById("btn-bool-false");
    if (trueBtn && trueBtn.classList.contains("selected-true")) {
      parsedVal = true;
    } else if (falseBtn && falseBtn.classList.contains("selected-false")) {
      parsedVal = false;
    } else {
      parsedVal = null;
    }
  } else {
    const inp = document.getElementById("modal-val-input");
    const rawVal = inp ? inp.value.trim() : "";
    if (rawVal === "" || rawVal.toUpperCase() === "#NULL#") {
      parsedVal = null;
    } else if (["integer", "double", "currency", "percent"].includes(fieldDesc.type)) {
      const num = Number(rawVal);
      parsedVal = isNaN(num) ? rawVal : num;
    } else {
      parsedVal = rawVal;
    }
  }

  // Update modified fields tracking
  if (parsedVal === recordData[fieldName]) {
    delete modifiedFields[fieldName];
  } else {
    modifiedFields[fieldName] = parsedVal;
  }

  updateSaveButtonState();
  renderFields(false, false);
  closeEditModal();
}

function updateSaveButtonState() {
  const count = Object.keys(modifiedFields).length;
  const saveBtn = document.getElementById("btn-save-changes");
  const cancelBtn = document.getElementById("btn-cancel-edits");
  if (!saveBtn) return;

  if (count > 0) {
    saveBtn.style.display = "inline-flex";
    saveBtn.textContent = `💾 Save Modifications (${count})`;
    if (cancelBtn) cancelBtn.style.display = "inline-flex";
  } else if (isEditMode) {
    saveBtn.style.display = "inline-flex";
    saveBtn.textContent = `💾 Save Modifications (0)`;
    if (cancelBtn) cancelBtn.style.display = "inline-flex";
  } else {
    saveBtn.style.display = "none";
    if (cancelBtn) cancelBtn.style.display = "none";
  }
}

// ─── CRUD: CREATE NEW RECORD MODAL CONTROLLER ─────────────────────────
async function openNewRecordModal() {
  const targetObj = sobjectName || document.getElementById("select-sobject")?.value || "Account";
  const objInput = document.getElementById("new-rec-sobject");
  if (objInput) objInput.value = targetObj;
  document.getElementById("new-record-modal-title").textContent = `Create New ${targetObj} Record`;
  document.getElementById("new-record-modal").style.display = "flex";

  await loadNewRecordFormFields(targetObj);
}

async function loadNewRecordFormFields(objName) {
  const container = document.getElementById("new-rec-fields-container");
  container.innerHTML = `<div style="text-align:center; color:#0176d3; padding:20px;">Fetching createable fields for ${objName}...</div>`;

  try {
    const desc = await sfConn.metadata(objName);
    const fields = (desc.fields || []).filter(f => f.createable !== false && isFieldEditable(f));
    fields.sort((a, b) => {
      if (a.nillable === false && b.nillable !== false) return -1;
      if (b.nillable === false && a.nillable !== false) return 1;
      return (a.label || a.name).localeCompare(b.label || b.name);
    });

    if (fields.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:20px;">No createable fields available for ${objName}.</div>`;
      return;
    }

    container.innerHTML = fields.map(f => {
      const isReq = f.nillable === false;
      let inputHtml = "";

      if (f.type === "boolean") {
        inputHtml = `
          <select class="new-rec-input" data-field="${f.name}" style="padding:6px 8px; font-size:12px; border:1px solid var(--border); border-radius:4px; width:100%;">
            <option value="">-- None / Default --</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        `;
      } else if (f.type === "picklist" && Array.isArray(f.picklistValues) && f.picklistValues.length > 0) {
        let opts = `<option value="">-- None --</option>`;
        f.picklistValues.forEach(pv => {
          if (pv.active !== false) {
            opts += `<option value="${escapeHtml(pv.value)}">${escapeHtml(pv.label)}</option>`;
          }
        });
        inputHtml = `<select class="new-rec-input" data-field="${f.name}" style="padding:6px 8px; font-size:12px; border:1px solid var(--border); border-radius:4px; width:100%;">${opts}</select>`;
      } else if (["integer", "double", "currency", "percent"].includes(f.type)) {
        inputHtml = `<input type="number" step="any" class="new-rec-input" data-field="${f.name}" placeholder="Numeric value" style="padding:6px 8px; font-size:12px; border:1px solid var(--border); border-radius:4px; width:100%;">`;
      } else if (f.type === "date") {
        inputHtml = `<input type="date" class="new-rec-input" data-field="${f.name}" style="padding:6px 8px; font-size:12px; border:1px solid var(--border); border-radius:4px; width:100%;">`;
      } else {
        inputHtml = `<input type="text" class="new-rec-input" data-field="${f.name}" placeholder="Value..." style="padding:6px 8px; font-size:12px; border:1px solid var(--border); border-radius:4px; width:100%;">`;
      }

      return `
        <div style="display:flex; flex-direction:column; gap:3px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <label style="font-size:11px; font-weight:700;">
              ${escapeHtml(f.label)} <code style="font-size:10px; color:#6b7280;">(${f.name})</code>
              ${isReq ? '<span style="color:#dc2626; font-weight:700;">* Required</span>' : ''}
            </label>
            <span style="font-size:10px; color:#6b7280;">${f.type}</span>
          </div>
          ${inputHtml}
        </div>
      `;
    }).join("");

  } catch (e) {
    container.innerHTML = `<div style="color:#dc2626; padding:20px;">Failed to describe ${objName}: ${e.message}</div>`;
  }
}

async function submitNewRecord() {
  const targetObj = document.getElementById("new-rec-sobject").value.trim();
  if (!targetObj) {
    alert("Please enter a target SObject name.");
    return;
  }

  const payload = {};
  document.querySelectorAll(".new-rec-input").forEach(inp => {
    const fn = inp.dataset.field;
    const raw = inp.value.trim();
    if (raw !== "") {
      if (raw === "true") payload[fn] = true;
      else if (raw === "false") payload[fn] = false;
      else if (inp.type === "number") payload[fn] = Number(raw);
      else payload[fn] = raw;
    }
  });

  if (Object.keys(payload).length === 0) {
    alert("Please enter at least one field value to create a record.");
    return;
  }

  const submitBtn = document.getElementById("modal-btn-new-rec-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = "⏳ Creating in Org...";

  try {
    const res = await sfConn.rest(`/services/data/v${apiVersion}/sobjects/${targetObj}`, {
      method: "POST",
      body: payload
    });

    alert(`✓ New ${targetObj} record created successfully in Salesforce!\n\nNew Record ID: ${res.id}`);
    document.getElementById("new-record-modal").style.display = "none";
    document.getElementById("input-record-id").value = res.id;
    await loadRecord(res.id);
  } catch (err) {
    alert(`❌ Failed to create record: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "🚀 Create Record in Org";
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function setupEvents() {
  document.getElementById("field-filter").addEventListener("input", () => {
    displayedRecordFieldCount = 50;
    renderFields(!recordId, false);
  });
  document.getElementById("chk-populated-only").addEventListener("change", () => {
    displayedRecordFieldCount = 50;
    renderFields(!recordId, false);
  });

  // Infinite Scroll Listener for Fields Table
  const fieldsTableEl = document.getElementById("fields-table");
  const fieldsContainer = fieldsTableEl ? fieldsTableEl.closest(".table-container") : null;
  fieldsContainer?.addEventListener("scroll", () => {
    if (fieldsContainer.scrollTop + fieldsContainer.clientHeight >= fieldsContainer.scrollHeight - 60) {
      const filtered = getFilteredRecordFields(!recordId);
      if (displayedRecordFieldCount < filtered.length) {
        displayedRecordFieldCount += 50;
        renderFields(!recordId, true);
      }
    }
  });

  // Toggle Edit Mode button
  document.getElementById("btn-toggle-edit-mode")?.addEventListener("click", () => {
    if (!recordId) return;
    isEditMode = !isEditMode;
    const btn = document.getElementById("btn-toggle-edit-mode");
    btn.textContent = isEditMode ? "👁️ View Mode" : "✏️ Edit Mode";
    btn.classList.toggle("btn-primary", isEditMode);
    btn.classList.toggle("btn-secondary", !isEditMode);
    renderFields(false, false);
    updateSaveButtonState();
  });

  // New Record button (CRUD: CREATE)
  document.getElementById("btn-new-record")?.addEventListener("click", openNewRecordModal);
  document.getElementById("modal-btn-new-rec-close")?.addEventListener("click", () => {
    document.getElementById("new-record-modal").style.display = "none";
  });
  document.getElementById("modal-btn-new-rec-cancel")?.addEventListener("click", () => {
    document.getElementById("new-record-modal").style.display = "none";
  });
  document.getElementById("btn-refresh-new-rec-fields")?.addEventListener("click", () => {
    const obj = document.getElementById("new-rec-sobject").value.trim();
    if (obj) loadNewRecordFormFields(obj);
  });
  document.getElementById("modal-btn-new-rec-submit")?.addEventListener("click", submitNewRecord);

  // Discard all unsaved edits
  document.getElementById("btn-cancel-edits")?.addEventListener("click", () => {
    if (Object.keys(modifiedFields).length > 0) {
      if (!confirm("Discard all unsaved field modifications?")) return;
    }
    modifiedFields = {};
    isEditMode = false;
    const toggleBtn = document.getElementById("btn-toggle-edit-mode");
    if (toggleBtn) {
      toggleBtn.textContent = "✏️ Edit Mode";
      toggleBtn.classList.remove("btn-primary");
      toggleBtn.classList.add("btn-secondary");
    }
    updateSaveButtonState();
    renderFields(false, false);
  });

  // Delegated listener for inline table inputs
  const tbody = document.getElementById("fields-body");
  const handleInlineChange = (e) => {
    const target = e.target;
    if (!target.classList.contains("inline-edit-input")) return;
    const fieldName = target.dataset.field;
    const fieldDesc = fieldDescribes.find(f => f.name === fieldName);
    if (!fieldDesc) return;

    const rawVal = target.value.trim();
    let parsedVal;

    if (fieldDesc.type === "boolean") {
      parsedVal = rawVal === "true";
    } else if (rawVal === "" || rawVal.toUpperCase() === "#NULL#") {
      parsedVal = null;
    } else if (["integer", "double", "currency", "percent"].includes(fieldDesc.type)) {
      const num = Number(rawVal);
      parsedVal = isNaN(num) ? rawVal : num;
    } else {
      parsedVal = rawVal;
    }

    if (parsedVal === recordData[fieldName]) {
      delete modifiedFields[fieldName];
      target.classList.remove("is-modified");
    } else {
      modifiedFields[fieldName] = parsedVal;
      target.classList.add("is-modified");
    }

    updateSaveButtonState();
  };

  tbody.addEventListener("change", handleInlineChange);
  tbody.addEventListener("input", handleInlineChange);

  // Load record button & Enter key
  document.getElementById("btn-load-record").addEventListener("click", () => {
    const id = document.getElementById("input-record-id").value;
    loadRecord(id);
  });
  document.getElementById("input-record-id").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadRecord(e.target.value);
  });

  // Recent records dropdown
  document.getElementById("select-recent-records").addEventListener("change", (e) => {
    if (e.target.value) {
      document.getElementById("input-record-id").value = e.target.value;
      loadRecord(e.target.value);
    }
  });

  // SObject schema view
  document.getElementById("btn-load-object-only").addEventListener("click", () => {
    const obj = document.getElementById("select-sobject").value;
    if (obj) loadObjectSchemaOnly(obj);
  });

  // Copy JSON
  document.getElementById("btn-copy-json").addEventListener("click", () => {
    const payload = recordId ? recordData : fieldDescribes;
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    alert("Data copied to clipboard as JSON!");
  });

  // Open in Salesforce
  document.getElementById("btn-open-sf").addEventListener("click", () => {
    if (recordId) {
      window.open(`https://${sfHost}/${recordId}`, "_blank");
    }
  });

  // Save changes via PATCH (CRUD: UPDATE)
  document.getElementById("btn-save-changes").addEventListener("click", async () => {
    // Flush any focused inline input before saving
    document.querySelectorAll(".inline-edit-input").forEach(input => {
      const fn = input.dataset.field;
      const fd = fieldDescribes.find(f => f.name === fn);
      if (!fd) return;
      const raw = input.value.trim();
      let val;
      if (fd.type === "boolean") {
        val = raw === "true";
      } else if (raw === "" || raw.toUpperCase() === "#NULL#") {
        val = null;
      } else if (["integer", "double", "currency", "percent"].includes(fd.type)) {
        const num = Number(raw);
        val = isNaN(num) ? raw : num;
      } else {
        val = raw;
      }
      if (val !== recordData[fn]) {
        modifiedFields[fn] = val;
      } else {
        delete modifiedFields[fn];
      }
    });

    const count = Object.keys(modifiedFields).length;
    if (count === 0) {
      alert("No modifications have been made to save.");
      return;
    }

    const saveBtn = document.getElementById("btn-save-changes");
    saveBtn.disabled = true;
    saveBtn.textContent = `💾 Saving (${count})...`;

    try {
      await sfConn.rest(`/services/data/v${apiVersion}/sobjects/${sobjectName}/${recordId}`, {
        method: "PATCH",
        body: modifiedFields
      });
      alert(`✓ Record updated successfully! Saved ${count} modified field(s).`);
      modifiedFields = {};
      saveBtn.disabled = false;
      updateSaveButtonState();
      await loadRecord(recordId);
    } catch (e) {
      saveBtn.disabled = false;
      updateSaveButtonState();
      alert(`❌ Save failed:\n\n${e.message}`);
    }
  });

  // Delete record (CRUD: DELETE)
  document.getElementById("btn-delete-record").addEventListener("click", async () => {
    if (!confirm(`Are you sure you want to permanently delete this ${sobjectName} record (${recordId})?`)) return;
    try {
      await sfConn.rest(`/services/data/v${apiVersion}/sobjects/${sobjectName}/${recordId}`, {
        method: "DELETE"
      });
      alert("✓ Record deleted successfully.");
      location.reload();
    } catch (e) {
      alert("❌ Delete failed: " + e.message);
    }
  });

  // Modal dialog controls
  document.getElementById("modal-btn-close")?.addEventListener("click", closeEditModal);
  document.getElementById("modal-btn-cancel")?.addEventListener("click", closeEditModal);
  document.getElementById("modal-btn-apply")?.addEventListener("click", applyModalEdit);

  // Set null quick action in modal
  document.getElementById("modal-btn-set-null")?.addEventListener("click", () => {
    if (!activeFieldDesc) return;
    if (activeFieldDesc.type === "boolean") {
      document.getElementById("btn-bool-true")?.classList.remove("selected-true");
      document.getElementById("btn-bool-false")?.classList.remove("selected-false");
    } else {
      const inp = document.getElementById("modal-val-input");
      if (inp) inp.value = "";
    }
  });

  // Revert original quick action in modal
  document.getElementById("modal-btn-reset-orig")?.addEventListener("click", () => {
    if (!activeEditField || !activeFieldDesc) return;
    const origVal = recordData[activeEditField];
    if (activeFieldDesc.type === "boolean") {
      const isTrue = origVal === true || origVal === "true";
      const isFalse = origVal === false || origVal === "false";
      document.getElementById("btn-bool-true")?.classList.toggle("selected-true", isTrue);
      document.getElementById("btn-bool-false")?.classList.toggle("selected-false", isFalse);
    } else {
      const inp = document.getElementById("modal-val-input");
      if (inp) inp.value = origVal === null || origVal === undefined ? "" : origVal;
    }
  });

  // Backdrop click to close modals
  document.getElementById("field-editor-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "field-editor-modal") closeEditModal();
  });
  document.getElementById("new-record-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "new-record-modal") {
      document.getElementById("new-record-modal").style.display = "none";
    }
  });

  // Global keyboard shortcuts (Esc to close, Enter to submit)
  document.addEventListener("keydown", (e) => {
    const editModal = document.getElementById("field-editor-modal");
    if (editModal && editModal.style.display !== "none") {
      if (e.key === "Escape") {
        e.preventDefault();
        closeEditModal();
      } else if (e.key === "Enter" && e.target.id === "modal-val-input" && e.target.tagName !== "TEXTAREA") {
        e.preventDefault();
        applyModalEdit();
      }
    }
    const newRecModal = document.getElementById("new-record-modal");
    if (newRecModal && newRecModal.style.display !== "none" && e.key === "Escape") {
      e.preventDefault();
      newRecModal.style.display = "none";
    }
  });
}

init();
