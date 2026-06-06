const API_BASE_URL = (typeof API_URL === "string" && API_URL.trim())
    ? API_URL.trim().replace(/\/+$/, "")
    : "";
const LOCAL_API_BASE_URL = "http://localhost:5000";

function normalizeApiBase(value) {
    return String(value || "")
        .trim()
        .replace(/\/+$/, "")
        .replace(/\/api$/, "");
}

function isLocalFrontend() {
    return window.location.protocol === "file:"
        || window.location.hostname === "localhost"
        || window.location.hostname === "127.0.0.1"
        || window.location.host.includes("localhost")
        || window.location.host.includes("127.0.0.1");
}

function getStoredApiBase() {
    try {
        return normalizeApiBase(localStorage.getItem("anvi-api-base"));
    } catch (_) {
        return "";
    }
}

function getApiBaseCandidates() {
    const candidates = [];
    const seen = new Set();

    const pushCandidate = (value) => {
        const base = normalizeApiBase(value);
        if (!base || seen.has(base)) {
            return;
        }
        seen.add(base);
        candidates.push(base);
    };

    const storedBase = getStoredApiBase();

    // On local dev / Live Server, prefer the local backend first so we don't
    // depend on the hosted preview being healthy.
    if (isLocalFrontend()) {
        pushCandidate(LOCAL_API_BASE_URL);
    }

    pushCandidate(storedBase);
    pushCandidate(API_BASE_URL);

    if (!isLocalFrontend()) {
        pushCandidate(LOCAL_API_BASE_URL);
    }

    return candidates;
}

export const ADMIN_API_BASE = `${API_BASE_URL}/api/admin`;
const ADMIN_TOKEN_KEY = "anvi-admin-token";

export async function fetchBackendHealth({ timeoutMs = 6000 } = {}) {
    const bases = getApiBaseCandidates();

    for (const base of bases) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(`${base}/api/test`, {
                method: "GET",
                headers: { Accept: "application/json" },
                signal: controller.signal
            });

            const payload = await response.json().catch(() => null);
            const database = payload?.database || "";

            if (response.ok && String(database).toLowerCase() === "connected") {
                return {
                    ok: true,
                    status: response.status,
                    database,
                    payload
                };
            }

            // Keep trying other bases if the current one is unhealthy.
        } catch (error) {
            // Ignore and continue with the next base candidate.
        } finally {
            window.clearTimeout(timer);
        }
    }

    return {
        ok: false,
        status: 0,
        database: "",
        payload: null
    };
}

export function getAdminToken() {
    const token = String(localStorage.getItem(ADMIN_TOKEN_KEY) || "").trim();
    if (!token) {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
    }
    return token;
}

export function setAdminToken(token) {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken() {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
}

export async function requestFirst(variants, { auth = true } = {}) {
    let lastError = null;

    for (const variant of variants) {
        try {
            return await apiRequest(variant.path, {
                method: variant.method || "GET",
                body: variant.body,
                auth
            });
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error("Admin API request failed.");
}

export async function apiRequest(path, { method = "GET", body, auth = true } = {}) {
    const headers = {
        Accept: "application/json"
    };

    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
    }

    if (auth) {
        const token = getAdminToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
    }

    let lastError = null;

    for (const base of getApiBaseCandidates()) {
        let response;
        try {
            response = await fetch(`${base}/api/admin${path}`, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined
            });
        } catch (error) {
            lastError = error;
            continue;
        }

        const contentType = response.headers.get("content-type") || "";
        const payload = contentType.includes("application/json")
            ? await response.json().catch(() => null)
            : await response.text().catch(() => "");

        if (response.ok) {
            return payload;
        }

        const message = typeof payload === "object" && payload?.message
            ? payload.message
            : `Request failed with status ${response.status}.`;
        const error = new Error(message);
        error.status = response.status;
        if (typeof payload === "object" && payload?.code) {
            error.code = payload.code;
        }

        if (response.status === 401 || response.status === 403) {
            throw error;
        }

        lastError = error;
    }

    throw lastError || new Error("Unable to reach the server. Please try again.");
}

export function formatDateTime(value) {
    const ms = toTimestamp(value);
    if (!ms) {
        return "-";
    }

    return new Date(ms).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

export function formatRelativeTime(value) {
    const ms = toTimestamp(value);
    if (!ms) {
        return "-";
    }

    const diff = Date.now() - ms;
    if (diff < 60_000) return "Just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function normalizeUserRecord(user) {
    return {
        id: user.id || user._id || "",
        fullName: user.fullName || user.name || "User",
        email: user.email || "No email",
        phone: user.phone || user.mobile || user.phoneNumber || "-",
        balance: toNumber(user.balance, user.points, 0),
        tokens: toNumber(user.tokens, user.totalTokens, 0),
        tokensConverted: toNumber(user.tokensConverted, user.totalTokensConverted, user.convertedTokens, 0),
        totalReferrals: toNumber(user.totalReferrals, user.referrals, 0),
        joinedAt: user.joinedAt || user.createdAt || user.registeredAt || 0,
        lastActive: user.lastActive || user.updatedAt || user.lastLoginAt || 0,
        joinType: user.joinType || (user.referredBy ? "referral" : "direct"),
        referredByName: user.referredByName || user.referredBy || ""
    };
}

export function normalizeTaskRecord(task) {
    const questions = Array.isArray(task.questions)
        ? task.questions
        : (typeof task.questions === "string" ? safeJsonParse(task.questions, []) : []);

    return {
        id: task.id || task._id || "",
        title: task.title || "Untitled Task",
        taskType: task.taskType || task.type || "general",
        rewardPoints: toNumber(task.rewardPoints, task.points, task.reward, 0),
        status: task.status || "active",
        createdAt: task.createdAt || task.updatedAt || task.date || 0,
        link: task.link || task.url || "",
        description: task.description || "",
        seedKey: task.seedKey || "",
        notifyUsers: Boolean(task.notifyUsers),
        questions,
        questionCount: Array.isArray(questions) ? questions.length : 0
    };
}

export function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export function chunkArray(list, size) {
    const chunks = [];
    for (let index = 0; index < list.length; index += size) {
        chunks.push(list.slice(index, index + size));
    }
    return chunks;
}

export function toNumber(...values) {
    for (const value of values) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return numeric;
        }
    }

    return 0;
}

export function capitalize(value) {
    const raw = String(value || "");
    return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "";
}

function safeJsonParse(value, fallback = null) {
    if (typeof value !== "string") {
        return fallback;
    }

    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function toTimestamp(value) {
    if (!value) return 0;
    if (typeof value === "number") return value > 100_000_000_000 ? value : value * 1000;
    if (typeof value === "string") {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric > 100_000_000_000 ? numeric : numeric * 1000;
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.seconds === "number") return value.seconds * 1000;
    return 0;
}
