/**
 * SF Power Inspector — Background Service Worker
 * Handles session management, cookie operations, keyboard shortcuts,
 * telemetry, live counting, subscriptions, and inter-component messaging.
 */

import {
  recordInstallEvent,
  getTelemetryStats,
  recordHeartbeat,
  recordSubscription,
  getSubscriptionStatus,
  isExperienceDue,
  recordExperienceFeedback,
  enableExperiencePreviewMode
} from "./telemetry-service.js";

const hostByTab = new Map();
const sessionCache = new Map();
const orgIdByHost = new Map();

// ─── Non-Org / Public Salesforce Domains to Exclude ─────────────────
const SF_EXCLUDED_HOSTS = new Set([
  "status.salesforce.com",
  "trust.salesforce.com",
  "help.salesforce.com",
  "trailhead.salesforce.com",
  "developer.salesforce.com",
  "appexchange.salesforce.com",
  "www.salesforce.com",
  "trailblazer.me"
]);

function isExcludedSfHost(host) {
  if (!host || typeof host !== "string") return true;
  const h = host.toLowerCase().trim().replace(/^\./, "");
  return (
    SF_EXCLUDED_HOSTS.has(h) ||
    h.startsWith("status.") ||
    h.startsWith("trust.") ||
    h.startsWith("help.") ||
    h.startsWith("trailhead.") ||
    h.startsWith("developer.") ||
    h.startsWith("appexchange.") ||
    h.startsWith("www.") ||
    h.includes("trailblazer.me") ||
    h.includes("status.salesforce")
  );
}

/**
 * Normalizes any Salesforce UI, Visualforce, Community, or Experience domain
 * into its corresponding authoritative API host.
 * Supports:
 * - All Sandboxes (Enhanced Domains, Classic CS instances, custom prefixes)
 * - Developer Edition & Scratch Orgs
 * - Production & Trailhead Playgrounds
 * - Government Cloud (*.salesforce.mil, *.force.mil)
 * - Cloudforce (*.cloudforce.com)
 * - China Cloud (*.sfcrmproducts.cn, *.sfcrmapps.cn)
 * - Microsoft Defender for Cloud Apps (*.mcas.ms)
 */
function normalizeToApiHost(domain) {
  if (!domain) return domain;
  let d = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^\./, "").toLowerCase();
  d = d.replace(/\.mcas\.ms$/, "");

  // Auto-heal any Developer Edition host missing .develop. subdomain before and after conversion
  if (d.includes("-dev-ed") && !d.includes(".develop.")) {
    d = d.replace(/-dev-ed(?!\.develop)/g, "-dev-ed.develop");
  }

  // 1. Lightning UI to My Domain (Enhanced Domains, Standard, Develop, Trailblaze, Sandboxes)
  d = d.replace(/\.lightning\.force\.com$/i, ".my.salesforce.com");
  d = d.replace(/\.lightning\.force\.mil$/i, ".my.salesforce.mil");
  d = d.replace(/\.lightning\.cloudforce\.com$/i, ".my.cloudforce.com");
  d = d.replace(/\.lightning\.sfcrmproducts\.cn$/i, ".my.sfcrmproducts.cn");

  // 2. Lightning with instance name: company--sandbox.lightning.cs123.force.com -> company--sandbox.cs123.my.salesforce.com
  d = d.replace(/\.lightning\.([a-z0-9_-]+)\.force\.com$/i, ".$1.my.salesforce.com");

  // 3. Visualforce domains to parent API domain
  d = d.replace(/--c\.(sandbox\.)?vf\.force\.com$/i, (m, g1) => (g1 ? ".sandbox.my.salesforce.com" : ".my.salesforce.com"));
  d = d.replace(/--c\.[^.]+\.visual\.force\.com$/i, ".my.salesforce.com");
  d = d.replace(/--c\.(sandbox\.)?visualforce\.com$/i, (m, g1) => (g1 ? ".sandbox.my.salesforce.com" : ".my.salesforce.com"));
  d = d.replace(/--c\.visualforce\.com$/i, ".my.salesforce.com");
  d = d.replace(/^c\.([a-z0-9]+)\.visual\.force\.com$/i, "$1.salesforce.com");

  // 4. Experience Cloud / Communities to parent API domain
  d = d.replace(/\.builder\.salesforce-experience\.com$/i, () => (d.includes("--") ? ".sandbox.my.salesforce.com" : ".my.salesforce.com"));
  d = d.replace(/\.(preview|live-preview)\.salesforce-experience\.com$/i, () => (d.includes("--") ? ".sandbox.my.salesforce.com" : ".my.salesforce.com"));

  // Ensure Developer Edition healing applies after all lightning/VF replacements too
  if (d.includes("-dev-ed") && !d.includes(".develop.")) {
    d = d.replace(/-dev-ed(?!\.develop)/g, "-dev-ed.develop");
  }

  // 5. Classic sandbox or production instance hosts (e.g. cs123.salesforce.com, na45.salesforce.com)
  // are already direct API hosts; preserve them without mangling.
  return d;
}

