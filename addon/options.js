/**
 * SF Power Inspector PRO — Extension Options, Settings & AI Trust Vault
 * Implements full parity with Salesforce Inspector, Salesforce Inspector Reloaded,
 * and Advanced Inspector, plus Next-Gen AI & Einstein Trust Layer configuration.
 */

import { sfConn, apiVersion, updateNavbarOrgBadge, syncTheme, toggleTheme, resolveSfHost } from "./sf-connection.js";
import { saveEncryptedKey, getDecryptedKey, maskSensitiveData, executeAiQuery } from "./ai-service.js";

syncTheme();

const sfHost = resolveSfHost();

// ─── Complete Settings Schema & Defaults ────────────────────────────
export const DEFAULT_SETTINGS = {
  // 1. API & Safety Shields
  apiVersion: "62.0",
  autoDetectApi: true,
  batchSize: "200",
  toolingApiPriority: true,
  sandboxBanner: true,
  bannerColor: "#ff9800",
  bannerText: "SANDBOX ENVIRONMENT",
  prodBanner: true,
  prodConfirm: true,
  titlePrefix: true,
  faviconTint: true,

  // 2. Data & Inspection
  exportFormat: "csv",
  autoFormatSoql: true,
  autoSuggestFields: true,
  includeDeletedRows: false,
  queryPlan: true,
  fieldSort: "label",
  showAuditFields: true,
  inlineEdit: true,
  highlightModified: true,
  autoCopyRecordId: false,

  // 3. UI & Org Dark Mode
  theme: "dark",
  orgDarkMode: true,
  darkIntensity: "100",
  darkInvertCharts: true,
  darkPreserveAvatars: true,
  sidebarWidth: "395px",
  btnPosition: "right-middle",
  btnOpacity: 80,
  defaultSection: "tools",

  // 4. Hotkeys
  hotkeyPopup: "Alt+I",
  hotkeyApi: "Alt+A",
  hotkeyDark: "Alt+D",
  hotkeyQuery: "Ctrl+Enter",
  hotkeySearch: "Ctrl+Shift+K",

  // 5. AI & Einstein Trust Layer
  aiProvider: "local",
  openaiModel: "gpt-4o",
  anthropicModel: "claude-3-5-sonnet-20241022",
  geminiModel: "gemini-1.5-flash",
  ollamaEndpoint: "http://localhost:11434",
  ollamaModel: "llama3.2",
  maskStrict: true,
  maskEmail: true,
  maskPhone: true,
  maskSsn: true,
  maskCc: true,
  maskCurr: true,
};

let currentSettings = { ...DEFAULT_SETTINGS };

// ─── Initialize Options Page ─────────────────────────────────────────
async function init() {
  syncTheme();

  // Pre-render Org Badge in navbar
  if (sfHost) {
    const cachedOrgStr = localStorage.getItem(sfHost + "_orgInfo");
    if (cachedOrgStr) {
      try {
        updateNavbarOrgBadge(sfHost, JSON.parse(cachedOrgStr));
      } catch (e) {}
    }
    // Attempt live session verification
    sfConn.getSession(sfHost).then(() => {
      const liveOrgStr = localStorage.getItem(sfHost + "_orgInfo");
      if (liveOrgStr) {
        try {
          updateNavbarOrgBadge(sfHost, JSON.parse(liveOrgStr));
        } catch (e) {}
      }
    }).catch(() => {});
  } else {
    const badge = document.getElementById("navbar-org-badge");
    if (badge) badge.textContent = "Global Options";
  }

  // Load Settings from chrome.storage & localStorage
  await loadSettings();

  // Populate UI Controls
  populateForm();

  // Setup UI Events
  setupTabs();
  setupSwatchesAndPreviews();
  setupVisibilityToggles();
  setupSliders();
  setupProviderCards();
  setupAiPresets();
  setupActionButtons();

  // Welcome banner on first install
  const params = new URLSearchParams(window.location.search);
  if (params.get("welcome") === "true") {
    showToast("🎉 Welcome to SF Power Inspector PRO! Configure your preferences and AI keys below.", "success");
  }
}

