// Background script - handles import/export.
// Chrome: uses declarativeNetRequest to redirect API to a data: URI.
// Firefox: uses webRequest.filterResponseData() to modify the response body.

const DNR_RULE_ID = 1001;

// Feature detection: Firefox exposes filterResponseData on browser.webRequest.
const useWebRequestFilter =
  typeof browser !== "undefined" &&
  typeof browser.webRequest !== "undefined" &&
  typeof browser.webRequest.filterResponseData === "function";

// Find the active web page tab, skipping extension tabs.
// Works from both the popup (where lastFocusedWindow is the browser window)
// and the pop-out (where lastFocusedWindow is the extension window, so we
// fall back to scanning all normal windows).
async function getTargetTab() {
  // Try the last focused window first.
  let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  let tab = tabs.find((t) => t.url?.startsWith("http"));
  if (tab) return tab;

  // Fallback: active HTTP tab in any normal window.
  tabs = await chrome.tabs.query({ active: true, windowType: "normal" });
  tab = tabs.find((t) => t.url?.startsWith("http"));
  return tab || null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "import-dashboard") {
    handleImport(message.data).then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: err.message })
    );
    return true;
  }

  if (message.type === "export-dashboard") {
    handleExport().then(
      (result) => sendResponse(result),
      (err) => sendResponse({ dashboard: { error: err.message } })
    );
    return true;
  }
});

// ---------------------------------------------------------------------------
// Shared: read page state and build the merged API response
// ---------------------------------------------------------------------------

async function getPageInfo(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      try {
        const ctx = window.__grafanaSceneContext;
        if (!ctx) return null;
        return {
          meta: ctx._state.meta,
          id: ctx._state.id,
          uid: ctx._state.uid,
        };
      } catch (e) {
        return null;
      }
    },
  });
  return result;
}

function buildApiResponse(pageInfo, importDashboard) {
  const apiResponse = {
    meta: pageInfo?.meta || {
      type: "db",
      canSave: true,
      canEdit: true,
      canAdmin: false,
      canStar: true,
      canDelete: false,
      slug: "",
      url: "",
      version: 1,
      hasAcl: false,
      isFolder: false,
      provisioned: false,
    },
    dashboard: importDashboard,
  };

  if (pageInfo) {
    apiResponse.dashboard.id = pageInfo.id;
    apiResponse.dashboard.uid = pageInfo.uid;
  }

  return apiResponse;
}

function getDashboardUid(tabUrl) {
  const m = tabUrl.match(/\/d\/([^/]+)/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Import: browser-specific implementations
// ---------------------------------------------------------------------------

async function handleImport(importDashboard) {
  const tab = await getTargetTab();
  if (!tab) throw new Error("No active tab");

  const pageInfo = await getPageInfo(tab.id);
  const apiResponse = buildApiResponse(pageInfo, importDashboard);

  if (useWebRequestFilter) {
    await handleImportFirefox(tab, apiResponse);
  } else {
    await handleImportChrome(tab, apiResponse);
  }
}

// -- Chrome: DNR data: URI redirect ----------------------------------------

async function handleImportChrome(tab, apiResponse) {
  const jsonStr = JSON.stringify(apiResponse);
  const bytes = new TextEncoder().encode(jsonStr);
  const binary = String.fromCodePoint(...bytes);
  const base64 = btoa(binary);
  const dataUri = "data:application/json;base64," + base64;

  const uid = getDashboardUid(tab.url);
  const urlFilter = uid
    ? "*/api/dashboards/uid/" + uid
    : "*/api/dashboards/uid/*";

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [DNR_RULE_ID],
    addRules: [
      {
        id: DNR_RULE_ID,
        priority: 1,
        action: {
          type: "redirect",
          redirect: { url: dataUri },
        },
        condition: {
          urlFilter: urlFilter,
          resourceTypes: ["xmlhttprequest"],
        },
      },
    ],
  });

  await chrome.tabs.reload(tab.id);

  setTimeout(async () => {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [DNR_RULE_ID],
    });
  }, 5000);
}

// -- Firefox: webRequest.filterResponseData() ------------------------------

async function handleImportFirefox(tab, apiResponse) {
  const uid = getDashboardUid(tab.url);
  const urlPattern = uid
    ? "*://*/api/dashboards/uid/" + uid
    : "*://*/api/dashboards/uid/*";

  const responseBody = JSON.stringify(apiResponse);
  let intercepted = false;

  function listener(details) {
    if (intercepted) return;
    intercepted = true;

    // Remove the listener immediately (one-shot).
    browser.webRequest.onBeforeRequest.removeListener(listener);

    const filter = browser.webRequest.filterResponseData(details.requestId);
    const encoder = new TextEncoder();

    // Discard the original response body and write our own.
    filter.ondata = () => {
      // Ignore incoming data chunks.
    };

    filter.onstop = () => {
      filter.write(encoder.encode(responseBody));
      filter.close();
    };
  }

  browser.webRequest.onBeforeRequest.addListener(
    listener,
    { urls: [urlPattern], types: ["xmlhttprequest"] },
    ["blocking"]
  );

  await chrome.tabs.reload(tab.id);

  // Safety cleanup: remove listener after 10 seconds if it hasn't fired.
  setTimeout(() => {
    try {
      browser.webRequest.onBeforeRequest.removeListener(listener);
    } catch (e) {
      // Already removed.
    }
  }, 10000);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

async function handleExport() {
  const tab = await getTargetTab();
  if (!tab) return { dashboard: { error: "No active tab" } };

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: () => {
      try {
        const ctx = window.__grafanaSceneContext;
        if (!ctx) return { error: "No Grafana scene context found" };
        return ctx._initialSaveModel || { error: "No save model found" };
      } catch (e) {
        return { error: e.message };
      }
    },
  });

  if (chrome.runtime.lastError) {
    return { dashboard: { error: chrome.runtime.lastError.message } };
  }
  return { dashboard: result };
}
