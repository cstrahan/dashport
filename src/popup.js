// Popup script - handles file upload, JSON paste, import trigger, and export.

// When opened as a pop-out window, let the body fill the window.
if (window.location.search.includes("window=1")) {
  document.body.style.width = "auto";
}

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const jsonInput = document.getElementById("jsonInput");
const importBtn = document.getElementById("importBtn");
const exportBtn = document.getElementById("exportBtn");
const copyBtn = document.getElementById("copyBtn");
const status = document.getElementById("status");

let dashboardJson = null;

function showStatus(message, type) {
  status.textContent = message;
  status.className = "status " + type;
}

function clearStatus() {
  status.className = "status";
}

function parseDashboard(text) {
  const data = JSON.parse(text);

  // Support both formats:
  // 1. Full API response: { meta: {...}, dashboard: {...} }
  // 2. Dashboard-only export: { title: "...", panels: [...], ... }
  if (data.dashboard && data.meta) {
    return data.dashboard;
  }
  return data;
}

function setDashboard(json, filename) {
  dashboardJson = json;
  importBtn.disabled = false;
  clearStatus();

  if (filename) {
    dropZone.classList.add("has-file");
    dropZone.innerHTML = '<div class="filename">' + filename + "</div>" + json.title;
  }
}

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const json = parseDashboard(e.target.result);
      setDashboard(json, file.name);
      jsonInput.value = "";
    } catch (err) {
      showStatus("Invalid JSON: " + err.message, "error");
    }
  };
  reader.readAsText(file);
}

// File drop zone
dropZone.addEventListener("click", () => fileInput.click());

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files.length > 0) {
    handleFile(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) {
    handleFile(fileInput.files[0]);
  }
});

// Paste JSON
jsonInput.addEventListener("input", () => {
  const text = jsonInput.value.trim();
  if (!text) {
    dashboardJson = null;
    importBtn.disabled = true;
    clearStatus();
    return;
  }
  try {
    const json = parseDashboard(text);
    dashboardJson = json;
    importBtn.disabled = false;
    clearStatus();
    // Clear file state if pasting
    dropZone.classList.remove("has-file");
    dropZone.textContent = "Drop a JSON file here or click to browse";
  } catch (err) {
    dashboardJson = null;
    importBtn.disabled = true;
    showStatus("Invalid JSON: " + err.message, "error");
  }
});

// Import button
importBtn.addEventListener("click", () => {
  if (!dashboardJson) return;

  importBtn.disabled = true;
  importBtn.textContent = "Importing...";

  chrome.runtime.sendMessage(
    { type: "import-dashboard", data: dashboardJson },
    (response) => {
      if (response?.ok) {
        showStatus("Imported! Page is reloading...", "success");
        // Popup will close automatically when the tab reloads
      } else {
        showStatus("Failed to import: " + (response?.error || "unknown error"), "error");
        importBtn.disabled = false;
        importBtn.textContent = "Import & Reload";
      }
    }
  );
});

// Export button
exportBtn.addEventListener("click", () => {
  exportBtn.textContent = "Exporting...";

  chrome.runtime.sendMessage({ type: "export-dashboard" }, (response) => {
    exportBtn.textContent = "Export Current Dashboard";

    if (response?.dashboard && !response.dashboard.error) {
      const json = JSON.stringify(response.dashboard, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (response.dashboard.uid || response.dashboard.title || "dashboard") + ".json";
      a.click();
      URL.revokeObjectURL(url);
      showStatus("Exported: " + a.download, "success");
    } else {
      showStatus(
        "Export failed: " + (response?.dashboard?.error || "Not a Grafana dashboard page"),
        "error"
      );
    }
  });
});

// Pop out into a persistent window (useful in Firefox where the popup closes on blur)
document.getElementById("popoutBtn").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.windows.create({
    url: chrome.runtime.getURL("popup.html?window=1"),
    type: "popup",
    width: 420,
    height: 520,
  });
  window.close();
});

// Copy to clipboard button
copyBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "export-dashboard" }, (response) => {
    if (response?.dashboard && !response.dashboard.error) {
      const json = JSON.stringify(response.dashboard, null, 2);
      navigator.clipboard.writeText(json).then(
        () => showStatus("Copied to clipboard", "success"),
        () => showStatus("Failed to copy to clipboard", "error")
      );
    } else {
      showStatus(
        "Export failed: " + (response?.dashboard?.error || "Not a Grafana dashboard page"),
        "error"
      );
    }
  });
});