// ─── Settings Storage & Sync ─────────────────────────────────────────
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["sfpi_settings", "sfpi_orgDarkMode", "sfpi_apiVersion"], (res) => {
      const stored = res.sfpi_settings || {};
      
      // Merge stored settings with defaults and legacy localStorage keys
      currentSettings = {
        ...DEFAULT_SETTINGS,
        ...stored,
        apiVersion: localStorage.getItem("sfpi_apiVersion") || stored.apiVersion || DEFAULT_SETTINGS.apiVersion,
        sandboxBanner: localStorage.getItem("sfpi_sandboxBanner") !== null 
          ? localStorage.getItem("sfpi_sandboxBanner") !== "false" 
          : (stored.sandboxBanner ?? DEFAULT_SETTINGS.sandboxBanner),
        bannerColor: localStorage.getItem("sfpi_bannerColor") || stored.bannerColor || DEFAULT_SETTINGS.bannerColor,
        prodBanner: localStorage.getItem("sfpi_prodBanner") !== null 
          ? localStorage.getItem("sfpi_prodBanner") !== "false" 
          : (stored.prodBanner ?? DEFAULT_SETTINGS.prodBanner),
        theme: localStorage.getItem("sfpi_theme") || stored.theme || DEFAULT_SETTINGS.theme,
        orgDarkMode: res.sfpi_orgDarkMode !== undefined 
          ? res.sfpi_orgDarkMode 
          : (stored.orgDarkMode ?? DEFAULT_SETTINGS.orgDarkMode),
      };

      resolve(currentSettings);
    });
  });
}

async function populateForm() {
  // Tab 1: API & Safety
  setVal("opt-api-version", currentSettings.apiVersion);
  setChecked("opt-auto-api", currentSettings.autoDetectApi);
  setVal("opt-batch-size", currentSettings.batchSize);
  setChecked("opt-tooling-api", currentSettings.toolingApiPriority);
  setChecked("opt-sandbox-banner", currentSettings.sandboxBanner);
  setVal("opt-banner-color", currentSettings.bannerColor);
  setVal("opt-banner-text", currentSettings.bannerText);
  setChecked("opt-prod-banner", currentSettings.prodBanner);
  setChecked("opt-prod-confirm", currentSettings.prodConfirm);
  setChecked("opt-title-prefix", currentSettings.titlePrefix);
  setChecked("opt-favicon-tint", currentSettings.faviconTint);
  updateBannerPreview();

  // Tab 2: Data & Inspection
  setVal("opt-export-format", currentSettings.exportFormat);
  setChecked("opt-auto-soql", currentSettings.autoFormatSoql);
  setChecked("opt-auto-suggest", currentSettings.autoSuggestFields);
  setChecked("opt-include-deleted", currentSettings.includeDeletedRows);
  setChecked("opt-query-plan", currentSettings.queryPlan);
  setVal("opt-field-sort", currentSettings.fieldSort);
  setChecked("opt-show-audit", currentSettings.showAuditFields);
  setChecked("opt-inline-edit", currentSettings.inlineEdit);
  setChecked("opt-highlight-modified", currentSettings.highlightModified);
  setChecked("opt-auto-copy-id", currentSettings.autoCopyRecordId);

  // Tab 3: UI & Dark Mode
  setVal("opt-theme", currentSettings.theme);
  setChecked("opt-org-darkmode", currentSettings.orgDarkMode);
  setVal("opt-dark-intensity", currentSettings.darkIntensity);
  setChecked("opt-dark-invert-charts", currentSettings.darkInvertCharts);
  setChecked("opt-dark-preserve-avatars", currentSettings.darkPreserveAvatars);
  setVal("opt-sidebar-width", currentSettings.sidebarWidth);
  setVal("opt-btn-position", currentSettings.btnPosition);
  setVal("opt-btn-opacity", currentSettings.btnOpacity);
  const opacityLbl = document.getElementById("lbl-btn-opacity");
  if (opacityLbl) opacityLbl.textContent = `${currentSettings.btnOpacity}%`;
  setVal("opt-default-section", currentSettings.defaultSection);

  // Tab 4: Hotkeys
  setVal("opt-hotkey-popup", currentSettings.hotkeyPopup);
  setVal("opt-hotkey-api", currentSettings.hotkeyApi);
  setVal("opt-hotkey-dark", currentSettings.hotkeyDark);
  setVal("opt-hotkey-query", currentSettings.hotkeyQuery);
  setVal("opt-hotkey-search", currentSettings.hotkeySearch);

  // Tab 5: AI & Trust Layer
  selectProviderCard(currentSettings.aiProvider || "local");
  setVal("opt-model-openai", currentSettings.openaiModel);
  setVal("opt-model-anthropic", currentSettings.anthropicModel);
  setVal("opt-model-gemini", currentSettings.geminiModel);
  setVal("opt-endpoint-ollama", currentSettings.ollamaEndpoint);
  setVal("opt-model-ollama", currentSettings.ollamaModel);

  setChecked("opt-mask-strict", currentSettings.maskStrict);
  setChecked("opt-mask-email", currentSettings.maskEmail);
  setChecked("opt-mask-phone", currentSettings.maskPhone);
  setChecked("opt-mask-ssn", currentSettings.maskSsn);
  setChecked("opt-mask-cc", currentSettings.maskCc);
  setChecked("opt-mask-curr", currentSettings.maskCurr);

  // Load Decrypted API Keys asynchronously
  getDecryptedKey("openai").then(k => { if (k) setVal("opt-key-openai", k); });
  getDecryptedKey("anthropic").then(k => { if (k) setVal("opt-key-anthropic", k); });
  getDecryptedKey("gemini").then(k => { if (k) setVal("opt-key-gemini", k); });
}

