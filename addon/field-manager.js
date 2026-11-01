import { sfConn, apiVersion, updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";

let sfHost = resolveSfHost();
let allPermSets = [];
let flsSelections = {}; // For new field creation: permSetId -> { read: bool, edit: bool }
let currentExistingFields = [];
let selectedExistingField = null;
let currentCustomFieldToolingId = null;
let existingFlsMap = {}; // permSetId -> { id: fieldPermId, read: bool, edit: bool }

// Infinite scroll & category state
let currentFieldCategory = "all"; // 'all' | 'custom' | 'standard'
let displayedFieldCount = 40;
let displayedFlsCount = 40;

async function init() {
  if (!sfHost) {
    sfHost = resolveSfHost();
  }
  if (!sfHost) {
    // Attempt fallback from background service worker
    sfHost = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 2500);
      try {
        chrome.runtime.sendMessage({ message: "getActiveSfHost" }, (res) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(res || null);
        });
      } catch (e) {
        clearTimeout(timer);
        resolve(null);
      }
    });

    if (sfHost) {
      sessionStorage.setItem("sfpi_active_host", sfHost);
      localStorage.setItem("sfpi_last_host", sfHost);
    }
  }

  if (!sfHost) {
    alert("Salesforce host not found. Please open the extension from an active Salesforce tab.");
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
  loadSObjectsDatalist();
  await loadPermissionSets();

  // Read URL params obj and field for deep-linking
  const params = new URLSearchParams(window.location.search);
  const targetObj = params.get("obj") || "Account";
  const targetField = params.get("field") || null;

  const objInput = document.getElementById("existing-obj-input");
  if (objInput) objInput.value = targetObj;

  // Load target object and auto-select specified field
  await loadExistingObjectFields(targetObj, targetField);
}

// ─── Mode Switching ──────────────────────────────────────────────────
function switchMode(mode) {
  const isEdit = mode === "edit-fields";
  document.getElementById("view-edit-fields").style.display = isEdit ? "flex" : "none";
  document.getElementById("view-create-field").style.display = isEdit ? "none" : "flex";
  document.getElementById("btn-save-existing-field").style.display = isEdit ? "inline-flex" : "none";
  document.getElementById("btn-create-field").style.display = isEdit ? "none" : "inline-flex";

  document.querySelectorAll("#fm-main-mode-tabs .tool-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.mode === mode);
  });
}

// ─── Load All Org SObjects for Autocomplete Datalist ──────────────────
async function loadSObjectsDatalist() {
  try {
    const res = await sfConn.getSObjects();
    const list = document.getElementById("sobjects-datalist");
    if (!list) return;
    list.innerHTML = "";
    (res.sobjects || []).forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.name;
      opt.label = `${s.label} (${s.name})`;
      list.appendChild(opt);
    });
  } catch (e) {
    console.warn("Could not load SObjects datalist:", e);
  }
}

// ─── Load All Org Profiles and Permission Sets ────────────────────────
async function loadPermissionSets() {
  const tbody = document.getElementById("fls-body");
  if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:30px;">Loading Profiles and Permission Sets...</td></tr>`;

  try {
    let res = null;
    try {
      const q = `SELECT Id, Name, Label, IsOwnedByProfile, Profile.Name FROM PermissionSet ORDER BY IsOwnedByProfile DESC, Label ASC LIMIT 1000`;
      res = await sfConn.query(q);
    } catch (eOrder) {
      const qFallback = `SELECT Id, Name, Label, IsOwnedByProfile, Profile.Name FROM PermissionSet LIMIT 500`;
      res = await sfConn.query(qFallback);
    }
    allPermSets = res?.records || [];

    const countEl = document.getElementById("fls-total-count");
    if (countEl) countEl.textContent = allPermSets.length;
    const existingCountEl = document.getElementById("existing-fls-total-count");
    if (existingCountEl) existingCountEl.textContent = allPermSets.length;

    // Default preset for new fields: Admins have Edit, others have Read
    allPermSets.forEach(ps => {
      const isSysAdmin = (ps.Profile?.Name || ps.Name || "").toLowerCase().includes("admin");
      flsSelections[ps.Id] = {
        read: isSysAdmin,
        edit: isSysAdmin
      };
    });

    renderFlsTable();
    updateSelectedCount();
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="color:red; text-align:center; padding:20px;">Failed to load permission sets: ${e.message}</td></tr>`;
  }
}

// ─── VIEW 1: MANAGE & EDIT EXISTING FIELDS (UNCOVERS ALL FIELDS) ───────
async function loadExistingObjectFields(objName, targetFieldName = null) {
  const tbody = document.getElementById("existing-fields-body");
  tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:20px; color:#0176d3;">Fetching comprehensive field dictionary for '${escapeHtml(objName)}'...</td></tr>`;

  try {
    // 1. Fetch describe metadata
    let describeFields = [];
    try {
      const describe = await sfConn.metadata(objName);
      describeFields = describe.fields || [];
    } catch (eDesc) {
      console.warn("Describe warning:", eDesc);
    }

    // 2. Fetch Tooling API FieldDefinition to uncover ALL fields (even those hidden from current profile FLS)
    let toolingFields = [];
    try {
      const q = `SELECT QualifiedApiName, Label, DataType, Length, Precision, Scale, IsCalculated, IsNillable, DeveloperName FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = '${objName}' LIMIT 2000`;
      const toolRes = await sfConn.query(q, true);
      toolingFields = toolRes?.records || [];
    } catch (eTool) {
      console.warn("Tooling FieldDefinition query fallback note:", eTool);
    }

    // 3. Merge: Start with describe fields
    const fieldMap = new Map();
    describeFields.forEach(f => {
      fieldMap.set(f.name.toLowerCase(), {
        ...f,
        custom: f.custom || f.name.endsWith("__c")
      });
    });

    // Merge missing custom fields from Tooling FieldDefinition
    toolingFields.forEach(tf => {
      const qName = tf.QualifiedApiName || "";
      const key = qName.toLowerCase();
      // Standard virtual particles (e.g. CompareName, CompareSite) don't have FLS or schema
      if (!qName.endsWith("__c")) return;
      if (!fieldMap.has(key)) {
        fieldMap.set(key, {
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
        });
      }
    });

    currentExistingFields = Array.from(fieldMap.values());
    currentExistingFields.sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name));

    // Update Category Counts
    const customCount = currentExistingFields.filter(f => f.custom).length;
    const stdCount = currentExistingFields.length - customCount;
    document.getElementById("field-list-count").textContent = `${currentExistingFields.length} fields`;
    const catAll = document.getElementById("cat-count-all");
    const catCustom = document.getElementById("cat-count-custom");
    const catStd = document.getElementById("cat-count-standard");
    if (catAll) catAll.textContent = currentExistingFields.length;
    if (catCustom) catCustom.textContent = customCount;
    if (catStd) catStd.textContent = stdCount;

    // Reset infinite scroll batching
    displayedFieldCount = 40;
    renderExistingFieldsList(false);

    // Auto-select target field or first field
    if (currentExistingFields.length > 0) {
      let defaultField = null;
      if (targetFieldName) {
        defaultField = currentExistingFields.find(f => f.name.toLowerCase() === targetFieldName.toLowerCase()) ||
                       currentExistingFields.find(f => (f.label || "").toLowerCase() === targetFieldName.toLowerCase());
      }
      if (!defaultField) {
        defaultField = currentExistingFields.find(f => f.custom) || currentExistingFields[0];
      }
      selectExistingField(defaultField, objName);
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" style="color:#dc2626; text-align:center; padding:20px;">Failed to load fields for '${objName}': ${err.message}</td></tr>`;
  }
}

