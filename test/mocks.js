/**
 * Browser & Chrome Extension Mock Environment for Testing
 */

class MockStorage {
  constructor() {
    return new Proxy(this, {
      get: (target, prop) => {
        if (prop in target) return target[prop];
        return target.getItem(prop);
      },
      set: (target, prop, value) => {
        if (prop === "store") {
          target[prop] = value;
          return true;
        }
        target.setItem(prop, value);
        return true;
      },
      deleteProperty: (target, prop) => {
        target.removeItem(prop);
        return true;
      },
      ownKeys: (target) => {
        return Array.from(target.store.keys());
      },
      getOwnPropertyDescriptor: (target, prop) => {
        if (target.store.has(prop)) {
          return {
            value: target.store.get(prop),
            enumerable: true,
            configurable: true,
            writable: true
          };
        }
        return undefined;
      }
    });
  }

  store = new Map();

  getItem(key) {
    return this.store.has(String(key)) ? this.store.get(String(key)) : null;
  }
  setItem(key, value) {
    this.store.set(String(key), String(value));
  }
  removeItem(key) {
    this.store.delete(String(key));
  }
  clear() {
    this.store.clear();
  }
  get length() {
    return this.store.size;
  }
  key(index) {
    const keys = Array.from(this.store.keys());
    return keys[index] || null;
  }
}

export class MockXMLHttpRequest {
  constructor() {
    this.readyState = 0;
    this.status = 200;
    this.response = {};
    this.responseText = "{}";
    this.responseType = "json";
    this.headers = new Map();
    this.onreadystatechange = null;
  }

  static customHandler = null;

  open(method, url) {
    this.method = method;
    this.url = url;
    this.readyState = 1;
  }

  setRequestHeader(name, val) {
    this.headers.set(name, val);
  }

  send(body) {
    this.readyState = 4;
    if (MockXMLHttpRequest.customHandler) {
      const custom = MockXMLHttpRequest.customHandler(this.method, this.url, body, this.headers);
      if (custom) {
        this.status = custom.status !== undefined ? custom.status : 200;
        this.response = custom.response !== undefined ? custom.response : {};
        this.responseText = typeof this.response === "string" ? this.response : JSON.stringify(this.response);
        if (this.onreadystatechange) this.onreadystatechange();
        return;
      }
    }

    if (this.url.includes("/services/oauth2/userinfo")) {
      this.status = 200;
      this.response = {
        user_id: "005gL000008HZ6QQAW",
        organization_id: "00DgL00000CAN98",
        organization_name: "Acme Inc",
        preferred_username: "admin@company.com",
        urls: { rest: "https://cs123.salesforce.com/services/data/v62.0/" }
      };
    } else if (this.url.includes("/query/?q=SELECT+Id,+IsSandbox")) {
      this.status = 200;
      this.response = {
        totalSize: 1,
        done: true,
        records: [{
          Id: "00DgL00000CAN98",
          Name: "Acme Inc",
          IsSandbox: true,
          InstanceName: "CAN98",
          OrganizationType: "Developer Edition"
        }]
      };
    } else if (this.url.includes("/limits")) {
      this.status = 200;
      this.response = {
        DataStorageMB: { Max: 5, Remaining: 2 },
        FileStorageMB: { Max: 20, Remaining: 15 }
      };
    } else if (this.url.includes("/sobjects/") && this.url.includes("/describe")) {
      this.status = 200;
      this.response = {
        name: "Account",
        label: "Account",
        keyPrefix: "001",
        fields: [{ name: "Id", type: "id" }, { name: "Name", type: "string" }]
      };
    } else if (this.url.includes("/sobjects/")) {
      this.status = 200;
      this.response = {
        sobjects: [
          { name: "Account", label: "Account", keyPrefix: "001" },
          { name: "Contact", label: "Contact", keyPrefix: "003" }
        ]
      };
    } else if (this.url.includes("/services/data/") && !this.url.includes("sobjects") && !this.url.includes("query")) {
      this.status = 200;
      this.response = [
        { version: "62.0", label: "Winter '25" },
        { version: "61.0", label: "Summer '24" }
      ];
    } else {
      this.status = 200;
      this.response = {
        totalSize: 1,
        done: true,
        records: [{ Id: "001gL00000RzDfCQAV", Name: "Test Account" }]
      };
    }
    this.responseText = typeof this.response === "string" ? this.response : JSON.stringify(this.response);
    if (this.onreadystatechange) this.onreadystatechange();
  }
}

export function setupMockEnvironment() {
  const localStorageMock = new MockStorage();
  const sessionStorageMock = new MockStorage();

  const listeners = new Map();

  globalThis.localStorage = localStorageMock;
  globalThis.sessionStorage = sessionStorageMock;
  globalThis.XMLHttpRequest = MockXMLHttpRequest;

  globalThis.window = {
    location: {
      search: "",
      href: "https://my-company.lightning.force.com/lightning/r/Account/001gL00000RzDfCQAV/view",
      hostname: "my-company.lightning.force.com"
    },
    addEventListener: (type, handler) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener: (type, handler) => {
      if (listeners.has(type)) {
        listeners.set(type, listeners.get(type).filter(h => h !== handler));
      }
    },
    history: {
      replaceState: () => {}
    },
    open: () => {}
  };

  const elements = new Map();
  globalThis.document = {
    readyState: "complete",
    documentElement: {
      getAttribute: (attr) => "dark",
      setAttribute: () => {}
    },
    addEventListener: () => {},
    querySelector: (sel) => null,
    querySelectorAll: () => [],
    getElementById: (id) => null,
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      style: {},
      classList: {
        add: () => {},
        remove: () => {},
        toggle: () => {}
      },
      setAttribute: () => {},
      appendChild: () => {},
      addEventListener: () => {}
    })
  };

  globalThis.chrome = {
    runtime: {
      id: "mock-sfpi-extension-id",
      getManifest: () => ({ version: "1.0.0", version_name: "1.0" }),
      getURL: (path) => `chrome-extension://mock-sfpi-extension-id/${path}`,
      sendMessage: (msg, callback) => {
        if (!callback) return;
        if (msg.message === "getSession") {
          callback({ key: "00D000000000001!AQcAQmockSessionToken12345", hostname: msg.sfHost || "my-company.my.salesforce.com" });
        } else if (msg.message === "getActiveSfHost") {
          callback("my-company.my.salesforce.com");
        } else if (msg.message === "proxyFetch") {
          callback({ ok: true, status: 200, data: { success: true, records: [{ Id: "001ProxyRecord" }] } });
        } else {
          callback({ success: true });
        }
      },
      lastError: null
    },
    cookies: {
      get: (details, callback) => {
        callback({ name: details.name, value: "00D000000000001!AQcAQmockSessionToken12345" });
      },
      getAll: (details, callback) => {
        callback([
          { name: "sid", value: "00D000000000001!AQcAQmockSessionToken12345", domain: "salesforce.com" }
        ]);
      }
    },
    tabs: {
      query: (queryInfo, callback) => {
        callback([{ id: 1, url: "https://my-company.my.salesforce.com" }]);
      },
      create: () => {},
      reload: () => {}
    },
    windows: {
      create: (data, callback) => {
        if (callback) callback({ id: 101, incognito: Boolean(data.incognito) });
      }
    },
    storage: {
      local: {
        get: (keys, callback) => callback({}),
        set: (items, callback) => { if (callback) callback(); }
      }
    }
  };

  return { localStorageMock, sessionStorageMock };
}