// ─── Tab Switching ───────────────────────────────────────────────────
function setupTabs() {
  const tabs = document.querySelectorAll(".tool-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      const targetId = `view-${tab.dataset.tab}`;
      document.querySelectorAll(".tab-content").forEach(content => {
        content.style.display = content.id === targetId ? "flex" : "none";
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

// ─── Swatches & Sandbox Banner Live Preview ─────────────────────────
function setupSwatchesAndPreviews() {
  const colorInput = document.getElementById("opt-banner-color");
  const textInput = document.getElementById("opt-banner-text");

  // Swatch buttons
  document.querySelectorAll(".color-swatch-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const color = btn.dataset.color;
      if (colorInput) colorInput.value = color;
      document.querySelectorAll(".color-swatch-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      updateBannerPreview();
    });
  });

  colorInput?.addEventListener("input", updateBannerPreview);
  textInput?.addEventListener("input", updateBannerPreview);
}

function updateBannerPreview() {
  const banner = document.getElementById("preview-sandbox-banner");
  const color = document.getElementById("opt-banner-color")?.value || "#ff9800";
  const text = document.getElementById("opt-banner-text")?.value || "SANDBOX ENVIRONMENT";
  const hostLabel = sfHost ? ` — ${sfHost.split(".")[0]}` : " — sandbox-demo";

  if (banner) {
    banner.style.backgroundColor = color;
    banner.textContent = `⚠️ ${text}${hostLabel}`;
  }
}

// ─── Visibility Toggles (Eye Icons) ──────────────────────────────────
function setupVisibilityToggles() {
  document.querySelectorAll(".btn-toggle-vis").forEach(btn => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.for);
      if (!input) return;
      if (input.type === "password") {
        input.type = "text";
        btn.textContent = "🔒";
      } else {
        input.type = "password";
        btn.textContent = "👁️";
      }
    });
  });
}

// ─── Sliders ─────────────────────────────────────────────────────────
function setupSliders() {
  const opacityInput = document.getElementById("opt-btn-opacity");
  const opacityLbl = document.getElementById("lbl-btn-opacity");
  opacityInput?.addEventListener("input", () => {
    if (opacityLbl) opacityLbl.textContent = `${opacityInput.value}%`;
  });
}

// ─── AI Provider Cards ──────────────────────────────────────────────
function setupProviderCards() {
  document.querySelectorAll(".provider-card").forEach(card => {
    card.addEventListener("click", () => {
      const provider = card.dataset.provider;
      selectProviderCard(provider);
    });
  });
}

function selectProviderCard(provider) {
  currentSettings.aiProvider = provider;
  document.querySelectorAll(".provider-card").forEach(c => {
    c.classList.toggle("active", c.dataset.provider === provider);
  });
}