function getFilteredFields() {
  const query = (document.getElementById("existing-fields-filter")?.value || "").toLowerCase().trim();
  return currentExistingFields.filter(f => {
    if (currentFieldCategory === "custom" && !f.custom) return false;
    if (currentFieldCategory === "standard" && f.custom) return false;
    if (!query) return true;
    return (f.label || "").toLowerCase().includes(query) ||
           (f.name || "").toLowerCase().includes(query) ||
           (f.type || "").toLowerCase().includes(query);
  });
}

function renderExistingFieldsList(append = false) {
  const tbody = document.getElementById("existing-fields-body");
  const filtered = getFilteredFields();

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--text-muted);">No matching fields.</td></tr>`;
    return;
  }

  const startIdx = append ? tbody.children.length : 0;
  const batch = filtered.slice(startIdx, displayedFieldCount);

  if (batch.length === 0 && append) return;

  const rowsHtml = batch.map(f => {
    const isCustom = f.custom;
    const isSelected = selectedExistingField?.name === f.name;
    const bg = isSelected ? "style='background: #eff6ff; font-weight: 600; cursor: pointer;'" : "style='cursor: pointer;'";

    return `
      <tr class="existing-field-row" data-field-name="${f.name}" ${bg}>
        <td>
          <div style="font-weight: 600; color: #1e293b;">${escapeHtml(f.label)}</div>
          ${isCustom ? '<span style="font-size:9px; background:#e0f2fe; color:#0284c7; padding:1px 4px; border-radius:3px; font-weight:700;">CUSTOM</span>' : '<span style="font-size:9px; background:#f1f5f9; color:#475569; padding:1px 4px; border-radius:3px;">STANDARD</span>'}
        </td>
        <td><code style="font-size:11px; color:#475569;">${escapeHtml(f.name)}</code></td>
        <td style="font-size:11px; color:#64748b;">${escapeHtml(f.type || '')}</td>
      </tr>
    `;
  }).join("");

  if (append) {
    tbody.insertAdjacentHTML("beforeend", rowsHtml);
  } else {
    tbody.innerHTML = rowsHtml;
  }

  // Bind click handlers to newly rendered rows
  tbody.querySelectorAll(".existing-field-row").forEach(row => {
    if (!row.dataset.bound) {
      row.dataset.bound = "true";
      row.addEventListener("click", () => {
        const fieldName = row.dataset.fieldName;
        const targetObj = document.getElementById("existing-obj-input").value.trim() || "Account";
        const field = currentExistingFields.find(f => f.name === fieldName);
        if (field) selectExistingField(field, targetObj);
      });
    }
  });
}

