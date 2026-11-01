// SF Power Inspector - Page Context Navigation Script
// Dispatched into the host page context to access Salesforce Lightning's global $A object
document.addEventListener("lightningNavigate", (event) => {
  handleLightningNavigation(event.detail);
});

function handleLightningNavigation(details) {
  try {
    if (details.fallbackURL && /\/analytics\b|\/tableau\b|AnalyticsStudio/i.test(window.location.pathname || "")) {
      window.open(details.fallbackURL, "_top");
      return;
    }
    if (typeof $A === "undefined" || !$A.get) {
      if (details.fallbackURL) window.open(details.fallbackURL, "_top");
      return;
    }

    switch (details.navigationType) {
      case "recordId": {
        const e = $A.get("e.force:navigateToSObject");
        if (e) {
          e.setParams({ recordId: details.recordId });
          e.fire();
        } else if (details.fallbackURL) {
          window.open(details.fallbackURL, "_top");
        }
        break;
      }
      case "url": {
        const e = $A.get("e.force:navigateToURL");
        if (e) {
          e.setParams({ url: details.url });
          e.fire();
        } else if (details.fallbackURL) {
          window.open(details.fallbackURL, "_top");
        }
        break;
      }
      default:
        if (details.fallbackURL) window.open(details.fallbackURL, "_top");
    }
  } catch (error) {
    console.warn("[SF Power Inspector] Lightning navigation fallback:", error);
    if (details.fallbackURL) window.open(details.fallbackURL, "_top");
  }
}

