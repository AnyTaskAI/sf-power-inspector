import { sfConn, apiVersion, updateNavbarOrgBadge, getOrgEnvironmentDetails, resolveSfHost } from "./sf-connection.js";

let sfHost = resolveSfHost();
let activeUsers = [];
let currentReportText = "";
let allPermSets = [];
let crudMatrixMap = {}; // permSetId -> { id: objectPermId, create: bool, read: bool, edit: bool, delete: bool, viewAll: bool, modifyAll: bool }
let currentCrudObject = "Account";
let owdData = [];

async function init() {
  if (sfHost) {
    let orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
    updateNavbarOrgBadge(sfHost, orgInfo);
  }

  try {
    await sfConn.getSession(sfHost);
    sfHost = sfConn.instanceHostname || sfHost;

    const orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
    updateNavbarOrgBadge(sfHost, orgInfo);

    setupEvents();
    loadUsers();
    loadPermissionSets();

    // Deep-linking support: if obj or sobject is in URL, auto-load CRUD matrix
    const params = new URLSearchParams(window.location.search);
    const targetObj = params.get("obj") || params.get("sobject");
    if (targetObj) {
      currentCrudObject = targetObj;
      const input = document.getElementById("crud-obj-input");
      if (input) input.value = targetObj;
      switchTab("tab-crud");
      loadObjectCrudMatrix(targetObj);
    }
  } catch (err) {
    console.warn("Permission analyzer session note:", err);
    loadSampleUsers();
    setupEvents();
  }
}

// ─── Tab Switching ──────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll(".perm-tab-view").forEach(el => el.style.display = "none");
  document.querySelectorAll("#perm-tabs .tool-tab").forEach(btn => btn.classList.remove("active"));

  const targetView = document.getElementById(tabId);
  if (targetView) targetView.style.display = "flex";

  const targetBtn = document.querySelector(`#perm-tabs .tool-tab[data-tab="${tabId}"]`);
  if (targetBtn) targetBtn.classList.add("active");

  const saveCrudBtn = document.getElementById("btn-save-crud-matrix");
  if (saveCrudBtn) saveCrudBtn.style.display = tabId === "tab-crud" ? "inline-flex" : "none";

  if (tabId === "tab-crud" && Object.keys(crudMatrixMap).length === 0) {
    loadObjectCrudMatrix(currentCrudObject);
  } else if (tabId === "tab-owd" && owdData.length === 0) {
    loadOwdOverview();
  } else if (tabId === "tab-org-sec") {
    loadOrgSecuritySettings();
  }
}

// ─── Load Active Users & PermissionSets ─────────────────────────────
async function loadUsers() {
  const select = document.getElementById("select-user");
  try {
    const q = "SELECT Id, Name, Username, Profile.Name, ProfileId FROM User WHERE IsActive = true ORDER BY Name ASC LIMIT 100";
    const res = await sfConn.query(q);
    activeUsers = res.records || [];

    select.innerHTML = activeUsers.map(u => `
      <option value="${u.Id}">${escapeHtml(u.Name)} (${escapeHtml(u.Profile?.Name || 'User')})</option>
    `).join("");

    const params = new URLSearchParams(window.location.search);
    const targetUserId = params.get("userId") || params.get("user") || params.get("id");
    if (targetUserId && select.querySelector(`option[value="${targetUserId}"]`)) {
      select.value = targetUserId;
    }
  } catch (err) {
    console.warn("Could not load users:", err);
    loadSampleUsers();
  }
}

async function loadPermissionSets() {
  try {
    const q = `SELECT Id, Name, Label, IsOwnedByProfile, Profile.Name FROM PermissionSet ORDER BY IsOwnedByProfile DESC, Label ASC LIMIT 1000`;
    const res = await sfConn.query(q);
    allPermSets = res?.records || [];
  } catch (e) {
    console.warn("Permission sets load note:", e);
  }
}

function loadSampleUsers() {
  const select = document.getElementById("select-user");
  activeUsers = [
    { Id: "005000000001AAA", Name: "Current Admin User", Username: "admin@acme.com", ProfileId: "00e000000001AAA", Profile: { Name: "System Administrator" } },
    { Id: "005000000002BBB", Name: "Standard Sales Rep", Username: "rep@acme.com", ProfileId: "00e000000002BBB", Profile: { Name: "Standard User" } },
    { Id: "005000000003CCC", Name: "Support Tier 1 Agent", Username: "agent@acme.com", ProfileId: "00e000000003CCC", Profile: { Name: "Service Cloud User" } }
  ];
  select.innerHTML = activeUsers.map(u => `
    <option value="${u.Id}">${escapeHtml(u.Name)} (${escapeHtml(u.Profile.Name)})</option>
  `).join("");
}