async function selectExistingField(field, objName) {
  selectedExistingField = field;
  currentCustomFieldToolingId = null;

  // Re-render field rows to show active selection highlight
  renderExistingFieldsList(false);

  document.getElementById("edit-field-title").textContent = `${field.label} (${field.name})`;
  const typeBadge = document.getElementById("edit-field-type-badge");
  typeBadge.textContent = field.custom ? "CUSTOM FIELD" : "STANDARD FIELD";
  typeBadge.style.background = field.custom ? "#e0f2fe" : "#f1f5f9";
  typeBadge.style.color = field.custom ? "#0284c7" : "#475569";

  const deleteBtn = document.getElementById("btn-delete-field");
  if (deleteBtn) deleteBtn.style.display = field.custom ? "inline-flex" : "none";

  const stdGuidance = document.getElementById("standard-field-guidance");
  if (stdGuidance) stdGuidance.style.display = field.custom ? "none" : "block";

  const setupBtn = document.getElementById("btn-open-field-in-setup");
  if (setupBtn) {
    setupBtn.href = `https://${sfHost}/lightning/setup/ObjectManager/${objName}/FieldsAndRelationships/view`;
  }

  // Populate editor form
  document.getElementById("edit-field-label").value = field.label || "";
  document.getElementById("edit-field-api").value = field.name || "";
  document.getElementById("edit-field-datatype").value = field.type || "";
  document.getElementById("edit-field-length").value = field.length || (field.precision ? `${field.precision},${field.scale}` : "N/A");
  document.getElementById("edit-field-desc").value = field.description || "";
  document.getElementById("edit-field-help").value = field.inlineHelpText || "";

  document.getElementById("edit-chk-required").checked = !field.nillable;
  document.getElementById("edit-chk-unique").checked = !!field.unique;
  document.getElementById("edit-chk-external-id").checked = !!field.externalId;

  // Handle Picklist Values
  const picklistSection = document.getElementById("edit-picklist-section");
  const picklistArea = document.getElementById("edit-picklist-values");
  if (field.type === "picklist" || field.type === "multipicklist") {
    picklistSection.style.display = "block";
    const values = (field.picklistValues || []).map(pv => pv.label || pv.value);
    picklistArea.value = values.join("\n");
  } else {
    picklistSection.style.display = "none";
  }

  const statusEl = document.getElementById("edit-field-status");
  statusEl.style.display = "none";

  // If custom field, query Tooling API for CustomField Id and full Metadata
  if (field.custom) {
    const devName = field.name.replace(/__c$/, "");
    try {
      const q = `SELECT Id, DeveloperName, TableEnumOrId, Description, InlineHelpText, Metadata FROM CustomField WHERE (TableEnumOrId = '${objName}' OR TableEnumOrId = '${objName}__c') AND DeveloperName = '${devName}' LIMIT 1`;
      const toolRes = await sfConn.query(q, true);
      const rec = toolRes?.records?.[0];
      if (rec) {
        currentCustomFieldToolingId = rec.Id;
        if (rec.Description) document.getElementById("edit-field-desc").value = rec.Description;
        if (rec.InlineHelpText) document.getElementById("edit-field-help").value = rec.InlineHelpText;
      }
    } catch (e) {
      console.warn("[Field Manager] Tooling CustomField query note:", e);
    }
  }

  // Load live FLS for this field
  loadExistingFieldFls(objName, field.name);
}

// ─── FLS PERMISSIONS MATRIX (WITH INFINITE SCROLL & LIVE STATE) ────────
async function loadExistingFieldFls(objName, fieldName) {
  const tbody = document.getElementById("existing-fls-body");
  const label = document.getElementById("fls-field-target-label");
  label.textContent = `Live FLS for: ${objName}.${fieldName}`;
  tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:25px; color:#0176d3;">Querying live FieldPermissions across Profiles & Permission Sets...</td></tr>`;

  existingFlsMap = {};
  allPermSets.forEach(ps => {
    existingFlsMap[ps.Id] = { id: null, read: false, edit: false };
  });

  try {
    const fullName = `${objName}.${fieldName}`;
    let res = null;
    try {
      const q = `SELECT Id, ParentId, Parent.Name, Parent.Label, Parent.IsOwnedByProfile, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE SobjectType = '${objName}' AND Field = '${fullName}' LIMIT 1000`;
      res = await sfConn.query(q);
    } catch (qErr) {
      const qSimple = `SELECT Id, ParentId, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE SobjectType = '${objName}' AND Field = '${fullName}' LIMIT 1000`;
      res = await sfConn.query(qSimple);
    }

    const records = res?.records || [];
    records.forEach(fp => {
      existingFlsMap[fp.ParentId] = {
        id: fp.Id,
        read: fp.PermissionsRead === true,
        edit: fp.PermissionsEdit === true
      };
    });

    displayedFlsCount = 40;
    renderExistingFlsTable(false);
    updateExistingFlsCount();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:#dc2626; text-align:center; padding:20px;">Could not load FieldPermissions: ${err.message}</td></tr>`;
  }
}

function getFilteredPermSets() {
  const query = (document.getElementById("existing-fls-search")?.value || "").toLowerCase().trim();
  return allPermSets.filter(ps => {
    if (!query) return true;
    const label = (ps.Label || ps.Name || "").toLowerCase();
    const profileName = (ps.Profile?.Name || "").toLowerCase();
    return label.includes(query) || profileName.includes(query);
  });
}