// ─── AI Architecture Presets ─────────────────────────────────────────
function setupAiPresets() {
  document.getElementById("preset-enterprise")?.addEventListener("click", () => {
    selectProviderCard("local");
    setChecked("opt-mask-strict", true);
    setChecked("opt-mask-email", true);
    setChecked("opt-mask-phone", true);
    setChecked("opt-mask-ssn", true);
    setChecked("opt-mask-cc", true);
    setChecked("opt-mask-curr", true);
    showToast("✓ Enterprise Ultra-Secure Profile Applied (100% Offline CTA Engine)", "success");
  });

  document.getElementById("preset-fast")?.addEventListener("click", () => {
    selectProviderCard("gemini");
    setVal("opt-model-gemini", "gemini-1.5-flash");
    showToast("✓ High-Speed Developer Profile Applied (Gemini 1.5 Flash)", "success");
  });

  document.getElementById("preset-cta")?.addEventListener("click", () => {
    selectProviderCard("anthropic");
    setVal("opt-model-anthropic", "claude-3-5-sonnet-20241022");
    showToast("✓ CTA Deep Reasoning Profile Applied (Claude 3.5 Sonnet)", "success");
  });

  document.getElementById("preset-ollama")?.addEventListener("click", () => {
    selectProviderCard("ollama");
    setVal("opt-endpoint-ollama", "http://localhost:11434");
    showToast("✓ Air-Gapped Ollama Host Applied (Localhost:11434)", "success");
  });
}

