/**
 * SF Power Inspector — Salesforce Connection Module
 * Reverse-engineers Salesforce session from browser cookies and provides
 * a unified API layer for REST, Tooling, Metadata, Bulk, and GraphQL APIs.
 */

export const DEFAULT_API_VERSION = "62.0";
export let apiVersion = (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function" ? localStorage.getItem("sfpi_apiVersion") : null) || DEFAULT_API_VERSION;
export let sessionError = null;

// Dynamic Extension Release Version (reads dynamically from manifest.json on every release)
export const extManifest = (typeof chrome !== "undefined" && chrome.runtime?.getManifest) ? chrome.runtime.getManifest() : null;
export const extensionVersion = extManifest?.version_name ? `v${extManifest.version_name}` : (extManifest?.version ? `v${extManifest.version}` : "v1.0");

const CLIENT_ID = "SF_Power_Inspector";

// ─── Universal Host Validator & Resolver ─────────────────────────────
export const SF_EXCLUDED_HOSTS = new Set([
  "status.salesforce.com",
  "trust.salesforce.com",
  "help.salesforce.com",
  "trailhead.salesforce.com",
  "developer.salesforce.com",
  "appexchange.salesforce.com",
  "www.salesforce.com",
  "trailblazer.me"
]);

export function isExcludedSfHost(host) {
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

// ─── Universal Host Resolver & History Sync ─────────────────────────
export function resolveSfHost() {
  if (typeof window === "undefined") return "";
  let host = new URLSearchParams(window.location.search).get("host") || "";

  if (isExcludedSfHost(host)) {
    host = "";
  }

  if (!host) {
    try {
      const activeHost = sessionStorage.getItem("sfpi_active_host") || localStorage.getItem("sfpi_last_host") || "";
      if (!isExcludedSfHost(activeHost)) {
        host = activeHost;
      }
    } catch (e) {}
  }

  if (!host) {
    try {
      const keys = Object.keys(localStorage).filter(k => 
        (k.includes("_orgInfo") || k.includes("_access_token")) &&
        !isExcludedSfHost(k.replace("_orgInfo", "").replace("_access_token", ""))
      );
      if (keys.length > 0) {
        host = keys[0].replace("_orgInfo", "").replace("_access_token", "");
      }
    } catch (e) {}
  }

  if (host && host.includes("-dev-ed") && !host.includes(".develop.")) {
    host = host.replace(/-dev-ed(?!\.develop)/g, "-dev-ed.develop");
  }

  if (host && !isExcludedSfHost(host)) {
    try {
      sessionStorage.setItem("sfpi_active_host", host);
      localStorage.setItem("sfpi_last_host", host);
      const u = new URL(window.location.href);
      if (!u.searchParams.get("host")) {
        u.searchParams.set("host", host);
        window.history.replaceState({}, document.title, u.toString());
      }
    } catch (e) {}
  }

  return isExcludedSfHost(host) ? "" : host;
}

// ─── Main Connection Object ─────────────────────────────────────────
export const sfConn = {
  instanceHostname: null,
  sessionId: null,

  /**
   * Establish session using browser cookies or OAuth token
   */
  async getSession(sfHost) {
    if (isExcludedSfHost(sfHost)) {
      sfHost = "";
    }

    if (!sfHost) {
      // Try asking background for active tab's Salesforce host with timeout
      sfHost = await new Promise((resolve) => {
        if (typeof chrome === "undefined" || !chrome.runtime?.id) { resolve(null); return; }
        const timer = setTimeout(() => resolve(null), 2500);
        try {
          chrome.runtime.sendMessage({ message: "getActiveSfHost" }, (res) => {
            clearTimeout(timer);
            if (chrome.runtime?.lastError) { resolve(null); return; }
            resolve(res && !isExcludedSfHost(res) ? res : null);
          });
        } catch (e) {
          clearTimeout(timer);
          resolve(null);
        }
      });
    }

    if (!sfHost || isExcludedSfHost(sfHost)) {
      // Try local storage cache for legitimate org hosts only
      const keys = Object.keys(localStorage).filter(k => 
        (k.includes("_orgInfo") || k.includes("_access_token")) &&
        !isExcludedSfHost(k.replace("_orgInfo", "").replace("_access_token", ""))
      );
      if (keys.length > 0) {
        sfHost = keys[0].replace("_orgInfo", "").replace("_access_token", "");
      }
    }

    // Auto-heal Developer Edition host missing .develop. subdomain
    if (sfHost && sfHost.includes("-dev-ed") && !sfHost.includes(".develop.")) {
      sfHost = sfHost.replace(/-dev-ed(?!\.develop)/g, "-dev-ed.develop");
    }

    sfHost = this._getMyDomain(sfHost);
    this.instanceHostname = sfHost;

    if (!sfHost) return null;

    // 1. Prioritize live browser cookie session (matches Salesforce Inspector Reloaded)
    const message = await new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.runtime?.id) { resolve(null); return; }
      try {
        chrome.runtime.sendMessage({ message: "getSession", sfHost }, (res) => {
          if (chrome.runtime?.lastError) {
            resolve(null);
            return;
          }
          resolve(res);
        });
      } catch (e) {
        resolve(null);
      }
    });

    if (message && message.key) {
      this.sessionId = message.key;
      if (message.hostname) {
        const cookieHost = this._getMyDomain(message.hostname);
        const isGeneric = cookieHost === "salesforce.com" || cookieHost === "force.com" || cookieHost.split(".").length <= 2;
        if (!isGeneric) {
          this.instanceHostname = cookieHost;
        }
      }
    } else {
      // 2. Fall back to stored OAuth token if cookie was not accessible
      const storedToken = localStorage.getItem(sfHost + "_access_token");
      if (storedToken) {
        this.sessionId = storedToken;
      }
    }

    // Compute preliminary info immediately from hostname so UI has instant accurate state
    const preliminary = extractSandboxDetails(sfHost);
    const cachedStr = localStorage.getItem(sfHost + "_orgInfo");
    let cachedInfo = cachedStr ? JSON.parse(cachedStr) : null;
    const needsRefresh =
      !cachedInfo ||
      !cachedInfo._liveVerified ||
      !cachedInfo.orgName ||
      !cachedInfo.orgType ||
      cachedInfo.isSandbox === undefined ||
      (Date.now() - (cachedInfo._lastFetched || 0) > 180000) ||
      (preliminary.isSandbox && !cachedInfo.isSandbox) ||
      (preliminary.sandboxName && !cachedInfo.sandboxName);

    if (!cachedInfo) {
      cachedInfo = {
        _liveVerified: false,
        _lastFetched: 0,
        isSandbox: preliminary.isSandbox,
        envType: preliminary.envType,
        environment: preliminary.environment,
        sandboxName: preliminary.sandboxName,
        orgName: sfHost ? sfHost.split(".")[0].split("--")[0] : "",
        orgType: preliminary.envType === "DEVELOPER EDITION" ? "Developer Edition" : "",
        instance: preliminary.instance || "",
      };
      localStorage.setItem(sfHost + "_orgInfo", JSON.stringify(cachedInfo));
    }

    // Refresh org metadata if needed — multi-tiered for all end users (admin & non-admin)
    if (this.sessionId && needsRefresh) {
      try {
        let org = null;
        try {
          // Tier 1: Full administrative fields
          const res = await this.rest(
            `/services/data/v${apiVersion}/query/?q=SELECT+Id,+IsSandbox,+InstanceName,+TrialExpirationDate,+OrganizationType,+Name+FROM+Organization+LIMIT+1`,
            { logErrors: false }
          );
          org = res?.records?.[0];
        } catch (eFull) {
          // Tier 2: Basic fields accessible to standard non-admin users
          try {
            const resBasic = await this.rest(
              `/services/data/v${apiVersion}/query/?q=SELECT+Id,+IsSandbox,+InstanceName,+Name+FROM+Organization+LIMIT+1`,
              { logErrors: false }
            );
            org = resBasic?.records?.[0];
          } catch (eBasic) {
            // Expected for non-admin profiles; quietly fallback to userinfo
          }
        }

        // Tier 3: Query current user info (100% accessible to all authenticated Salesforce users)
        let userInfo = null;
        try {
          userInfo = await this.rest("/services/oauth2/userinfo", { logErrors: false });
        } catch (ue) {}

        if (org || userInfo) {
          const username = userInfo?.preferred_username || null;
          const details = extractSandboxDetails(sfHost, org || {}, username);

          // If instance is available from userinfo URLs
          let discoveredInstance = org?.InstanceName || details.instance;
          if (!discoveredInstance && userInfo?.urls?.rest) {
            try {
              const u = new URL(userInfo.urls.rest);
              const hostParts = u.hostname.split(".");
              if (/^cs\d+/i.test(hostParts[0])) discoveredInstance = hostParts[0].toUpperCase();
            } catch (e) {}
          }

          const info = {
            _liveVerified: true,
            _lastFetched: Date.now(),
            orgId: org?.Id || userInfo?.organization_id || null,
            userId: userInfo?.user_id || null,
            currentUsername: userInfo?.preferred_username || null,
            isSandbox: details.isSandbox,
            envType: details.envType,
            environment: details.environment,
            sandboxName: details.sandboxName,
            instance: discoveredInstance || "",
            trialExpDate: org?.TrialExpirationDate || null,
            orgType: org?.OrganizationType || details.edition,
            orgName: org?.Name || userInfo?.organization_name || details.companyName,
          };

          cachedInfo = info;
          localStorage.setItem(sfHost + "_orgInfo", JSON.stringify(info));
          if (this.instanceHostname && this.instanceHostname !== sfHost) {
            localStorage.setItem(this.instanceHostname + "_orgInfo", JSON.stringify(info));
          }
          updateNavbarOrgBadge(sfHost, info);
        }
      } catch (e) {
        // Non-fatal background fetch note
      }
    }

    // Dynamically discover latest supported API version in background
    if (this.sessionId && !localStorage.getItem(sfHost + "_apiVersionDiscovered")) {
      this.discoverLatestApiVersion().then(() => {
        localStorage.setItem(sfHost + "_apiVersionDiscovered", "true");
      });
    }

    return this.sessionId;
  },

  /**
   * Discover latest stable Salesforce API version supported by the target org
   */
  async discoverLatestApiVersion() {
    if (!this.instanceHostname || !this.sessionId) return apiVersion;
    try {
      const res = await this.rest("/services/data/", { logErrors: false });
      if (Array.isArray(res) && res.length > 0) {
        const versions = res
          .map((v) => parseFloat(v.version))
          .filter((v) => !isNaN(v) && v >= 40.0)
          .sort((a, b) => b - a);
        if (versions.length > 0) {
          apiVersion = versions[0].toFixed(1);
          localStorage.setItem("sfpi_apiVersion", apiVersion);
        }
      }
    } catch (e) {
      // Non-fatal API discovery fallback
    }
    return apiVersion;
  },

  /**
   * Unified REST API caller
   * Architecture: Matches live Salesforce Inspector Reloaded XHR pattern exactly.
   * Extension pages with host_permissions bypass CORS — direct XHR is the primary engine.
   * Background proxy fetch is a resilient fallback for content-script or edge-case contexts.
   */
  async rest(url, options = {}) {
    const {
      method = "GET",
      body = undefined,
      bodyType = "json",
      responseType = "json",
      api = "normal",
      headers = {},
      logErrors = true,
      useCache = true,
    } = options;

    // Proactively verify / restore session if missing
    if (!this.sessionId && this.instanceHostname) {
      await this.getSession(this.instanceHostname);
    }
    if (!this.sessionId) {
      const activeHost = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ message: "getActiveSfHost" }, (res) => {
            if (chrome.runtime.lastError) { resolve(null); return; }
            resolve(res || null);
          });
        } catch (e) {
          resolve(null);
        }
      });
      if (activeHost) await this.getSession(activeHost);
    }

    if (!this.instanceHostname) {
      throw new Error("Not connected to Salesforce. Please open the inspector from an active Salesforce page.");
    }

    // Auto-heal Developer Edition host missing .develop. subdomain
    if (this.instanceHostname.includes("-dev-ed") && !this.instanceHostname.includes(".develop.")) {
      this.instanceHostname = this.instanceHostname.replace(/-dev-ed(?!\.develop)/g, "-dev-ed.develop");
    }

    if (!this.sessionId) {
      throw new Error("Salesforce session token not found. Please log in or refresh your Salesforce tab.");
    }

    const sfHost = "https://" + this.instanceHostname;

    // Cache-buster to prevent stale responses (matches Salesforce Inspector Reloaded pattern)
    let requestUrl = url;
    if (useCache) {
      requestUrl += (requestUrl.includes("?") ? "&" : "?") + "cache=" + Math.random();
    }
    const fullUrl = new URL(requestUrl, sfHost);

    // Prepare body payload once (used by both XHR and proxy paths)
    let payload = body;
    if (payload !== undefined && bodyType === "json" && typeof payload !== "string") {
      payload = JSON.stringify(payload);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Primary Execution Engine: XMLHttpRequest (matches Salesforce Inspector Reloaded exactly)
    // Extension pages with host_permissions bypass CORS preflights entirely.
    // This is the ONLY engine for extension pages — no proxy fallback needed.
    // ═══════════════════════════════════════════════════════════════════
    if (typeof XMLHttpRequest !== "undefined") {
      const xhr = new XMLHttpRequest();
      if (useCache) {
        requestUrl = url + (url.includes("?") ? "&" : "?") + "cache=" + Math.random();
      } else {
        requestUrl = url;
      }
      const xhrUrl = new URL(requestUrl, sfHost);
      xhr.open(method, xhrUrl.toString(), true);

      // Auth header (matches reference implementation exactly)
      if (api === "bulk") {
        xhr.setRequestHeader("X-SFDC-Session", this.sessionId);
      } else {
        xhr.setRequestHeader("Authorization", "Bearer " + this.sessionId);
      }

      // Custom headers (applied before protected headers)
      const protectedHeaders = ["Sforce-Call-Options", "Authorization", "X-SFDC-Session"];
      for (const [name, val] of Object.entries(headers)) {
        if (!protectedHeaders.includes(name)) {
          xhr.setRequestHeader(name, val);
        }
      }

      // Content-Type only when body is present (avoid triggering unnecessary preflights)
      if (payload !== undefined && !headers["Content-Type"]) {
        xhr.setRequestHeader("Content-Type", "application/json; charset=UTF-8");
      }

      // Accept header
      if (!headers["Accept"]) {
        xhr.setRequestHeader("Accept", "application/json; charset=UTF-8");
      }

      // Sforce-Call-Options LAST to prevent override (matches reference)
      xhr.setRequestHeader("Sforce-Call-Options", `client=${CLIENT_ID}`);

      xhr.responseType = responseType;
      await new Promise((resolve) => {
        xhr.onreadystatechange = () => {
          if (xhr.readyState === 4) {
            resolve();
          }
        };
        xhr.send(payload !== undefined ? payload : null);
      });

      if (xhr.status >= 200 && xhr.status < 400) {
        return xhr.response;
      }

      if (xhr.status === 0) {
        // Network error, offline, or timeout — matches reference implementation pattern
        if (logErrors) { console.error("[SF Power Inspector] Received no response from Salesforce REST API", xhr); }
        const err = new Error("Network error, offline or timeout. Please check your connection and refresh your Salesforce tab.");
        err.name = "SalesforceRestError";
        throw err;
      }

      if (xhr.status === 401) {
        if (!options.suppressSessionError) {
          this.sessionId = null;
          if (this.instanceHostname) localStorage.removeItem(this.instanceHostname + "_access_token");
          if (sfHost) localStorage.removeItem(sfHost + "_access_token");
          try { chrome.runtime?.sendMessage({ message: "clearSessionCache" }); } catch (e) {}
          sessionError = "Session expired. Please refresh your Salesforce tab.";
        }
        let errMsg = "Session expired or invalid";
        try {
          const resp = xhr.response;
          if (Array.isArray(resp) && resp[0]?.message) {
            errMsg = resp[0].message;
          } else if (typeof resp === "string") {
            const parsed = JSON.parse(resp);
            if (parsed[0]?.message) errMsg = parsed[0].message;
          }
        } catch (e) {}
        throw new Error(`API Error 401: ${errMsg}`);
      }

      // All other error statuses
      let errMsg = `HTTP Error ${xhr.status}: ${xhr.statusText}`;
      try {
        const resp = xhr.response;
        if (Array.isArray(resp) && resp[0]?.message) {
          errMsg = resp.map((e) => `${e.errorCode || "ERROR"}: ${e.message}`).join("\n");
        } else if (typeof resp === "string") {
          errMsg = resp;
        } else if (resp && typeof resp === "object") {
          errMsg = JSON.stringify(resp);
        }
      } catch (e) {}
      if (logErrors) console.error(`[SF Power Inspector] API Error ${xhr.status}:`, errMsg);
      throw new Error(`API Error ${xhr.status}: ${errMsg}`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Fallback Engine: Background service worker proxyFetch
    // Only used when XMLHttpRequest is not available (e.g. service worker context).
    // ═══════════════════════════════════════════════════════════════════
    const proxyHeaders = {};
    if (api === "bulk") {
      proxyHeaders["X-SFDC-Session"] = this.sessionId;
    } else {
      proxyHeaders["Authorization"] = "Bearer " + this.sessionId;
    }
    proxyHeaders["Accept"] = "application/json; charset=UTF-8";
    proxyHeaders["Sforce-Call-Options"] = `client=${CLIENT_ID}`;
    if (payload !== undefined) {
      proxyHeaders["Content-Type"] = headers["Content-Type"] || "application/json; charset=UTF-8";
    }
    for (const [name, val] of Object.entries(headers)) {
      if (val !== undefined && val !== null) {
        proxyHeaders[name] = val;
      }
    }

    const proxyRes = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          {
            message: "proxyFetch",
            url: fullUrl.toString(),
            options: {
              method,
              headers: proxyHeaders,
              body: method !== "GET" && method !== "HEAD" ? payload : undefined,
            },
          },
          (res) => {
            if (chrome.runtime.lastError) {
              console.error("[SF Power Inspector] proxyFetch sendMessage error:", chrome.runtime.lastError.message);
              resolve({ ok: false, status: 0, error: chrome.runtime.lastError.message, data: chrome.runtime.lastError.message });
              return;
            }
            resolve(res);
          }
        );
      } catch (msgErr) {
        console.error("[SF Power Inspector] proxyFetch messaging failed:", msgErr);
        resolve({ ok: false, status: 0, error: msgErr.message, data: msgErr.message });
      }
    });

    if (!proxyRes || !proxyRes.ok) {
      const errStr = proxyRes?.error || (typeof proxyRes?.data === "string" ? proxyRes.data : JSON.stringify(proxyRes?.data)) || "Network or API request failed";
      if (proxyRes?.status === 401) {
        if (!options.suppressSessionError) {
          this.sessionId = null;
          if (this.instanceHostname) localStorage.removeItem(this.instanceHostname + "_access_token");
          if (sfHost) localStorage.removeItem(sfHost + "_access_token");
          try { chrome.runtime?.sendMessage({ message: "clearSessionCache" }); } catch (e) {}
          sessionError = "Session expired. Please refresh the page.";
        }
      }
      throw new Error(`API Error ${proxyRes?.status || 0}: ${errStr}`);
    }

    if (responseType === "json") {
      return typeof proxyRes.data === "string" ? JSON.parse(proxyRes.data) : proxyRes.data;
    }
    if (responseType === "text") {
      return typeof proxyRes.data === "string" ? proxyRes.data : JSON.stringify(proxyRes.data);
    }
    return proxyRes.data;
  },

  /**
   * Tooling API shortcut
   */
  async tooling(url, options = {}) {
    const toolingUrl = url.startsWith("/services/data")
      ? url
      : `/services/data/v${apiVersion}/tooling${url}`;
    return this.rest(toolingUrl, options);
  },

  /**
   * Metadata API — describe
   */
  async metadata(type) {
    return this.rest(`/services/data/v${apiVersion}/sobjects/${type}/describe/`);
  },

  /**
   * SOQL Query with auto-pagination
   */
  async query(soql, tooling = false, options = {}) {
    const isTooling = typeof tooling === "object" ? Boolean(tooling.tooling) : Boolean(tooling);
    const opts = typeof tooling === "object" ? tooling : options;
    const base = isTooling
      ? `/services/data/v${apiVersion}/tooling/query/`
      : `/services/data/v${apiVersion}/query/`;
    const url = `${base}?q=${encodeURIComponent(soql)}`;
    let result = await this.rest(url, opts);
    let allRecords = result.records ? [...result.records] : [];

    while (result.nextRecordsUrl) {
      result = await this.rest(result.nextRecordsUrl, opts);
      if (result.records) {
        allRecords.push(...result.records);
      }
    }

    return {
      ...result,
      records: allRecords,
      totalSize: (result.totalSize !== undefined && result.totalSize !== null) ? result.totalSize : allRecords.length
    };
  },

  /**
   * GraphQL API
   */
  async graphql(query, variables = {}) {
    return this.rest(`/services/data/v${apiVersion}/graphql`, {
      method: "POST",
      body: { query, variables },
    });
  },

  /**
   * Composite API (batch multiple requests)
   */
  async composite(requests, allOrNone = false) {
    return this.rest(`/services/data/v${apiVersion}/composite`, {
      method: "POST",
      body: { allOrNone, compositeRequest: requests },
    });
  },

  /**
   * Get all SObject types in the org
   */
  async getSObjects() {
    const cacheKey = "sfpi_sobjects_" + this.instanceHostname;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);

    const result = await this.rest(`/services/data/v${apiVersion}/sobjects/`);
    sessionStorage.setItem(cacheKey, JSON.stringify(result));
    return result;
  },

  /**
   * Describe Global — alias for getSObjects
   */
  async describeGlobal() {
    return this.getSObjects();
  },

  /**
   * Describe SObject — alias for metadata describe
   */
  async describe(sobjectName) {
    return this.metadata(sobjectName);
  },

  /**
   * Normalizes any Salesforce domain (Sandbox, Instance, Lightning, VF, Communities)
   * to its authoritative API host without hardcoding or mangling instance hosts.
   */
  _getMyDomain(host) {
    if (!host) return host;
    let clean = host.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^\./, "").toLowerCase();
    clean = clean.replace(/\.mcas\.ms$/, "");

    // Auto-heal Developer Edition host missing .develop. subdomain
    if (clean.includes("-dev-ed") && !clean.includes(".develop.")) {
      clean = clean.replace(/-dev-ed(?!\.develop)/g, "-dev-ed.develop");
    }

    // 1. Lightning UI to My Domain (Enhanced Domains, Sandboxes & Production)
    clean = clean.replace(/\.lightning\.force\.com$/i, ".my.salesforce.com");
    clean = clean.replace(/\.lightning\.force\.mil$/i, ".my.salesforce.mil");
    clean = clean.replace(/\.lightning\.cloudforce\.com$/i, ".my.cloudforce.com");
    clean = clean.replace(/\.lightning\.sfcrmproducts\.cn$/i, ".my.sfcrmproducts.cn");

    // 2. Lightning with instance name: company--sandbox.lightning.cs123.force.com -> company--sandbox.cs123.my.salesforce.com
    clean = clean.replace(/\.lightning\.([a-z0-9_-]+)\.force\.com$/i, ".$1.my.salesforce.com");

    // 3. Visualforce domains to parent API domain
    clean = clean.replace(/--c\.(sandbox\.)?vf\.force\.com$/i, (m, g1) => (g1 ? ".sandbox.my.salesforce.com" : ".my.salesforce.com"));
    clean = clean.replace(/--c\.[^.]+\.visual\.force\.com$/i, ".my.salesforce.com");
    clean = clean.replace(/--c\.(sandbox\.)?visualforce\.com$/i, (m, g1) => (g1 ? ".sandbox.my.salesforce.com" : ".my.salesforce.com"));
    clean = clean.replace(/--c\.visualforce\.com$/i, ".my.salesforce.com");
    clean = clean.replace(/^c\.([a-z0-9]+)\.visual\.force\.com$/i, "$1.salesforce.com");

    // 4. Experience Cloud / Communities to parent API domain
    clean = clean.replace(/\.builder\.salesforce-experience\.com$/i, () => (clean.includes("--") ? ".sandbox.my.salesforce.com" : ".my.salesforce.com"));
    clean = clean.replace(/\.(preview|live-preview)\.salesforce-experience\.com$/i, () => (clean.includes("--") ? ".sandbox.my.salesforce.com" : ".my.salesforce.com"));

    // Ensure Developer Edition healing applies after all lightning/VF replacements too
    if (clean.includes("-dev-ed") && !clean.includes(".develop.")) {
      clean = clean.replace(/-dev-ed(?!\.develop)/g, "-dev-ed.develop");
    }

    // 5. Classic instance sandboxes (e.g. cs123.salesforce.com) and production instances (na45.salesforce.com)
    // are already valid API endpoints; return them untouched.
    return clean;
  },
};