function renderExistingFlsTable(append = false) {
  const tbody = document.getElementById("existing-fls-body");
  const filtered = getFilteredPermSets();

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">No matching Profiles or Permission Sets.</td></tr>`;
    return;
  }

  const startIdx = append ? tbody.children.length : 0;
  const batch = filtered.slice(startIdx, displayedFlsCount);

  if (batch.length === 0 && append) return;

  const rowsHtml = batch.map(ps => {
    const isProfile = ps.IsOwnedByProfile;
    const displayName = isProfile ? `${ps.Profile?.Name || ps.Label}` : ps.Label;
    const typeBadge = isProfile
      ? `<span style="font-size:10px; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-weight:700;">PROFILE</span>`
      : `<span style="font-size:10px; background:#fef3c7; color:#b45309; padding:2px 6px; border-radius:4px; font-weight:700;">PERMISSION SET</span>`;

    const perm = existingFlsMap[ps.Id] || { read: false, edit: false };

    return `
      <tr data-psid="${ps.Id}">
        <td><strong>${escapeHtml(displayName)}</strong><br><code style="font-size:10px; color:#6b7280;">${escapeHtml(ps.Name)}</code></td>
        <td>${typeBadge}</td>
        <td style="text-align:center;">
          <input type="checkbox" class="existing-chk-read" data-psid="${ps.Id}" ${perm.read ? 'checked' : ''}>
        </td>
        <td style="text-align:center;">
          <input type="checkbox" class="existing-chk-edit" data-psid="${ps.Id}" ${perm.edit ? 'checked' : ''}>
        </td>
      </tr>
    `;
  }).join("");

  if (append) {
    tbody.insertAdjacentHTML("beforeend", rowsHtml);
  } else {
    tbody.innerHTML = rowsHtml;
  }

  // Bind change handlers to newly rendered checkboxes
  tbody.querySelectorAll(".existing-chk-read").forEach(chk => {
    if (!chk.dataset.bound) {
      chk.dataset.bound = "true";
      chk.addEventListener("change", (e) => {
        const psId = e.target.dataset.psid;
        if (!existingFlsMap[psId]) existingFlsMap[psId] = { id: null, read: false, edit: false };
        existingFlsMap[psId].read = e.target.checked;
        if (!e.target.checked) {
          existingFlsMap[psId].edit = false;
          const editChk = tbody.querySelector(`.existing-chk-edit[data-psid="${psId}"]`);
          if (editChk) editChk.checked = false;
        }
        updateExistingFlsCount();
      });
    }
  });

  tbody.querySelectorAll(".existing-chk-edit").forEach(chk => {
    if (!chk.dataset.bound) {
      chk.dataset.bound = "true";
      chk.addEventListener("change", (e) => {
        const psId = e.target.dataset.psid;
        if (!existingFlsMap[psId]) existingFlsMap[psId] = { id: null, read: false, edit: false };
        existingFlsMap[psId].edit = e.target.checked;
        if (e.target.checked) {
          existingFlsMap[psId].read = true;
          const readChk = tbody.querySelector(`.existing-chk-read[data-psid="${psId}"]`);
          if (readChk) readChk.checked = true;
        }
        updateExistingFlsCount();
      });
    }
  });
}

function updateExistingFlsCount() {
  const activeCount = Object.values(existingFlsMap).filter(p => p.read).length;
  const countEl = document.getElementById("existing-fls-active-count");
  if (countEl) countEl.textContent = activeCount;
}

// ─── Save Changes to Existing Field Metadata (CRUD: UPDATE) ─────────
async function saveExistingFieldMetadata() {
  if (!selectedExistingField) {
    alert("Please select a field to update.");
    return;
  }

  const objName = document.getElementById("existing-obj-input").value.trim();
  const label = document.getElementById("edit-field-label").value.trim();
  const desc = document.getElementById("edit-field-desc").value.trim();
  const helpText = document.getElementById("edit-field-help").value.trim();
  const isRequired = document.getElementById("edit-chk-required").checked;
  const statusEl = document.getElementById("edit-field-status");

  statusEl.style.display = "block";
  statusEl.style.background = "#eff6ff";
  statusEl.style.color = "#1d4ed8";
  statusEl.textContent = "⏳ Saving field metadata changes to Salesforce via Tooling API...";

  try {
    if (selectedExistingField.custom) {
      let toolingId = currentCustomFieldToolingId;
      if (!toolingId) {
        const devName = selectedExistingField.name.replace(/__c$/, "");
        const q = `SELECT Id, DeveloperName, TableEnumOrId, Metadata FROM CustomField WHERE (TableEnumOrId = '${objName}' OR TableEnumOrId = '${objName}__c') AND DeveloperName = '${devName}' LIMIT 1`;
        const res = await sfConn.query(q, true);
        toolingId = res?.records?.[0]?.Id;
      }

      if (!toolingId) {
        throw new Error(`Could not locate CustomField Tooling record for '${selectedExistingField.name}'.`);
      }

      const fieldType = selectedExistingField.type === "string" ? "Text" : (selectedExistingField.type === "double" ? "Number" : (selectedExistingField.type === "textarea" ? "LongTextArea" : selectedExistingField.type));
      const patchBody = {
        Metadata: {
          label: label,
          description: desc,
          inlineHelpText: helpText,
          required: isRequired,
          type: fieldType
        }
      };

      if (fieldType === "Text" || fieldType === "EncryptedText") {
        patchBody.Metadata.length = selectedExistingField.length || 255;
      } else if (fieldType === "LongTextArea" || fieldType === "Html") {
        patchBody.Metadata.length = selectedExistingField.length || 32768;
        patchBody.Metadata.visibleLines = selectedExistingField.visibleLines || 3;
      } else if (fieldType === "Number" || fieldType === "Currency" || fieldType === "Percent") {
        patchBody.Metadata.precision = selectedExistingField.precision || 18;
        patchBody.Metadata.scale = selectedExistingField.scale || 0;
      }

      // Handle picklists
      if (selectedExistingField.type === "picklist" || selectedExistingField.type === "multipicklist") {
        const rawLines = document.getElementById("edit-picklist-values").value.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (rawLines.length > 0) {
          patchBody.Metadata.valueSet = {
            valueSetDefinition: {
              sorted: false,
              value: rawLines.map((v, idx) => ({
                fullName: v.trim(),
                default: idx === 0,
                label: v.trim()
              }))
            }
          };
        }
      }

      await sfConn.tooling(`/sobjects/CustomField/${toolingId}`, {
        method: "PATCH",
        body: patchBody
      });

      statusEl.style.background = "#f0fdf4";
      statusEl.style.color = "#15803d";
      statusEl.textContent = `✓ Custom field '${selectedExistingField.name}' metadata updated successfully in Salesforce!`;
    } else {
      statusEl.style.background = "#eff6ff";
      statusEl.style.color = "#1e40af";
      statusEl.textContent = `ℹ️ Standard field '${selectedExistingField.name}' schema is system-managed. Use Section 2 to save live FLS permissions across all profiles.`;
    }

    setTimeout(() => {
      loadExistingObjectFields(objName, selectedExistingField.name);
    }, 1500);

  } catch (err) {
    statusEl.style.background = "#fef2f2";
    statusEl.style.color = "#dc2626";
    statusEl.textContent = `❌ Failed to save field metadata: ${err.message}`;
  }
}

