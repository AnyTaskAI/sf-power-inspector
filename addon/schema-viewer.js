import { sfConn, apiVersion, updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";

const sfHost = resolveSfHost();
let allSObjects = [];
let currentDescribe = null;
let selectedFieldsForSoql = new Set(["Id"]);
let currentFilter = "all";

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

  setupEvents();
  loadSObjects();
}

async function loadSObjects() {
  try {
    const res = await sfConn.getSObjects();
    allSObjects = res.sobjects || [];
    allSObjects.sort((a, b) => a.label.localeCompare(b.label));

    document.getElementById("count-all").textContent = allSObjects.length;
    renderObjectsList();

    // Auto-select requested object from URL params or default to Account
    const params = new URLSearchParams(window.location.search);
    const targetObj = params.get("sobject") || params.get("obj");
    const defaultObj = (targetObj && allSObjects.find(o => o.name.toLowerCase() === targetObj.toLowerCase())) || allSObjects.find(o => o.name === "Account") || allSObjects[0];
    if (defaultObj) {
      loadObjectDescribe(defaultObj.name);
    }
  } catch (e) {
    document.getElementById("objects-list").innerHTML = `<li style="padding:20px; color:#dc2626;">Failed to load SObjects: ${e.message}</li>`;
  }
}

function renderObjectsList() {
  const list = document.getElementById("objects-list");
  const search = document.getElementById("obj-search").value.toLowerCase();

  const filtered = allSObjects.filter(o => {
    if (currentFilter === "standard" && o.custom) return false;
    if (currentFilter === "custom" && !o.custom) return false;
    return o.name.toLowerCase().includes(search) || o.label.toLowerCase().includes(search);
  });

  if (filtered.length === 0) {
    list.innerHTML = `<li style="padding:20px; text-align:center; color:#6b7280;">No matching objects.</li>`;
    return;
  }

  list.innerHTML = filtered.map(o => {
    const isSelected = currentDescribe?.name === o.name;
    const activeStyle = isSelected ? "background:#eef4ff; border-left: 3px solid #0176d3;" : "";

    return `
      <li class="obj-item" data-name="${o.name}" style="padding: 8px 12px; border-bottom: 1px solid #f1f5f9; cursor: pointer; display: flex; justify-content: space-between; align-items: center; ${activeStyle}">
        <div style="overflow:hidden;">
          <strong style="font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block;">${o.label}</strong>
          <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);">${o.name}</span>
        </div>
        <div>
          ${o.custom ? '<span style="font-size:9px; background:#fef3c7; color:#b45309; padding:1px 4px; border-radius:3px; font-weight:700;">CUSTOM</span>' : ''}
          ${o.keyPrefix ? `<span style="font-size:9px; background:#f1f5f9; color:#475569; padding:1px 4px; border-radius:3px; font-family:monospace;">${o.keyPrefix}</span>` : ''}
        </div>
      </li>
    `;
  }).join("");

  list.querySelectorAll(".obj-item").forEach(item => {
    item.addEventListener("click", () => {
      loadObjectDescribe(item.dataset.name);
    });
  });
}

async function loadObjectDescribe(objName) {
  const fieldsBody = document.getElementById("fields-body");
  fieldsBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px;">Fetching metadata schema for <strong>${objName}</strong>...</td></tr>`;

  try {
    currentDescribe = await sfConn.metadata(objName);
    selectedFieldsForSoql = new Set(["Id"]);

    // Update Banner
    document.getElementById("obj-title").textContent = currentDescribe.label;
    document.getElementById("obj-api-badge").textContent = currentDescribe.name;
    document.getElementById("obj-prefix-badge").textContent = `Prefix: ${currentDescribe.keyPrefix || "None"}`;

    const flags = [];
    if (currentDescribe.queryable) flags.push("Queryable");
    if (currentDescribe.createable) flags.push("Createable");
    if (currentDescribe.updateable) flags.push("Updateable");
    if (currentDescribe.deletable) flags.push("Deletable");
    if (currentDescribe.customSetting) flags.push("Custom Setting");
    if (currentDescribe.feedEnabled) flags.push("Feed Enabled");
    document.getElementById("obj-flags").textContent = `Capabilities: ${flags.join(" • ")}`;

    document.getElementById("field-count").textContent = currentDescribe.fields.length;
    document.getElementById("rel-count").textContent = (currentDescribe.childRelationships?.length || 0);

    // Setup Link
    const setupBtn = document.getElementById("btn-open-object-manager");
    setupBtn.style.display = "inline-flex";
    setupBtn.onclick = () => {
      window.open(`https://${sfHost}/lightning/setup/ObjectManager/${currentDescribe.name}/Details/view`, "_blank");
    };

    renderFieldsTable();
    renderRelationships();
    renderVisualErd();
    updateSoqlOutput();
    renderObjectsList(); // refresh active highlight
  } catch (e) {
    fieldsBody.innerHTML = `<tr><td colspan="6" style="color:red; text-align: center; padding: 20px;">Failed to describe ${objName}: ${e.message}</td></tr>`;
  }
}

