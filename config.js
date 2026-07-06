// Central API config (single source of truth)
// Defaults:
// - Local preview (file://, 127.0.0.1/localhost:550x): use local backend (when running)
// - Production hosts: use Render backend
const RENDER_API_URL = "https://anvipayz-main-preview.onrender.com";
const LOCAL_API_URL = "http://localhost:5000";

const isLocalPreview =
    window.location.protocol === "file:" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

// Use local backend for any local preview, and Render for production hosts.
// This avoids CORS issues when the frontend is served from 127.0.0.1:55xx.
const API_URL = isLocalPreview ? LOCAL_API_URL : RENDER_API_URL;

// Backwards-compatible aliases used across existing scripts
const API_BASE_URL = API_URL;
const ADMIN_API_BASE_URL = `${API_URL}/api/admin`;

// Safety: ensure any stored API base points to the current API_URL so stale values do not win.
try {
    const stored = String(localStorage.getItem("anvi-api-base") || "").trim();
    if (!stored || /railway\.app/i.test(stored) || (isLocalPreview && stored !== LOCAL_API_URL)) {
        localStorage.setItem("anvi-api-base", API_URL);
    }
} catch (_) {
    // ignore
}

// Expose for module scripts as well.
try {
    globalThis.API_URL = API_URL;
    globalThis.API_BASE_URL = API_BASE_URL;
    globalThis.ADMIN_API_BASE_URL = ADMIN_API_BASE_URL;
} catch (_) {
    // ignore
}