// ─── Delete Custom Field (CRUD: DELETE) ──────────────────────────────
async function deleteSelectedField() {
  if (!selectedExistingField || !selectedExistingField.custom) {
    alert("Only custom fields can be deleted.");
    return;
  }

  const objName = document.getElementById("existing-obj-input").value.trim();
  const fieldName = selectedExistingField.name;

  if (!confirm(`⚠️ ARE YOU SURE?\n\nPermanently delete custom field '${selectedExistingField.label}' (${fieldName}) from ${objName} in your Salesforce Org?\n\nThis will remove the field and all stored values.`)) {
    return;
  }

  let toolingId = currentCustomFieldToolingId;
  if (!toolingId) {
    const devName = fieldName.replace(/__c$/, "");
    const q = `SELECT Id FROM CustomField WHERE (TableEnumOrId = '${objName}' OR TableEnumOrId = '${objName}__c') AND DeveloperName = '${devName}' LIMIT 1`;
    const res = await sfConn.query(q, true);
    toolingId = res?.records?.[0]?.Id;
  }

  if (!toolingId) {
    alert(`Could not find Tooling ID for custom field '${fieldName}'.`);
    return;
  }

  try {
    await sfConn.tooling(`/sobjects/CustomField/${toolingId}`, {
      method: "DELETE"
    });
    alert(`✓ Custom field '${fieldName}' was permanently deleted from Salesforce.`);
    selectedExistingField = null;
    currentCustomFieldToolingId = null;
    await loadExistingObjectFields(objName);
  } catch (e) {
    alert(`❌ Failed to delete field '${fieldName}': ${e.message}`);
  }
}

// ─── Save Live FLS Permissions (CRUD: CREATE, UPDATE, DELETE) ────────
async function saveExistingFieldFls() {
  if (!selectedExistingField) {
    alert("Please select a field first.");
    return;
  }

  const objName = document.getElementById("existing-obj-input").value.trim();
  const fullName = `${objName}.${selectedExistingField.name}`;
  const saveBtn = document.getElementById("btn-save-fls");
  const oldText = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = "⏳ Saving FLS to Org...";

  try {
    const toInsert = [];
    const toUpdate = [];
    const toDeleteIds = [];

    for (const [psId, p] of Object.entries(existingFlsMap)) {
      if (p.id) {
        if (!p.read) {
          // REVOKE: In Salesforce, removing FLS requires deleting the FieldPermissions record!
          toDeleteIds.push(p.id);
        } else {
          // UPDATE: Read is true, edit may be true or false
          toUpdate.push({
            attributes: { type: "FieldPermissions" },
            Id: p.id,
            PermissionsRead: true,
            PermissionsEdit: p.edit === true
          });
        }
      } else if (p.read) {
        // GRANT (INSERT): New permission record
        toInsert.push({
          attributes: { type: "FieldPermissions" },
          ParentId: psId,
          SobjectType: objName,
          Field: fullName,
          PermissionsRead: true,
          PermissionsEdit: p.edit === true
        });
      }
    }

    let successCount = 0;
    let failCount = 0;

    // 1. Process Deletions (Revocations)
    for (let i = 0; i < toDeleteIds.length; i += 200) {
      const batchIds = toDeleteIds.slice(i, i + 200);
      try {
        const delRes = await sfConn.rest(`/services/data/v${apiVersion}/composite/sobjects?ids=${batchIds.join(",")}&allOrNone=false`, {
          method: "DELETE"
        });
        (delRes || []).forEach(r => r.success ? successCount++ : failCount++);
      } catch (delErr) {
        console.warn("FLS batch delete note:", delErr);
      }
    }

    // 2. Process Updates
    for (let i = 0; i < toUpdate.length; i += 200) {
      const batch = toUpdate.slice(i, i + 200);
      try {
        const upRes = await sfConn.rest(`/services/data/v${apiVersion}/composite/sobjects`, {
          method: "PATCH",
          body: { allOrNone: false, records: batch }
        });
        (upRes?.records || upRes || []).forEach(r => r.success ? successCount++ : failCount++);
      } catch (upErr) {
        console.warn("FLS batch update note:", upErr);
      }
    }

    // 3. Process Inserts (Grants)
    for (let i = 0; i < toInsert.length; i += 200) {
      const batch = toInsert.slice(i, i + 200);
      try {
        const insRes = await sfConn.rest(`/services/data/v${apiVersion}/composite/sobjects`, {
          method: "POST",
          body: { allOrNone: false, records: batch }
        });
        (insRes?.records || insRes || []).forEach(r => r.success ? successCount++ : failCount++);
      } catch (insErr) {
        console.warn("FLS batch insert note:", insErr);
      }
    }

    alert(`✓ FLS permissions successfully stored in your Salesforce Org for '${fullName}'!\n\n• Successfully modified: ${successCount} permission set(s)\n${failCount > 0 ? `• Skipped system-restricted profiles: ${failCount}\n` : ''}`);
    await loadExistingFieldFls(objName, selectedExistingField.name);

  } catch (err) {
    alert(`❌ Failed to update FLS permissions: ${err.message}`);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = oldText;
  }
}

