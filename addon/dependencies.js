import { sfConn, apiVersion, updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";

const sfHost = resolveSfHost();

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
}

function setupEvents() {
  document.getElementById("btn-search-dep").addEventListener("click", queryDependencies);
  document.getElementById("component-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") queryDependencies();
  });
}

async function queryDependencies() {
  const compName = document.getElementById("component-name").value.trim();
  const direction = document.getElementById("dep-direction").value;
  const statusEl = document.getElementById("dep-status");
  const tbody = document.getElementById("dep-body");

  if (!compName) {
    alert("Please enter a component name.");
    return;
  }

  statusEl.textContent = "Querying Tooling API...";
  tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:30px;">Analyzing MetadataComponentDependency...</td></tr>`;

  try {
    let whereClause = "";
    if (direction === "whereUsed") {
      whereClause = `RefMetadataComponentName = '${compName}'`;
    } else {
      whereClause = `MetadataComponentName = '${compName}'`;
    }

    const q = `SELECT MetadataComponentName, MetadataComponentType, RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency WHERE ${whereClause} LIMIT 200`;
    const res = await sfConn.query(q, true);
    const records = res.records || [];

    document.getElementById("dep-count").textContent = records.length;
    statusEl.innerHTML = `<span style="color:#16a34a;">✓ Found ${records.length} relationships</span>`;

    if (records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:30px;">No dependencies found for '${compName}'.</td></tr>`;
      return;
    }

    tbody.innerHTML = records.map(r => `
      <tr>
        <td><strong>${r.MetadataComponentName}</strong></td>
        <td><span style="font-size:11px; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px;">${r.MetadataComponentType}</span></td>
        <td><strong>${r.RefMetadataComponentName}</strong></td>
        <td><span style="font-size:11px; background:#fef3c7; color:#b45309; padding:2px 6px; border-radius:4px;">${r.RefMetadataComponentType}</span></td>
      </tr>
    `).join("");

  } catch (err) {
    statusEl.innerHTML = `<span style="color:#dc2626;">❌ Error</span>`;
    tbody.innerHTML = `<tr><td colspan="4" style="color:red; text-align:center; padding:20px;">Tooling query failed: ${err.message}</td></tr>`;
  }
}

init();