// ─── Resolve Org Environment & Sandbox Details ───────────────────────
export function getOrgEnvironmentDetails(sfHost, orgInfo = {}, username = null) {
  const host = (sfHost || "").replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
  const org = orgInfo || {};
  let envType = "PRODUCTION";
  let sandboxName = null;
  let isSandbox = false;

  // 1. Check for Sandbox in Hostname (company--sandboxname)
  const sandboxMatch = host.match(/^[a-z0-9_-]+?--([a-z0-9_-]+?)(?:--c)?(?:\.sandbox|\.my|\.lightning|\.cs|\.salesforce|\.force|\.develop|\.trailblaze)/i);
  if (sandboxMatch && sandboxMatch[1]) {
    const candidate = sandboxMatch[1];
    if (candidate !== "c" && candidate !== "lightning" && candidate !== "sandbox") {
      sandboxName = candidate.toUpperCase();
      isSandbox = true;
      envType = "SANDBOX";
    }
  }

  // Check for .sandbox. domain or classic sandbox instances (CSxx)
  if (host.includes(".sandbox.") || /^cs\d+/i.test(host) || /\.cs\d+\./i.test(host)) {
    isSandbox = true;
    envType = "SANDBOX";
  }

  // Any hostname containing '--' is a Salesforce Sandbox (e.g. company--dev, acme--qa)
  if (!isSandbox && host.includes("--")) {
    const dblDashMatch = host.match(/^[a-z0-9_]+--([a-z0-9_]+)/i);
    if (dblDashMatch && dblDashMatch[1]) {
      const part = dblDashMatch[1].toLowerCase();
      if (part !== "c" && part !== "lightning") {
        isSandbox = true;
        envType = "SANDBOX";
        if (!sandboxName && part !== "sandbox") {
          sandboxName = part.toUpperCase();
        }
      }
    }
  }

  // 2. Check Org Metadata (Authoritative)
  if (org.IsSandbox === false || org.isSandbox === false) {
    isSandbox = false;
    if (envType === "SANDBOX") envType = "PRODUCTION";
  } else if (org.IsSandbox === true || org.isSandbox === true) {
    isSandbox = true;
    envType = "SANDBOX";
  }

  const instance = (org.InstanceName || org.instance || "").trim();
  // Classic CS instances are Sandboxes (CS = Classic Sandbox)
  if (/^CS\d+$/i.test(instance)) {
    isSandbox = true;
    envType = "SANDBOX";
  }

  const orgType = (org.OrganizationType || org.orgType || "").trim();
  if (/sandbox/i.test(orgType)) {
    isSandbox = true;
    envType = "SANDBOX";
  }

  // 3. Fallback for Sandbox Name from username (e.g. user@domain.com.dev -> DEV)
  const user = username || org.username;
  if (isSandbox && !sandboxName && user && user.includes(".")) {
    const parts = user.split(".");
    const last = parts[parts.length - 1];
    const commonTlds = ["com", "org", "net", "edu", "gov", "mil", "io", "co", "uk", "in", "de", "ca", "au", "fr", "app"];
    if (last && !commonTlds.includes(last.toLowerCase())) {
      sandboxName = last.toUpperCase();
    }
  }

  // 4. Fallback for Sandbox Name from dashed host
  if (isSandbox && !sandboxName) {
    const dashMatch = host.match(/--([a-z0-9_-]+)/i) || host.match(/-([a-z0-9]+)/i);
    if (dashMatch && dashMatch[1] && !["c", "dev-ed", "lightning", "sandbox"].includes(dashMatch[1].toLowerCase())) {
      sandboxName = dashMatch[1].toUpperCase();
    }
  }

  // If confirmed sandbox without explicit name, default to instance or "SANDBOX"
  if (isSandbox && !sandboxName) {
    sandboxName = instance ? instance.toUpperCase() : "SANDBOX";
  }

  // 5. Non-Sandbox environments (Developer Edition, Scratch Org, Trial, Production)
  if (!isSandbox) {
    if (/developer/i.test(orgType) || host.includes("-dev-ed") || host.includes(".develop.")) {
      envType = "DEVELOPER EDITION";
      sandboxName = "DEV-ED";
    } else if (host.includes(".trailblaze.") || /trailblaze/i.test(orgType)) {
      envType = "TRAILBLAZE ORG";
      sandboxName = "PLAYGROUND";
    } else if (org.TrialExpirationDate || org.trialExpDate) {
      if (/scratch/i.test(orgType)) {
        envType = "SCRATCH ORG";
        sandboxName = "SCRATCH";
      } else {
        envType = "TRIAL ORG";
        sandboxName = "TRIAL";
      }
    } else if (/trial/i.test(orgType)) {
      envType = "TRIAL ORG";
      sandboxName = "TRIAL";
    }
  }

  let edition = orgType;
  if (isSandbox) {
    if (/developer/i.test(orgType) || (sandboxName && (/^dev/i.test(sandboxName) || sandboxName === "DEVELOPER" || sandboxName === "DEV"))) {
      edition = "Developer Sandbox";
    } else if (/developer\s*pro/i.test(orgType)) {
      edition = "Developer Pro Sandbox";
    } else if (/partial/i.test(orgType)) {
      edition = "Partial Copy Sandbox";
    } else if (/full/i.test(orgType)) {
      edition = "Full Sandbox";
    } else if (!edition) {
      edition = "Sandbox";
    }
  } else {
    edition = orgType || (envType === "DEVELOPER EDITION" ? "Developer Edition" : (envType === "PRODUCTION" ? "Enterprise Edition" : envType));
  }
  const companyName = org.Name || org.orgName || (host ? host.split(".")[0].split("--")[0].replace(/-dev-ed$/i, "") : "Salesforce");

  // Dynamic friendly environment name
  let environment = "Production";
  if (isSandbox) {
    environment = (sandboxName && sandboxName !== "SANDBOX") ? `Sandbox (${sandboxName})` : "Sandbox";
  } else if (envType === "DEVELOPER EDITION") {
    environment = "Developer Edition";
  } else if (envType === "SCRATCH ORG") {
    environment = "Scratch Org";
  } else if (envType === "TRIAL ORG") {
    environment = "Trial Org";
  } else if (envType === "TRAILBLAZE ORG") {
    environment = "Trailhead Playground";
  } else {
    environment = "Production";
  }

  return { isSandbox, envType, environment, sandboxName, edition, companyName, instance };
}

