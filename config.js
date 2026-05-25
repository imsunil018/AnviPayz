// Central API config (single source of truth)
// Defaults:
// - Live Server / static local preview (127.0.0.1:550x): use Render backend
// - Backend-served pages (localhost:5000): use local backend
const RENDER_API_URL = "https://anvipayz-main-preview.onrender.com";
const LOCAL_API_URL = "http://localhost:5000";

const isLocalHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

const isBackendOrigin =
    isLocalHost && String(window.location.port || "") === "5000";

const API_URL = isBackendOrigin ? LOCAL_API_URL : RENDER_API_URL;

// Backwards-compatible aliases used across existing scripts
const API_BASE_URL = API_URL;
const ADMIN_API_BASE_URL = `${API_URL}/api/admin`;

// Expose for module scripts as well.
try {
    globalThis.API_URL = API_URL;
    globalThis.API_BASE_URL = API_BASE_URL;
    globalThis.ADMIN_API_BASE_URL = ADMIN_API_BASE_URL;
} catch (_) {
    // ignore
}