function renderFieldsTable() {
  if (!currentDescribe?.fields) return;

  const tbody = document.getElementById("fields-body");
  const search = document.getElementById("field-search").value.toLowerCase();
  const typeFilter = document.getElementById("field-type-filter").value;

  const filtered = currentDescribe.fields.filter(f => {
    if (typeFilter === "custom" && !f.custom) return false;
    if (typeFilter === "required" && f.nillable !== false) return false;
    if (typeFilter === "reference" && f.type !== "reference") return false;
    if (typeFilter === "picklist" && f.type !== "picklist" && f.type !== "multipicklist") return false;
    if (typeFilter === "calculated" && !f.calculated) return false;

    return f.name.toLowerCase().includes(search) || f.label.toLowerCase().includes(search);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px;">No fields match current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(f => {
    const isChecked = selectedFieldsForSoql.has(f.name);

    // Badges & details
    let detailsHtml = "";
    if (f.type === "reference" && f.referenceTo?.length > 0) {
      detailsHtml = f.referenceTo.map(target => `
        <span class="jump-target" data-target="${target}" style="cursor:pointer; color:#0176d3; font-weight:600; text-decoration:underline;">
          ↗ ${target}
        </span>
      `).join(", ");
    } else if (f.calculated && f.calculatedFormula) {
      detailsHtml = `<code style="font-size:11px; color:#475569;">${f.calculatedFormula}</code>`;
    } else if ((f.type === "picklist" || f.type === "multipicklist") && f.picklistValues?.length > 0) {
      const vals = f.picklistValues.slice(0, 4).map(p => p.label).join(", ");
      detailsHtml = `<span style="font-size:11px; color:#475569;">${vals}${f.picklistValues.length > 4 ? ` (+${f.picklistValues.length - 4} more)` : ''}</span>`;
    } else {
      detailsHtml = `<span style="color:#9ca3af; font-size:11px;">—</span>`;
    }

    const flags = [];
    if (f.custom) flags.push("Custom");
    if (f.nillable === false) flags.push("Required");
    if (f.unique) flags.push("Unique");
    if (f.externalId) flags.push("ExtId");

    let typeColor = "#e0f2fe";
    let typeTextColor = "#0369a1";
    if (f.type === "reference") { typeColor = "#fef3c7"; typeTextColor = "#b45309"; }
    if (f.calculated) { typeColor = "#f3e8ff"; typeTextColor = "#7e22ce"; }

    return `
      <tr>
        <td style="text-align:center;">
          <input type="checkbox" class="field-soql-chk" data-name="${f.name}" ${isChecked ? 'checked' : ''}>
        </td>
        <td><strong>${f.label}</strong></td>
        <td><code>${f.name}</code></td>
        <td>
          <span style="font-size:11px; background:${typeColor}; color:${typeTextColor}; padding:2px 6px; border-radius:4px; font-weight:600;">
            ${f.type}${f.length ? ` (${f.length})` : ''}
          </span>
        </td>
        <td>${detailsHtml}</td>
        <td style="font-size:11px; color:#475569;">${flags.join(", ")}</td>
      </tr>
    `;
  }).join("");

  // Jump to parent lookup handlers
  tbody.querySelectorAll(".jump-target").forEach(el => {
    el.addEventListener("click", () => {
      loadObjectDescribe(el.dataset.target);
    });
  });

  // Checkbox handlers for SOQL builder
  tbody.querySelectorAll(".field-soql-chk").forEach(chk => {
    chk.addEventListener("change", (e) => {
      const fieldName = e.target.dataset.name;
      if (e.target.checked) selectedFieldsForSoql.add(fieldName);
      else selectedFieldsForSoql.delete(fieldName);
      updateSoqlOutput();
    });
  });
}