// ─── VIEW 2: CREATE NEW FIELD (CRUD: CREATE) ─────────────────────────
function renderFlsTable() {
  const tbody = document.getElementById("fls-body");
  if (!tbody) return;
  const query = (document.getElementById("fls-search")?.value || "").toLowerCase();

  const filtered = allPermSets.filter(ps => {
    const label = (ps.Label || ps.Name || "").toLowerCase();
    const profileName = (ps.Profile?.Name || "").toLowerCase();
    return label.includes(query) || profileName.includes(query);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:30px;">No matching Profiles or Permission Sets.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(ps => {
    const isProfile = ps.IsOwnedByProfile;
    const displayName = isProfile ? `${ps.Profile?.Name || ps.Label}` : ps.Label;
    const typeBadge = isProfile
      ? `<span style="font-size:10px; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-weight:700;">PROFILE</span>`
      : `<span style="font-size:10px; background:#fef3c7; color:#b45309; padding:2px 6px; border-radius:4px; font-weight:700;">PERMISSION SET</span>`;

    const state = flsSelections[ps.Id] || { read: false, edit: false };

    return `
      <tr data-id="${ps.Id}">
        <td><strong>${escapeHtml(displayName)}</strong><br><code style="font-size:10px; color:#6b7280;">${escapeHtml(ps.Name)}</code></td>
        <td>${typeBadge}</td>
        <td style="text-align:center;">
          <input type="checkbox" class="chk-read" data-id="${ps.Id}" ${state.read ? 'checked' : ''}>
        </td>
        <td style="text-align:center;">
          <input type="checkbox" class="chk-edit" data-id="${ps.Id}" ${state.edit ? 'checked' : ''}>
        </td>
      </tr>
    `;
  }).join("");

  // Bind change handlers
  tbody.querySelectorAll(".chk-read").forEach(chk => {
    chk.addEventListener("change", (e) => {
      const psId = e.target.dataset.id;
      if (!flsSelections[psId]) flsSelections[psId] = { read: false, edit: false };
      flsSelections[psId].read = e.target.checked;
      if (!e.target.checked) {
        flsSelections[psId].edit = false;
        const editChk = tbody.querySelector(`.chk-edit[data-id="${psId}"]`);
        if (editChk) editChk.checked = false;
      }
      updateSelectedCount();
    });
  });

  tbody.querySelectorAll(".chk-edit").forEach(chk => {
    chk.addEventListener("change", (e) => {
      const psId = e.target.dataset.id;
      if (!flsSelections[psId]) flsSelections[psId] = { read: false, edit: false };
      flsSelections[psId].edit = e.target.checked;
      if (e.target.checked) {
        flsSelections[psId].read = true;
        const readChk = tbody.querySelector(`.chk-read[data-id="${psId}"]`);
        if (readChk) readChk.checked = true;
      }
      updateSelectedCount();
    });
  });
}

function updateSelectedCount() {
  const selectedCount = Object.values(flsSelections).filter(s => s.read).length;
  const countEl = document.getElementById("fls-selected-count");
  if (countEl) countEl.textContent = selectedCount;
}

