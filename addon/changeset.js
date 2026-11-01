import { sfConn, apiVersion, updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";

const sfHost = resolveSfHost();

// Change Set Registry: Map<csId, { id, name, target, description, createdDate, components: Map<xmlType, Set<memberName>> }>
let allChangeSets = new Map();
let activeChangeSetId = null;

let currentLoadedComponents = [];
let selectedComponentIds = new Set();
let missingDependenciesFound = [];

// Complete 20+ Metadata Types Configuration with Object.ComponentName naming
const METADATA_CONFIG = {
  ApexClass: {
    query: "SELECT Id, Name, NamespacePrefix, LastModifiedDate, LastModifiedBy.Name FROM ApexClass ORDER BY LastModifiedDate DESC",
    getName: r => r.Name,
    xmlType: "ApexClass"
  },
  ApexTrigger: {
    query: "SELECT Id, Name, TableEnumOrId, NamespacePrefix, LastModifiedDate, LastModifiedBy.Name FROM ApexTrigger ORDER BY LastModifiedDate DESC",
    getName: r => r.TableEnumOrId ? `${r.TableEnumOrId}.${r.Name}` : r.Name,
    xmlType: "ApexTrigger"
  },
  LightningComponentBundle: {
    query: "SELECT Id, DeveloperName, MasterLabel, NamespacePrefix, LastModifiedDate, LastModifiedBy.Name FROM LightningComponentBundle ORDER BY LastModifiedDate DESC",
    getName: r => r.DeveloperName,
    xmlType: "LightningComponentBundle"
  },
  AuraDefinitionBundle: {
    query: "SELECT Id, DeveloperName, MasterLabel, NamespacePrefix, LastModifiedDate, LastModifiedBy.Name FROM AuraDefinitionBundle ORDER BY LastModifiedDate DESC",
    getName: r => r.DeveloperName,
    xmlType: "AuraDefinitionBundle"
  },
  FlowDefinition: {
    query: "SELECT Id, DeveloperName, MasterLabel, LastModifiedDate, LastModifiedBy.Name FROM FlowDefinition ORDER BY LastModifiedDate DESC",
    getName: r => r.DeveloperName,
    xmlType: "Flow"
  },
  CustomObject: {
    query: "SELECT Id, DeveloperName, NamespacePrefix, LastModifiedDate, LastModifiedBy.Name FROM CustomObject ORDER BY LastModifiedDate DESC",
    getName: r => `${r.DeveloperName}__c`,
    xmlType: "CustomObject"
  },
  CustomField: {
    query: "SELECT Id, DeveloperName, TableEnumOrId, NamespacePrefix, LastModifiedDate, LastModifiedBy.Name FROM CustomField ORDER BY LastModifiedDate DESC",
    getName: r => `${r.TableEnumOrId}.${r.DeveloperName}__c`,
    xmlType: "CustomField"
  },
  ValidationRule: {
    query: "SELECT Id, ValidationName, EntityDefinition.DeveloperName, EntityDefinition.QualifiedApiName, LastModifiedDate, LastModifiedBy.Name FROM ValidationRule ORDER BY LastModifiedDate DESC",
    getName: r => `${r.EntityDefinition?.DeveloperName || r.EntityDefinition?.QualifiedApiName || "Unknown"}.${r.ValidationName}`,
    xmlType: "ValidationRule"
  },
  RecordType: {
    query: "SELECT Id, Name, DeveloperName, SobjectType, NamespacePrefix, LastModifiedDate, LastModifiedBy.Name FROM RecordType ORDER BY LastModifiedDate DESC",
    getName: r => `${r.SobjectType}.${r.DeveloperName || r.Name}`,
    xmlType: "RecordType"
  },
  Layout: {
    query: "SELECT Id, Name, TableEnumOrId, NamespacePrefix, LastModifiedDate, LastModifiedBy.Name FROM Layout ORDER BY LastModifiedDate DESC",
    getName: r => `${r.TableEnumOrId}-${r.Name}`,
    xmlType: "Layout"
  },
  PermissionSet: {
    query: "SELECT Id, Name, Label, NamespacePrefix, LastModifiedDate, LastModifiedBy.Name FROM PermissionSet WHERE IsCustom = true ORDER BY LastModifiedDate DESC",
    getName: r => r.Name,
    xmlType: "PermissionSet"
  },
  PermissionSetGroup: {
    query: "SELECT Id, DeveloperName, MasterLabel, NamespacePrefix, LastModifiedDate, LastModifiedBy.Name FROM PermissionSetGroup ORDER BY LastModifiedDate DESC",
    getName: r => r.DeveloperName,
    xmlType: "PermissionSetGroup"
  },
  Profile: {
    query: "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM Profile ORDER BY LastModifiedDate DESC",
    getName: r => r.Name,
    xmlType: "Profile"
  },
  ApexPage: {
    query: "SELECT Id, Name, NamespacePrefix, LastModifiedDate, LastModifiedBy.Name FROM ApexPage ORDER BY LastModifiedDate DESC",
    getName: r => r.Name,
    xmlType: "ApexPage"
  },
  ApexComponent: {
    query: "SELECT Id, Name, NamespacePrefix, LastModifiedDate, LastModifiedBy.Name FROM ApexComponent ORDER BY LastModifiedDate DESC",
    getName: r => r.Name,
    xmlType: "ApexComponent"
  },
  CustomMetadata: {
    query: "SELECT Id, DeveloperName, NamespacePrefix, LastModifiedDate, LastModifiedBy.Name FROM CustomObject WHERE DeveloperName LIKE '%__mdt' ORDER BY LastModifiedDate DESC",
    getName: r => r.DeveloperName,
    xmlType: "CustomMetadata"
  },
  CustomLabel: {
    query: "SELECT Id, Name, Value, NamespacePrefix, LastModifiedDate, LastModifiedBy.Name FROM ExternalString ORDER BY LastModifiedDate DESC",
    getName: r => r.Name,
    xmlType: "CustomLabel"
  },
  EmailTemplate: {
    query: "SELECT Id, DeveloperName, Name, NamespacePrefix, LastModifiedDate, LastModifiedBy.Name FROM EmailTemplate ORDER BY LastModifiedDate DESC",
    getName: r => r.DeveloperName || r.Name,
    xmlType: "EmailTemplate"
  },
  QuickAction: {
    query: "SELECT Id, Name, TargetSobjectType, LastModifiedDate, LastModifiedBy.Name FROM QuickActionDefinition ORDER BY LastModifiedDate DESC",
    getName: r => r.TargetSobjectType ? `${r.TargetSobjectType}.${r.Name}` : r.Name,
    xmlType: "QuickAction"
  },
  Group: {
    query: "SELECT Id, DeveloperName, Name, Type, LastModifiedDate, LastModifiedBy.Name FROM Group WHERE Type IN ('Regular', 'Queue') ORDER BY LastModifiedDate DESC",
    getName: r => r.DeveloperName || r.Name,
    xmlType: "Group"
  }
};

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

  updateGlobalLinks();
  loadChangeSetsFromStorage();
  setupEvents();
  renderChangeSetUI();
  loadInboundDeploymentHistory();
}

