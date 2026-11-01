/**
 * SF Power Inspector — Content Script
 * Injected into Salesforce pages. Detects SF context, creates
 * the floating inspector button, and loads the popup iframe.
 */

const SF_PAGE_SELECTORS = [
  "body.sfdcBody",
  "body.ApexCSIPage",
  "#auraLoadingBox",
  "#studioBody",
  "#flowContainer",
  "div.desktop",
  "div.auraDesktop"
];
const SF_KNOWN_ROOT_DOMAINS = [
  "salesforce.com",
  "salesforce-setup.com",
  "force.com",
  "cloudforce.com",
  "visualforce.com",
  "salesforce.mil",
  "force.mil",
  "cloudforce.mil",
  "crmforce.mil",
  "sfcrmapps.cn",
  "sfcrmproducts.cn",
  "salesforce-experience.com",
  "site.com"
];

const SF_EXCLUDED_HOSTS = [
  "status.salesforce.com",
  "trust.salesforce.com",
  "help.salesforce.com",
  "trailhead.salesforce.com",
  "developer.salesforce.com",
  "appexchange.salesforce.com",
  "www.salesforce.com",
  "trailblazer.me"
];

const isExcludedHost = SF_EXCLUDED_HOSTS.some(
  (h) => location.hostname === h || location.hostname.endsWith("." + h)
);

// Detect if we're on a Salesforce page (supports all sandboxes, prod, Gov Cloud, Experience Cloud, VF, etc.)
const isSfPage =
  !isExcludedHost &&
  (document.querySelector(SF_PAGE_SELECTORS.join(", ")) != null ||
    SF_KNOWN_ROOT_DOMAINS.some((d) => location.hostname === d || location.hostname.endsWith("." + d)) ||
    location.hostname.endsWith(".mcas.ms"));

if (isSfPage && window.top === window.self) {
  if (typeof chrome === "undefined" || !chrome.runtime?.id) {
    initInspectorButton(location.hostname);
  } else {
    try {
      chrome.runtime.sendMessage(
        { message: "getSfHost", url: location.href },
        (sfHost) => {
          if (chrome.runtime?.lastError || !sfHost) {
            initInspectorButton(location.hostname);
          } else {
            initInspectorButton(sfHost);
          }
        }
      );
    } catch (e) {
      initInspectorButton(location.hostname);
    }
  }
}