// ─── Event Setup ────────────────────────────────────────────────────
function setupEvents() {
  // Main Mode Switcher
  document.querySelectorAll("#fm-main-mode-tabs .tool-tab").forEach(tab => {
    tab.addEventListener("click", () => switchMode(tab.dataset.mode));
  });

  // Category filter pills
  document.querySelectorAll(".btn-cat-filter").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-cat-filter").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFieldCategory = btn.dataset.cat;
      displayedFieldCount = 40;
      renderExistingFieldsList(false);
    });
  });

  // View 1 Events (Edit Existing)
  document.getElementById("btn-load-obj-fields")?.addEventListener("click", () => {
    const objName = document.getElementById("existing-obj-input").value.trim();
    if (objName) loadExistingObjectFields(objName);
  });
  document.getElementById("existing-obj-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const objName = e.target.value.trim();
      if (objName) loadExistingObjectFields(objName);
    }
  });

  document.getElementById("existing-fields-filter")?.addEventListener("input", () => {
    displayedFieldCount = 40;
    renderExistingFieldsList(false);
  });

  document.getElementById("existing-fls-search")?.addEventListener("input", () => {
    displayedFlsCount = 40;
    renderExistingFlsTable(false);
  });

  // Infinite Scroll Listener for Fields Table
  const fieldsTableEl = document.getElementById("table-existing-fields");
  const fieldContainer = fieldsTableEl ? fieldsTableEl.closest(".table-container") : null;
  fieldContainer?.addEventListener("scroll", () => {
    if (fieldContainer.scrollTop + fieldContainer.clientHeight >= fieldContainer.scrollHeight - 60) {
      const filtered = getFilteredFields();
      if (displayedFieldCount < filtered.length) {
        displayedFieldCount += 40;
        renderExistingFieldsList(true);
      }
    }
  });

  // Infinite Scroll Listener for FLS Table
  const flsTableEl = document.getElementById("existing-fls-table");
  const flsContainer = flsTableEl ? flsTableEl.closest(".table-container") : null;
  flsContainer?.addEventListener("scroll", () => {
    if (flsContainer.scrollTop + flsContainer.clientHeight >= flsContainer.scrollHeight - 60) {
      const filtered = getFilteredPermSets();
      if (displayedFlsCount < filtered.length) {
        displayedFlsCount += 40;
        renderExistingFlsTable(true);
      }
    }
  });

  document.getElementById("btn-fls-all-edit")?.addEventListener("click", () => {
    allPermSets.forEach(ps => {
      if (!existingFlsMap[ps.Id]) existingFlsMap[ps.Id] = { id: null, read: false, edit: false };
      existingFlsMap[ps.Id].read = true;
      existingFlsMap[ps.Id].edit = true;
    });
    renderExistingFlsTable(false);
    updateExistingFlsCount();
  });

  document.getElementById("btn-fls-all-read")?.addEventListener("click", () => {
    allPermSets.forEach(ps => {
      if (!existingFlsMap[ps.Id]) existingFlsMap[ps.Id] = { id: null, read: false, edit: false };
      existingFlsMap[ps.Id].read = true;
      existingFlsMap[ps.Id].edit = false;
    });
    renderExistingFlsTable(false);
    updateExistingFlsCount();
  });

  document.getElementById("btn-fls-clear")?.addEventListener("click", () => {
    allPermSets.forEach(ps => {
      if (!existingFlsMap[ps.Id]) existingFlsMap[ps.Id] = { id: null, read: false, edit: false };
      existingFlsMap[ps.Id].read = false;
      existingFlsMap[ps.Id].edit = false;
    });
    renderExistingFlsTable(false);
    updateExistingFlsCount();
  });

  document.getElementById("btn-save-existing-field")?.addEventListener("click", saveExistingFieldMetadata);
  document.getElementById("btn-delete-field")?.addEventListener("click", deleteSelectedField);
  document.getElementById("btn-save-fls")?.addEventListener("click", saveExistingFieldFls);

  // View 2 Events (Create New Field)
  const fieldTypeSelect = document.getElementById("field-type");
  fieldTypeSelect?.addEventListener("change", (e) => {
    const t = e.target.value;
    const optLength = document.getElementById("opt-text-length");
    const optNum = document.getElementById("opt-number-spec");
    const optPick = document.getElementById("opt-picklist-values");

    if (optLength) optLength.style.display = (t === "Text" || t === "Url") ? "block" : "none";
    if (optNum) optNum.style.display = (t === "Number" || t === "Currency" || t === "Percent") ? "grid" : "none";
    if (optPick) optPick.style.display = (t === "Picklist") ? "block" : "none";
  });

  document.getElementById("fls-all-edit")?.addEventListener("click", () => {
    allPermSets.forEach(ps => flsSelections[ps.Id] = { read: true, edit: true });
    renderFlsTable();
    updateSelectedCount();
  });

  document.getElementById("fls-all-read")?.addEventListener("click", () => {
    allPermSets.forEach(ps => flsSelections[ps.Id] = { read: true, edit: false });
    renderFlsTable();
    updateSelectedCount();
  });

  document.getElementById("fls-admins-only")?.addEventListener("click", () => {
    allPermSets.forEach(ps => {
      const isAdmin = (ps.Profile?.Name || ps.Name || "").toLowerCase().includes("admin");
      flsSelections[ps.Id] = { read: isAdmin, edit: isAdmin };
    });
    renderFlsTable();
    updateSelectedCount();
  });

  document.getElementById("fls-clear")?.addEventListener("click", () => {
    allPermSets.forEach(ps => flsSelections[ps.Id] = { read: false, edit: false });
    renderFlsTable();
    updateSelectedCount();
  });

  document.getElementById("fls-search")?.addEventListener("input", renderFlsTable);

  document.getElementById("field-label")?.addEventListener("input", (e) => {
    const apiInput = document.getElementById("field-api");
    if (apiInput && !apiInput.dataset.manual) {
      apiInput.value = e.target.value
        .trim()
        .replace(/[^a-zA-Z0-9]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
    }
  });

  document.getElementById("field-api")?.addEventListener("input", (e) => {
    e.target.dataset.manual = "true";
  });

  document.getElementById("btn-toggle-payloads")?.addEventListener("click", () => {
    const el = document.getElementById("payloads-inspector");
    if (el) el.style.display = el.style.display === "none" ? "block" : "none";
  });

  document.getElementById("btn-create-field")?.addEventListener("click", executeCreateField);
}