function updateGlobalLinks() {
  document.getElementById("btn-open-outbound").href = `https://${sfHost}/lightning/setup/OutboundChangeSet/home`;
  document.getElementById("btn-open-inbound").href = `https://${sfHost}/lightning/setup/InboundChangeSet/home`;
  document.getElementById("btn-open-deploy-settings").href = `https://${sfHost}/lightning/setup/DeploymentSettings/home`;
  document.getElementById("btn-open-deploy-monitor").href = `https://${sfHost}/lightning/setup/DeployStatus/home`;
  document.getElementById("btn-launch-sf-changeset").href = `https://${sfHost}/lightning/setup/OutboundChangeSet/home`;
  document.getElementById("link-deploy-settings-inline").href = `https://${sfHost}/lightning/setup/DeploymentSettings/home`;
}

function loadChangeSetsFromStorage() {
  try {
    const raw = localStorage.getItem(`sfpi_cs_store_${sfHost}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      allChangeSets = new Map();
      Object.keys(parsed).forEach(id => {
        const item = parsed[id];
        const compMap = new Map();
        if (item.components) {
          Object.keys(item.components).forEach(type => {
            compMap.set(type, new Set(item.components[type]));
          });
        }
        allChangeSets.set(id, {
          ...item,
          components: compMap
        });
      });
    }
    activeChangeSetId = localStorage.getItem(`sfpi_active_cs_${sfHost}`) || null;
    if (activeChangeSetId && !allChangeSets.has(activeChangeSetId)) {
      activeChangeSetId = null;
    }
  } catch (e) {
    console.warn("Error loading change sets:", e);
    allChangeSets = new Map();
    activeChangeSetId = null;
  }
}

function persistChangeSetsToStorage() {
  const store = {};
  for (const [id, cs] of allChangeSets.entries()) {
    const compObj = {};
    for (const [type, set] of cs.components.entries()) {
      if (set.size > 0) compObj[type] = Array.from(set);
    }
    store[id] = {
      id: cs.id,
      name: cs.name,
      target: cs.target,
      description: cs.description,
      createdDate: cs.createdDate,
      components: compObj
    };
  }
  localStorage.setItem(`sfpi_cs_store_${sfHost}`, JSON.stringify(store));
  if (activeChangeSetId) {
    localStorage.setItem(`sfpi_active_cs_${sfHost}`, activeChangeSetId);
  } else {
    localStorage.removeItem(`sfpi_active_cs_${sfHost}`);
  }
}

function getActiveChangeSet() {
  return activeChangeSetId ? allChangeSets.get(activeChangeSetId) : null;
}

function setupEvents() {
  // Main Tab Navigation (Outbound vs Inbound History)
  document.querySelectorAll("#main-cs-tabs .tool-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#main-cs-tabs .tool-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab;
      document.getElementById("tab-content-outbound").style.display = target === "outbound" ? "flex" : "none";
      document.getElementById("tab-content-inbound").style.display = target === "inbound" ? "flex" : "none";
      if (target === "inbound") {
        loadInboundDeploymentHistory();
      }
    });
  });

  document.getElementById("btn-refresh-inbound").addEventListener("click", loadInboundDeploymentHistory);

  // Change Set selector dropdown
  document.getElementById("select-active-changeset").addEventListener("change", (e) => {
    const val = e.target.value;
    if (val === "__NEW__") {
      openModalCreate();
    } else {
      activeChangeSetId = val || null;
      persistChangeSetsToStorage();
      renderChangeSetUI();
    }
  });

  // Header Buttons
  document.getElementById("btn-new-changeset").addEventListener("click", openModalCreate);
  document.getElementById("btn-clone-changeset").addEventListener("click", openModalClone);
  document.getElementById("btn-edit-changeset").addEventListener("click", openModalEdit);
  document.getElementById("btn-delete-changeset").addEventListener("click", deleteActiveChangeSet);

  // Quick Onboarding Create
  document.getElementById("btn-quick-create").addEventListener("click", () => {
    const name = document.getElementById("quick-cs-name").value.trim();
    const target = document.getElementById("quick-cs-target").value.trim() || "Production";
    const desc = document.getElementById("quick-cs-desc").value.trim();

    if (!name) {
      alert("Please enter a Change Set Name.");
      return;
    }
    createAndActivateChangeSet(name, target, desc);
  });

  // Modal events: Create / Edit
  document.getElementById("btn-close-modal").addEventListener("click", closeModal);
  document.getElementById("btn-cancel-modal").addEventListener("click", closeModal);
  document.getElementById("btn-save-modal").addEventListener("click", handleModalSave);

  // Modal events: Clone
  document.getElementById("btn-close-clone-modal").addEventListener("click", closeCloneModal);
  document.getElementById("btn-cancel-clone").addEventListener("click", closeCloneModal);
  document.getElementById("btn-confirm-clone").addEventListener("click", handleConfirmClone);

  // Modal events: Deploy
  document.getElementById("btn-open-deploy-modal").addEventListener("click", openDeployModal);
  document.getElementById("btn-close-deploy-modal").addEventListener("click", closeDeployModal);
  document.getElementById("btn-cancel-deploy").addEventListener("click", closeDeployModal);
  document.getElementById("btn-copy-deploy-cmd").addEventListener("click", copyDeployModalCli);
  document.getElementById("btn-execute-deploy-action").addEventListener("click", executeDeployAction);

  // Deploy modal reactive changes
  document.getElementById("deploy-target-org-input").addEventListener("input", updateDeployModalCli);
  document.getElementById("deploy-mode-select").addEventListener("change", updateDeployModalCli);
  document.getElementById("deploy-test-level").addEventListener("change", updateDeployModalCli);

  // Component Filters & Staging
  document.getElementById("select-meta-type").addEventListener("change", loadComponentsForSelectedType);
  document.getElementById("select-date-filter").addEventListener("change", filterAndRenderComponents);
  document.getElementById("select-namespace-filter").addEventListener("change", filterAndRenderComponents);
  document.getElementById("input-search-components").addEventListener("input", filterAndRenderComponents);

  document.getElementById("chk-master").addEventListener("change", (e) => {
    const isChecked = e.target.checked;
    document.querySelectorAll(".comp-row-chk").forEach(chk => {
      chk.checked = isChecked;
      const id = chk.dataset.id;
      if (isChecked) selectedComponentIds.add(id);
      else selectedComponentIds.delete(id);
    });
    updateSelectedCount();
  });

  document.getElementById("btn-select-all").addEventListener("click", () => {
    document.querySelectorAll(".comp-row-chk").forEach(chk => {
      chk.checked = true;
      selectedComponentIds.add(chk.dataset.id);
    });
    document.getElementById("chk-master").checked = true;
    updateSelectedCount();
  });

  document.getElementById("btn-deselect-all").addEventListener("click", () => {
    document.querySelectorAll(".comp-row-chk").forEach(chk => {
      chk.checked = false;
    });
    selectedComponentIds.clear();
    document.getElementById("chk-master").checked = false;
    updateSelectedCount();
  });

  document.getElementById("btn-add-to-changeset").addEventListener("click", addSelectedToChangeSet);
  document.getElementById("btn-clear-staged").addEventListener("click", clearStagedManifest);

  // Dependency Checker
  document.getElementById("btn-check-deps").addEventListener("click", runDependencyCheck);
  document.getElementById("btn-close-deps-modal").addEventListener("click", closeDepsModal);
  document.getElementById("btn-close-deps").addEventListener("click", closeDepsModal);
  document.getElementById("btn-add-missing-deps").addEventListener("click", addMissingDependenciesToChangeSet);

  // Export & Deployment
  document.getElementById("btn-download-package-xml").addEventListener("click", downloadPackageXml);
  document.getElementById("btn-copy-package-xml").addEventListener("click", copyPackageXml);
  document.getElementById("btn-copy-cli").addEventListener("click", copyCliCommand);
}

function renderChangeSetUI() {
  const select = document.getElementById("select-active-changeset");
  const onboardingView = document.getElementById("onboarding-view");
  const stagingView = document.getElementById("staging-view");
  const metaBar = document.getElementById("changeset-meta-bar");
  const btnClone = document.getElementById("btn-clone-changeset");
  const btnEdit = document.getElementById("btn-edit-changeset");
  const btnDelete = document.getElementById("btn-delete-changeset");

  // Re-populate dropdown
  let optionsHtml = `<option value="">-- No Change Set Active --</option>`;
  for (const cs of allChangeSets.values()) {
    let count = 0;
    for (const set of cs.components.values()) count += set.size;
    const isSelected = cs.id === activeChangeSetId ? "selected" : "";
    optionsHtml += `<option value="${cs.id}" ${isSelected}>📦 ${cs.name} (${count} items)</option>`;
  }
  optionsHtml += `<option value="__NEW__">➕ Create New Change Set...</option>`;
  select.innerHTML = optionsHtml;

  const currentCS = getActiveChangeSet();

  if (!currentCS) {
    onboardingView.style.display = "flex";
    stagingView.style.display = "none";
    metaBar.style.display = "none";
    btnClone.style.display = "none";
    btnEdit.style.display = "none";
    btnDelete.style.display = "none";
  } else {
    onboardingView.style.display = "none";
    stagingView.style.display = "flex";
    metaBar.style.display = "flex";
    btnClone.style.display = "inline-flex";
    btnEdit.style.display = "inline-flex";
    btnDelete.style.display = "inline-flex";

    document.getElementById("cs-target-label").textContent = currentCS.target || "Production";

    renderStagedManifest();
    loadComponentsForSelectedType();
  }
}

function createAndActivateChangeSet(name, target, description) {
  const id = "cs_" + Date.now();
  const cs = {
    id,
    name,
    target: target || "Production",
    description: description || "",
    createdDate: new Date().toISOString(),
    components: new Map()
  };
  allChangeSets.set(id, cs);
  activeChangeSetId = id;
  persistChangeSetsToStorage();
  renderChangeSetUI();
}

function deleteActiveChangeSet() {
  const cs = getActiveChangeSet();
  if (!cs) return;

  if (confirm(`Are you sure you want to delete Change Set '${cs.name}'?`)) {
    allChangeSets.delete(cs.id);
    activeChangeSetId = null;
    persistChangeSetsToStorage();
    renderChangeSetUI();
  }
}

// ----------------- Clone Modal Handling -----------------

function openModalClone() {
  const cs = getActiveChangeSet();
  if (!cs) return;

  document.getElementById("clone-cs-name").value = `${cs.name}_Clone`;
  document.getElementById("modal-clone").style.display = "flex";
}

function closeCloneModal() {
  document.getElementById("modal-clone").style.display = "none";
}

function handleConfirmClone() {
  const cs = getActiveChangeSet();
  if (!cs) return;

  const newName = document.getElementById("clone-cs-name").value.trim();
  if (!newName) {
    alert("Please enter a new name for the cloned Change Set.");
    return;
  }

  const newId = "cs_" + Date.now();
  const clonedComponents = new Map();
  for (const [type, set] of cs.components.entries()) {
    clonedComponents.set(type, new Set(set));
  }

  const clonedCS = {
    id: newId,
    name: newName,
    target: cs.target,
    description: `Cloned from ${cs.name}. ${cs.description || ""}`,
    createdDate: new Date().toISOString(),
    components: clonedComponents
  };

  allChangeSets.set(newId, clonedCS);
  activeChangeSetId = newId;
  persistChangeSetsToStorage();
  closeCloneModal();
  renderChangeSetUI();
}

// ----------------- Create / Edit Modal -----------------

let isEditMode = false;

function openModalCreate() {
  isEditMode = false;
  document.getElementById("modal-cs-title").textContent = "➕ Create New Outbound Change Set";
  document.getElementById("modal-cs-name").value = "";
  document.getElementById("modal-cs-target").value = "Production";
  document.getElementById("modal-cs-desc").value = "";
  document.getElementById("modal-changeset").style.display = "flex";
}

function openModalEdit() {
  const cs = getActiveChangeSet();
  if (!cs) return;
  isEditMode = true;
  document.getElementById("modal-cs-title").textContent = `✏️ Edit Change Set '${cs.name}'`;
  document.getElementById("modal-cs-name").value = cs.name;
  document.getElementById("modal-cs-target").value = cs.target;
  document.getElementById("modal-cs-desc").value = cs.description || "";
  document.getElementById("modal-changeset").style.display = "flex";
}

function closeModal() {
  document.getElementById("modal-changeset").style.display = "none";
}

function handleModalSave() {
  const name = document.getElementById("modal-cs-name").value.trim();
  const target = document.getElementById("modal-cs-target").value.trim() || "Production";
  const desc = document.getElementById("modal-cs-desc").value.trim();

  if (!name) {
    alert("Please enter a Change Set Name.");
    return;
  }

  if (isEditMode) {
    const cs = getActiveChangeSet();
    if (cs) {
      cs.name = name;
      cs.target = target;
      cs.description = desc;
      persistChangeSetsToStorage();
      renderChangeSetUI();
    }
  } else {
    createAndActivateChangeSet(name, target, desc);
  }
  closeModal();
}

// ----------------- Deploy Modal & Actions -----------------

function openDeployModal() {
  const currentCS = getActiveChangeSet();
  if (!currentCS) return;

  let totalItems = 0;
  for (const set of currentCS.components.values()) totalItems += set.size;

  document.getElementById("deploy-cs-title").textContent = currentCS.name;
  document.getElementById("deploy-cs-count").textContent = totalItems;
  document.getElementById("deploy-target-org-input").value = currentCS.target || "Production";

  updateDeployModalCli();
  document.getElementById("modal-deploy").style.display = "flex";
}

function closeDeployModal() {
  document.getElementById("modal-deploy").style.display = "none";
}

function updateDeployModalCli() {
  const currentCS = getActiveChangeSet();
  if (!currentCS) return;

  const targetOrg = document.getElementById("deploy-target-org-input").value.trim() || "Production";
  const mode = document.getElementById("deploy-mode-select").value;
  const testLevel = document.getElementById("deploy-test-level").value;

  const pairs = [];
  for (const [type, set] of currentCS.components.entries()) {
    if (set.size === 0) continue;
    set.forEach(name => {
      pairs.push(`${type}:${name}`);
    });
  }

  let cmd = `sf project deploy start --target-org "${targetOrg}" --test-level ${testLevel}`;
  if (mode === "validate") {
    cmd += " --dry-run";
  }
  if (pairs.length > 0) {
    cmd += ` --metadata ${pairs.join(",")}`;
  }

  document.getElementById("deploy-cli-cmd").value = cmd;
}

function copyDeployModalCli() {
  const input = document.getElementById("deploy-cli-cmd");
  copyToClipboardFallback(input.value, document.getElementById("btn-copy-deploy-cmd"), "✓ Copied!");
}

function executeDeployAction() {
  closeDeployModal();
  window.open(`https://${sfHost}/lightning/setup/DeployStatus/home`, "_blank");
}

// ----------------- Component Explorer -----------------

async function loadComponentsForSelectedType() {
  const currentCS = getActiveChangeSet();
  if (!currentCS) return;

  const typeKey = document.getElementById("select-meta-type").value;
  const config = METADATA_CONFIG[typeKey];
  const tbody = document.getElementById("components-body");
  const statEl = document.getElementById("components-stat");

  if (!config) return;

  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px;">Loading ${typeKey} metadata via Tooling API...</td></tr>`;
  statEl.textContent = `Querying ${typeKey}...`;
  selectedComponentIds.clear();
  updateSelectedCount();
  document.getElementById("chk-master").checked = false;

  try {
    const res = await sfConn.query(config.query, true);
    currentLoadedComponents = (res.records || []).map(r => ({
      raw: r,
      id: r.Id,
      name: config.getName(r),
      namespace: r.NamespacePrefix,
      lastModifiedDate: r.LastModifiedDate ? new Date(r.LastModifiedDate) : null,
      lastModifiedByName: r.LastModifiedBy?.Name || "System"
    }));

    statEl.textContent = `Fetched ${currentLoadedComponents.length} components`;
    filterAndRenderComponents();
  } catch (err) {
    statEl.textContent = `❌ Error: ${err.message}`;
    tbody.innerHTML = `<tr><td colspan="5" style="color:red; text-align:center; padding:20px;">Tooling Query Failed: ${err.message}</td></tr>`;
  }
}

function filterAndRenderComponents() {
  const currentCS = getActiveChangeSet();
  if (!currentCS) return;

  const tbody = document.getElementById("components-body");
  const dateFilter = document.getElementById("select-date-filter").value;
  const nsFilter = document.getElementById("select-namespace-filter").value;
  const query = document.getElementById("input-search-components").value.trim().toLowerCase();
  const typeKey = document.getElementById("select-meta-type").value;
  const config = METADATA_CONFIG[typeKey];

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const filtered = currentLoadedComponents.filter(c => {
    if (nsFilter === "unmanaged" && c.namespace) return false;
    if (c.lastModifiedDate) {
      if (dateFilter === "today" && c.lastModifiedDate < startOfToday) return false;
      if (dateFilter === "7days" && c.lastModifiedDate < sevenDaysAgo) return false;
      if (dateFilter === "30days" && c.lastModifiedDate < thirtyDaysAgo) return false;
    }
    if (query) {
      const matchName = c.name.toLowerCase().includes(query);
      const matchAuthor = c.lastModifiedByName.toLowerCase().includes(query);
      if (!matchName && !matchAuthor) return false;
    }
    return true;
  });

  const statEl = document.getElementById("components-stat");
  statEl.textContent = `Showing ${filtered.length} of ${currentLoadedComponents.length} components`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted);">No components match the filter criteria.</td></tr>`;
    return;
  }

  const stagedSet = currentCS.components.get(config.xmlType) || new Set();

  tbody.innerHTML = filtered.map(c => {
    const isStaged = stagedSet.has(c.name);
    const isChecked = selectedComponentIds.has(c.id);

    return `
      <tr class="${isStaged ? "staged-row" : ""}">
        <td style="text-align:center;">
          <input type="checkbox" class="comp-row-chk" data-id="${c.id}" data-name="${c.name}" ${isChecked ? "checked" : ""}>
        </td>
        <td>
          <strong style="color:var(--text-main); font-size:12px; font-family:var(--font-mono);">${c.name}</strong>
          ${c.namespace ? `<span style="font-size:10px; color:#6b7280; background:#f1f5f9; padding:1px 4px; border-radius:3px; margin-left:4px;">${c.namespace}</span>` : ""}
        </td>
        <td style="font-size:11px; color:var(--text-muted);">
          ${c.lastModifiedDate ? c.lastModifiedDate.toLocaleDateString() + " " + c.lastModifiedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—"}
        </td>
        <td style="font-size:11px;">${c.lastModifiedByName}</td>
        <td style="text-align:center;">
          ${isStaged ? `<span style="font-size:10px; font-weight:700; color:#16a34a; background:#f0fdf4; padding:2px 6px; border-radius:4px;">✓ INCLUDED</span>` : `<span style="font-size:10px; color:#9ca3af;">—</span>`}
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".comp-row-chk").forEach(chk => {
    chk.addEventListener("change", (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) selectedComponentIds.add(id);
      else selectedComponentIds.delete(id);
      updateSelectedCount();
    });
  });
}

function updateSelectedCount() {
  document.getElementById("selected-to-add-count").textContent = selectedComponentIds.size;
}

function addSelectedToChangeSet() {
  const currentCS = getActiveChangeSet();
  if (!currentCS) {
    alert("Please select or create a Change Set first.");
    return;
  }

  if (selectedComponentIds.size === 0) {
    alert("Please select at least one component to add.");
    return;
  }

  const typeKey = document.getElementById("select-meta-type").value;
  const config = METADATA_CONFIG[typeKey];
  if (!config) return;

  if (!currentCS.components.has(config.xmlType)) {
    currentCS.components.set(config.xmlType, new Set());
  }

  const targetSet = currentCS.components.get(config.xmlType);

  selectedComponentIds.forEach(id => {
    const comp = currentLoadedComponents.find(c => c.id === id);
    if (comp) {
      targetSet.add(comp.name);
    }
  });

  selectedComponentIds.clear();
  document.getElementById("chk-master").checked = false;
  updateSelectedCount();

  persistChangeSetsToStorage();
  renderStagedManifest();
  filterAndRenderComponents();
}

function renderStagedManifest() {
  const currentCS = getActiveChangeSet();
  const container = document.getElementById("staged-container");
  const countBadge = document.getElementById("staged-count-badge");

  if (!currentCS) {
    countBadge.textContent = "0 Items";
    container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);">No active change set.</div>`;
    updateCliPreview();
    return;
  }

  let totalItems = 0;
  for (const set of currentCS.components.values()) {
    totalItems += set.size;
  }
  countBadge.textContent = `${totalItems} Items`;

  if (totalItems === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 40px 20px; font-size: 13px;">
        No components added to <strong>${currentCS.name}</strong> yet.<br>
        <span style="font-size: 11px;">Select components from the left panel and click "Add to Change Set".</span>
      </div>
    `;
    updateCliPreview();
    return;
  }

  let html = "";
  for (const [type, set] of currentCS.components.entries()) {
    if (set.size === 0) continue;
    const items = Array.from(set).sort();

    html += `
      <div style="background: #ffffff; border: 1px solid var(--border); border-radius: 6px; overflow: hidden;">
        <div style="background: #f8fafc; padding: 6px 10px; font-size: 12px; font-weight: 700; color: #0176d3; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border);">
          <span>${type} (${items.length})</span>
          <button class="btn btn-secondary" style="font-size:10px; padding:1px 6px; color:#dc2626;" data-action="remove-type" data-type="${type}">Remove Type</button>
        </div>
        <div style="max-height: 120px; overflow-y: auto; padding: 4px 8px; display: flex; flex-direction: column; gap: 2px;">
          ${items.map(name => `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 2px 4px; border-bottom: 1px solid #f8fafc;">
              <code style="font-family: var(--font-mono); color: #1e293b;">${name}</code>
              <span style="color: #ef4444; cursor: pointer; font-weight: bold; padding: 0 4px;" data-action="remove-item" data-type="${type}" data-name="${name}">×</span>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
  if (!container.dataset.boundDelegation) {
    container.dataset.boundDelegation = "true";
    container.addEventListener("click", (e) => {
      const target = e.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;
      if (action === "remove-type") {
        window.removeStagedType(target.dataset.type);
      } else if (action === "remove-item") {
        window.removeStagedItem(target.dataset.type, target.dataset.name);
      }
    });
  }
  updateCliPreview();
}

window.removeStagedType = (type) => {
  const currentCS = getActiveChangeSet();
  if (currentCS) {
    currentCS.components.delete(type);
    persistChangeSetsToStorage();
    renderStagedManifest();
    filterAndRenderComponents();
  }
};

window.removeStagedItem = (type, name) => {
  const currentCS = getActiveChangeSet();
  if (currentCS) {
    const set = currentCS.components.get(type);
    if (set) {
      set.delete(name);
      if (set.size === 0) currentCS.components.delete(type);
      persistChangeSetsToStorage();
      renderStagedManifest();
      filterAndRenderComponents();
    }
  }
};

function clearStagedManifest() {
  const currentCS = getActiveChangeSet();
  if (!currentCS) return;

  if (confirm(`Clear all staged components from '${currentCS.name}'?`)) {
    currentCS.components.clear();
    persistChangeSetsToStorage();
    renderStagedManifest();
    filterAndRenderComponents();
  }
}

// ----------------- Dependency Checker -----------------

async function runDependencyCheck() {
  const currentCS = getActiveChangeSet();
  if (!currentCS) return;

  const modal = document.getElementById("modal-deps");
  const container = document.getElementById("deps-results-container");
  const btnAddMissing = document.getElementById("btn-add-missing-deps");

  modal.style.display = "flex";
  container.innerHTML = `<div style="text-align:center; padding:20px;">🔍 Scanning Tooling API MetadataComponentDependency for staged items...</div>`;
  btnAddMissing.style.display = "none";
  missingDependenciesFound = [];

  const namesToCheck = [];
  const stagedNamesSet = new Set();

  for (const [type, set] of currentCS.components.entries()) {
    set.forEach(n => {
      stagedNamesSet.add(n.toLowerCase());
      if (type === "CustomField" && n.includes(".")) {
        namesToCheck.push(n.split(".")[1]);
      } else {
        namesToCheck.push(n);
      }
    });
  }

  if (namesToCheck.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">No components staged yet in this change set.</div>`;
    return;
  }

  try {
    const sampleNames = [...new Set(namesToCheck)].slice(0, 20);
    const depQueries = sampleNames.map(name =>
      sfConn.query(`SELECT MetadataComponentName, MetadataComponentType, RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency WHERE MetadataComponentName = '${name}'`, true, { logErrors: false })
        .then(r => r.records || [])
        .catch(() => [])
    );
    const depBatches = await Promise.all(depQueries);
    const deps = depBatches.flat();

    const missing = [];
    deps.forEach(dep => {
      const refName = dep.RefMetadataComponentName;
      const refType = dep.RefMetadataComponentType;

      if (!refName || refType === "StandardEntity" || refType === "CustomObject") return;
      if (!stagedNamesSet.has(refName.toLowerCase())) {
        missing.push({
          sourceName: dep.MetadataComponentName,
          sourceType: dep.MetadataComponentType,
          refName,
          refType
        });
      }
    });

    missingDependenciesFound = missing;

    if (missing.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:20px; color:#16a34a;">
          <strong>✓ All Dependencies Verified!</strong><br>
          <span style="font-size:11px; color:var(--text-muted);">No missing custom references detected among staged components.</span>
        </div>
      `;
    } else {
      btnAddMissing.style.display = "inline-flex";
      container.innerHTML = `
        <div style="margin-bottom:8px; font-weight:600; color:#dc2626; font-size:12px;">
          ⚠️ Found ${missing.length} dependent component(s) referenced by your staged code that are not in this Change Set:
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>Missing Component</th>
              <th>Type</th>
              <th>Referenced By</th>
            </tr>
          </thead>
          <tbody>
            ${missing.map(m => `
              <tr>
                <td><strong>${m.refName}</strong></td>
                <td><span class="autocomplete-badge">${m.refType}</span></td>
                <td style="color:var(--text-muted); font-size:11px;">${m.sourceName} (${m.sourceType})</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    }
  } catch (err) {
    container.innerHTML = `<div style="color:red; padding:15px;">Dependency Scan Warning: ${err.message}<br><small style="color:#6b7280;">MetadataComponentDependency may require 'View Setup and Configuration' or Dev Edition permissions.</small></div>`;
  }
}

function closeDepsModal() {
  document.getElementById("modal-deps").style.display = "none";
}

function addMissingDependenciesToChangeSet() {
  const currentCS = getActiveChangeSet();
  if (!currentCS || missingDependenciesFound.length === 0) return;

  missingDependenciesFound.forEach(m => {
    const xmlType = m.refType === "CustomField" ? "CustomField" : m.refType;
    if (!currentCS.components.has(xmlType)) {
      currentCS.components.set(xmlType, new Set());
    }
    currentCS.components.get(xmlType).add(m.refName);
  });

  persistChangeSetsToStorage();
  renderStagedManifest();
  filterAndRenderComponents();
  closeDepsModal();
  alert(`✓ Added ${missingDependenciesFound.length} missing dependencies to '${currentCS.name}'!`);
}

// ----------------- Inbound & Deployment History -----------------

async function loadInboundDeploymentHistory() {
  const tbody = document.getElementById("inbound-body");
  const countBadge = document.getElementById("inbound-count");

  tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px;">Loading org deployments from Tooling API DeployRequest...</td></tr>`;

  try {
    const q = `SELECT Id, Status, StartDate, CompletedDate, CheckOnly, ErrorMessage, 
                      NumberComponentsTotal, NumberComponentsDeployed, NumberComponentErrors, 
                      NumberTestsTotal, NumberTestsCompleted, CreatedDate, CreatedBy.Name 
               FROM DeployRequest 
               ORDER BY CreatedDate DESC LIMIT 50`;
    const res = await sfConn.query(q, true);
    const deploys = res.records || [];

    countBadge.textContent = deploys.length;

    if (deploys.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:25px; color:var(--text-muted);">No deployment history records found in this org.</td></tr>`;
      return;
    }

    tbody.innerHTML = deploys.map(d => {
      const isSucceeded = d.Status === "Succeeded";
      const isFailed = d.Status === "Failed";
      const isInProgress = d.Status === "InProgress";

      let statusColor = "#6b7280";
      let statusBg = "#f1f5f9";
      if (isSucceeded) { statusColor = "#16a34a"; statusBg = "#f0fdf4"; }
      if (isFailed) { statusColor = "#dc2626"; statusBg = "#fef2f2"; }
      if (isInProgress) { statusColor = "#0284c7"; statusBg = "#eff6ff"; }

      const startDate = d.StartDate ? new Date(d.StartDate).toLocaleString() : (d.CreatedDate ? new Date(d.CreatedDate).toLocaleString() : "—");
      const completedDate = d.CompletedDate ? new Date(d.CompletedDate).toLocaleString() : "—";
      const user = d.CreatedBy?.Name || "System";
      const monitorUrl = `https://${sfHost}/lightning/setup/DeployStatus/home`;

      return `
        <tr>
          <td>
            <code style="font-size:11px; font-weight:600; color:#1e293b;">${d.Id}</code>
            <a href="${monitorUrl}" target="_blank" style="display:block; font-size:10px; color:#0176d3; text-decoration:none;">↗ View in Setup</a>
          </td>
          <td>
            <span style="font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; background:${statusBg}; color:${statusColor};">
              ${d.Status}
            </span>
          </td>
          <td>
            <span style="font-size:10px; padding:1px 6px; border-radius:4px; background:#f8fafc; border:1px solid var(--border);">
              ${d.CheckOnly ? "Validation" : "Deploy"}
            </span>
          </td>
          <td style="font-size:11px; color:var(--text-muted);">${startDate}</td>
          <td style="font-size:11px; color:var(--text-muted);">${completedDate}</td>
          <td style="font-size:11px;">${user}</td>
          <td style="font-size:11px;">
            ${d.NumberComponentsDeployed || 0} / ${d.NumberComponentsTotal || 0}
            ${d.NumberComponentErrors ? `<span style="color:#dc2626; font-weight:bold;">(${d.NumberComponentErrors} err)</span>` : ""}
          </td>
          <td style="font-size:11px;">
            ${d.NumberTestsCompleted || 0} / ${d.NumberTestsTotal || 0}
          </td>
          <td style="font-size:11px; color:${d.ErrorMessage ? "#dc2626" : "var(--text-muted);"}; max-width:240px; overflow:hidden; text-overflow:ellipsis;">
            ${d.ErrorMessage || "—"}
          </td>
        </tr>
      `;
    }).join("");

  } catch (err) {
    countBadge.textContent = "!";
    tbody.innerHTML = `<tr><td colspan="9" style="color:red; text-align:center; padding:20px;">Could not load DeployRequest history: ${err.message}<br><small style="color:#6b7280;">User may require 'View Setup and Configuration' or 'Modify All Data' permission.</small></td></tr>`;
  }
}

// ----------------- Export & Deploy -----------------

function generatePackageXmlString() {
  const currentCS = getActiveChangeSet();
  if (!currentCS) return "";

  const typesXml = [];
  const sortedTypes = Array.from(currentCS.components.keys()).sort();

  for (const type of sortedTypes) {
    const set = currentCS.components.get(type);
    if (!set || set.size === 0) continue;
    const members = Array.from(set).sort().map(m => `        <members>${m}</members>`).join("\n");
    typesXml.push(`    <types>\n${members}\n        <name>${type}</name>\n    </types>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
${typesXml.join("\n")}
    <version>${apiVersion}</version>
</Package>`;
}

function updateCliPreview() {
  const previewEl = document.getElementById("cli-preview");
  const currentCS = getActiveChangeSet();
  if (!currentCS) {
    previewEl.textContent = "sf project deploy start --metadata ...";
    return;
  }

  const pairs = [];
  for (const [type, set] of currentCS.components.entries()) {
    if (set.size === 0) continue;
    set.forEach(name => {
      pairs.push(`${type}:${name}`);
    });
  }

  if (pairs.length === 0) {
    previewEl.textContent = "sf project deploy start --metadata ...";
    return;
  }

  previewEl.textContent = `sf project deploy start --metadata ${pairs.join(",")}`;
}

function downloadPackageXml() {
  const currentCS = getActiveChangeSet();
  if (!currentCS) {
    alert("Please select or create a Change Set first.");
    return;
  }

  let totalItems = 0;
  for (const set of currentCS.components.values()) totalItems += set.size;

  if (totalItems === 0) {
    alert(`No components staged in '${currentCS.name}'.`);
    return;
  }

  const xml = generatePackageXmlString();
  const blob = new Blob([xml], { type: "application/xml;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `package-${currentCS.name.replace(/[^a-zA-Z0-9_]/g, "_")}.xml`;
  a.click();
  URL.revokeObjectURL(url);
}

function copyPackageXml() {
  const currentCS = getActiveChangeSet();
  if (!currentCS) {
    alert("Please select or create a Change Set first.");
    return;
  }

  const xml = generatePackageXmlString();
  copyToClipboardFallback(xml, document.getElementById("btn-copy-package-xml"), "✓ Copied XML!");
}

function copyCliCommand() {
  const cmd = document.getElementById("cli-preview").textContent;
  copyToClipboardFallback(cmd, document.getElementById("btn-copy-cli"), "✓ Copied!");
}

function copyToClipboardFallback(text, btnEl, successMsg) {
  const originalText = btnEl.textContent;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    document.execCommand("copy");
    btnEl.textContent = successMsg;
    setTimeout(() => { btnEl.textContent = originalText; }, 2000);
  } catch (err) {
    alert("Copy failed. Please copy manually from screen.");
  } finally {
    document.body.removeChild(textarea);
  }
}

init();