// Backwards-compatible alias
export function extractSandboxDetails(sfHost, orgInfo = {}, username = null) {
  const details = getOrgEnvironmentDetails(sfHost, orgInfo, username);
  return {
    isSandbox: details.isSandbox,
    sandboxName: details.sandboxName,
    envType: details.envType,
    environment: details.environment,
    edition: details.edition,
    companyName: details.companyName,
    instance: details.instance
  };
}

// ─── Helper: Update Navbar Environment & Org Badge ──────────────────
export function updateNavbarOrgBadge(sfHost, orgInfo) {
  if (typeof document === "undefined") return;
  const badge = document.getElementById("env-badge") || document.getElementById("navbar-org-badge");
  const orgNameEl = document.getElementById("org-name") || document.getElementById("navbar-org-name");
  const details = getOrgEnvironmentDetails(sfHost, orgInfo);

  if (badge) {
    if (details.isSandbox) {
      badge.textContent = `SANDBOX : ${details.sandboxName}`;
      badge.className = "badge badge-sandbox";
    } else if (details.envType === "DEVELOPER EDITION") {
      badge.textContent = "DEVELOPER EDITION";
      badge.className = "badge badge-dev";
    } else if (details.envType === "SCRATCH ORG") {
      badge.textContent = "SCRATCH ORG";
      badge.className = "badge badge-scratch";
    } else if (details.envType === "TRIAL ORG") {
      badge.textContent = "TRIAL ORG";
      badge.className = "badge badge-scratch";
    } else if (details.envType === "TRAILBLAZE ORG") {
      badge.textContent = "PLAYGROUND";
      badge.className = "badge badge-dev";
    } else {
      badge.textContent = "PRODUCTION";
      badge.className = "badge badge-prod";
    }
    badge.title = `Environment: ${details.environment} | Salesforce Org: ${details.companyName}`;
  }

  if (orgNameEl) {
    const sandboxPart = details.isSandbox && details.sandboxName ? ` • ${details.sandboxName}` : "";
    const envPart = details.environment ? ` • ${details.environment}` : "";
    orgNameEl.textContent = `${details.companyName} • ${details.edition}${sandboxPart}${envPart}`;
    orgNameEl.title = `Organization: ${details.companyName}\nEnvironment: ${details.environment}\nEdition: ${details.edition}${details.instance ? `\nInstance: ${details.instance}` : ''}\nAuthoritative Host: ${sfHost}`;
  }
}