// ─── Execute Field Creation (CRUD: CREATE) ───────────────────────────
async function executeCreateField() {
  const targetObj = document.getElementById("target-obj").value.trim();
  const label = document.getElementById("field-label").value.trim();
  let api = document.getElementById("field-api").value.trim().replace(/__c$/, "");
  const type = document.getElementById("field-type").value;
  const helpText = document.getElementById("field-help").value.trim();
  const isRequired = document.getElementById("chk-required").checked;
  const isUnique = document.getElementById("chk-unique").checked;
  const isExternalId = document.getElementById("chk-external-id").checked;

  const output = document.getElementById("creation-output");

  if (!targetObj || !label || !api) {
    alert("Please provide target object, label, and API name.");
    return;
  }

  const fullName = `${targetObj}.${api}__c`;
  output.textContent = `🚀 Starting deployment for CustomField ${fullName}...\n`;

  const metadata = {
    label,
    type,
    required: isRequired,
    unique: isUnique,
    externalId: isExternalId,
    description: helpText || undefined,
    inlineHelpText: helpText || undefined
  };

  if (type === "Text" || type === "EncryptedText") {
    let len = parseInt(document.getElementById("text-length")?.value) || 255;
    if (len > 255) {
      alert(`⚠️ Notice: Salesforce standard Text fields support a maximum length of 255 characters.\n\nYour length of ${len} has been automatically adjusted to 255.`);
      len = 255;
      const tInput = document.getElementById("text-length");
      if (tInput) tInput.value = 255;
    }
    metadata.length = len;
  } else if (type === "Number" || type === "Currency" || type === "Percent") {
    metadata.precision = parseInt(document.getElementById("num-precision")?.value) || 18;
    metadata.scale = parseInt(document.getElementById("num-scale")?.value) || 0;
  } else if (type === "Checkbox") {
    metadata.defaultValue = false;
  } else if (type === "LongTextArea" || type === "Html") {
    metadata.length = 32768;
    metadata.visibleLines = type === "Html" ? 25 : 3;
  } else if (type === "Picklist") {
    const rawLines = document.getElementById("picklist-lines").value.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (rawLines.length === 0) {
      alert("Please provide at least one picklist value (one per line).");
      return;
    }
    const valueSetDefinition = {
      sorted: false,
      value: rawLines.map((v, idx) => ({
        fullName: v.trim(),
        default: idx === 0,
        label: v.trim()
      }))
    };
    metadata.valueSet = { valueSetDefinition };
  }

  const requestBody = {
    FullName: fullName,
    Metadata: metadata
  };

  try {
    const res = await sfConn.tooling(`/sobjects/CustomField`, {
      method: "POST",
      body: requestBody
    });

    output.textContent += `✓ [1/2] CustomField created successfully!\n  Field ID: ${res.id}\n  FullName: ${fullName}\n\n`;

    const successCard = document.getElementById("success-visual-card");
    if (successCard) {
      successCard.style.display = "block";
      const setupLink = document.getElementById("link-open-field-setup");
      if (setupLink) setupLink.href = `https://${sfHost}/lightning/setup/ObjectManager/${targetObj}/FieldsAndRelationships/view`;
      const schemaLink = document.getElementById("link-open-schema-viewer");
      if (schemaLink) schemaLink.href = chrome.runtime.getURL(`schema-viewer.html?host=${sfHost}`);
    }

    const reqView = document.getElementById("request-payload-view");
    const resView = document.getElementById("response-payload-view");
    if (reqView) reqView.textContent = JSON.stringify(requestBody, null, 2);
    if (resView) resView.textContent = JSON.stringify(res, null, 2);

    const selectedFls = Object.entries(flsSelections).filter(([, s]) => s.read);

    if (selectedFls.length > 0) {
      output.textContent += `Applying Field Visibility (FLS) to ${selectedFls.length} Profiles & Permission Sets...\n`;

      const permRecords = selectedFls.map(([psId, s]) => ({
        attributes: { type: "FieldPermissions" },
        ParentId: psId,
        SobjectType: targetObj,
        Field: fullName,
        PermissionsRead: true,
        PermissionsEdit: s.edit
      }));

      for (let i = 0; i < permRecords.length; i += 200) {
        const batch = permRecords.slice(i, i + 200);
        await sfConn.rest(`/services/data/v${apiVersion}/composite/sobjects`, {
          method: "POST",
          body: { allOrNone: false, records: batch }
        });
      }
      output.textContent += `✓ [2/2] FLS applied successfully across selected Profiles and Permission Sets!\n`;
    }

    output.textContent += `\n🎉 All operations complete! Field is live and accessible.`;

  } catch (err) {
    output.textContent += `\n❌ Deployment Failed: ${err.message}\n`;
    const resView = document.getElementById("response-payload-view");
    if (resView) resView.textContent = err.message;
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

init();
