// Central API config (single source of truth)
// Defaults:
// - Local preview (127.0.0.1/localhost:550x): use local backend (when running)
// - Production hosts: use Render backend
const RENDER_API_URL = "https://anvipayz-main-preview.onrender.com";
const LOCAL_API_URL = "http://localhost:5000";

const isLocalHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

const port = String(window.location.port || "");
const isBackendOrigin = isLocalHost && port === "5000";

// Use Render by default everywhere except when you are literally on the backend origin itself.
// For local + Live Server, you can force local backend by setting `localStorage["anvi-api-base"] = "http://localhost:5000"`.
const API_URL = isBackendOrigin ? LOCAL_API_URL : RENDER_API_URL;

// Backwards-compatible aliases used across existing scripts
const API_BASE_URL = API_URL;
const ADMIN_API_BASE_URL = `${API_URL}/api/admin`;

// Safety: ensure any stored API base points to the current API_URL (avoids stale Railway cache)
try {
    const stored = String(localStorage.getItem("anvi-api-base") || "").trim();
    if (!stored || /railway\.app/i.test(stored)) {
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