function renderRelationships() {
  if (!currentDescribe) return;

  // 1. Parent Lookups
  const parentTbody = document.getElementById("parent-lookups-body");
  const lookups = currentDescribe.fields.filter(f => f.type === "reference" && f.referenceTo?.length > 0);

  if (lookups.length === 0) {
    parentTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:16px; color:#6b7280;">No parent lookups on this object.</td></tr>`;
  } else {
    parentTbody.innerHTML = lookups.map(l => `
      <tr>
        <td><code>${l.name}</code></td>
        <td>
          ${l.referenceTo.map(target => `
            <button class="btn btn-secondary jump-obj-btn" data-target="${target}" style="padding:2px 8px; font-size:11px;">
              🔗 ${target}
            </button>
          `).join(" ")}
        </td>
        <td><code>${l.relationshipName || "-"}</code></td>
      </tr>
    `).join("");
  }

  // 2. Child Relationships
  const childTbody = document.getElementById("child-relationships-body");
  const childRels = currentDescribe.childRelationships || [];

  if (childRels.length === 0) {
    childTbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:16px; color:#6b7280;">No child relationships found.</td></tr>`;
  } else {
    childTbody.innerHTML = childRels.map(c => `
      <tr>
        <td>
          <button class="btn btn-secondary jump-obj-btn" data-target="${c.childSObject}" style="padding:2px 8px; font-size:11px;">
            🔗 ${c.childSObject}
          </button>
        </td>
        <td><code>${c.field}</code></td>
        <td><code>${c.relationshipName || "-"}</code></td>
        <td>${c.cascadeDelete ? '<span style="color:#dc2626; font-weight:700;">Yes</span>' : 'No'}</td>
      </tr>
    `).join("");
  }

  document.querySelectorAll(".jump-obj-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      loadObjectDescribe(btn.dataset.target);
    });
  });

  // Raw JSON
  document.getElementById("raw-json").textContent = JSON.stringify(currentDescribe, null, 2);
}

function renderVisualErd() {
  if (!currentDescribe) return;
  const canvas = document.getElementById("erd-canvas");

  const parentLookups = currentDescribe.fields.filter(f => f.type === "reference" && f.referenceTo?.length > 0);
  const childRels = (currentDescribe.childRelationships || []).slice(0, 6);

  const parentCards = parentLookups.slice(0, 4).map(l => `
    <div style="background:#fff; border:1px solid #cbd5e1; border-radius:6px; padding:10px; width:160px; box-shadow:0 1px 3px rgba(0,0,0,0.05); text-align:left;">
      <div style="font-size:10px; color:#b45309; font-weight:700;">PARENT OBJECT</div>
      <strong style="font-size:12px; color:#0176d3;">${l.referenceTo[0]}</strong>
      <div style="font-size:10px; color:#6b7280; margin-top:4px;">FK: ${l.name}</div>
    </div>
  `).join("");

  const childCards = childRels.map(c => `
    <div style="background:#fff; border:1px solid #cbd5e1; border-radius:6px; padding:10px; width:160px; box-shadow:0 1px 3px rgba(0,0,0,0.05); text-align:left;">
      <div style="font-size:10px; color:#15803d; font-weight:700;">CHILD RELATIONSHIP</div>
      <strong style="font-size:12px; color:#0176d3;">${c.childSObject}</strong>
      <div style="font-size:10px; color:#6b7280; margin-top:4px;">Via: ${c.field}</div>
    </div>
  `).join("");

  canvas.innerHTML = `
    <!-- Parents Column -->
    <div style="display:flex; flex-direction:column; gap:12px;">
      <div style="font-size:11px; font-weight:700; color:#b45309;">Parents (Lookups To)</div>
      ${parentCards || '<div style="font-size:11px; color:#9ca3af;">No Parent Lookups</div>'}
    </div>

    <!-- Center Active Node -->
    <div style="background:#0176d3; color:#fff; border-radius:10px; padding:20px; width:220px; box-shadow:0 4px 12px rgba(1,118,211,0.25); text-align:center;">
      <div style="font-size:11px; text-transform:uppercase; opacity:0.9; font-weight:600;">Active SObject</div>
      <div style="font-size:18px; font-weight:800; margin: 6px 0;">${currentDescribe.label}</div>
      <code style="font-size:12px; opacity:0.95;">${currentDescribe.name}</code>
      <div style="margin-top:10px; font-size:11px; background:rgba(255,255,255,0.2); padding:4px 8px; border-radius:4px;">
        ${currentDescribe.fields.length} Fields • ${currentDescribe.childRelationships?.length || 0} Children
      </div>
    </div>

    <!-- Children Column -->
    <div style="display:flex; flex-direction:column; gap:12px;">
      <div style="font-size:11px; font-weight:700; color:#15803d;">Children (Related Lists)</div>
      ${childCards || '<div style="font-size:11px; color:#9ca3af;">No Child Relationships</div>'}
    </div>
  `;
}