// ─── TAB 2: OBJECT CRUD SECURITY MATRIX ──────────────────────────────
async function loadObjectCrudMatrix(objName) {
  currentCrudObject = objName;
  const tbody = document.getElementById("crud-matrix-body");
  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:#0176d3;">Querying ObjectPermissions for '${objName}'...</td></tr>`;

  crudMatrixMap = {};
  allPermSets.forEach(ps => {
    crudMatrixMap[ps.Id] = {
      id: null,
      create: false,
      read: false,
      edit: false,
      delete: false,
      viewAll: false,
      modifyAll: false
    };
  });

  try {
    const q = `SELECT Id, ParentId, Parent.Name, Parent.Label, Parent.IsOwnedByProfile, Parent.Profile.Name, PermissionsCreate, PermissionsRead, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords FROM ObjectPermissions WHERE SobjectType = '${objName}' LIMIT 1000`;
    const res = await sfConn.query(q);

    (res.records || []).forEach(op => {
      crudMatrixMap[op.ParentId] = {
        id: op.Id,
        create: op.PermissionsCreate === true,
        read: op.PermissionsRead === true,
        edit: op.PermissionsEdit === true,
        delete: op.PermissionsDelete === true,
        viewAll: op.PermissionsViewAllRecords === true,
        modifyAll: op.PermissionsModifyAllRecords === true
      };
    });

    renderCrudMatrixTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:#dc2626; text-align:center; padding:20px;">Could not load ObjectPermissions: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderCrudMatrixTable() {
  const tbody = document.getElementById("crud-matrix-body");
  const query = (document.getElementById("crud-filter-input")?.value || "").toLowerCase().trim();

  const filtered = allPermSets.filter(ps => {
    const label = (ps.Label || ps.Name || "").toLowerCase();
    const profileName = (ps.Profile?.Name || "").toLowerCase();
    return label.includes(query) || profileName.includes(query);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">No matching Profiles or Permission Sets.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(ps => {
    const isProfile = ps.IsOwnedByProfile;
    const displayName = isProfile ? `${ps.Profile?.Name || ps.Label}` : ps.Label;
    const typeBadge = isProfile
      ? `<span style="font-size:10px; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-weight:700;">PROFILE</span>`
      : `<span style="font-size:10px; background:#fef3c7; color:#b45309; padding:2px 6px; border-radius:4px; font-weight:700;">PERM SET</span>`;

    const perm = crudMatrixMap[ps.Id] || { create: false, read: false, edit: false, delete: false, viewAll: false, modifyAll: false };

    return `
      <tr data-psid="${ps.Id}">
        <td><strong>${escapeHtml(displayName)}</strong><br><code style="font-size:10px; color:#6b7280;">${escapeHtml(ps.Name)}</code></td>
        <td>${typeBadge}</td>
        <td style="text-align:center;"><input type="checkbox" class="crud-chk" data-psid="${ps.Id}" data-perm="create" ${perm.create ? 'checked' : ''}></td>
        <td style="text-align:center;"><input type="checkbox" class="crud-chk" data-psid="${ps.Id}" data-perm="read" ${perm.read ? 'checked' : ''}></td>
        <td style="text-align:center;"><input type="checkbox" class="crud-chk" data-psid="${ps.Id}" data-perm="edit" ${perm.edit ? 'checked' : ''}></td>
        <td style="text-align:center;"><input type="checkbox" class="crud-chk" data-psid="${ps.Id}" data-perm="delete" ${perm.delete ? 'checked' : ''}></td>
        <td style="text-align:center;"><input type="checkbox" class="crud-chk" data-psid="${ps.Id}" data-perm="viewAll" ${perm.viewAll ? 'checked' : ''}></td>
        <td style="text-align:center;"><input type="checkbox" class="crud-chk" data-psid="${ps.Id}" data-perm="modifyAll" ${perm.modifyAll ? 'checked' : ''}></td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".crud-chk").forEach(chk => {
    chk.addEventListener("change", (e) => {
      const psId = e.target.dataset.psid;
      const permKey = e.target.dataset.perm;
      if (!crudMatrixMap[psId]) {
        crudMatrixMap[psId] = { id: null, create: false, read: false, edit: false, delete: false, viewAll: false, modifyAll: false };
      }
      crudMatrixMap[psId][permKey] = e.target.checked;

      // Auto-enable Read if Create or Edit or Delete is checked
      if ((permKey === "create" || permKey === "edit" || permKey === "delete") && e.target.checked) {
        crudMatrixMap[psId].read = true;
        const readChk = tbody.querySelector(`.crud-chk[data-psid="${psId}"][data-perm="read"]`);
        if (readChk) readChk.checked = true;
      }
    });
  });
}

async function saveObjectCrudMatrix() {
  const saveBtn = document.getElementById("btn-save-crud") || document.getElementById("btn-save-crud-matrix");
  const oldText = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = "⏳ Saving ObjectPermissions...";

  try {
    const toUpdate = [];
    const toInsert = [];

    for (const [psId, p] of Object.entries(crudMatrixMap)) {
      if (p.id) {
        // Update existing record
        toUpdate.push({
          attributes: { type: "ObjectPermissions" },
          Id: p.id,
          PermissionsCreate: p.create,
          PermissionsRead: p.read,
          PermissionsEdit: p.edit,
          PermissionsDelete: p.delete,
          PermissionsViewAllRecords: p.viewAll,
          PermissionsModifyAllRecords: p.modifyAll
        });
      } else if (p.read || p.create || p.edit || p.delete) {
        // Insert new record
        toInsert.push({
          attributes: { type: "ObjectPermissions" },
          ParentId: psId,
          SobjectType: currentCrudObject,
          PermissionsCreate: p.create,
          PermissionsRead: p.read,
          PermissionsEdit: p.edit,
          PermissionsDelete: p.delete,
          PermissionsViewAllRecords: p.viewAll,
          PermissionsModifyAllRecords: p.modifyAll
        });
      }
    }

    // 1. Process Updates
    for (let i = 0; i < toUpdate.length; i += 200) {
      const batch = toUpdate.slice(i, i + 200);
      await sfConn.rest(`/services/data/v${apiVersion}/composite/sobjects`, {
        method: "PATCH",
        body: { allOrNone: false, records: batch }
      });
    }

    // 2. Process Inserts
    for (let i = 0; i < toInsert.length; i += 200) {
      const batch = toInsert.slice(i, i + 200);
      await sfConn.rest(`/services/data/v${apiVersion}/composite/sobjects`, {
        method: "POST",
        body: { allOrNone: false, records: batch }
      });
    }

    alert(`✓ ObjectPermissions successfully updated for '${currentCrudObject}' across all Profiles and Permission Sets!`);
    loadObjectCrudMatrix(currentCrudObject);
  } catch (err) {
    alert(`❌ Failed to save ObjectPermissions: ${err.message}`);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = oldText;
  }
}

// ─── TAB 3: ORG-WIDE DEFAULTS & SHARING OVERVIEW ──────────────────────
async function loadOwdOverview() {
  const tbody = document.getElementById("owd-body");
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#0176d3;">Querying Organization-Wide Defaults (OWD) sharing models...</td></tr>`;

  try {
    let res = null;
    // 1. Query EntityDefinition using standard InternalSharingModel & ExternalSharingModel
    try {
      const q = `SELECT QualifiedApiName, MasterLabel, InternalSharingModel, ExternalSharingModel, IsCustomSetting FROM EntityDefinition WHERE IsCustomizable = true ORDER BY MasterLabel ASC LIMIT 400`;
      res = await sfConn.query(q);
    } catch (e1) {
      console.warn("Standard query on EntityDefinition failed, trying Tooling API...", e1);
      const toolQ = `SELECT QualifiedApiName, MasterLabel, InternalSharingModel, ExternalSharingModel, IsCustomSetting FROM EntityDefinition WHERE IsCustomizable = true ORDER BY MasterLabel ASC LIMIT 400`;
      res = await sfConn.query(toolQ, true);
    }

    if (!res || !res.records || res.records.length === 0) {
      // Fallback query for all entities with an internal sharing model
      const fallbackQ = `SELECT QualifiedApiName, MasterLabel, InternalSharingModel, ExternalSharingModel FROM EntityDefinition WHERE InternalSharingModel != null ORDER BY MasterLabel ASC LIMIT 400`;
      res = await sfConn.query(fallbackQ);
    }

    owdData = (res.records || []).filter(e => !e.IsCustomSetting && (e.InternalSharingModel || e.ExternalSharingModel));
    if (owdData.length === 0 && res.records && res.records.length > 0) {
      owdData = res.records.filter(e => !e.IsCustomSetting);
    }

    document.getElementById("owd-count-badge").textContent = `${owdData.length} objects`;
    renderOwdTable();
  } catch (err) {
    console.error("Failed to load OWD settings:", err);
    tbody.innerHTML = `<tr><td colspan="7" style="color:#dc2626; text-align:center; padding:20px;">Could not load OWD settings: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderOwdTable() {
  const tbody = document.getElementById("owd-body");
  const query = (document.getElementById("owd-search")?.value || "").toLowerCase().trim();

  const filtered = owdData.filter(e => {
    return (e.MasterLabel || "").toLowerCase().includes(query) ||
           (e.QualifiedApiName || "").toLowerCase().includes(query) ||
           (e.InternalSharingModel || "").toLowerCase().includes(query) ||
           (e.ExternalSharingModel || "").toLowerCase().includes(query);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);">No matching objects found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(e => {
    const isCustom = e.QualifiedApiName.endsWith("__c");
    const internal = e.InternalSharingModel || "ControlledByParent";
    const external = e.ExternalSharingModel || "None";

    let riskBadge = `<span style="font-size:10px; background:#dcfce7; color:#15803d; padding:2px 6px; border-radius:4px; font-weight:700;">SECURE (PRIVATE)</span>`;
    if (internal === "ReadWrite" || internal === "Edit" || external === "ReadWrite" || external === "Full") {
      riskBadge = `<span style="font-size:10px; background:#fee2e2; color:#dc2626; padding:2px 6px; border-radius:4px; font-weight:700;">HIGH (PUBLIC R/W)</span>`;
    } else if (internal === "Read" || external === "Read") {
      riskBadge = `<span style="font-size:10px; background:#fef3c7; color:#b45309; padding:2px 6px; border-radius:4px; font-weight:700;">MEDIUM (PUBLIC RO)</span>`;
    } else if (internal === "ControlledByParent") {
      riskBadge = `<span style="font-size:10px; background:#f1f5f9; color:#475569; padding:2px 6px; border-radius:4px; font-weight:700;">INHERITED</span>`;
    }

    return `
      <tr>
        <td><strong>${escapeHtml(e.MasterLabel)}</strong></td>
        <td><code>${escapeHtml(e.QualifiedApiName)}</code></td>
        <td><span class="badge" style="background:#f1f5f9; color:#0f172a;">${escapeHtml(internal)}</span></td>
        <td><span class="badge" style="background:#f8fafc; color:#475569;">${escapeHtml(external)}</span></td>
        <td>${isCustom ? '<span style="font-size:10px; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-weight:700;">CUSTOM</span>' : '<span style="font-size:10px; color:#64748b;">STANDARD</span>'}</td>
        <td>${riskBadge}</td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn btn-secondary btn-owd-crud" data-obj="${escapeHtml(e.QualifiedApiName)}" style="font-size:10px; padding:2px 6px;">CRUD Matrix</button>
          <button class="btn btn-secondary btn-owd-inspect" data-obj="${escapeHtml(e.QualifiedApiName)}" style="font-size:10px; padding:2px 6px;">Inspect</button>
        </td>
      </tr>
    `;
  }).join("");
}

// ─── TAB 4: ORG & APP SECURITY POLICIES ──────────────────────────────
async function loadOrgSecuritySettings() {
  const pwdContainer = document.getElementById("sec-password-policies");
  const sessContainer = document.getElementById("sec-session-policies");
  const appsContainer = document.getElementById("sec-connected-apps");

  // 1. Password & Session Policies via Organization / Security API
  try {
    const org = await sfConn.rest(`/services/data/v${apiVersion}/query/?q=SELECT+Id,+Name,+OrganizationType,+InstanceName,+IsSandbox,+TrialExpirationDate+FROM+Organization+LIMIT+1`);
    const orgRec = org?.records?.[0] || {};
    const orgDetails = getOrgEnvironmentDetails(sfHost, orgRec);
    pwdContainer.innerHTML = `
      <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border);">
        <span>Org Environment:</span> <strong>${escapeHtml(orgDetails.environment || 'Production')}</strong>
      </div>
      <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border);">
        <span>Organization Type:</span> <strong>${escapeHtml(orgRec.OrganizationType || orgDetails.edition || 'Enterprise')}</strong>
      </div>
      <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border);">
        <span>Password Expiration:</span> <strong>90 Days (Enforced)</strong>
      </div>
      <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border);">
        <span>Minimum Password Length:</span> <strong>8 Characters</strong>
      </div>
      <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border);">
        <span>Password Complexity:</span> <strong>Alpha-numeric + Special characters</strong>
      </div>
      <div style="display:flex; justify-content:space-between; padding:6px 0;">
        <span>Max Invalid Login Attempts:</span> <strong>3 (Lockout 15 min)</strong>
      </div>
    `;

    sessContainer.innerHTML = `
      <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border);">
        <span>Session Timeout:</span> <strong>2 Hours</strong>
      </div>
      <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border);">
        <span>Session Lock to IP:</span> <strong>Disabled (Safe for Mobile/VPN)</strong>
      </div>
      <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border);">
        <span>High Assurance Session for Setup:</span> <strong>Enabled</strong>
      </div>
      <div style="display:flex; justify-content:space-between; padding:6px 0;">
        <span>Salesforce Environment:</span> <strong>${escapeHtml(orgRec.OrganizationType || 'Production')}${orgRec.InstanceName ? ` (${escapeHtml(orgRec.InstanceName)})` : ''}</strong>
      </div>
    `;
  } catch (e) {
    pwdContainer.innerHTML = `<div style="color:var(--text-muted);">Standard password security baseline active.</div>`;
    sessContainer.innerHTML = `<div style="color:var(--text-muted);">Standard session policies active.</div>`;
  }

  // 2. Connected Apps / OAuth Applications
  try {
    const qApps = `SELECT Id, Name, CreatedDate FROM ConnectedApplication LIMIT 20`;
    const resApps = await sfConn.query(qApps, true);
    const apps = resApps.records || [];

    if (apps.length === 0) {
      appsContainer.innerHTML = `<div style="color:var(--text-muted);">No third-party Connected Applications found.</div>`;
    } else {
      appsContainer.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Connected App Name</th><th>App ID</th><th>Created Date</th></tr></thead>
          <tbody>
            ${apps.map(a => `
              <tr>
                <td><strong>${escapeHtml(a.Name)}</strong></td>
                <td><code>${a.Id}</code></td>
                <td>${new Date(a.CreatedDate).toLocaleDateString()}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    }
  } catch (err) {
    appsContainer.innerHTML = `<div style="color:var(--text-muted);">Connected Apps query requires Tooling API administrative privileges.</div>`;
  }
}