// ─── Utility: Format bytes ──────────────────────────────────────────
export function formatBytes(bytes) {
  if (!bytes || bytes <= 0 || isNaN(bytes)) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const safeI = Math.min(i, sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, safeI)).toFixed(2)) + " " + sizes[safeI];
}

// ─── Theme Synchronization & Navbar Integration ────────────────────
export function syncTheme() {
  if (typeof document === "undefined") return;
  const theme = localStorage.getItem("sfpi_theme") || "dark";
  document.documentElement.setAttribute("data-theme", theme);
}

export const applyTheme = syncTheme;

export function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("sfpi_theme", next);
  return next;
}

if (typeof document !== "undefined") {
  syncTheme();

  window.addEventListener("storage", (e) => {
    if (e.key === "sfpi_theme") {
      syncTheme();
    }
  });

  const attachThemeToggle = () => {
    const meta = document.querySelector(".tool-meta");
    if (meta && !document.getElementById("btn-navbar-theme")) {
      const btn = document.createElement("button");
      btn.id = "btn-navbar-theme";
      btn.className = "btn btn-secondary";
      btn.style.cssText = "font-size: 13px; padding: 4px 8px; cursor: pointer;";
      btn.title = "Toggle Light / Dark Theme";
      btn.textContent = "🌓";
      btn.addEventListener("click", () => toggleTheme());
      meta.appendChild(btn);
    }

    // Automatically update navbar badge with accurate sandbox name if on a tool page
    const host = resolveSfHost();
    if (host) {
      const orgInfo = JSON.parse(localStorage.getItem(host + "_orgInfo") || "{}");
      updateNavbarOrgBadge(host, orgInfo);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attachThemeToggle);
  } else {
    attachThemeToggle();
  }
}