function updateSoqlOutput() {
  if (!currentDescribe) return;
  const fields = Array.from(selectedFieldsForSoql);
  const fieldsStr = fields.length > 0 ? fields.join(", ") : "Id";
  const soql = `SELECT ${fieldsStr} FROM ${currentDescribe.name} LIMIT 50`;
  document.getElementById("soql-output").value = soql;
}

function setupEvents() {
  // SObject palette search
  document.getElementById("obj-search").addEventListener("input", renderObjectsList);

  // SObject filter tabs
  document.querySelectorAll(".filter-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = tab.dataset.filter;
      renderObjectsList();
    });
  });

  // Main tabs
  document.querySelectorAll("#schema-tabs .tool-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#schema-tabs .tool-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab;
      document.getElementById("tab-view-fields").style.display = target === "fields" ? "flex" : "none";
      document.getElementById("tab-view-relationships").style.display = target === "relationships" ? "block" : "none";
      document.getElementById("tab-view-erd").style.display = target === "erd" ? "block" : "none";
      document.getElementById("tab-view-raw").style.display = target === "raw" ? "block" : "none";
    });
  });

  // Field search and type filter
  document.getElementById("field-search").addEventListener("input", renderFieldsTable);
  document.getElementById("field-type-filter").addEventListener("change", renderFieldsTable);

  // Select all fields for SOQL
  document.getElementById("btn-select-all-fields").addEventListener("click", () => {
    if (!currentDescribe?.fields) return;
    currentDescribe.fields.forEach(f => selectedFieldsForSoql.add(f.name));
    renderFieldsTable();
    updateSoqlOutput();
  });

  // Toggle all visible fields
  document.getElementById("chk-toggle-all-fields").addEventListener("change", (e) => {
    if (!currentDescribe?.fields) return;
    if (e.target.checked) {
      currentDescribe.fields.forEach(f => selectedFieldsForSoql.add(f.name));
    } else {
      selectedFieldsForSoql.clear();
      selectedFieldsForSoql.add("Id");
    }
    renderFieldsTable();
    updateSoqlOutput();
  });

  // Copy SOQL
  document.getElementById("btn-copy-soql").addEventListener("click", () => {
    const val = document.getElementById("soql-output").value;
    navigator.clipboard.writeText(val);
    alert("SOQL Query copied to clipboard!");
  });

  // Open in Data Explorer
  document.getElementById("btn-open-in-explorer").addEventListener("click", () => {
    const val = document.getElementById("soql-output").value;
    localStorage.setItem("sfpi_prefill_query", val);
    const url = chrome.runtime.getURL(`data-explorer.html?host=${sfHost}`);
    window.open(url, "_blank");
  });

  // Export Data Dictionary CSV
  document.getElementById("btn-export-csv").addEventListener("click", () => {
    if (!currentDescribe?.fields) return;
    const headers = ["Label", "API Name", "Type", "Length", "Formula", "Custom", "Required", "Unique", "ExternalId", "ReferenceTo"];
    const rows = [headers.join(",")];
    for (const f of currentDescribe.fields) {
      rows.push([
        `"${(f.label || "").replace(/"/g, '""')}"`,
        `"${f.name}"`,
        `"${f.type}"`,
        f.length || "",
        `"${(f.calculatedFormula || "").replace(/"/g, '""')}"`,
        f.custom,
        !f.nillable,
        f.unique,
        f.externalId,
        `"${(f.referenceTo || []).join(";")}"`
      ].join(","));
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentDescribe.name}-Data-Dictionary.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

init();