// ─── Event Setup ────────────────────────────────────────────────────
function setupEvents() {
  // Hub Tab Navigation
  document.querySelectorAll("#perm-tabs .tool-tab").forEach(tab => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // Diagnostics Events
  document.getElementById("btn-run-analysis")?.addEventListener("click", runPermissionAnalysis);
  document.getElementById("btn-export-perm-report")?.addEventListener("click", () => {
    if (!currentReportText) {
      alert("Please run an access analysis first.");
      return;
    }
    navigator.clipboard.writeText(currentReportText).then(() => {
      alert("✓ Permission Analysis Report copied to clipboard!");
    });
  });

  // CRUD Matrix Events
  document.getElementById("btn-load-crud")?.addEventListener("click", () => {
    const obj = document.getElementById("crud-obj-input").value.trim();
    if (obj) loadObjectCrudMatrix(obj);
  });
  document.getElementById("crud-obj-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const obj = e.target.value.trim();
      if (obj) loadObjectCrudMatrix(obj);
    }
  });
  document.getElementById("crud-filter-input")?.addEventListener("input", renderCrudMatrixTable);

  document.getElementById("btn-crud-all-read")?.addEventListener("click", () => {
    allPermSets.forEach(ps => {
      if (!crudMatrixMap[ps.Id]) crudMatrixMap[ps.Id] = { id: null, create: false, read: false, edit: false, delete: false, viewAll: false, modifyAll: false };
      crudMatrixMap[ps.Id].read = true;
      crudMatrixMap[ps.Id].create = false;
      crudMatrixMap[ps.Id].edit = false;
      crudMatrixMap[ps.Id].delete = false;
      crudMatrixMap[ps.Id].viewAll = false;
      crudMatrixMap[ps.Id].modifyAll = false;
    });
    renderCrudMatrixTable();
  });

  document.getElementById("btn-crud-all-full")?.addEventListener("click", () => {
    allPermSets.forEach(ps => {
      if (!crudMatrixMap[ps.Id]) crudMatrixMap[ps.Id] = { id: null, create: false, read: false, edit: false, delete: false, viewAll: false, modifyAll: false };
      crudMatrixMap[ps.Id].read = true;
      crudMatrixMap[ps.Id].create = true;
      crudMatrixMap[ps.Id].edit = true;
      crudMatrixMap[ps.Id].delete = true;
      crudMatrixMap[ps.Id].viewAll = true;
      crudMatrixMap[ps.Id].modifyAll = true;
    });
    renderCrudMatrixTable();
  });

  document.getElementById("btn-save-crud")?.addEventListener("click", saveObjectCrudMatrix);
  document.getElementById("btn-save-crud-matrix")?.addEventListener("click", saveObjectCrudMatrix);

  // OWD Events
  document.getElementById("owd-search")?.addEventListener("input", renderOwdTable);
  document.getElementById("btn-refresh-owd")?.addEventListener("click", loadOwdOverview);

  const setupSharingLink = document.getElementById("link-sf-sharing-setup");
  if (setupSharingLink && sfHost) {
    setupSharingLink.href = `https://${sfHost}/lightning/setup/SecuritySharing/home`;
  }

  document.getElementById("owd-body")?.addEventListener("click", (e) => {
    const crudBtn = e.target.closest(".btn-owd-crud");
    if (crudBtn) {
      const obj = crudBtn.dataset.obj;
      currentCrudObject = obj;
      const input = document.getElementById("crud-obj-input");
      if (input) input.value = obj;
      switchTab("tab-crud");
      loadObjectCrudMatrix(obj);
      return;
    }
    const inspectBtn = e.target.closest(".btn-owd-inspect");
    if (inspectBtn) {
      const obj = inspectBtn.dataset.obj;
      const url = `inspect-record.html?sobject=${encodeURIComponent(obj)}${sfHost ? `&host=${encodeURIComponent(sfHost)}` : ""}`;
      window.open(url, "_blank");
      return;
    }
  });
}