// ─── Cookie Helper Functions (Zero-Throw in Chromium) ───────────────
function safeCookieGet(url, name, storeId) {
  const details = { url, name };
  if (storeId && typeof storeId === "string") details.storeId = storeId;
  return new Promise((resolve) => {
    try {
      chrome.cookies.get(details, (c) => resolve(c || null));
    } catch (e) {
      resolve(null);
    }
  });
}

function safeCookieGetAll(opts = {}) {
  const details = { name: opts.name || "sid" };
  if (opts.domain) details.domain = opts.domain;
  if (opts.secure !== undefined) details.secure = opts.secure;
  if (opts.storeId && typeof opts.storeId === "string") details.storeId = opts.storeId;
  return new Promise((resolve) => {
    try {
      chrome.cookies.getAll(details, (cookies) => {
        if (chrome.runtime.lastError) {
          resolve([]);
        } else {
          resolve(cookies || []);
        }
      });
    } catch (e) {
      resolve([]);
    }
  });
}

// ─── Message Handler ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // 1. Resolve the authoritative Salesforce API host dynamically for any org/sandbox
  if (request.message === "getSfHost") {
    let currentDomain = "";
    try {
      currentDomain = new URL(request.url).hostname.replace(/^\./, "").toLowerCase();
    } catch (e) {}

    if (isExcludedSfHost(currentDomain)) {
      sendResponse("");
      return true;
    }

    (async () => {
      try {
        let chosenDomain = normalizeToApiHost(currentDomain);

        // Record orgId if cookie exists
        const cookie = await safeCookieGet(request.url, "sid", sender.tab?.cookieStoreId);
        if (cookie && cookie.value) {
          const [orgId] = cookie.value.split("!");
          if (orgId) {
            orgIdByHost.set(chosenDomain.toLowerCase(), orgId);
            orgIdByHost.set(currentDomain.toLowerCase(), orgId);
          }
        }

        // Only search other cookie domains if currentDomain is a generic or visualforce domain
        const isGenericOrVF = currentDomain.includes(".vf.force.") ||
                              currentDomain.includes(".visualforce.") ||
                              currentDomain.includes(".visual.force.") ||
                              currentDomain === "salesforce.com" ||
                              currentDomain === "force.com" ||
                              currentDomain.split(".").length <= 2;

        if (isGenericOrVF && cookie && cookie.value) {
          const [orgId] = cookie.value.split("!");
          if (orgId) {
            let cookies = await safeCookieGetAll({ name: "sid", secure: true, storeId: sender.tab?.cookieStoreId });
            if (cookies.length === 0 && sender.tab?.cookieStoreId) {
              cookies = await safeCookieGetAll({ name: "sid", secure: true });
            }

            const matching = cookies.filter(
              (c) => c.value && c.value.startsWith(orgId + "!") &&
                     !isExcludedSfHost(c.domain) &&
                     !c.domain.includes(".vf.force.") &&
                     !c.domain.includes(".visualforce.")
            );

            if (matching.length > 0) {
              const myDomain = matching.find(c => c.domain.includes(".my.salesforce.") || c.domain.includes(".salesforce.com"));
              if (myDomain) {
                const dom = myDomain.domain.replace(/^\./, "");
                if (dom !== "salesforce.com" && dom !== "force.com" && dom.split(".").length > 2 && !isExcludedSfHost(dom)) {
                  chosenDomain = normalizeToApiHost(dom);
                }
              }
            }
          }
        }

        sendResponse(chosenDomain);
      } catch (err) {
        sendResponse(normalizeToApiHost(currentDomain));
      }
    })();
    return true; // async sendResponse
  }

  // 1b. Clear cached sessions on demand (e.g. after 401 or logout)
  if (request.message === "clearSession" || request.message === "clearSessionCache") {
    sessionCache.clear();
    orgIdByHost.clear();
    sendResponse({ success: true });
    return true;
  }

  // 2. Retrieve session details dynamically across any org or sandbox
  //    Matches the proven Salesforce Inspector Reloaded pattern:
  //    1. Direct cookie lookup on the requested host
  //    2. Fallback: search by orgId across known Salesforce domains
  if (request.message === "getSession") {
    if (sender.tab?.id && request.sfHost && !isExcludedSfHost(request.sfHost)) {
      hostByTab.set(sender.tab.id, request.sfHost);
    }
    let cleanHost = request.sfHost ? normalizeToApiHost(request.sfHost) : "";

    if (!cleanHost || isExcludedSfHost(cleanHost)) {
      sendResponse(null);
      return true;
    }

    (async () => {
      try {
        const storeId = sender.tab?.cookieStoreId;

        // Step 1: Direct cookie get on the My Domain API host (always fresh, most common path)
        const directCookie = await safeCookieGet("https://" + cleanHost, "sid", storeId);
        if (directCookie && directCookie.value) {
          const session = { key: directCookie.value, hostname: cleanHost };
          sessionCache.set(cleanHost, session);
          sendResponse(session);
          return;
        }

        // Step 2: Try the Lightning variant (cookie is often set on lightning domain)
        const candidateHosts = [];
        if (cleanHost.includes(".my.salesforce.")) {
          candidateHosts.push(cleanHost.replace(/\.my\.salesforce\./, ".lightning.force."));
        }
        if (cleanHost.includes(".lightning.force.")) {
          candidateHosts.push(cleanHost.replace(/\.lightning\.force\./, ".my.salesforce."));
        }
        if (cleanHost.includes("-dev-ed.develop.")) {
          candidateHosts.push(cleanHost.replace("-dev-ed.develop.", "-dev-ed."));
        }
        if (cleanHost.includes(".develop.")) {
          candidateHosts.push(cleanHost.replace(".develop.", "."));
        }
        if (cleanHost.includes(".sandbox.")) {
          candidateHosts.push(cleanHost.replace(/\.sandbox\./, "."));
        }

        for (const alt of candidateHosts) {
          const altCookie = await safeCookieGet("https://" + alt.replace(/^\./, ""), "sid", storeId);
          if (altCookie && altCookie.value) {
            const session = { key: altCookie.value, hostname: cleanHost };
            sessionCache.set(cleanHost, session);
            sendResponse(session);
            return;
          }
        }

        // Step 3: Broad search across known Salesforce cookie domains (matches reference pattern)
        // This handles VF pages, Experience Cloud, and cross-domain scenarios
        const orderedDomains = ["salesforce.com", "cloudforce.com", "salesforce.mil", "cloudforce.mil", "sfcrmproducts.cn", "force.com"];

        // First, get orgId from any available cookie on the current page
        let knownOrgId = cleanHost ? orgIdByHost.get(cleanHost) : null;

        // Try to find orgId from any sid cookie on candidate domains
        if (!knownOrgId) {
          for (const domain of orderedDomains) {
            const domainCookies = await safeCookieGetAll({ name: "sid", domain, secure: true, storeId });
            for (const c of domainCookies) {
              if (c.value && c.domain) {
                const d = c.domain.replace(/^\./, "").toLowerCase();
                const hostPrefix = cleanHost.split(".")[0];
                if (d.includes(hostPrefix) || d.includes(hostPrefix.split("--")[0])) {
                  knownOrgId = c.value.split("!")[0];
                  break;
                }
              }
            }
            if (knownOrgId) break;
          }
        }

        // Now search for the best matching cookie using orgId
        if (knownOrgId) {
          for (const domain of orderedDomains) {
            const domainCookies = await safeCookieGetAll({ name: "sid", domain, secure: true, storeId });
            const match = domainCookies.find(c =>
              c.value && c.value.startsWith(knownOrgId + "!") &&
              c.domain !== "help.salesforce.com" &&
              !c.domain.includes("trailhead")
            );
            if (match) {
              const session = { key: match.value, hostname: cleanHost };
              sessionCache.set(cleanHost, session);
              sendResponse(session);
              return;
            }
          }
        }

        // Step 4: Last resort — global scan of all sid cookies
        let allCookies = await safeCookieGetAll({ name: "sid", storeId });
        if (allCookies.length === 0 && storeId) {
          allCookies = await safeCookieGetAll({ name: "sid" });
        }

        const hostPrefix = cleanHost.split(".")[0];
        const coreOrg = hostPrefix.split("--")[0];

        // Find cookie that matches our host prefix
        const prefixMatch = allCookies.find(c => {
          if (!c.value || !c.domain) return false;
          const d = c.domain.replace(/^\./, "").toLowerCase();
          if (d === "help.salesforce.com" || d.includes("trailhead")) return false;
          return d.includes(hostPrefix) || d.includes(coreOrg);
        });

        if (prefixMatch) {
          const session = { key: prefixMatch.value, hostname: cleanHost };
          sessionCache.set(cleanHost, session);
          sendResponse(session);
          return;
        }

        sendResponse(null);
      } catch (err) {
        console.error("[background] getSession error:", err);
        sendResponse(null);
      }
    })();

    return true;
  }

  // 2b. Elevated Proxy Fetch to bypass CORS preflights and browser network blocks
  if (request.message === "proxyFetch") {
    let { url, options = {} } = request;
    // Auto-heal Developer Edition host missing .develop. subdomain in requested URL
    if (url && url.includes("-dev-ed") && !url.includes(".develop.")) {
      url = url.replace(/-dev-ed(?!\.develop)/g, "-dev-ed.develop");
    }

    (async () => {
      try {
        const method = options.method || "GET";

        // Clean headers: remove any undefined/null values that survived JSON serialization
        const cleanHeaders = {};
        if (options.headers && typeof options.headers === "object") {
          for (const [k, v] of Object.entries(options.headers)) {
            if (v !== undefined && v !== null && v !== "undefined" && v !== "null") {
              cleanHeaders[k] = String(v);
            }
          }
        }

        const fetchOptions = {
          method,
          headers: cleanHeaders
        };
        // Never send body on GET/HEAD
        if (method !== "GET" && method !== "HEAD" && options.body !== undefined && options.body !== null) {
          fetchOptions.body = options.body;
        }

        const res = await fetch(url, fetchOptions);

        // Check for login redirection (indicates session invalid/expired)
        const isLoginRedirect = res.redirected && (res.url.includes("login.salesforce.com") || res.url.includes("/login/"));
        if (isLoginRedirect) {
          sendResponse({
            ok: false,
            status: 401,
            statusText: "Unauthorized",
            data: "Session expired or invalid. Please refresh your Salesforce tab.",
            error: "Session expired or invalid. Please refresh your Salesforce tab.",
            contentType: "text/plain"
          });
          return;
        }

        const contentType = res.headers.get("content-type") || "";
        let body;
        if (contentType.includes("application/json")) {
          try {
            body = await res.json();
          } catch (e) {
            body = await res.text();
          }
        } else {
          body = await res.text();
        }

        const responsePayload = {
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          headers: Object.fromEntries(res.headers.entries()),
          data: body,
          error: res.ok ? null : (typeof body === "string" ? body : JSON.stringify(body)),
          contentType
        };
        sendResponse(responsePayload);
      } catch (err) {
        console.error("[background] proxyFetch error:", err);

        // Dynamic self-healing retry on candidate URL (e.g. if lightning vs my.salesforce host issue)
        let retrySucceeded = false;
        try {
          let candidateUrl = null;
          if (url.includes("-dev-ed") && !url.includes(".develop.")) {
            candidateUrl = url.replace(/-dev-ed(?!\.develop)/g, "-dev-ed.develop");
          } else if (url.includes(".lightning.force.")) {
            candidateUrl = url.replace(/\.lightning\.force\./, ".my.salesforce.");
          }
          if (candidateUrl && candidateUrl !== url) {
            const retryRes = await fetch(candidateUrl, fetchOptions);
            const contentType = retryRes.headers.get("content-type") || "";
            let body = contentType.includes("application/json") ? await retryRes.json() : await retryRes.text();
            sendResponse({
              ok: retryRes.ok,
              status: retryRes.status,
              statusText: retryRes.statusText,
              headers: Object.fromEntries(retryRes.headers.entries()),
              data: body,
              error: retryRes.ok ? null : (typeof body === "string" ? body : JSON.stringify(body)),
              contentType
            });
            retrySucceeded = true;
            return;
          }
        } catch (retryErr) {
          // Retry failed, fallback to original error
        }

        if (!retrySucceeded) {
          sendResponse({
            ok: false,
            status: 0,
            data: err.message || "Network request failed in background worker",
            error: err.message || "Network request failed in background worker"
          });
        }
      }
    })();
    return true; // async sendResponse
  }

  // 2b. Get active tab's Salesforce host if not provided in URL
  if (request.message === "getActiveSfHost") {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      let host = null;
      if (tabs && tabs[0] && tabs[0].url) {
        try {
          const u = new URL(tabs[0].url);
          const h = u.hostname.toLowerCase();
          if (
            (h.includes("salesforce.com") ||
             h.includes("force.com") ||
             h.includes("cloudforce.com")) &&
            !isExcludedSfHost(h)
          ) {
            host = u.hostname;
          }
        } catch (e) {}
      }
      sendResponse(host);
    });
    return true;
  }

  // 3. Create a new browser window (for popping out tools or incognito login)
  if (request.message === "createWindow") {
    try {
      chrome.windows.create({
        url: request.url,
        incognito: Boolean(request.incognito),
        type: request.type || "normal",
        width: request.width || 1280,
        height: request.height || 850,
      }, (createdWin) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: Boolean(createdWin) });
        }
      });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true; // Keep message channel open for async response
  }

  // 4. Reload current tab
  if (request.message === "reloadPage") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.reload(tabs[0].id);
    });
  }

  // 5. Copy to clipboard
  if (request.message === "copyToClipboard") {
    // Offscreen or fallback copy
    sendResponse({ success: true });
  }

  // 5b. Toggle Org Dark Mode across all Salesforce tabs
  if (request.message === "setOrgDarkMode") {
    const enabled = request.enabled === true;
    chrome.storage.local.set({ sfpi_orgDarkMode: enabled }, () => {
      // Broadcast to ALL Salesforce tabs so they toggle immediately
      chrome.tabs.query({}, (tabs) => {
        const sfDomains = [".salesforce.com", ".force.com", ".cloudforce.com", ".visualforce.com",
                          ".salesforce-setup.com", ".sfcrmapps.cn", ".sfcrmproducts.cn",
                          ".salesforce.mil", ".force.mil", ".cloudforce.mil", ".crmforce.mil",
                          ".builder.salesforce-experience.com"];
        for (const tab of tabs) {
          if (tab.url) {
            try {
              const u = new URL(tab.url);
              const isSf = sfDomains.some(d => u.hostname.endsWith(d) || u.hostname === d.replace(/^\./, "")) ||
                           u.hostname.includes("force.com") || u.hostname.includes("salesforce.com");
              if (isSf) {
                chrome.tabs.sendMessage(tab.id, {
                  message: "toggleOrgDarkMode",
                  enabled: enabled
                }).catch(() => {});
              }
            } catch (e) {}
          }
        }
      });
    });
    sendResponse({ success: true });
    return true;
  }

  // 5c. Get Org Dark Mode status
  if (request.message === "getOrgDarkMode") {
    chrome.storage.local.get(["sfpi_orgDarkMode"], (result) => {
      sendResponse({
        enabled: result.sfpi_orgDarkMode === true
      });
    });
    return true;
  }

  // 5d. Broadcast settings updates
  if (request.message === "settingsUpdated") {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, request).catch(() => {});
        }
      });
    });
    sendResponse({ success: true });
    return true;
  }

  // 6. Show notification
  if (request.message === "showNotification") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "images/icon128.png",
      title: request.title || "SF Power Inspector",
      message: request.body || "",
    });
  }

  // 7. Telemetry, Live Users & Subscription Message Handlers
  if (request.message === "getTelemetryStats") {
    sendResponse(getTelemetryStats());
    return true;
  }

  if (request.message === "recordHeartbeat") {
    sendResponse(recordHeartbeat());
    return true;
  }

  if (request.message === "recordSubscription") {
    sendResponse(recordSubscription(request.data));
    return true;
  }

  if (request.message === "getSubscriptionStatus") {
    sendResponse(getSubscriptionStatus());
    return true;
  }

  if (request.message === "recordExperienceFeedback") {
    sendResponse(recordExperienceFeedback(request.data));
    return true;
  }

  if (request.message === "openWelcomePage") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
    sendResponse({ success: true });
    return true;
  }

  if (request.message === "openExperiencePage") {
    if (request.preview) enableExperiencePreviewMode();
    chrome.tabs.create({ url: chrome.runtime.getURL("experience.html?ref=preview") });
    sendResponse({ success: true });
    return true;
  }

  return false;
});