// ─── Action Buttons & Tests ──────────────────────────────────────────
function setupActionButtons() {
  // Navbar Theme Toggle Button (🌓)
  document.getElementById("btn-theme-toggle")?.addEventListener("click", () => {
    const nextTheme = toggleTheme();
    setVal("opt-theme", nextTheme);
    showToast(`Theme switched to ${nextTheme} mode.`, "success");
  });

  // Dropdown Theme Change
  document.getElementById("opt-theme")?.addEventListener("change", (e) => {
    let chosen = e.target.value;
    if (chosen === "system") {
      chosen = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", chosen);
    localStorage.setItem("sfpi_theme", chosen);
    chrome.storage.local.set({ sfpi_theme: chosen });
    showToast(`Inspector theme updated to ${e.target.value}.`, "success");
  });

  // Org Dark Mode Real-Time Toggle
  document.getElementById("opt-org-darkmode")?.addEventListener("change", (e) => {
    const enabled = e.target.checked;
    currentSettings.orgDarkMode = enabled;
    chrome.storage.local.set({ sfpi_orgDarkMode: enabled });
    chrome.runtime.sendMessage({ message: "setOrgDarkMode", enabled });
    showToast(`Salesforce Org Dark Mode ${enabled ? "enabled" : "disabled"}.`, "success");
  });

  // Save All Changes
  document.getElementById("btn-save-all")?.addEventListener("click", saveAllSettings);

  // Reset to Defaults
  document.getElementById("btn-reset-defaults")?.addEventListener("click", () => {
    if (confirm("Reset all settings to default values? Custom keys and dark mode will be reset.")) {
      currentSettings = { ...DEFAULT_SETTINGS };
      populateForm();
      showToast("Settings reset to defaults. Click 'Save' to commit.", "success");
    }
  });

  // Reset Hotkeys
  document.getElementById("btn-reset-hotkeys")?.addEventListener("click", () => {
    setVal("opt-hotkey-popup", DEFAULT_SETTINGS.hotkeyPopup);
    setVal("opt-hotkey-api", DEFAULT_SETTINGS.hotkeyApi);
    setVal("opt-hotkey-dark", DEFAULT_SETTINGS.hotkeyDark);
    setVal("opt-hotkey-query", DEFAULT_SETTINGS.hotkeyQuery);
    setVal("opt-hotkey-search", DEFAULT_SETTINGS.hotkeySearch);
    showToast("Hotkeys restored to default values.", "success");
  });

  // Test OpenAI Connection
  document.getElementById("btn-test-openai")?.addEventListener("click", async () => {
    const key = document.getElementById("opt-key-openai")?.value.trim();
    const model = document.getElementById("opt-model-openai")?.value || "gpt-4o";
    const statusDiv = document.getElementById("status-openai");
    if (!statusDiv) return;

    if (!key) {
      showStatus(statusDiv, "❌ Please enter an OpenAI API key first.", "error");
      return;
    }

    showStatus(statusDiv, "⏳ Connecting to OpenAI API...", "loading");
    const t0 = performance.now();
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 5 })
      });
      const latency = Math.round(performance.now() - t0);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      showStatus(statusDiv, `✓ Connected successfully (${latency}ms) — Model: ${model}`, "success");
    } catch (e) {
      showStatus(statusDiv, `❌ Connection failed: ${e.message}`, "error");
    }
  });

  // Test Claude Connection
  document.getElementById("btn-test-anthropic")?.addEventListener("click", async () => {
    const key = document.getElementById("opt-key-anthropic")?.value.trim();
    const model = document.getElementById("opt-model-anthropic")?.value || "claude-3-5-sonnet-20241022";
    const statusDiv = document.getElementById("status-anthropic");
    if (!statusDiv) return;

    if (!key) {
      showStatus(statusDiv, "❌ Please enter an Anthropic API key first.", "error");
      return;
    }

    showStatus(statusDiv, "⏳ Connecting to Anthropic API...", "loading");
    const t0 = performance.now();
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "dangerously-allow-browser": "true"
        },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 5 })
      });
      const latency = Math.round(performance.now() - t0);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      showStatus(statusDiv, `✓ Connected successfully (${latency}ms) — Model: ${model}`, "success");
    } catch (e) {
      showStatus(statusDiv, `❌ Connection failed: ${e.message}`, "error");
    }
  });

  // Test Gemini Connection
  document.getElementById("btn-test-gemini")?.addEventListener("click", async () => {
    const key = document.getElementById("opt-key-gemini")?.value.trim();
    const model = document.getElementById("opt-model-gemini")?.value || "gemini-1.5-flash";
    const statusDiv = document.getElementById("status-gemini");
    if (!statusDiv) return;

    if (!key) {
      showStatus(statusDiv, "❌ Please enter a Google Gemini API key first.", "error");
      return;
    }

    showStatus(statusDiv, "⏳ Connecting to Google Gemini API...", "loading");
    const t0 = performance.now();
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] })
      });
      const latency = Math.round(performance.now() - t0);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      showStatus(statusDiv, `✓ Connected successfully (${latency}ms) — Model: ${model}`, "success");
    } catch (e) {
      showStatus(statusDiv, `❌ Connection failed: ${e.message}`, "error");
    }
  });

  // Test Ollama Host
  document.getElementById("btn-test-ollama")?.addEventListener("click", async () => {
    const endpoint = document.getElementById("opt-endpoint-ollama")?.value.trim() || "http://localhost:11434";
    const model = document.getElementById("opt-model-ollama")?.value.trim() || "llama3.2";
    const statusDiv = document.getElementById("status-ollama");
    if (!statusDiv) return;

    showStatus(statusDiv, "⏳ Pinging Ollama host...", "loading");
    const t0 = performance.now();
    try {
      const res = await fetch(`${endpoint.replace(/\/+$/, "")}/api/tags`, { method: "GET" });
      const latency = Math.round(performance.now() - t0);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const models = (json.models || []).map(m => m.name).join(", ");
      showStatus(statusDiv, `✓ Ollama host reached (${latency}ms) — Available: ${models || model}`, "success");
    } catch (e) {
      showStatus(statusDiv, `❌ Could not reach Ollama at ${endpoint}: ${e.message}`, "error");
    }
  });

  // Run AI Test Playground
  document.getElementById("btn-run-ai-test")?.addEventListener("click", async () => {
    const promptInput = document.getElementById("ai-test-prompt");
    const consoleOutput = document.getElementById("ai-test-output");
    const latencyLbl = document.getElementById("ai-test-latency-label");
    const sanitizedLbl = document.getElementById("ai-test-sanitized-label");
    const promptText = promptInput?.value.trim() || "Write a SOQL query to find all contacts for Acme Corp with email test@acme.com and phone +1-555-0199";

    if (!consoleOutput) return;

    // Apply Trust Layer Masking Preview
    const isStrict = document.getElementById("opt-mask-strict")?.checked !== false;
    const masked = maskSensitiveData(promptText, isStrict);
    if (sanitizedLbl) {
      sanitizedLbl.textContent = promptText !== masked 
        ? "🛡️ Trust Layer: Sensitive PII Redacted!" 
        : "🛡️ Trust Layer: Clean Prompt";
      sanitizedLbl.style.color = promptText !== masked ? "#10b981" : "#94a3b8";
    }

    consoleOutput.textContent = `[Trust Layer Input]: ${masked}\n\n[Connecting to ${currentSettings.aiProvider.toUpperCase()} engine...]`;
    if (latencyLbl) latencyLbl.textContent = "Running...";

    const t0 = performance.now();
    const result = await executeAiQuery({
      prompt: promptText,
      provider: currentSettings.aiProvider,
      strictMasking: isStrict
    });
    const latency = Math.round(performance.now() - t0);

    if (latencyLbl) latencyLbl.textContent = `Latency: ${latency}ms`;
    if (result.success) {
      consoleOutput.textContent = result.content;
    } else {
      consoleOutput.textContent = `❌ Provider Error: ${result.error}\n\nFallback CTA Response:\n${result.content}`;
    }
  });

  // Export JSON Backup
  document.getElementById("btn-export-config")?.addEventListener("click", () => {
    const backup = {
      app: "SF Power Inspector PRO",
      version: "1.0",
      exportDate: new Date().toISOString(),
      settings: currentSettings,
      queryHistory: JSON.parse(localStorage.getItem("sfpi_query_history") || "[]")
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sf-power-inspector-settings-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Configuration exported to JSON backup.", "success");
  });

  // Import JSON Backup
  document.getElementById("file-import-config")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        if (data.settings) {
          currentSettings = { ...DEFAULT_SETTINGS, ...data.settings };
          populateForm();
          if (data.queryHistory && Array.isArray(data.queryHistory)) {
            localStorage.setItem("sfpi_query_history", JSON.stringify(data.queryHistory));
          }
          await saveAllSettings();
          showToast("✓ Settings restored successfully from backup!", "success");
        } else {
          showToast("Invalid configuration file format.", "error");
        }
      } catch (err) {
        showToast("Failed to parse JSON file: " + err.message, "error");
      }
    };
    reader.readAsText(file);
  });

  // 1-Click Reverse Engineering Migration from Legacy Extensions
  document.getElementById("btn-detect-migrate")?.addEventListener("click", async () => {
    const statusBox = document.getElementById("migration-status-box");
    if (!statusBox) return;

    statusBox.style.display = "block";
    statusBox.style.background = "#f1f5f9";
    statusBox.style.color = "#0f172a";
    statusBox.textContent = "Scanning browser storage for Salesforce Inspector & Inspector Reloaded...";

    let migratedQueriesCount = 0;
    let migratedSettingsCount = 0;

    // 1. Scan localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      // Legacy Inspector queries
      if (k === "queryHistory" || k === "savedQueries" || k === "sfir_saved_queries" || k === "sfai_queries") {
        try {
          const queries = JSON.parse(localStorage.getItem(k));
          if (Array.isArray(queries)) {
            const existing = JSON.parse(localStorage.getItem("sfpi_query_history") || "[]");
            const merged = Array.from(new Set([...existing, ...queries]));
            localStorage.setItem("sfpi_query_history", JSON.stringify(merged));
            migratedQueriesCount += queries.length;
          }
        } catch (e) {}
      }
      // Legacy API version
      if (k === "apiVersion" || k === "sfir_apiVersion") {
        const val = localStorage.getItem(k);
        if (val) {
          setVal("opt-api-version", val);
          migratedSettingsCount++;
        }
      }
      // Legacy Options
      if (k === "sf-inspector-options" || k === "inspectorOptions" || k === "sfir_options") {
        try {
          const opts = JSON.parse(localStorage.getItem(k));
          if (opts.theme) setVal("opt-theme", opts.theme);
          if (opts.bannerColor) setVal("opt-banner-color", opts.bannerColor);
          migratedSettingsCount++;
        } catch (e) {}
      }
    }

    // 2. Scan chrome.storage.local
    chrome.storage.local.get(null, (allKeys) => {
      Object.keys(allKeys).forEach(k => {
        if (k.includes("inspector") || k.includes("sfir_") || k.includes("queryHistory")) {
          const val = allKeys[k];
          if (Array.isArray(val)) {
            const existing = JSON.parse(localStorage.getItem("sfpi_query_history") || "[]");
            const merged = Array.from(new Set([...existing, ...val]));
            localStorage.setItem("sfpi_query_history", JSON.stringify(merged));
            migratedQueriesCount += val.length;
          }
        }
      });

      statusBox.style.background = "#ecfdf5";
      statusBox.style.color = "#065f46";
      statusBox.innerHTML = `
        ✓ <b>Migration Complete!</b><br>
        • Imported <b>${migratedQueriesCount}</b> saved/history SOQL queries.<br>
        • Imported <b>${migratedSettingsCount}</b> preferences & configurations.<br>
        All features and saved queries are now active in SF Power Inspector PRO!
      `;
      showToast("Legacy Inspector data migrated successfully!", "success");
    });
  });

  // Clear SObject Cache
  document.getElementById("btn-clear-cache")?.addEventListener("click", () => {
    let count = 0;
    Object.keys(sessionStorage).forEach(k => {
      if (k.startsWith("sfpi_")) {
        sessionStorage.removeItem(k);
        count++;
      }
    });
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith("sfpi_describe_")) {
        localStorage.removeItem(k);
        count++;
      }
    });
    showToast(`✓ Cleared ${count} cached metadata items.`, "success");
  });

  // Clear Query History
  document.getElementById("btn-clear-history")?.addEventListener("click", () => {
    localStorage.removeItem("sfpi_query_history");
    showToast("✓ Query history cleared.", "success");
  });

  // Factory Reset
  document.getElementById("btn-factory-reset")?.addEventListener("click", () => {
    if (confirm("⚠️ WARNING: This will permanently wipe all settings, dark mode preferences, and encrypted API keys. Continue?")) {
      chrome.storage.local.clear(() => {
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith("sfpi_")) localStorage.removeItem(k);
        });
        currentSettings = { ...DEFAULT_SETTINGS };
        populateForm();
        showToast("✓ Factory reset complete.", "success");
      });
    }
  });
}