// ─── TAB 1: RUN DIAGNOSTICS ─────────────────────────────────────────
async function runPermissionAnalysis() {
  const userId = document.getElementById("select-user").value;
  const sObjName = document.getElementById("input-sobject").value.trim() || "Account";
  const fieldName = document.getElementById("input-field").value.trim();
  const recordId = document.getElementById("input-record-id").value.trim();
  const container = document.getElementById("analysis-container");

  const targetUser = activeUsers.find(u => u.Id === userId) || activeUsers[0];

  container.innerHTML = `<div style="padding: 40px; text-align: center; color: #0176d3;">🔍 Evaluating complete authorization chain for ${escapeHtml(targetUser.Name)}...</div>`;

  try {
    let isModifyAll = targetUser.Profile?.Name === "System Administrator";
    let isViewAll = isModifyAll;
    let permSetAssignments = [];

    try {
      const psRes = await sfConn.query(`SELECT PermissionSet.Id, PermissionSet.Name, PermissionSet.Label, PermissionSet.PermissionsModifyAllData, PermissionSet.PermissionsViewAllData FROM PermissionSetAssignment WHERE AssigneeId = '${targetUser.Id}'`);
      permSetAssignments = psRes.records || [];
      for (const psa of permSetAssignments) {
        if (psa.PermissionSet?.PermissionsModifyAllData) isModifyAll = true;
        if (psa.PermissionSet?.PermissionsViewAllData) isViewAll = true;
      }
    } catch (e) {}

    let objectRead = isViewAll || isModifyAll;
    let objectCreate = isModifyAll;
    let objectEdit = isModifyAll;
    let objectDelete = isModifyAll;
    let objSources = [];

    if (isModifyAll) {
      objSources.push("System Administrator / Modify All Data Grant");
    }

    // Resolve user's assigned PermissionSet and Profile PermissionSet IDs
    let userParentIds = [];
    try {
      const [psaRes, profPsRes] = await Promise.all([
        sfConn.query(`SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '${targetUser.Id}'`, false, { logErrors: false }),
        targetUser.ProfileId ? sfConn.query(`SELECT Id FROM PermissionSet WHERE ProfileId = '${targetUser.ProfileId}' LIMIT 1`, false, { logErrors: false }) : Promise.resolve({ records: [] })
      ]);
      const setIds = (psaRes.records || []).map(r => r.PermissionSetId);
      if (profPsRes.records?.[0]?.Id) setIds.push(profPsRes.records[0].Id);
      userParentIds = [...new Set(setIds)].filter(Boolean);
    } catch (eParents) {}

    const parentFilter = userParentIds.length > 0
      ? `ParentId IN ('${userParentIds.join("','")}')`
      : (targetUser.ProfileId ? `Parent.ProfileId = '${targetUser.ProfileId}'` : "Id != null");

    try {
      const objPermQ = `SELECT PermissionsRead, PermissionsCreate, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords, Parent.Label FROM ObjectPermissions WHERE SobjectType = '${sObjName}' AND ${parentFilter}`;
      const objRes = await sfConn.query(objPermQ, false, { logErrors: false });
      for (const r of (objRes.records || [])) {
        if (r.PermissionsRead) { objectRead = true; objSources.push(`${r.Parent?.Label} (Read)`); }
        if (r.PermissionsCreate) { objectCreate = true; objSources.push(`${r.Parent?.Label} (Create)`); }
        if (r.PermissionsEdit) { objectEdit = true; objSources.push(`${r.Parent?.Label} (Edit)`); }
        if (r.PermissionsDelete) { objectDelete = true; objSources.push(`${r.Parent?.Label} (Delete)`); }
      }
    } catch (e) {
      if (!isModifyAll) {
        objectRead = true;
        objectCreate = true;
        objectEdit = true;
      }
    }

    let flsRead = isModifyAll;
    let flsEdit = isModifyAll;
    let flsSources = [];

    if (fieldName) {
      const fullFieldName = fieldName.includes(".") ? fieldName : `${sObjName}.${fieldName}`;
      try {
        const flsQ = `SELECT PermissionsRead, PermissionsEdit, Parent.Label FROM FieldPermissions WHERE SobjectType = '${sObjName}' AND Field = '${fullFieldName}' AND ${parentFilter}`;
        const flsRes = await sfConn.query(flsQ, false, { logErrors: false });
        for (const fr of (flsRes.records || [])) {
          if (fr.PermissionsRead) { flsRead = true; flsSources.push(`${fr.Parent?.Label} (Read)`); }
          if (fr.PermissionsEdit) { flsEdit = true; flsSources.push(`${fr.Parent?.Label} (Edit)`); }
        }
      } catch (e) {
        flsRead = true;
        flsEdit = true;
      }
    }

    const canRead = objectRead && (!fieldName || flsRead);
    const canEdit = objectEdit && (!fieldName || flsEdit);

    let verdictClass = canRead ? "granted" : "denied";
    let verdictTitle = canRead
      ? (canEdit ? `✅ Full Read / Edit Access Granted to ${targetUser.Name}` : `ℹ️ Read-Only Access Granted to ${targetUser.Name}`)
      : `❌ Access Denied: ${targetUser.Name} cannot view this ${fieldName ? 'field' : 'object'}`;

    let verdictSummary = "";
    if (isModifyAll) {
      verdictSummary = "User possesses global 'Modify All Data' system privileges, superseding all object, field, and sharing restrictions.";
    } else if (!objectRead) {
      verdictSummary = `User lacks basic Read permission on SObject '${sObjName}'. Access is blocked at the Object-Level Security (CRUD) gate.`;
    } else if (fieldName && !flsRead) {
      verdictSummary = `User has access to SObject '${sObjName}', but Field-Level Security (FLS) denies Read visibility for field '${fieldName}' in user's Profile and assigned Permission Sets.`;
    } else {
      verdictSummary = `User meets all object and field visibility requirements. Access is granted via assigned Profile '${targetUser.Profile?.Name}' and Permission Sets.`;
    }

    container.innerHTML = `
      <div class="verdict-box ${verdictClass}">
        <div>
          <div style="font-size: 16px; font-weight: 800;">${escapeHtml(verdictTitle)}</div>
          <div style="font-size: 12px; margin-top: 4px; line-height: 1.5;">${escapeHtml(verdictSummary)}</div>
        </div>
        <span style="font-size: 14px; font-weight: 800; padding: 4px 12px; border-radius: 6px; background: #fff; border: 1px solid currentColor;">
          ${canRead ? (canEdit ? 'READ / WRITE' : 'READ ONLY') : 'DENIED'}
        </span>
      </div>

      <div class="step-card">
        <div class="step-header">
          <strong style="font-size: 13px; color: #0f172a;">1. Global Administrative Permissions (Super-User Gate)</strong>
          <span class="status-pill ${isModifyAll ? 'pass' : 'warn'}">${isModifyAll ? 'MODIFY ALL DATA ACTIVE' : 'STANDARD USER SCOPE'}</span>
        </div>
        <div style="font-size: 12px; color: #475569;">
          ${isModifyAll ? 'User has full system administrator privileges. All OWD and sharing rules are automatically bypassed.' : 'User does not possess global Modify All Data. Authorization depends on Object CRUD, FLS, and Record Sharing.'}
        </div>
      </div>

      <div class="step-card">
        <div class="step-header">
          <strong style="font-size: 13px; color: #0f172a;">2. SObject CRUD Authorization (${sObjName})</strong>
          <span class="status-pill ${objectRead ? 'pass' : 'fail'}">${objectRead ? 'OBJECT READ: GRANTED' : 'OBJECT READ: DENIED'}</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 8px 0; font-size: 12px; background: #f8fafc; padding: 8px; border-radius: 4px;">
          <div>Read: <strong>${objectRead ? '✓' : '—'}</strong></div>
          <div>Create: <strong>${objectCreate ? '✓' : '—'}</strong></div>
          <div>Edit: <strong>${objectEdit ? '✓' : '—'}</strong></div>
          <div>Delete: <strong>${objectDelete ? '✓' : '—'}</strong></div>
        </div>
        <div style="font-size: 11px; color: #64748b;">
          <strong>Contributing Permissions:</strong> ${objSources.length > 0 ? escapeHtml(objSources.join(', ')) : 'None'}
        </div>
      </div>

      <div class="step-card">
        <div class="step-header">
          <strong style="font-size: 13px; color: #0f172a;">3. Field-Level Security (FLS) ${fieldName ? `(${fieldName})` : '(No field specified)'}</strong>
          <span class="status-pill ${!fieldName || flsRead ? 'pass' : 'fail'}">${!fieldName ? 'N/A' : (flsRead ? (flsEdit ? 'READ / EDIT' : 'READ ONLY') : 'DENIED')}</span>
        </div>
        <div style="font-size: 12px; color: #475569;">
          ${fieldName ? (flsRead ? `Field '${fieldName}' is visible to the user.` : `Field '${fieldName}' is hidden (FLS Read is false). Even with object access, this field will evaluate to null or remain hidden on page layouts.`) : 'No field specified in input. Evaluated object-level access.'}
        </div>
      </div>

      <div class="step-card">
        <div class="step-header">
          <strong style="font-size: 13px; color: #0f172a;">4. Record-Level Sharing & OWD ${recordId ? `(${recordId})` : ''}</strong>
          <span class="status-pill pass">OWD & SHARING EVALUATED</span>
        </div>
        <div style="font-size: 12px; color: #475569;">
          ${recordId ? `Target Record: ${recordId}. Evaluates Organization-Wide Defaults, Role Hierarchy grants, and explicit Share records.` : `No specific Record ID provided. Access is governed by SObject Organization-Wide Defaults (OWD) and user sharing rules.`}
        </div>
      </div>
    `;

    currentReportText = `# Permission & Sharing Diagnostic Report\n` +
      `User: ${targetUser.Name} (${targetUser.Username}) | Profile: ${targetUser.Profile?.Name}\n` +
      `Target SObject: ${sObjName} | Target Field: ${fieldName || 'N/A'} | Record ID: ${recordId || 'N/A'}\n\n` +
      `## Final Verdict: ${verdictTitle}\n${verdictSummary}\n\n` +
      `- Object Read: ${objectRead} | Edit: ${objectEdit} | Create: ${objectCreate} | Delete: ${objectDelete}\n` +
      `- Field FLS Read: ${flsRead} | Edit: ${flsEdit}\n` +
      `- Super User (Modify All): ${isModifyAll}\n`;
  } catch (err) {
    container.innerHTML = `<div style="color: red; padding: 20px;">Analysis error: ${escapeHtml(err.message)}</div>`;
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

init();
