import { sfConn, apiVersion, updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";

const sfHost = resolveSfHost();
let rawLimits = {};

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
  loadLimits();
}

async function loadLimits() {
  const tbody = document.getElementById("limits-body");
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px;">Fetching limits from /limits...</td></tr>`;

  try {
    rawLimits = await sfConn.rest(`/services/data/v${apiVersion}/limits`);
    renderLimits(rawLimits);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:red; text-align:center; padding:20px;">Failed to load limits: ${err.message}</td></tr>`;
  }
}

function renderLimits(limits) {
  const tbody = document.getElementById("limits-body");
  const filter = document.getElementById("limits-search").value.toLowerCase();

  const entries = Object.entries(limits).filter(([name]) => name.toLowerCase().includes(filter));

  tbody.innerHTML = entries.map(([name, data]) => {
    const max = data.Max || 0;
    const remaining = data.Remaining || 0;
    const used = max - remaining;
    const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;

    let barColor = "#22c55e"; // green
    if (pct > 75) barColor = "#eab308"; // yellow
    if (pct > 90) barColor = "#ef4444"; // red

    return `
      <tr>
        <td><strong>${formatLimitName(name)}</strong><br><code style="font-size:10px; color:#6b7280;">${name}</code></td>
        <td>
          <div style="background:#e5e7eb; border-radius:10px; height:12px; width:100%; overflow:hidden;">
            <div style="background:${barColor}; width:${pct}%; height:100%;"></div>
          </div>
        </td>
        <td><strong style="color:${barColor};">${pct}%</strong></td>
        <td>${remaining.toLocaleString()}</td>
        <td>${max.toLocaleString()}</td>
      </tr>
    `;
  }).join("");
}

function formatLimitName(name) {
  return name.replace(/([A-Z])/g, " $1").trim();
}

function setupEvents() {
  document.getElementById("limits-search").addEventListener("input", () => renderLimits(rawLimits));
  document.getElementById("btn-refresh").addEventListener("click", loadLimits);
  const cleanLink = document.getElementById("btn-clean-storage-link");
  if (cleanLink && sfHost) {
    cleanLink.href = `storage-cleaner.html?host=${encodeURIComponent(sfHost)}`;
  }
}

init();

