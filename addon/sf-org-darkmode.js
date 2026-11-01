/**
 * SF Power Inspector — Salesforce Org Dark Mode Content Script
 * Runs at document_start to prevent white flash.
 * Reads chrome.storage for org dark mode setting and injects/removes
 * the dark mode CSS stylesheet into all Salesforce pages.
 *
 * Features:
 * - Applies BEFORE first paint (document_start)
 * - MutationObserver for SPA navigation and dynamically added components
 * - Injects into open shadow roots via adoptedStyleSheets
 * - Handles same-origin iframes (via all_frames: true in manifest)
 * - Listens for chrome.storage.onChanged for instant toggle
 * - Cross-tab: new tabs automatically respect the setting
 */

(function () {
  "use strict";

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

  if (SF_EXCLUDED_HOSTS.some(h => location.hostname === h || location.hostname.endsWith("." + h))) {
    return;
  }

  const STYLE_ID = "sfpi-org-darkmode-style";
  const LINK_ID = "sfpi-org-darkmode-link";
  const STORAGE_KEY = "sfpi_orgDarkMode";

  let isDarkModeEnabled = false;
  let darkStyleSheet = null;
  let observer = null;

  // ─── 1. Read setting from chrome.storage and apply immediately ─────
  function initialize() {
    // Check if chrome.storage is available (content script context)
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.runtime?.id) {
      return;
    }

    try {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        if (chrome.runtime?.lastError) {
          return;
        }

        isDarkModeEnabled = result?.[STORAGE_KEY] === true;

        if (isDarkModeEnabled) {
          applyDarkMode();
        }
      });
    } catch (e) {}
  }

  // ─── 2. Apply Dark Mode ────────────────────────────────────────────
  function applyDarkMode() {
    isDarkModeEnabled = true;

    // Avoid duplicate injection
    if (document.getElementById(LINK_ID)) return;

    // Strategy: inject a <link> to the CSS file (more performant, cacheable)
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
      const link = document.createElement("link");
      link.id = LINK_ID;
      link.rel = "stylesheet";
      link.type = "text/css";
      link.href = chrome.runtime.getURL("styles/sf-org-darkmode.css");
      link.setAttribute("data-sfpi", "org-darkmode");

      // Insert into <head> or <html> (before any other styles if possible)
      const target = document.head || document.documentElement;
      if (target) {
        // Insert as first child to give it highest CSS priority (along with !important)
        target.insertBefore(link, target.firstChild);
      } else {
        // Document not ready yet — wait for head
        const headObserver = new MutationObserver(() => {
          if (document.head) {
            document.head.insertBefore(link, document.head.firstChild);
            headObserver.disconnect();
          }
        });
        headObserver.observe(document.documentElement || document, {
          childList: true,
          subtree: true,
        });
      }
    }

    // Also set a data attribute on html for easy detection
    if (document.documentElement) {
      document.documentElement.setAttribute("data-sfpi-darkmode", "true");
    }

    // Start observing for dynamically added components and shadow roots
    startObserver();
  }

  // ─── 3. Remove Dark Mode ───────────────────────────────────────────
  function removeDarkMode() {
    isDarkModeEnabled = false;

    // Remove injected <link>
    const link = document.getElementById(LINK_ID);
    if (link) link.remove();

    // Remove injected <style>
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();

    // Remove data attribute
    if (document.documentElement) {
      document.documentElement.removeAttribute("data-sfpi-darkmode");
    }

    // Clean up shadow root injections
    cleanupShadowRoots();

    // Stop observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // ─── 4. Shadow DOM Handling ────────────────────────────────────────
  const processedShadowRoots = new WeakSet();

  function injectIntoShadowRoot(shadowRoot) {
    if (!shadowRoot || processedShadowRoots.has(shadowRoot)) return;
    processedShadowRoots.add(shadowRoot);

    try {
      // Use adoptedStyleSheets if available (modern Chrome)
      if (shadowRoot.adoptedStyleSheets !== undefined && darkStyleSheet) {
        const existing = [...shadowRoot.adoptedStyleSheets];
        if (!existing.includes(darkStyleSheet)) {
          shadowRoot.adoptedStyleSheets = [...existing, darkStyleSheet];
        }
      } else {
        // Fallback: inject a <link> into the shadow root
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.type = "text/css";
          link.href = chrome.runtime.getURL("styles/sf-org-darkmode.css");
          link.setAttribute("data-sfpi", "org-darkmode-shadow");
          shadowRoot.appendChild(link);
        }
      }
    } catch (e) {
      // Silently fail for closed shadow roots
    }
  }

  function cleanupShadowRoots() {
    // Remove adopted stylesheets from shadow roots
    document.querySelectorAll("*").forEach((el) => {
      try {
        if (el.shadowRoot) {
          // Remove from adoptedStyleSheets
          if (el.shadowRoot.adoptedStyleSheets && darkStyleSheet) {
            el.shadowRoot.adoptedStyleSheets = el.shadowRoot.adoptedStyleSheets.filter(
              (s) => s !== darkStyleSheet
            );
          }
          // Remove injected <link> elements
          el.shadowRoot.querySelectorAll('[data-sfpi="org-darkmode-shadow"]').forEach((l) => l.remove());
        }
      } catch (e) {
        // Closed shadow root — skip
      }
    });
  }

  // ─── 5. MutationObserver for SPA Navigation ────────────────────────
  function startObserver() {
    if (observer) return;

    // Build a shared CSSStyleSheet for shadow root injection
    try {
      if (typeof CSSStyleSheet === "function" && CSSStyleSheet.prototype.replaceSync) {
        darkStyleSheet = new CSSStyleSheet();
        // Fetch the CSS content and populate the sheet
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
          fetch(chrome.runtime.getURL("styles/sf-org-darkmode.css"))
            .then((res) => res.text())
            .then((css) => {
              if (darkStyleSheet) {
                darkStyleSheet.replaceSync(css);
              }
              // Now scan existing shadow roots
              scanShadowRoots(document.body || document.documentElement);
            })
            .catch(() => {});
        }
      }
    } catch (e) {
      // CSSStyleSheet constructor not supported — use link fallback
    }

    // Debounced observer callback to avoid layout thrash
    let debounceTimer = null;
    observer = new MutationObserver((mutations) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.id === "sfpi-root" || node.classList?.contains("sfpi-btn")) continue;

            // Check if this new node has a shadow root
            try {
              if (node.shadowRoot && isDarkModeEnabled) {
                injectIntoShadowRoot(node.shadowRoot);
              }
            } catch (e) {}

            // Scan descendants for shadow roots
            if (isDarkModeEnabled) {
              scanShadowRoots(node);
            }
          }
        }
      }, 100);
    });

    const target = document.body || document.documentElement;
    if (target) {
      observer.observe(target, {
        childList: true,
        subtree: true,
      });
    }
  }

  function scanShadowRoots(root) {
    if (!root || !isDarkModeEnabled || root.id === "sfpi-root") return;
    try {
      root.querySelectorAll("*").forEach((el) => {
        try {
          if (el.shadowRoot) {
            injectIntoShadowRoot(el.shadowRoot);
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  // ─── 6. Listen for Setting Changes (instant toggle) ────────────────
  if (typeof chrome !== "undefined" && chrome.storage) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;

      if (changes[STORAGE_KEY]) {
        const newValue = changes[STORAGE_KEY].newValue;
        if (newValue === true) {
          applyDarkMode();
        } else {
          removeDarkMode();
        }
      }
    });
  }

  // ─── 7. Listen for messages from popup/background ──────────────────
  if (typeof chrome !== "undefined" && chrome.runtime) {
    chrome.runtime.onMessage.addListener((request) => {
      if (request.message === "toggleOrgDarkMode") {
        if (request.enabled) {
          applyDarkMode();
        } else {
          removeDarkMode();
        }
      }
    });
  }

  // ─── 8. Boot ───────────────────────────────────────────────────────
  initialize();
})();