// ─── Save All Settings ───────────────────────────────────────────────
async function saveAllSettings() {
  const saveBtn = document.getElementById("btn-save-all");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "⏳ Saving...";
  }

  // Collect All Values
  currentSettings.apiVersion = getVal("opt-api-version");
  currentSettings.autoDetectApi = getChecked("opt-auto-api");
  currentSettings.batchSize = getVal("opt-batch-size");
  currentSettings.toolingApiPriority = getChecked("opt-tooling-api");
  currentSettings.sandboxBanner = getChecked("opt-sandbox-banner");
  currentSettings.bannerColor = getVal("opt-banner-color");
  currentSettings.bannerText = getVal("opt-banner-text");
  currentSettings.prodBanner = getChecked("opt-prod-banner");
  currentSettings.prodConfirm = getChecked("opt-prod-confirm");
  currentSettings.titlePrefix = getChecked("opt-title-prefix");
  currentSettings.faviconTint = getChecked("opt-favicon-tint");

  currentSettings.exportFormat = getVal("opt-export-format");
  currentSettings.autoFormatSoql = getChecked("opt-auto-soql");
  currentSettings.autoSuggestFields = getChecked("opt-auto-suggest");
  currentSettings.includeDeletedRows = getChecked("opt-include-deleted");
  currentSettings.queryPlan = getChecked("opt-query-plan");
  currentSettings.fieldSort = getVal("opt-field-sort");
  currentSettings.showAuditFields = getChecked("opt-show-audit");
  currentSettings.inlineEdit = getChecked("opt-inline-edit");
  currentSettings.highlightModified = getChecked("opt-highlight-modified");
  currentSettings.autoCopyRecordId = getChecked("opt-auto-copy-id");

  currentSettings.theme = getVal("opt-theme");
  currentSettings.orgDarkMode = getChecked("opt-org-darkmode");
  currentSettings.darkIntensity = getVal("opt-dark-intensity");
  currentSettings.darkInvertCharts = getChecked("opt-dark-invert-charts");
  currentSettings.darkPreserveAvatars = getChecked("opt-dark-preserve-avatars");
  currentSettings.sidebarWidth = getVal("opt-sidebar-width");
  currentSettings.btnPosition = getVal("opt-btn-position");
  currentSettings.btnOpacity = parseInt(getVal("opt-btn-opacity") || "80", 10);
  currentSettings.defaultSection = getVal("opt-default-section");

  currentSettings.hotkeyPopup = getVal("opt-hotkey-popup");
  currentSettings.hotkeyApi = getVal("opt-hotkey-api");
  currentSettings.hotkeyDark = getVal("opt-hotkey-dark");
  currentSettings.hotkeyQuery = getVal("opt-hotkey-query");
  currentSettings.hotkeySearch = getVal("opt-hotkey-search");

  currentSettings.openaiModel = getVal("opt-model-openai");
  currentSettings.anthropicModel = getVal("opt-model-anthropic");
  currentSettings.geminiModel = getVal("opt-model-gemini");
  currentSettings.ollamaEndpoint = getVal("opt-endpoint-ollama");
  currentSettings.ollamaModel = getVal("opt-model-ollama");

  currentSettings.maskStrict = getChecked("opt-mask-strict");
  currentSettings.maskEmail = getChecked("opt-mask-email");
  currentSettings.maskPhone = getChecked("opt-mask-phone");
  currentSettings.maskSsn = getChecked("opt-mask-ssn");
  currentSettings.maskCc = getChecked("opt-mask-cc");
  currentSettings.maskCurr = getChecked("opt-mask-curr");

  // Save Encrypted API Keys via AES-GCM
  const keyOpenAI = document.getElementById("opt-key-openai")?.value.trim();
  const keyAnthropic = document.getElementById("opt-key-anthropic")?.value.trim();
  const keyGemini = document.getElementById("opt-key-gemini")?.value.trim();

  await saveEncryptedKey("openai", keyOpenAI);
  await saveEncryptedKey("anthropic", keyAnthropic);
  await saveEncryptedKey("gemini", keyGemini);

  // Sync with localStorage for synchronous instant reads
  localStorage.setItem("sfpi_apiVersion", currentSettings.apiVersion);
  localStorage.setItem("sfpi_sandboxBanner", currentSettings.sandboxBanner);
  localStorage.setItem("sfpi_bannerColor", currentSettings.bannerColor);
  localStorage.setItem("sfpi_bannerText", currentSettings.bannerText);
  localStorage.setItem("sfpi_prodBanner", currentSettings.prodBanner);
  localStorage.setItem("sfpi_theme", currentSettings.theme);
  localStorage.setItem("sfpi_openai_model", currentSettings.openaiModel);
  localStorage.setItem("sfpi_anthropic_model", currentSettings.anthropicModel);
  localStorage.setItem("sfpi_gemini_model", currentSettings.geminiModel);
  localStorage.setItem("sfpi_ollama_endpoint", currentSettings.ollamaEndpoint);
  localStorage.setItem("sfpi_ollama_model", currentSettings.ollamaModel);

  // Persist to chrome.storage.local
  chrome.storage.local.set({
    sfpi_settings: currentSettings,
    sfpi_orgDarkMode: currentSettings.orgDarkMode,
    sfpi_apiVersion: currentSettings.apiVersion,
    sfpi_theme: currentSettings.theme,
  }, () => {
    // Broadcast updates to all content scripts & background worker
    chrome.runtime.sendMessage({
      message: "setOrgDarkMode",
      enabled: currentSettings.orgDarkMode
    });

    chrome.runtime.sendMessage({
      message: "settingsUpdated",
      settings: currentSettings
    });

    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "💾 Save All Changes";
    }

    showToast("✓ All settings saved successfully!", "success");
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────
function getVal(id) {
  return document.getElementById(id)?.value?.trim() || "";
}
function setVal(id, val) {
  const el = document.getElementById(id);
  if (el && val !== undefined && val !== null) el.value = val;
}
function getChecked(id) {
  return document.getElementById(id)?.checked === true;
}
function setChecked(id, bool) {
  const el = document.getElementById(id);
  if (el) el.checked = bool === true;
}

function showStatus(el, msg, type) {
  el.style.display = "block";
  el.textContent = msg;
  if (type === "success") {
    el.style.color = "#10b981";
  } else if (type === "error") {
    el.style.color = "#ef4444";
  } else {
    el.style.color = "#0284c7";
  }
}

function showToast(msg, type = "success") {
  const toast = document.getElementById("toast-message");
  const icon = document.getElementById("toast-icon");
  const text = document.getElementById("toast-text");
  if (!toast) return;

  toast.className = `sfpi-toast ${type} show`;
  if (icon) icon.textContent = type === "success" ? "✓" : "⚠️";
  if (text) text.textContent = msg;

  setTimeout(() => {
    toast.classList.remove("show");
  }, 3500);
}

// Boot
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