// ─── Tab Cleanup ─────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => hostByTab.delete(tabId));

// ─── Extension Icon Click → Open Popup ──────────────────────────────
chrome.action.onClicked.addListener((tab) => {
  chrome.runtime.sendMessage({
    msg: "shortcut_pressed",
    sfHost: hostByTab.get(tab.id),
    command: "open-popup",
  });
});

// ─── Keyboard Shortcuts ─────────────────────────────────────────────
chrome.commands?.onCommand.addListener((command, tab) => {
  const sfHost = hostByTab.get(tab.id);
  if (!sfHost) return;

  const quickLinks = {
    "link-setup": "/lightning/setup/SetupOneHome/home",
    "link-home": "/",
    "link-dev": "/_ui/common/apex/debug/ApexCSIPage",
  };

  if (quickLinks[command]) {
    chrome.tabs.create({ url: `https://${sfHost}${quickLinks[command]}` });
  } else if (command.startsWith("open-")) {
    chrome.runtime.sendMessage({ msg: "shortcut_pressed", command, sfHost });
  } else {
    // Open the tool page in a new tab
    chrome.tabs.create({
      url: `chrome-extension://${chrome.runtime.id}/${command}.html?host=${sfHost}`,
    });
  }
});

// ─── First Install Welcome & 2-Hour Experience Scheduling ───────────
chrome.runtime.onInstalled.addListener((details) => {
  recordInstallEvent();

  if (details.reason === "install") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("welcome.html?installed=true"),
    });
  }
});

// ─── 2-Hour Post-Installation Experience Alarm ──────────────────────
if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "sfpi_post_install_experience_2h") {
      if (isExperienceDue()) {
        chrome.tabs.create({
          url: chrome.runtime.getURL("experience.html?ref=2h_alarm"),
        });
        if (chrome.notifications?.create) {
          try {
            chrome.notifications.create("sfpi-2h-experience", {
              type: "basic",
              iconUrl: "images/icon128.png",
              title: "⭐ 2 Hours with SF Power Inspector PRO",
              message: "How has your experience been? Rate features, explore tips, or subscribe to update drops!",
              priority: 1
            });
          } catch (e) {}
        }
      }
    }
  });
}

console.log("[SF Power Inspector] Background service worker started.");

