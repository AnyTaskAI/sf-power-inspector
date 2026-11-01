import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupMockEnvironment, MockXMLHttpRequest } from "./mocks.js";

// Setup mock browser globals before importing module
setupMockEnvironment();

const {
  isExcludedSfHost,
  resolveSfHost,
  SF_EXCLUDED_HOSTS,
  sfConn,
  extractSandboxDetails,
  getOrgEnvironmentDetails,
  DEFAULT_API_VERSION,
  apiVersion,
  extensionVersion,
  toggleTheme,
  applyTheme,
  updateNavbarOrgBadge,
  formatBytes
} = await import("../addon/sf-connection.js");

describe("sf-connection.js Comprehensive Test Suite", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    MockXMLHttpRequest.customHandler = null;
    globalThis.window.location.search = "";
    sfConn.instanceHostname = "my-company.my.salesforce.com";
    sfConn.sessionId = "00D000000000001!AQcAQmockSessionToken12345";
  });

  describe("Host Exclusion & Filtering", () => {
    it("should reject non-org public status and marketing hosts", () => {
      assert.strictEqual(isExcludedSfHost("status.salesforce.com"), true);
      assert.strictEqual(isExcludedSfHost("trust.salesforce.com"), true);
      assert.strictEqual(isExcludedSfHost("help.salesforce.com"), true);
      assert.strictEqual(isExcludedSfHost("trailhead.salesforce.com"), true);
      assert.strictEqual(isExcludedSfHost("developer.salesforce.com"), true);
      assert.strictEqual(isExcludedSfHost("appexchange.salesforce.com"), true);
      assert.strictEqual(isExcludedSfHost("www.salesforce.com"), true);
      assert.strictEqual(isExcludedSfHost("trailblazer.me"), true);
      assert.strictEqual(isExcludedSfHost("status.salesforce.mil"), true);
    });

    it("should reject null, undefined, empty and invalid host values", () => {
      assert.strictEqual(isExcludedSfHost(""), true);
      assert.strictEqual(isExcludedSfHost(null), true);
      assert.strictEqual(isExcludedSfHost(undefined), true);
      assert.strictEqual(isExcludedSfHost(12345), true);
    });

    it("should accept valid Salesforce org hosts", () => {
      assert.strictEqual(isExcludedSfHost("parrotcodes-dev-ed.develop.my.salesforce.com"), false);
      assert.strictEqual(isExcludedSfHost("mycompany--qa.sandbox.my.salesforce.com"), false);
      assert.strictEqual(isExcludedSfHost("enterprise.lightning.force.com"), false);
      assert.strictEqual(isExcludedSfHost("na1.salesforce.com"), false);
      assert.strictEqual(isExcludedSfHost("cs42.salesforce.com"), false);
      assert.strictEqual(isExcludedSfHost("govorg.my.salesforce.mil"), false);
    });
  });

  describe("resolveSfHost Resolver", () => {
    it("should extract host from URL search params", () => {
      globalThis.window.location.search = "?host=acme.my.salesforce.com";
      const host = resolveSfHost();
      assert.strictEqual(host, "acme.my.salesforce.com");
    });

    it("should reject excluded host in URL query and fall back to clean storage", () => {
      localStorage.setItem("sfpi_last_host", "legit-org.my.salesforce.com");
      globalThis.window.location.search = "?host=status.salesforce.com";
      const host = resolveSfHost();
      assert.strictEqual(host, "legit-org.my.salesforce.com");
    });

    it("should auto-heal -dev-ed host missing .develop.", () => {
      globalThis.window.location.search = "?host=mydev-dev-ed.my.salesforce.com";
      const host = resolveSfHost();
      assert.strictEqual(host, "mydev-dev-ed.develop.my.salesforce.com");
    });

    it("should discover host from localStorage keys if nothing in URL or session", () => {
      localStorage.setItem("discovered-org.my.salesforce.com_orgInfo", JSON.stringify({ companyName: "Discovered" }));
      const host = resolveSfHost();
      assert.strictEqual(host, "discovered-org.my.salesforce.com");
    });
  });

  describe("extractSandboxDetails & Environment", () => {
    it("should identify Developer Edition orgs", () => {
      const details = extractSandboxDetails("myorg-dev-ed.develop.my.salesforce.com");
      assert.strictEqual(details.isSandbox, false);
      assert.strictEqual(details.envType, "DEVELOPER EDITION");
      assert.strictEqual(details.environment, "Developer Edition");
    });

    it("should identify Sandboxes and extract accurate sandbox name", () => {
      const details = extractSandboxDetails("company--uat.sandbox.my.salesforce.com");
      assert.strictEqual(details.isSandbox, true);
      assert.strictEqual(details.sandboxName, "UAT");
      assert.strictEqual(details.envType, "SANDBOX");
      assert.strictEqual(details.environment, "Sandbox (UAT)");
    });

    it("should identify Scratch orgs", () => {
      const details = extractSandboxDetails("company-scratch.my.salesforce.com", { trialExpDate: "2026-12-31" });
      assert.strictEqual(details.isSandbox, false);
      assert.ok(details.envType === "SCRATCH ORG" || details.envType === "TRIAL ORG");
    });

    it("should identify Trailhead Playgrounds", () => {
      const details = extractSandboxDetails("playful-bear.trailblaze.my.salesforce.com");
      assert.strictEqual(details.isSandbox, false);
      assert.strictEqual(details.envType, "TRAILBLAZE ORG");
    });

    it("should identify Production environments", () => {
      const details = extractSandboxDetails("company.my.salesforce.com");
      assert.strictEqual(details.isSandbox, false);
      assert.strictEqual(details.envType, "PRODUCTION");
      assert.strictEqual(details.environment, "Production");
    });
  });

  describe("sfConn Domain Normalizer", () => {
    it("should convert Lightning domains to My Domain", () => {
      assert.strictEqual(
        sfConn._getMyDomain("company.lightning.force.com"),
        "company.my.salesforce.com"
      );
    });

    it("should convert Visualforce domains to My Domain", () => {
      assert.strictEqual(
        sfConn._getMyDomain("company--c.vf.force.com"),
        "company.my.salesforce.com"
      );
    });

    it("should strip Microsoft Defender MCAS wrappers", () => {
      assert.strictEqual(
        sfConn._getMyDomain("company.lightning.force.com.mcas.ms"),
        "company.my.salesforce.com"
      );
    });

    it("should convert Experience Cloud builder domains", () => {
      assert.strictEqual(
        sfConn._getMyDomain("site.builder.salesforce-experience.com"),
        "site.my.salesforce.com"
      );
    });
  });

  describe("sfConn API Execution Engine", () => {
    it("should execute REST queries successfully", async () => {
      const res = await sfConn.query("SELECT Id, Name FROM Account LIMIT 1");
      assert.ok(res.records);
      assert.strictEqual(res.records.length, 1);
      assert.strictEqual(res.records[0].Name, "Test Account");
    });

    it("should execute Tooling API queries", async () => {
      const res = await sfConn.query("SELECT Id, DeveloperName FROM ApexClass", true);
      assert.ok(res.records);
    });

    it("should handle automatic query pagination via nextRecordsUrl", async () => {
      let queryCallCount = 0;
      MockXMLHttpRequest.customHandler = (method, url) => {
        if (url.includes("/query/")) {
          queryCallCount++;
          if (queryCallCount === 1) {
            return {
              status: 200,
              response: {
                totalSize: 2,
                done: false,
                nextRecordsUrl: "/services/data/v62.0/query/01gD00000022xxxxxx-2000",
                records: [{ Id: "001000000000001", Name: "Page 1 Item" }]
              }
            };
          } else {
            return {
              status: 200,
              response: {
                totalSize: 2,
                done: true,
                records: [{ Id: "001000000000002", Name: "Page 2 Item" }]
              }
            };
          }
        }
        return null;
      };

      const res = await sfConn.query("SELECT Id, Name FROM Account");
      assert.strictEqual(res.records.length, 2);
      assert.strictEqual(res.records[0].Name, "Page 1 Item");
      assert.strictEqual(res.records[1].Name, "Page 2 Item");
      MockXMLHttpRequest.customHandler = null;
    });

    it("should execute metadata describe and describe alias calls", async () => {
      const desc = await sfConn.metadata("Account");
      assert.ok(desc);
      assert.strictEqual(desc.name, "Account");

      const descAlias = await sfConn.describe("Account");
      assert.ok(descAlias);
      assert.strictEqual(descAlias.name, "Account");
    });

    it("should execute getSObjects and describeGlobal to list all org entities", async () => {
      const list = await sfConn.getSObjects();
      assert.ok(list);
      assert.ok(Array.isArray(list.sobjects));

      const globalList = await sfConn.describeGlobal();
      assert.ok(globalList);
      assert.ok(Array.isArray(globalList.sobjects));
    });

    it("should execute GraphQL queries", async () => {
      MockXMLHttpRequest.customHandler = (method, url, body) => {
        if (url.includes("/graphql")) {
          return {
            status: 200,
            response: { data: { uiapi: { query: { Account: { edges: [] } } } } }
          };
        }
        return null;
      };
      const gqlRes = await sfConn.graphql("{ uiapi { query { Account { edges { node { Id } } } } } }");
      assert.ok(gqlRes.data);
      MockXMLHttpRequest.customHandler = null;
    });

    it("should execute standard REST CRUD operations", async () => {
      MockXMLHttpRequest.customHandler = (method, url, body) => {
        if (method === "POST" && url.includes("/sobjects/Account")) {
          return { status: 201, response: { id: "001NewRecordId", success: true } };
        }
        if (method === "PATCH" && url.includes("/sobjects/Account/001NewRecordId")) {
          return { status: 204, response: "" };
        }
        if (method === "DELETE" && url.includes("/sobjects/Account/001NewRecordId")) {
          return { status: 204, response: "" };
        }
        return null;
      };

      const createRes = await sfConn.rest("/services/data/v62.0/sobjects/Account", {
        method: "POST",
        body: { Name: "Acme Corp" }
      });
      assert.strictEqual(createRes.id, "001NewRecordId");

      const updateRes = await sfConn.rest("/services/data/v62.0/sobjects/Account/001NewRecordId", {
        method: "PATCH",
        body: { Name: "Acme Global" }
      });
      assert.ok(updateRes !== undefined);

      const deleteRes = await sfConn.rest("/services/data/v62.0/sobjects/Account/001NewRecordId", {
        method: "DELETE"
      });
      assert.ok(deleteRes !== undefined);
      MockXMLHttpRequest.customHandler = null;
    });

    it("should execute composite batch requests", async () => {
      const comp = await sfConn.composite([
        { method: "GET", url: "/services/data/v62.0/sobjects/Account/describe" }
      ]);
      assert.ok(comp);
    });

    it("should discover API version from server", async () => {
      const version = await sfConn.discoverLatestApiVersion();
      assert.strictEqual(version, "62.0");
    });

    it("should handle 401 session expiry by clearing token", async () => {
      MockXMLHttpRequest.customHandler = () => ({
        status: 401,
        response: [{ errorCode: "INVALID_SESSION_ID", message: "Session expired or invalid" }]
      });

      await assert.rejects(async () => {
        await sfConn.rest("/services/data/v62.0/sobjects/Account/describe", { logErrors: false });
      }, /Session expired/);

      assert.strictEqual(sfConn.sessionId, null);
    });

    it("should handle status 0 offline network errors", async () => {
      MockXMLHttpRequest.customHandler = () => ({ status: 0, response: "" });

      await assert.rejects(async () => {
        await sfConn.rest("/services/data/v62.0/limits", { logErrors: false });
      }, /Network error, offline or timeout/);
    });

    it("should handle getSession for valid and invalid hosts", async () => {
      // 1. Excluded host returns null when no active host
      const origSend = chrome.runtime.sendMessage;
      try {
        chrome.runtime.sendMessage = (msg, cb) => cb ? cb(null) : undefined;
        const excludedSession = await sfConn.getSession("status.salesforce.com");
        assert.strictEqual(excludedSession, null);
      } finally {
        chrome.runtime.sendMessage = origSend;
      }

      // 2. Valid host returns session token
      const validSession = await sfConn.getSession("testcorp.my.salesforce.com");
      assert.ok(validSession);
      assert.strictEqual(sfConn.sessionId, "00D000000000001!AQcAQmockSessionToken12345");

      // 3. Dev-ed missing .develop. auto-heals
      await sfConn.getSession("my-dev-ed.salesforce.com");
      assert.ok(sfConn.instanceHostname.includes(".develop."));

      // 4. Missing host fetches from active host
      await sfConn.getSession("");
      assert.ok(sfConn.sessionId);

      // 5. OAuth stored token fallback
      localStorage.setItem("oauth-org.my.salesforce.com_access_token", "stored-oauth-token-999");
      const stored = await sfConn.getSession("oauth-org.my.salesforce.com");
      assert.ok(stored);
    });

    it("should execute tooling API with relative and absolute paths", async () => {
      const relRes = await sfConn.tooling("/query/?q=SELECT+Id+FROM+ApexClass");
      assert.ok(relRes);

      const absRes = await sfConn.tooling("/services/data/v62.0/tooling/query/?q=SELECT+Id+FROM+ApexClass");
      assert.ok(absRes);
    });

    it("should fallback to background proxyFetch when XMLHttpRequest is not available", async () => {
      const originalXHR = globalThis.XMLHttpRequest;
      try {
        delete globalThis.XMLHttpRequest;
        const res = await sfConn.rest("/services/data/v62.0/sobjects/Account", {
          method: "GET",
          useCache: false
        });
        assert.ok(res);
        assert.ok(res.success);
      } finally {
        globalThis.XMLHttpRequest = originalXHR;
      }
    });

    it("should handle REST API errors with structured payloads", async () => {
      MockXMLHttpRequest.customHandler = () => ({
        status: 400,
        response: [{ errorCode: "MALFORMED_QUERY", message: "unexpected token: 'SELECT'" }]
      });

      await assert.rejects(async () => {
        await sfConn.rest("/services/data/v62.0/query/?q=BAD+QUERY", { logErrors: false });
      }, /MALFORMED_QUERY/);

      MockXMLHttpRequest.customHandler = () => ({
        status: 500,
        response: "Internal Server Error Occurred"
      });

      await assert.rejects(async () => {
        await sfConn.rest("/services/data/v62.0/limits", { logErrors: false });
      }, /API Error 500/);

      MockXMLHttpRequest.customHandler = null;
    });

    it("should format bytes into human-readable strings accurately", () => {
      assert.strictEqual(formatBytes(0), "0 B");
      assert.strictEqual(formatBytes(500), "500 B");
      assert.strictEqual(formatBytes(1024), "1 KB");
      assert.strictEqual(formatBytes(1048576), "1 MB");
      assert.strictEqual(formatBytes(1073741824), "1 GB");
      assert.strictEqual(formatBytes(1099511627776), "1 TB");
    });

    it("should accurately resolve environment details across various org types", () => {
      // 1. Instance CS12 indicates sandbox
      const csEnv = extractSandboxDetails("custom.cs12.my.salesforce.com", { InstanceName: "CS12" });
      assert.strictEqual(csEnv.isSandbox, true);

      // 2. Double dash sandbox with username suffix
      const userEnv = extractSandboxDetails(
        "company--stage.sandbox.my.salesforce.com",
        { isSandbox: true },
        "admin@company.com.stage"
      );
      assert.strictEqual(userEnv.isSandbox, true);
      assert.strictEqual(userEnv.sandboxName, "STAGE");

      // 3. IsSandbox false overrides host guessing to production
      const prodEnv = extractSandboxDetails("company--qa.sandbox.my.salesforce.com", {
        IsSandbox: false,
        OrganizationType: "Enterprise Edition"
      });
      assert.strictEqual(prodEnv.isSandbox, false);
      assert.strictEqual(prodEnv.envType, "PRODUCTION");

      // 4. Trial org
      const trialEnv = extractSandboxDetails("trial-org.my.salesforce.com", {
        OrganizationType: "Trial Edition"
      });
      assert.strictEqual(trialEnv.envType, "TRIAL ORG");
    });
  });

  describe("Navbar Badge & Theme Toggling", () => {
    it("should toggle between light and dark themes", () => {
      const nextTheme = toggleTheme();
      assert.ok(nextTheme === "dark" || nextTheme === "light");
      applyTheme();
    });

    it("should update navbar badge for Sandboxes and Developer Edition", () => {
      const dummyBadge = { textContent: "", className: "" };
      globalThis.document.getElementById = (id) => {
        if (id === "env-badge" || id === "navbar-org-badge") return dummyBadge;
        return null;
      };

      updateNavbarOrgBadge("company--uat.sandbox.my.salesforce.com", { isSandbox: true, sandboxName: "UAT" });
      assert.strictEqual(dummyBadge.textContent, "SANDBOX : UAT");
      assert.strictEqual(dummyBadge.className, "badge badge-sandbox");

      updateNavbarOrgBadge("company-dev-ed.develop.my.salesforce.com", {});
      assert.strictEqual(dummyBadge.textContent, "DEVELOPER EDITION");
      assert.strictEqual(dummyBadge.className, "badge badge-dev");
    });
  });
});