function initInspectorButton(sfHost) {
  if (window.top !== window.self) return;
  if (document.getElementById("sfpi-root")) return;

  // ── Create Root Container ──
  const root = document.createElement("div");
  root.id = "sfpi-root";

  // ── Create Toggle Button ──
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sfpi-btn";
  btn.accessKey = "i";
  btn.title = "SF Power Inspector (Alt+I)";
  btn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0176d3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 16v-4"/>
      <path d="M12 8h.01"/>
    </svg>
  `;
  root.appendChild(btn);

  // ── Create Popup Iframe ──
  const popupSrc = chrome.runtime.getURL("popup.html?host=" + sfHost);
  const popup = document.createElement("iframe");
  popup.className = "sfpi-popup";
  popup.title = "SF Power Inspector";
  popup.allow = "clipboard-write; clipboard-read";
  popup.src = popupSrc;

  // Apply custom width if configured in options
  try {
    if (chrome.runtime?.id) {
      chrome.storage.local.get(["sfpi_settings"], (res) => {
        const w = res?.sfpi_settings?.sidebarWidth;
        if (w && typeof w === "string" && /^\d+px$/i.test(w.trim()) && parseInt(w, 10) >= 380) {
          popup.style.width = w.trim();
        }
      });
    }
  } catch (e) {}

  root.appendChild(popup);

  // ── Toggle Logic ──
  let isOpen = false;

  function openPopup() {
    isOpen = true;
    root.classList.add("sfpi-active");
    const recId = extractRecordId();
    popup.contentWindow?.postMessage(
      {
        sfpiUpdate: true,
        locationHref: location.href,
        recordId: recId,
      },
      "*"
    );
    document.addEventListener("click", outsideClick);
    popup.focus();
  }

  function closePopup() {
    isOpen = false;
    root.classList.remove("sfpi-active");
    document.removeEventListener("click", outsideClick);
  }

  function outsideClick(e) {
    if (!root.contains(e.target)) closePopup();
  }

  btn.addEventListener("click", () => {
    isOpen ? closePopup() : openPopup();
  });

  // ── Listen for messages from popup iframe ──
  window.addEventListener("message", (e) => {
    if (e.source !== popup.contentWindow) return;

    if (e.data.sfpiOpenPopup) openPopup();
    if (e.data.sfpiClosePopup) closePopup();

    if (e.data.sfpiGetContext) {
      popup.contentWindow?.postMessage(
        {
          sfpiUpdate: true,
          locationHref: location.href,
          recordId: extractRecordId(),
        },
        "*"
      );
    }

    // Navigate in Lightning
    if (e.data.lightningNavigate) {
      document.dispatchEvent(
        new CustomEvent("lightningNavigate", { detail: e.data.lightningNavigate })
      );
    }

    // Show/Hide API names on fields
    if (e.data.sfpiToggleApiNames) {
      toggleFieldApiNames(e.data.sfpiToggleApiNames === "show");
    }

    // Copy to clipboard from popup iframe fallback
    if (e.data.sfpiCopyToClipboard) {
      navigator.clipboard?.writeText(e.data.sfpiCopyToClipboard).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = e.data.sfpiCopyToClipboard;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      });
    }
  });

  // ── Listen for keyboard shortcuts & settings updates from background ──
  chrome.runtime.onMessage.addListener((request) => {
    if (request.msg === "shortcut_pressed" && request.command === "open-popup") {
      isOpen ? closePopup() : openPopup();
    }
    if (request.message === "settingsUpdated") {
      document.querySelector(".sfpi-sandbox-banner")?.remove();
      document.querySelector(".sfpi-prod-shield")?.remove();
      applySandboxBanner(sfHost);
    }
  });

  // ── Watch for SPA URL changes in Lightning (pushState/replaceState) ──
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isOpen) {
        popup.contentWindow?.postMessage(
          {
            sfpiUpdate: true,
            locationHref: location.href,
            recordId: extractRecordId(),
          },
          "*"
        );
      }
    }
  });
  if (document.body) {
    urlObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ── Sandbox Banner Colorization ──
  applySandboxBanner(sfHost);

  // ── Mount into DOM safely ──
  const mount = () => {
    if (document.getElementById("sfpi-root")) return;
    const parent = document.body || document.documentElement;
    if (parent) {
      parent.appendChild(root);
    } else {
      window.addEventListener("DOMContentLoaded", () => {
        (document.body || document.documentElement).appendChild(root);
      }, { once: true });
    }
  };
  mount();

  // Watch for DOM resets or replacements to ensure button stays visible
  const bodyWatcher = new MutationObserver(() => {
    if (!document.getElementById("sfpi-root")) {
      const parent = document.body || document.documentElement;
      if (parent) parent.appendChild(root);
    }
  });
  bodyWatcher.observe(document.documentElement, { childList: true });
}

// ─── Utility: Extract Record ID from URL or DOM ─────────────────────
function isValidSfId(id) {
  if (!id || typeof id !== "string") return false;
  // Must be 15 or 18 alphanumeric chars and start with valid 3-char prefix
  return /^[a-zA-Z0-9]{15}$|^[a-zA-Z0-9]{18}$/.test(id);
}

function extractRecordId() {
  // 1. Check pathname: /lightning/r/Account/001xxxxxxxxxxxxAAA/view or /lightning/r/001...
  const pathParts = location.pathname.split("/");
  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i];
    if (isValidSfId(part)) return part;
  }

  // 2. Check query params: ?id=001... or ?recordId=001... or address=/001...
  const params = new URLSearchParams(location.search);
  const candidateParams = ["id", "recordId", "targetId", "parentId"];
  for (const param of candidateParams) {
    const val = params.get(param);
    if (isValidSfId(val)) return val;
  }
  const address = params.get("address");
  if (address) {
    const addrMatch = address.match(/([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})/);
    if (addrMatch && isValidSfId(addrMatch[1])) return addrMatch[1];
  }

  // 3. Check hash
  if (location.hash) {
    const hashMatch = location.hash.match(/([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})/);
    if (hashMatch && isValidSfId(hashMatch[1])) return hashMatch[1];
  }

  // 4. Check active DOM tab or record container
  const domCandidates = [
    document.querySelector("div.windowViewMode-normal.active [data-record-id]"),
    document.querySelector("section.oneConsoleTab.active [data-record-id]"),
    document.querySelector("[data-record-id]"),
    document.querySelector(".forceHighlightsPanel")
  ];
  for (const el of domCandidates) {
    const id = el?.getAttribute("data-record-id") || el?.dataset?.recordId;
    if (isValidSfId(id)) return id;
  }

  return null;
}

// ─── Utility: Toggle API Field Names on Page ────────────────────────
function toggleFieldApiNames(show) {
  const MARK_CLASS = "sfpi-api-name";
  if (show) {
    document
      .querySelectorAll(
        "record_flexipage-record-field > div, records-record-layout-item > div, div .forcePageBlockItemView"
      )
      .forEach((field) => {
        const label = field.querySelector("span");
        if (field.dataset.targetSelectionName && label && !label.querySelector("." + MARK_CLASS)) {
          const parts = field.dataset.targetSelectionName.split(".");
          const apiName = parts[2] || parts[parts.length - 1];
          const mark = document.createElement("mark");
          mark.className = MARK_CLASS;
          mark.style.cssText =
            "cursor:copy;background:#e1f5fe;color:#01579b;font-size:11px;padding:1px 4px;border-radius:3px;margin-left:4px;";
          mark.textContent = apiName;
          mark.addEventListener("click", () => {
            navigator.clipboard.writeText(apiName);
            mark.textContent = "✓ Copied";
            setTimeout(() => (mark.textContent = apiName), 1500);
          });
          label.appendChild(mark);
        }
      });
  } else {
    document.querySelectorAll("." + MARK_CLASS).forEach((el) => el.remove());
  }
}

// ─── Environment Safety Shields (Sandbox Banner & Prod Border) ───────
function applySandboxBanner(sfHost) {
  const orgInfo = localStorage.getItem(sfHost + "_orgInfo");
  if (!orgInfo) return;
  try {
    const info = JSON.parse(orgInfo);

    // 1. Title Environment Prefix
    if (localStorage.getItem("sfpi_titlePrefix") !== "false") {
      const prefix = info.isSandbox ? "[SANDBOX]" : (info.isProduction ? "[PROD]" : "[DEV]");
      if (!document.title.startsWith("[")) {
        document.title = `${prefix} ${document.title}`;
      }
    }

    // 2. Sandbox Warning Banner
    if (info.isSandbox && localStorage.getItem("sfpi_sandboxBanner") !== "false") {
      document.querySelector(".sfpi-sandbox-banner")?.remove();
      const bannerColor = localStorage.getItem("sfpi_bannerColor") || "#ff9800";
      const customText = localStorage.getItem("sfpi_bannerText") || "SANDBOX ENVIRONMENT";
      const banner = document.createElement("div");
      banner.className = "sfpi-sandbox-banner";
      banner.style.cssText = `
        position:fixed;top:0;left:0;right:0;z-index:99999;
        background:${bannerColor};color:#fff;text-align:center;
        font-size:12px;font-weight:700;padding:3px 0;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
        box-shadow: 0 1px 4px rgba(0,0,0,0.25);
        letter-spacing: 0.5px;
      `;
      banner.textContent = `⚠️ ${customText} — ${info.orgName || sfHost}`;
      document.body?.prepend(banner);
      if (document.body) document.body.style.paddingTop = "24px";
    }

    // 3. Production Org Safety Shield Border
    if (info.isProduction && localStorage.getItem("sfpi_prodBanner") !== "false") {
      document.querySelector(".sfpi-prod-shield")?.remove();
      const shield = document.createElement("div");
      shield.className = "sfpi-prod-shield";
      shield.style.cssText = `
        position:fixed;top:0;left:0;right:0;height:4px;
        background:#dc2626;z-index:999999;
        box-shadow: 0 0 10px rgba(220,38,38,0.7);
        pointer-events:none;
      `;
      document.body?.prepend(shield);
    }
  } catch (e) {
    /* ignore parse errors */
  }
}