// ─── Purge Poisoned / Stale Legacy Hosts from LocalStorage ───────────
(function cleanPoisonedStorage() {
  if (typeof localStorage === "undefined") return;
  try {
    const keysToRemove = [];
    const keysToMigrate = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.includes("status.salesforce.com") || key.includes("trust.salesforce.com") || key.includes("help.salesforce.com")) {
        keysToRemove.push(key);
      } else if (key.includes("-dev-ed.my.salesforce.com") && !key.includes(".develop.")) {
        keysToMigrate.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
    for (const key of keysToMigrate) {
      const val = localStorage.getItem(key);
      const healedKey = key.replace("-dev-ed.my.salesforce.com", "-dev-ed.develop.my.salesforce.com");
      if (!localStorage.getItem(healedKey)) {
        localStorage.setItem(healedKey, val);
      }
      localStorage.removeItem(key);
    }
    const lastHost = localStorage.getItem("sfpi_last_host");
    if (lastHost && isExcludedSfHost(lastHost)) {
      localStorage.removeItem("sfpi_last_host");
    }
    const actHost = sessionStorage.getItem("sfpi_active_host");
    if (actHost && isExcludedSfHost(actHost)) {
      sessionStorage.removeItem("sfpi_active_host");
    }
  } catch (e) {}
})();



