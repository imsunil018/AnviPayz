const APP_VERSION = "2026-03-30-production";

// API Base URL - fixed per environment
const isLocalDev = window.location.protocol === "file:" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.host.includes("localhost") ||
    window.location.host.includes("127.0.0.1");

function normalizeApiBase(value) {
    return String(value || "")
        .trim()
        .replace(/\/+$/, "")
        .replace(/\/api$/, "");
}

const API_BASE_CONFIG = (typeof API_URL === "string" && API_URL.trim())
    ? normalizeApiBase(API_URL)
    : "";
const API_BASE_LOCAL = API_BASE_CONFIG || "";
const API_BASE_FALLBACK_REMOTE = API_BASE_CONFIG || "";
function pickInitialApiBase() {
    try {
        const forced = normalizeApiBase(localStorage.getItem("anvi-api-base"));
        if (forced) {
            const isForcedLocal = forced.startsWith("http://localhost") || forced.startsWith("http://127.0.0.1");
            const isForcedRemote = API_BASE_FALLBACK_REMOTE && forced === API_BASE_FALLBACK_REMOTE;
            if (isForcedLocal || isForcedRemote) {
                return forced;
            }
        }
    } catch (_) {
        // ignore
    }

    if (!isLocalDev) {
        return API_BASE_FALLBACK_REMOTE || API_BASE_LOCAL;
    }

    // Live Server / static hosts on 127.0.0.1 often don't run the backend on `:5000`.
    // Default to remote to avoid a slow failing request on every page load.
    const port = String(window.location.port || "");
    if (window.location.protocol !== "file:" && port && port !== "5000") {
        return API_BASE_FALLBACK_REMOTE || API_BASE_LOCAL;
    }

    return API_BASE_LOCAL;
}

let activeApiBase = normalizeApiBase(pickInitialApiBase());
const API_PREFIX = "/api";

const INDIA_TIME_ZONE = "Asia/Kolkata";
const inflightRequests = new Map();
let appInitPromise = null;
let deleteAccountFlowResolver = null;
let deleteAccountFlowStep = 0;
let accountRestoreContext = null;
let lastNotificationsSyncAt = 0;
let notificationReadMigrationDone = false;
const DEBUG_LOGS = (() => {
    try {
        return localStorage.getItem("anvi-debug") === "1";
    } catch (_) {
        return false;
    }
})();

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

const STORAGE_KEYS = {
    token: "anvi-token",
    user: "anvi-user",
    notifications: "anvi-local-notifications",
    notificationReads: "anvi-notification-reads",
    activity: "anvi-local-activity",
    tasks: "anvi-local-task-state",
    watchState: "anvi-local-watch-state",
    referralSeenCount: "anvi-referral-seen-count",
    activeUser: "anvi-active-user"
};

function normalizeTokenValue(value) {
    return typeof value === "string" ? value.trim() : "";
}

function getStoredToken() {
    const token = normalizeTokenValue(localStorage.getItem(STORAGE_KEYS.token));
    if (!token) {
        localStorage.removeItem(STORAGE_KEYS.token);
    }
    return token;
}

const PUBLIC_PAGES = new Set(["index.html", "login.html", "forgot.html", "reset-password.html", "legal.html"]);
const DEFAULT_ADMIN_TASKS = [];
const SPIN_REWARDS = [5, 10, 15, 20, 25, 40, 60, 100];
const SECURITY_ACTIVITY_KEY = "anvi-last-activity";
const INACTIVITY_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;
const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const NOTIFICATION_MAX_STORED = 200;
const DELETE_ACCOUNT_FLOW_STEPS = [
    {
        badge: "Step 1 of 3",
        title: "Schedule account deletion?",
        message: "Your account will be signed out right away and marked for deletion on this device.",
        points: [
            "You will lose access to your current session.",
            "You can still restore the same account within the next 7 days."
        ],
        confirmLabel: "Continue"
    },
    {
        badge: "Step 2 of 3",
        title: "Recovery stays open for 7 days",
        message: "Your rewards and account data stay paused during the recovery window, then the account is removed permanently.",
        points: [
            "Login again within 7 days if you want to restore everything.",
            "After the deadline, coins, tokens, and history will be deleted permanently."
        ],
        confirmLabel: "I Understand"
    },
    {
        badge: "Final Step",
        title: "Final confirmation",
        message: "Please confirm one last time to schedule permanent deletion after the 7-day recovery period.",
        points: [
            "You can recover by logging in again before the deadline.",
            "If you do nothing for 7 days, deletion will happen permanently."
        ],
        confirmLabel: "Schedule Deletion",
        acknowledgement: "I understand permanent deletion will happen automatically after 7 days."
    }
];

const state = {
    page: currentPage(),
    user: null, // Always fetch from API, not localStorage
    token: getStoredToken(),
    notificationReads: readStore(STORAGE_KEYS.notificationReads, {}),
    notifications: normalizeNotifications(readStore(STORAGE_KEYS.notifications, [])),
    activity: normalizeActivity(readStore(STORAGE_KEYS.activity, [])),
    spinning: false,
    wheelRotation: 0,
    watchTimer: null,
    taskRefreshTimer: null,
    taskRefreshBound: false
};

const taskCatalog = globalThis.AnviTaskCatalog || null;

function getSafeToken() {
    const token = normalizeTokenValue(state.token);
    if (!token && state.token) {
        state.token = "";
        localStorage.removeItem(STORAGE_KEYS.token);
    }
    return token;
}

function storeAuthToken(value) {
    const token = normalizeTokenValue(value);
    if (!token) {
        state.token = "";
        localStorage.removeItem(STORAGE_KEYS.token);
        return;
    }
    localStorage.setItem(STORAGE_KEYS.token, token);
    state.token = token;
}

const MOBILE_NAV_META = {
    "home.html": { href: "home.html", label: "Dashboard", icon: "ri-home-5-line" },
    "wallet.html": { href: "wallet.html", label: "Wallet", icon: "ri-wallet-line" },
    "tasks.html": { href: "tasks.html", label: "Tasks", icon: "ri-task-line" },
    "recharge.html": { href: "recharge.html", label: "Recharge", icon: "ri-flashlight-fill" },
    "refer.html": { href: "refer.html", label: "Refer", icon: "ri-share-forward-line" },
    "notifications.html": { href: "notifications.html", label: "Notifications", icon: "ri-notification-3-line" },
    "profile.html": { href: "profile.html", label: "Profile", icon: "ri-user-line" },
    "support.html": { href: "support.html", label: "Support", icon: "ri-customer-service-2-line" },
    "spin.html": { href: "spin.html", label: "Spin", icon: "ri-refresh-line" },
    "shortcuts.html": { href: "shortcuts.html", label: "Shortcuts", icon: "ri-grid-fill" }
};

const HOME_QUICK_ACTIONS_KEY = "anvi-home-quick-actions";

const QUICK_ACTIONS_META = [
    { id: "convert", label: "Convert", href: "wallet.html#convert-section", icon: "ri-exchange-funds-line", tone: "convert" },
    { id: "refer", label: "Refer", href: "refer.html", icon: "ri-share-forward-line", tone: "refer" },
    { id: "support", label: "Support", href: "support.html", icon: "ri-customer-service-2-line", tone: "support" },
    { id: "leaderboard", label: "Leaderboard", href: "refer.html#leaderboard", icon: "ri-trophy-line", tone: "leaderboard" },
    { id: "wallet", label: "Wallet", href: "wallet.html", icon: "ri-wallet-line", tone: "convert" },
    { id: "tasks", label: "Tasks", href: "tasks.html", icon: "ri-task-line", tone: "alerts" },
    { id: "recharge", label: "Recharge", href: "recharge.html", icon: "ri-flashlight-fill", tone: "convert" },
    { id: "profile", label: "Profile", href: "profile.html", icon: "ri-user-line", tone: "support" },
    { id: "privacy", label: "Privacy", href: "privacy.html", icon: "ri-shield-check-line", tone: "showall" },
    { id: "terms", label: "Terms", href: "terms.html", icon: "ri-file-text-line", tone: "showall" },
    { id: "refund", label: "Refund", href: "refund.html", icon: "ri-refund-2-line", tone: "showall" },
    { id: "disclaimer", label: "Disclaimer", href: "disclaimer.html", icon: "ri-information-line", tone: "showall" },
    { id: "legal", label: "Legal", href: "legal.html", icon: "ri-bank-card-line", tone: "showall" },
    { id: "showall", label: "Notifications", href: "notifications.html", icon: "ri-notification-3-line", tone: "alerts" }
];

function defaultHomeQuickActions() {
    return ["convert", "wallet", "refer", "support", "leaderboard", "showall"];
}

function loadHomeQuickActions() {
    try {
        const raw = localStorage.getItem(HOME_QUICK_ACTIONS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        const ids = Array.isArray(parsed)
            ? parsed
                .map((id) => String(id || "").trim())
                .filter(Boolean)
                .map((id) => (id === "alerts" ? "showall" : id))
            : [];
        const available = new Set(QUICK_ACTIONS_META.map((item) => item.id));
        let unique = Array.from(new Set(ids)).filter((id) => available.has(id));

        return unique.length ? unique : defaultHomeQuickActions();
    } catch (error) {
        return defaultHomeQuickActions();
    }
}

function saveHomeQuickActions(ids) {
    const cleaned = (Array.isArray(ids) ? ids : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean);
    localStorage.setItem(HOME_QUICK_ACTIONS_KEY, JSON.stringify(cleaned));
}

function renderHomeQuickActions() {
    const container = document.getElementById("home-quick-actions");
    if (!container) {
        return;
    }

    const ids = loadHomeQuickActions();
    const metaMap = new Map(QUICK_ACTIONS_META.map((item) => [item.id, item]));
    const records = ids.map((id) => metaMap.get(id)).filter(Boolean);

    if (!records.length) {
        return;
    }

    container.innerHTML = records.map((action) => `
        <a class="mobile-quick-item" href="${escapeHtml(action.href)}" data-action-id="${escapeHtml(action.id)}">
            <span class="mobile-quick-icon mobile-quick-icon--${escapeHtml(action.tone || "showall")}">
                <i class="${escapeHtml(action.icon)}"></i>
            </span>
            <span>${escapeHtml(action.label)}</span>
        </a>
    `).join("");
}

function shortcutTileMarkup(action, { checked = false } = {}) {
    return `
        <div class="shortcut-tile" data-shortcut-id="${escapeHtml(action.id)}">
            <a class="shortcut-open" href="${escapeHtml(action.href)}">
                <span class="mobile-quick-icon mobile-quick-icon--${escapeHtml(action.tone || "showall")}">
                    <i class="${escapeHtml(action.icon)}"></i>
                </span>
                <span class="shortcut-label">${escapeHtml(action.label)}</span>
            </a>
            <label class="shortcut-pin">
                <input class="shortcut-pin-input" type="checkbox" ${checked ? "checked" : ""}>
                <span class="shortcut-pin-ui">Pin</span>
            </label>
        </div>
    `;
}

async function initShortcutsPage() {
    const container = document.getElementById("shortcuts-list");
    if (!container) {
        return;
    }

    const saveBtn = document.getElementById("shortcuts-save-btn");
    const editBtn = document.getElementById("shortcuts-edit-btn");
    const shortcutsCard = container.closest(".shortcuts-card");
    const current = loadHomeQuickActions();
    let lastSaved = new Set(current);
    let isEditing = false;

    const actions = QUICK_ACTIONS_META
        .filter((item) => item && item.id);

    container.innerHTML = actions
        .map((action) => shortcutTileMarkup(action, { checked: lastSaved.has(action.id) }))
        .join("");

    const maxShortcuts = 8;

    function applySavedSelection() {
        container.querySelectorAll(".shortcut-tile").forEach((tile) => {
            const id = String(tile?.dataset?.shortcutId || "").trim();
            const input = tile.querySelector(".shortcut-pin-input");
            if (!(input instanceof HTMLInputElement)) {
                return;
            }
            input.checked = Boolean(id && lastSaved.has(id));
        });
    }

    function setEditing(nextEditing) {
        isEditing = Boolean(nextEditing);

        if (shortcutsCard) {
            shortcutsCard.classList.toggle("is-editing", isEditing);
        }

        if (saveBtn) {
            saveBtn.hidden = !isEditing;
            saveBtn.disabled = !isEditing;
        }

        if (editBtn) {
            editBtn.setAttribute("aria-pressed", isEditing ? "true" : "false");
            editBtn.setAttribute("aria-label", isEditing ? "Exit edit mode" : "Edit shortcuts");
            editBtn.title = isEditing ? "Exit edit mode" : "Edit shortcuts";
            const icon = editBtn.querySelector("i");
            if (icon) {
                icon.className = isEditing ? "ri-close-line" : "ri-edit-2-line";
            }

            const label = editBtn.querySelector(".shortcuts-edit-label");
            if (label) {
                label.textContent = isEditing ? "Cancel" : "Edit";
            }
        }

        container.querySelectorAll(".shortcut-pin-input").forEach((input) => {
            if (input instanceof HTMLInputElement) {
                input.disabled = !isEditing;
            }
        });

        if (!isEditing) {
            applySavedSelection();
        }
    }

    function computePinnedIds() {
        const selected = [];
        container.querySelectorAll(".shortcut-pin-input:checked").forEach((input) => {
            const tile = input.closest(".shortcut-tile");
            const id = String(tile?.dataset?.shortcutId || "").trim();
            if (id) {
                selected.push(id);
            }
        });

        return selected.slice(0, maxShortcuts);
    }

    container.addEventListener("change", (event) => {
        if (!isEditing) {
            return;
        }

        const target = event.target;
        if (!(target instanceof HTMLInputElement) || !target.classList.contains("shortcut-pin-input")) {
            return;
        }

        const checkedCount = container.querySelectorAll(".shortcut-pin-input:checked").length;
        if (checkedCount > maxShortcuts) {
            target.checked = false;
            showToast("You can pin up to 8 shortcuts.", "error");
        }
    });

    editBtn?.addEventListener("click", () => {
        setEditing(!isEditing);
    });

    setEditing(false);

    saveBtn?.addEventListener("click", async () => {
        if (!isEditing) {
            return;
        }

        const ids = computePinnedIds();
        saveHomeQuickActions(ids);
        lastSaved = new Set(ids);
        showToast("Home shortcuts updated.", "success");
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        window.location.replace("home.html");
    });
}

const defaultTasks = [
    {
        id: "daily-checkin",
        title: "Daily Check-in",
        description: "Open the app once a day to keep your streak active.",
        rewardPoints: 10,
        buttonLabel: "Claim",
        category: "daily",
        style: "success"
    },
    {
        id: "watch-tutorial",
        title: "Watch Tutorial",
        description: "Watch the guided tutorial for 10 seconds.",
        rewardPoints: 15,
        buttonLabel: "Start",
        category: "video",
        style: "warning"
    }
];

document.addEventListener("DOMContentLoaded", () => {
    if (DEBUG_LOGS) {
        console.log("🔧 API_BASE:", activeApiBase);
        console.log("🔧 Is Local Dev:", isLocalDev);
        console.log("🔧 Location:", window.location.host);
    }

    if (!appInitPromise) {
        appInitPromise = initApp().finally(() => {
            appInitPromise = null;
        });
    }
});

window.logout = logout;

async function initApp() {
    console.info("[AnviPayz]", APP_VERSION, state.page);

    enforceAutoLogout();
    getSafeToken();
    bindActivityListeners();
    ensureUiShell();
    state.notificationReads = pruneNotificationReads(readStore(STORAGE_KEYS.notificationReads, {}));
    state.notifications = applyNotificationReadState(pruneNotifications(state.notifications));
    persistNotifications(state.notifications);
    syncActiveNav();
    bindNetworkIndicators();
    bindThemeToggles();

    if (state.page === "legal.html") {
        return;
    }

    if (!PUBLIC_PAGES.has(state.page) && !state.token) {
        redirectToLogin();
        return;
    }

    if (state.page === "index.html" || state.page === "login.html" || state.page === "forgot.html" || state.page === "reset-password.html") {
        if (state.token && (state.page === "index.html" || state.page === "login.html")) {
            window.location.replace("home.html");
            return;
        }

        initAuthPages();
        return;
    }

    initShellInteractions();

    // Show cached user data immediately to reduce splash time
    renderCommonUserState();
    // Fetch fresh user data in the background
    hydrateUser().then(() => renderCommonUserState()).catch(() => null);

    // Keep unread badge in sync across pages/sessions.
    // (No-op on failure; local cache still works as fallback.)
    if (state.page !== "notifications.html") {
        fetchNotificationsPayload().catch(() => null);
    }

    switch (state.page) {
        case "home.html":
            await initHomePage();
            break;
        case "tasks.html":
            await initTasksPage();
            break;
        case "wallet.html":
            await initWalletPage();
            break;
        case "refer.html":
            await initReferPage();
            break;
        case "recharge.html":
            await initRechargePage();
            break;
        case "notifications.html":
            await initNotificationsPage();
            break;
        case "spin.html":
            await initSpinPage();
            break;
        case "profile.html":
            await initProfilePage();
            break;
        case "support.html":
            initSupportPage();
            break;
        case "shortcuts.html":
            await initShortcutsPage();
            break;
        default:
            break;
    }
}

function currentPage() {
    const path = String(window.location.pathname || "/");
    const last = path.split("/").filter(Boolean).pop() || "";
    const lower = last.toLowerCase();

    // Vercel `cleanUrls: true` serves `home.html` at `/home` (no extension).
    // Normalize extensionless routes back to the physical `.html` filenames that
    // the app switch/case and navigation tables expect.
    if (!lower || lower === "/") {
        return "index.html";
    }

    if (!lower.includes(".")) {
        // Prefer explicit page hints when available (HTML uses `body[data-page]`).
        const hinted = String(document.body?.dataset?.page || "").trim().toLowerCase();
        const name = hinted && !hinted.includes(".") ? hinted : lower;
        return `${name}.html`;
    }

    return lower;
}

function ensureUiShell() {
    if (!document.querySelector(".app-toast-stack")) {
        const toastStack = document.createElement("div");
        toastStack.className = "app-toast-stack";
        document.body.appendChild(toastStack);
    }

    if (!document.querySelector(".page-loading-bar")) {
        const bar = document.createElement("div");
        bar.className = "page-loading-bar";
        document.body.appendChild(bar);
    }

    if (!document.querySelector(".network-status")) {
        const banner = document.createElement("div");
        banner.className = "network-status";
        banner.setAttribute("role", "status");
        banner.setAttribute("aria-live", "polite");
        banner.innerHTML = `
            <span class="network-status__dot"></span>
            <span class="network-status__text">Checking connection...</span>
        `;
        document.body.appendChild(banner);
    }

    if (!document.querySelector(".reward-modal")) {
        const modal = document.createElement("div");
        modal.className = "reward-modal";
        modal.hidden = true;
        modal.innerHTML = `
            <div class="reward-card">
                <div class="reward-icon" id="reward-icon">🎉</div>
                <h3 id="reward-title">Reward unlocked</h3>
                <p id="reward-message">Your action completed successfully.</p>
                <div class="reward-value" id="reward-value">0 Points</div>
                <div class="reward-actions">
                    <button type="button" class="btn-primary" id="reward-close-btn">Continue</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener("click", (event) => {
            if (event.target === modal) {
                hideRewardPopup();
            }
        });

        document.getElementById("reward-close-btn")?.addEventListener("click", hideRewardPopup);
    }

    if (!document.querySelector(".danger-confirm-modal")) {
        const modal = document.createElement("div");
        modal.className = "danger-confirm-modal";
        modal.hidden = true;
        modal.innerHTML = `
            <div class="danger-confirm-card" role="dialog" aria-modal="true" aria-labelledby="danger-confirm-title" aria-describedby="danger-confirm-message">
                <button type="button" class="danger-confirm-close" id="danger-confirm-close" aria-label="Close delete account confirmation">
                    <i class="ri-close-line"></i>
                </button>
                <div class="danger-confirm-badge" id="danger-confirm-badge">Step 1 of 3</div>
                <h3 id="danger-confirm-title">Delete your account?</h3>
                <p id="danger-confirm-message">This action needs multiple confirmations for your safety.</p>
                <div class="danger-confirm-points" id="danger-confirm-points"></div>
                <label class="danger-confirm-ack" id="danger-confirm-ack-wrap" hidden>
                    <input type="checkbox" id="danger-confirm-ack">
                    <span id="danger-confirm-ack-label">I understand this action cannot be undone.</span>
                </label>
                <div class="danger-confirm-progress" id="danger-confirm-progress" aria-hidden="true"></div>
                <div class="danger-confirm-actions">
                    <button type="button" class="danger-confirm-secondary" id="danger-confirm-cancel">Keep Account</button>
                    <button type="button" class="btn-danger danger-confirm-primary" id="danger-confirm-confirm">Continue</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener("click", (event) => {
            if (event.target === modal) {
                closeDeleteAccountFlow(false);
            }
        });

        document.getElementById("danger-confirm-close")?.addEventListener("click", () => {
            closeDeleteAccountFlow(false);
        });

        document.getElementById("danger-confirm-cancel")?.addEventListener("click", () => {
            closeDeleteAccountFlow(false);
        });

        document.getElementById("danger-confirm-confirm")?.addEventListener("click", () => {
            advanceDeleteAccountFlow();
        });

        document.getElementById("danger-confirm-ack")?.addEventListener("change", syncDeleteAccountConfirmButton);

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && !document.querySelector(".danger-confirm-modal")?.hidden) {
                closeDeleteAccountFlow(false);
            }

            if (event.key === "Escape" && !document.querySelector(".account-recovery-modal")?.hidden) {
                hideAccountRecoveryModal();
            }

            if (event.key === "Escape" && !document.querySelector(".logout-confirm-modal")?.hidden) {
                hideLogoutConfirm();
            }
        });
    }

    if (!document.querySelector(".account-recovery-modal")) {
        const modal = document.createElement("div");
        modal.className = "account-recovery-modal";
        modal.hidden = true;
        modal.innerHTML = `
            <div class="account-recovery-card" role="dialog" aria-modal="true" aria-labelledby="account-recovery-title" aria-describedby="account-recovery-message">
                <button type="button" class="account-recovery-close" id="account-recovery-close" aria-label="Close account recovery dialog">
                    <i class="ri-close-line"></i>
                </button>
                <div class="account-recovery-badge">Recovery Available</div>
                <h3 id="account-recovery-title">Restore your account?</h3>
                <p id="account-recovery-message">This account is scheduled for permanent deletion, but you can still bring it back before the deadline.</p>
                <div class="account-recovery-summary">
                    <div class="account-recovery-row">
                        <span>Email</span>
                        <strong id="account-recovery-email">-</strong>
                    </div>
                    <div class="account-recovery-row">
                        <span>Permanent deletion on</span>
                        <strong id="account-recovery-deadline">-</strong>
                    </div>
                </div>
                <div class="account-recovery-note" id="account-recovery-note">Restore now to keep your rewards, balance, and activity history.</div>
                <div class="account-recovery-actions">
                    <button type="button" class="account-recovery-secondary" id="account-recovery-later">Not Now</button>
                    <button type="button" class="btn-primary account-recovery-primary" id="account-recovery-confirm">Restore Account</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener("click", (event) => {
            if (event.target === modal) {
                hideAccountRecoveryModal();
            }
        });

        document.getElementById("account-recovery-close")?.addEventListener("click", hideAccountRecoveryModal);
        document.getElementById("account-recovery-later")?.addEventListener("click", hideAccountRecoveryModal);
        document.getElementById("account-recovery-confirm")?.addEventListener("click", () => {
            void restoreScheduledAccount();
        });
    }

    if (!document.querySelector(".logout-confirm-modal")) {
        const modal = document.createElement("div");
        modal.className = "logout-confirm-modal";
        modal.hidden = true;
        modal.innerHTML = `
            <div class="logout-confirm-card" role="dialog" aria-modal="true" aria-labelledby="logout-confirm-title" aria-describedby="logout-confirm-message">
                <button type="button" class="logout-confirm-close" id="logout-confirm-close" aria-label="Close logout dialog">
                    <i class="ri-close-line"></i>
                </button>
                <div class="logout-confirm-icon" aria-hidden="true">
                    <i class="ri-logout-box-r-line"></i>
                </div>
                <h3 id="logout-confirm-title">Logout?</h3>
                <p id="logout-confirm-message">Are you sure you want to logout from this device?</p>
                <div class="logout-confirm-actions">
                    <button type="button" class="logout-confirm-secondary" id="logout-confirm-cancel">Cancel</button>
                    <button type="button" class="btn-danger logout-confirm-primary" id="logout-confirm-confirm">Yes, Logout</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener("click", (event) => {
            if (event.target === modal) {
                hideLogoutConfirm();
            }
        });

        document.getElementById("logout-confirm-close")?.addEventListener("click", hideLogoutConfirm);
        document.getElementById("logout-confirm-cancel")?.addEventListener("click", hideLogoutConfirm);
        document.getElementById("logout-confirm-confirm")?.addEventListener("click", () => {
            hideLogoutConfirm();
            logout();
        });
    }

    ensureNavBadgeStyles();
    ensureSidebarUnreadBadge();
    updateSidebarUnreadBadge();
}

function showLogoutConfirm() {
    const modal = document.querySelector(".logout-confirm-modal");
    if (!modal) {
        logout();
        return;
    }

    modal.hidden = false;
    document.body.classList.add("modal-open");

    window.setTimeout(() => {
        document.getElementById("logout-confirm-cancel")?.focus();
    }, 10);
}

function hideLogoutConfirm() {
    const modal = document.querySelector(".logout-confirm-modal");
    if (modal) {
        modal.hidden = true;
    }
    document.body.classList.remove("modal-open");
}

function ensureNavBadgeStyles() {
    if (document.getElementById("nav-badge-style")) {
        return;
    }
    const style = document.createElement("style");
    style.id = "nav-badge-style";
    style.textContent = `
        .nav-badge {
            margin-left: auto;
            padding: 0.2rem 0.55rem;
            border-radius: 999px;
            background: rgba(239, 68, 68, 0.16);
            color: var(--danger);
            font-size: 0.7rem;
            font-weight: 800;
            letter-spacing: 0.04em;
        }
    `;
    document.head.appendChild(style);
}

function ensureSidebarUnreadBadge() {
    const navLink = document.querySelector(".nav-links a[href='notifications.html']");
    if (!navLink) {
        return;
    }

    if (!navLink.querySelector(".nav-badge")) {
        const badge = document.createElement("span");
        badge.id = "sidebar-unread-badge";
        badge.className = "nav-badge";
        badge.hidden = true;
        badge.textContent = "0";
        navLink.appendChild(badge);
    }
}

function updateSidebarUnreadBadge(countOverride) {
    const badge = document.getElementById("sidebar-unread-badge") || document.querySelector(".nav-badge");
    if (!badge) {
        return;
    }

    const count = typeof countOverride === "number"
        ? countOverride
        : state.notifications.filter((item) => item.unread).length;

    if (count > 0) {
        badge.textContent = count > 99 ? "99+" : formatNumber(count);
        badge.hidden = false;
    } else {
        badge.hidden = true;
    }
}

function showHomeUnreadBannerOnce() {
    if (state.page !== "home.html") {
        return;
    }

    if (!window.matchMedia("(max-width: 900px)").matches) {
        return;
    }

    const banner = document.getElementById("mobile-home-unread-banner");
    const countEl = document.getElementById("mobile-home-unread-count");
    if (!banner || !countEl) {
        return;
    }

    const unread = state.notifications.filter((item) => item.unread).length;
    if (unread <= 0) {
        banner.hidden = true;
        return;
    }

    const seenKey = "anvi-home-unread-banner-seen";
    if (sessionStorage.getItem(seenKey) === "1") {
        return;
    }

    countEl.textContent = unread > 99 ? "99+" : formatNumber(unread);
    banner.hidden = false;
    sessionStorage.setItem(seenKey, "1");

    window.setTimeout(() => {
        banner.hidden = true;
    }, 1800);
}

function bindThemeToggles() {
    document.querySelectorAll("#theme-toggle, .mobile-theme-toggle, #themeBtn").forEach((button) => {
        button.addEventListener("click", toggleTheme);
    });
}

function initShellInteractions() {
    const overlay = document.querySelector(".overlay");
    const sidebar = document.querySelector(".sidebar");
    const menuButton = document.getElementById("menu-btn");

    const closeSidebar = () => {
        sidebar?.classList.remove("open");
        overlay?.classList.remove("active");
        document.body.classList.remove("drawer-open");
    };

    const ensureCloseButton = () => {
        if (!sidebar) {
            return null;
        }
        let closeBtn = sidebar.querySelector(".sidebar-close");
        if (!closeBtn) {
            closeBtn = document.createElement("button");
            closeBtn.type = "button";
            closeBtn.className = "sidebar-close";
            closeBtn.setAttribute("aria-label", "Close menu");
            closeBtn.innerHTML = '<i class="ri-close-line"></i>';
            sidebar.prepend(closeBtn);
        }
        closeBtn.addEventListener("click", closeSidebar);
        return closeBtn;
    };

    ensureCloseButton();

    menuButton?.addEventListener("click", () => {
        sidebar?.classList.toggle("open");
        overlay?.classList.toggle("active");
        document.body.classList.toggle("drawer-open", sidebar?.classList.contains("open"));
    });

    overlay?.addEventListener("click", closeSidebar);

    document.querySelectorAll(".logout-link, .nav-footer a[href='index.html']").forEach((anchor) => {
        anchor.addEventListener("click", (event) => {
            event.preventDefault();
            showLogoutConfirm();
        });
    });
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
    const nextTheme = currentTheme === "light" ? "dark" : "light";
    if (typeof window.applyTheme === "function") {
        window.applyTheme(nextTheme, { persist: true });
        return;
    }

    document.documentElement.setAttribute("data-theme", nextTheme);
    try {
        localStorage.setItem("anvi-theme", nextTheme);
    } catch (error) {
        // ignore storage errors
    }

    const themeIcon = document.getElementById("theme-icon");
    if (themeIcon) {
        themeIcon.className = nextTheme === "dark" ? "ri-sun-line" : "ri-moon-line";
    }

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
        themeColorMeta.setAttribute("content", nextTheme === "dark" ? "#0f172a" : "#ffffff");
    }

    const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
    if (colorSchemeMeta) {
        colorSchemeMeta.setAttribute("content", nextTheme === "dark" ? "dark light" : "light dark");
    }
}

function initAuthPages() {
    // OTP state tracking
    let otpState = {
        loginEmail: "",
        registerData: {}
    };

    // Get form and button elements
    const loginForm = document.getElementById("login-form");
    const registerForm = document.getElementById("register-form");
    const loginSendOtpBtn = document.getElementById("login-send-otp-btn");
    const loginVerifyOtpBtn = document.getElementById("login-verify-otp-btn");
    const loginResendLink = document.getElementById("login-resend-otp-link");
    const loginOtpSection = document.getElementById("login-otp-section");
    const loginOtpInput = document.getElementById("login-otp-input");
    const registerSendOtpBtn = document.getElementById("register-send-otp-btn");
    const registerVerifyOtpBtn = document.getElementById("register-verify-otp-btn");
    const registerResendLink = document.getElementById("register-resend-otp-link");
    const registerOtpSection = document.getElementById("register-otp-section");
    const registerOtpInput = document.getElementById("register-otp-input");

    const urlParams = new URLSearchParams(window.location.search);
    const referralParam = urlParams.get("ref");
    const viewParam = urlParams.get("view");

    if (referralParam && document.getElementById("register-refer")) {
        document.getElementById("register-refer").value = referralParam;
    }

    if (viewParam === "register" && typeof window.switchView === "function") {
        window.switchView("register");
    }

    const moveToLoginForRecovery = (email) => {
        if (typeof window.switchView === "function") {
            window.switchView("login");
        }

        const loginEmailInput = document.getElementById("login-email");
        if (loginEmailInput && email) {
            loginEmailInput.value = email;
        }

        if (email) {
            otpState.loginEmail = email;
        }
    };

    // ============ LOGIN OTP FLOW ============
    loginSendOtpBtn?.addEventListener("click", async () => {
        const email = document.getElementById("login-email")?.value.trim();
        if (!isValidEmail(email)) {
            showToast("Enter a valid email address.", "error");
            return;
        }

        otpState.loginEmail = email;

        await withButtonState(loginSendOtpBtn, "Sending OTP...", async () => {
            try {
                await requestJson("/send-otp", {
                    method: "POST",
                    body: { email },
                    auth: false
                });
                showToast("OTP sent to your email.", "success");
                loginOtpSection.style.display = "block";
                loginOtpInput.focus();
                startResendTimer(loginResendLink);
            } catch (error) {
                if (error.code === "ACCOUNT_PENDING_DELETION") {
                    moveToLoginForRecovery(email);
                }
                showToast(error.message || "Failed to send OTP.", "error");
            }
        });
    });

    loginVerifyOtpBtn?.addEventListener("click", async () => {
        const otp = loginOtpInput?.value.trim();
        const email = otpState.loginEmail;

        if (!email || !isValidEmail(email)) {
            showToast("Please enter a valid email first.", "error");
            return;
        }

        if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
            showToast("Enter a valid 6-digit OTP.", "error");
            return;
        }

        await withButtonState(loginVerifyOtpBtn, "Verifying...", async () => {
            try {
                const data = await requestJson("/verify-otp", {
                    method: "POST",
                    body: { email, otp },
                    auth: false
                });

                if (data?.restoreRequired) {
                    showAccountRecoveryModal(data);
                    loginOtpInput.value = "";
                    return;
                }

                if (data?.token) {
                    storeAuthToken(data.token);
                }

                state.user = normalizeUser(data?.user || data);
                persistUser(state.user);
                if (data?.history?.length || data?.transactions?.length || data?.activityEntry) {
                    syncActivityState(data.history || data.transactions || [data.activityEntry], { replace: true });
                }

                showToast("Login successful!", "success");

                const loginReward = data.dailyReward || data.welcomeReward || null;
                if (data.dailyReward) {
                    markTaskCompleted("daily-login");
                }

                if (loginReward) {
                    playRewardSound();
                    showRewardPopup({
                        icon: "🎉",
                        title: data.streakReward ? "Daily Reward + Streak Bonus!" : (data.dailyReward ? "Daily Login Reward!" : "Login Reward!"),
                        message: loginReward.message,
                        value: `${loginReward.points} Points`
                    });
                } else {
                    showToast("Welcome back!", "success");
                }

                if (data?.dailyGoalBonus) {
                    pushNotification({
                        title: "Daily goal bonus",
                        message: data.dailyGoalBonus.message || `Daily goal completed. ${data.dailyGoalBonus.points} points credited.`,
                        type: "task"
                    });
                    showToast(`Daily goal bonus unlocked: +${formatNumber(numberFrom(data.dailyGoalBonus.points, 0))} points.`, "success");
                }

                if (Array.isArray(data?.levelRewards) && data.levelRewards.length) {
                    const levelBonus = data.levelRewards.reduce((sum, item) => sum + numberFrom(item.points, 0), 0);
                    showToast(`Level up bonus unlocked: +${formatNumber(levelBonus)} points.`, "success");

                    if (!loginReward) {
                        const levelRewardLabel = data.levelRewards
                            .map((item) => `Lv ${item.level} +${formatNumber(item.points)}`)
                            .join(" • ");
                        showRewardPopup({
                            icon: "🏅",
                            title: data.levelRewards.length === 1 ? `Level ${data.levelRewards[0].level} unlocked!` : "Level rewards unlocked!",
                            message: `Permanent XP progression keeps climbing. ${levelRewardLabel}`,
                            value: `+${formatNumber(levelBonus)} Points`
                        });
                    }
                }

                setTimeout(() => {
                    window.location.replace("home.html");
                }, 900);
            } catch (error) {
                showToast(error.message || "OTP verification failed.", "error");
                loginOtpInput.value = "";
                loginOtpInput.focus();
            }
        });
    });

    loginResendLink?.addEventListener("click", async (e) => {
        e.preventDefault();
        const email = otpState.loginEmail;
        if (!email || !isValidEmail(email)) {
            showToast("Please enter a valid email first.", "error");
            return;
        }

        await withButtonState(loginResendLink, "Resending...", async () => {
            try {
                await requestJson("/send-otp", {
                    method: "POST",
                    body: { email },
                    auth: false
                });
                showToast("OTP resent to your email.", "success");
                loginOtpInput.value = "";
                loginOtpInput.focus();
                startResendTimer(loginResendLink);
            } catch (error) {
                showToast(error.message || "Failed to resend OTP.", "error");
            }
        });
    });

    // ============ REGISTER OTP FLOW ============
    // ============================================
    // SMART REFERRAL CODE HANDLER
    // ============================================
    function validateReferralCode(code) {
        if (!code) return { valid: true, code: null };

        // Remove spaces and convert to uppercase
        const normalized = String(code || '').trim().toUpperCase();

        // Allowed formats:
        // - New: ANVI + first letter + 3/4 digits (e.g., ANVIA1234)
        // - Legacy: 4/5 digits + ANVI + 4/5 digits (e.g., 1234ANVI5678)
        const isValid = /^[0-9]{4,5}ANVI[0-9]{4,5}$/.test(normalized) || /^ANVI[A-Z][0-9]{4}$/.test(normalized);
        if (!isValid) {
            return {
                valid: false,
                error: "Invalid code format. Use format like: ANVIA1234"
            };
        }

        return { valid: true, code: normalized };
    }

    function populateReferralCodeFromURL() {
        try {
            const params = new URLSearchParams(window.location.search);
            const refParam = params.get('ref');

            if (refParam && document.getElementById('register-refer')) {
                const validation = validateReferralCode(refParam);
                if (validation.valid) {
                    document.getElementById('register-refer').value = validation.code || '';
                    console.log('✅ Referral code pre-populated:', validation.code);
                } else {
                    console.warn('⚠️ Invalid referral code in URL:', refParam);
                }
            }
        } catch (error) {
            console.error('Error populating referral code:', error);
        }
    }

    // Call on page load
    document.addEventListener('DOMContentLoaded', populateReferralCodeFromURL);

    // ============================================
    // REGISTER FORM HANDLERS
    // ============================================
    registerSendOtpBtn?.addEventListener("click", async () => {
        const name = document.getElementById("register-name")?.value.trim();
        const email = document.getElementById("register-email")?.value.trim();
        const referCodeRaw = document.getElementById("register-refer")?.value.trim();
        const acceptedTerms = Boolean(document.getElementById("register-terms")?.checked);

        // Validate name and email
        if (!name || !isValidEmail(email)) {
            showToast("Enter your name and a valid email address.", "error");
            return;
        }

        if (!acceptedTerms) {
            showToast("Please accept the Terms & Conditions to continue.", "error");
            return;
        }

        // Validate and normalize referral code
        const referCodeValidation = validateReferralCode(referCodeRaw);
        if (!referCodeValidation.valid) {
            showToast(referCodeValidation.error || "Invalid referral code.", "error");
            return;
        }

        const referCode = referCodeValidation.code; // Normalized code or null

        // Store in state for verification phase
        otpState.registerData = {
            name,
            email,
            referCode: referCode || null,
            acceptedTerms
        };

        await withButtonState(registerSendOtpBtn, "Sending OTP...", async () => {
            try {
                // ✅ NOW SENDING referCode in send-otp request
                await requestJson("/register-send-otp", {
                    method: "POST",
                    body: {
                        email,
                        name,
                        acceptedTerms,
                        referCode: referCode || undefined  // Send if exists
                    },
                    auth: false
                });
                showToast("OTP sent to your email.", "success");
                registerOtpSection.style.display = "block";
                registerOtpInput.focus();
                startResendTimer(registerResendLink);
                console.log('✅ OTP sent with referCode:', referCode || '(none)');
            } catch (error) {
                showToast(error.message || "Failed to send OTP.", "error");
                console.error('❌ OTP send error:', error);
            }
        });
    });

    registerVerifyOtpBtn?.addEventListener("click", async () => {
        const otp = registerOtpInput?.value.trim();
        const { name, email, referCode, acceptedTerms } = otpState.registerData;

        if (!email || !isValidEmail(email)) {
            showToast("Please enter a valid email first.", "error");
            return;
        }

        if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
            showToast("Enter a valid 6-digit OTP.", "error");
            return;
        }

        await withButtonState(registerVerifyOtpBtn, "Creating account...", async () => {
            try {
                const response = await requestJson("/register-verify-otp", {
                    method: "POST",
                    body: {
                        email,
                        otp,
                        name,
                        referCode: referCode || undefined,
                        acceptedTerms
                    },
                    auth: false
                });

                const data = response;

                if (data?.token) {
                    storeAuthToken(data.token);
                }

                state.user = normalizeUser(data?.user || data);
                persistUser(state.user);
                if (data?.history?.length || data?.transactions?.length || data?.activityEntry) {
                    syncActivityState(data.history || data.transactions || [data.activityEntry], { replace: true });
                }

                showToast("Account created successfully!", "success");
                playRewardSound();

                // Calculate total reward (welcome + referral bonus)
                const welcomeReward = numberFrom(data?.welcomeReward?.points, 0);
                const referralReward = numberFrom(data?.referralReward?.points, 0);
                const referrerName = String(data?.referralReward?.referrerName || "").trim();
                const totalSignupReward = welcomeReward + referralReward;

                // Build reward message
                let rewardMessage = "You've earned a welcome reward for joining AnviPayz!";
                if (referCode && referralReward > 0) {
                    rewardMessage = `You earned ${welcomeReward} welcome points + ${referralReward} referral bonus! Total: ${totalSignupReward} points`;
                    if (referrerName) {
                        rewardMessage = `${rewardMessage} Referred by ${referrerName}.`;
                    }
                }

                showRewardPopup({
                    icon: "🎉",
                    title: "Welcome to AnviPayz!",
                    message: rewardMessage,
                    value: `${formatNumber(totalSignupReward || state.user?.points || 0)} Points`
                });

                console.log('✅ Account created successfully');
                console.log('   Welcome reward:', welcomeReward);
                console.log('   Referral reward:', referralReward);
                console.log('   Referral code used:', referCode || 'none');

                setTimeout(() => {
                    window.location.replace("home.html");
                }, 900);
            } catch (error) {
                if (error.code === "ACCOUNT_PENDING_DELETION") {
                    moveToLoginForRecovery(email);
                }
                showToast(error.message || "OTP verification failed.", "error");
                console.error('❌ Verification error:', error);
                registerOtpInput.value = "";
                registerOtpInput.focus();
            }
        });
    });

    registerResendLink?.addEventListener("click", async (e) => {
        e.preventDefault();
        const { email, name, acceptedTerms } = otpState.registerData;
        if (!email || !isValidEmail(email)) {
            showToast("Please enter a valid email first.", "error");
            return;
        }

        await withButtonState(registerResendLink, "Resending...", async () => {
            try {
                await requestJson("/register-send-otp", {
                    method: "POST",
                    body: { email, name, acceptedTerms },
                    auth: false
                });
                showToast("OTP resent to your email.", "success");
                registerOtpInput.value = "";
                registerOtpInput.focus();
                startResendTimer(registerResendLink);
            } catch (error) {
                if (error.code === "ACCOUNT_PENDING_DELETION") {
                    moveToLoginForRecovery(email);
                }
                showToast(error.message || "Failed to resend OTP.", "error");
            }
        });
    });

    loginForm?.addEventListener("submit", (event) => event.preventDefault());
    registerForm?.addEventListener("submit", (event) => event.preventDefault());
}

function startResendTimer(linkElement) {
    if (!linkElement) return;

    let seconds = 30;
    const originalText = "Resend OTP";
    linkElement.style.pointerEvents = "none";
    linkElement.style.opacity = "0.5";
    linkElement.classList.add('timer-active');

    const interval = setInterval(() => {
        seconds--;
        linkElement.textContent = `Resend in ${seconds}s`;

        if (seconds <= 0) {
            clearInterval(interval);
            linkElement.style.pointerEvents = "auto";
            linkElement.style.opacity = "1";
            linkElement.textContent = originalText;
            linkElement.classList.remove('timer-active');
        }
    }, 1000);
}

async function verifyEmailToken(token) {
    try {
        showToast("Verifying your email link...", "warning");
        const data = await requestJson("/verify", {
            method: "POST",
            body: { token },
            auth: false
        });

        if (data?.token) {
            storeAuthToken(data.token);
        }

        state.user = normalizeUser(data?.user || data);
        persistUser(state.user);
        showRewardPopup({
            icon: "🎉",
            title: "Welcome to AnviPayz",
            message: "Your email is verified and your rewards account is ready.",
            value: `${formatNumber(state.user.points)} Points`
        });

        setTimeout(() => {
            window.location.replace("home.html");
        }, 900);
    } catch (error) {
        showToast(error.message || "This sign-in link is invalid or expired.", "error");
    }
}

async function hydrateUser() {
    try {
        const data = await requestJson("/me", { auth: true });

        state.user = normalizeUser(data?.user || data);
        persistUser(state.user);
    } catch (error) {
        if (error?.code === "DB_OFFLINE" || error?.status === 503) {
            return;
        }

        try {
            const fallback = await requestFirst([
                { path: "/dashboard", method: "GET" },
                { path: "/user/dashboard", method: "GET" }
            ], { auth: true });

            if (fallback?.user) {
                state.user = normalizeUser(fallback.user);
                persistUser(state.user);
                return;
            }
        } catch (fallbackError) {
            // Ignore and continue with the original error handling.
        }

        if (error.status === 401) {
            logout();
            return;
        }

        if (error.status === 423 || error.code === "ACCOUNT_PENDING_DELETION") {
            logout();
            return;
        }

        if (!state.user) {
            showToast("We could not load your session right now.", "error");
            redirectToLogin();
        }
    }
}

function updateHomeHeroPointsPreview(points) {
    const tokensPreview = numberFrom(points, 0) / 1000;
    setText("home-hero-token-inline", formatDecimal(tokensPreview));

    const chip = document.getElementById("home-hero-chip");
    if (chip) {
        const safePoints = Math.max(0, Math.floor(numberFrom(points, 0)));
        const progress = (safePoints % 1000) / 1000;
        chip.style.setProperty("--home-token-progress", progress.toFixed(4));
    }
}

function renderCommonUserState() {
    if (!state.user) {
        return;
    }

    setAllText("header-token-count", formatDecimal(state.user.tokens));
    setAllText("mobile-token-count", formatDecimal(state.user.tokens));
    setAllText("wallet-token-count", formatDecimal(state.user.tokens));
    setText("home-hero-token-count", formatDecimal(state.user.tokens));
    setText("user-name", firstName(state.user.name));
    setText("wallet-balance", formatNumber(state.user.points));
    setText("user-balance", formatNumber(state.user.points));
    updateHomeHeroPointsPreview(state.user.points);
    window.dispatchEvent(new CustomEvent("anvi:home-points-updated", { detail: { points: numberFrom(state.user.points, 0) } }));
    renderLifetimeXp();
    setText("profile-title", state.user.name || "AnviPayz Member");
    setText("profile-subtitle", state.user.email || "Rewards account");
    setText("profile-name", state.user.name || "-");
    setText("profile-email", state.user.email || "-");
    setText("profile-phone", state.user.phone || "Not added yet");
    setText("profile-joined", formatLongDate(state.user.joinedAt));
    setText("profile-referral-code", state.user.referralCode || "-");
    setText("profile-points", formatNumber(state.user.points));
    setText("profile-tokens", formatDecimal(state.user.tokens));
    setText("profile-summary-email", state.user.email || "-");
    setText("profile-summary-joined", formatLongDate(state.user.joinedAt));
    setText("profile-referral-inline-secondary", state.user.referralCode || "-");

    const avatar = document.getElementById("profile-avatar");
    if (avatar) {
        avatar.textContent = initialsFromName(state.user.name || "A");
        avatar.style.background = "linear-gradient(135deg, #6366f1, #22c55e)";
    }

    document.querySelectorAll("#token-available-pill").forEach((pill) => {
        pill.textContent = `${formatDecimal(state.user.tokens)} Tokens`;
    });
}

async function initHomePage() {
    showHomeUnreadBannerOnce();
    renderHomeQuickActions();

    // Paint something immediately (local cache) so the home screen doesn't feel blocked on network.
    const compactHistory = window.matchMedia?.("(max-width: 520px)")?.matches;
    const initialCount = compactHistory ? 4 : 7;
    const stepCount = compactHistory ? 6 : 7;
    const cachedHistory = [...state.activity].sort((a, b) => toTimestamp(b.time) - toTimestamp(a.time));
    renderHistoryList(
        document.getElementById("recent-history"),
        cachedHistory,
        "No recent wallet activity yet.",
        { timeStyle: "relative", variant: "compact", initialCount, stepCount, buttonLabel: "Show More" }
    );

    const [dashboardResult, tasksResult, referralResult] = await Promise.allSettled([
        fetchDashboardPayload(),
        fetchTasksPayload(),
        fetchReferralPayload()
    ]);

    const dashboard = dashboardResult.status === "fulfilled"
        ? dashboardResult.value
        : {
            stats: {
                points: state.user?.points || 0,
                referralEarnings: numberFrom(state.user?.referralEarnings, 0),
                taskRewards: buildTaskStats().earnedPoints,
                surveyEarnings: buildSurveyStats().earnedPoints
            },
            history: [...state.activity].sort((a, b) => toTimestamp(b.time) - toTimestamp(a.time))
        };
    const stats = dashboard.stats;

    setText("refer-income", formatNumber(stats.referralEarnings || 0));
    setText("task-income", formatNumber(stats.taskRewards || 0));
    setText("survey-income", formatNumber(stats.surveyEarnings || 0));
    setText("user-balance", formatNumber(stats.points));
    updateHomeHeroPointsPreview(stats.points);
    window.dispatchEvent(new CustomEvent("anvi:home-points-updated", { detail: { points: numberFrom(stats.points, 0), surveyEarnings: numberFrom(stats.surveyEarnings, 0) } }));
    renderLifetimeXp();

    const latestHistory = dashboard.history || [];
    renderHistoryList(
        document.getElementById("recent-history"),
        latestHistory,
        "No recent wallet activity yet.",
        { timeStyle: "relative", variant: "compact", initialCount, stepCount, buttonLabel: "Show More" }
    );

    const tasks = tasksResult.status === "fulfilled"
        ? (tasksResult.value?.tasks || [])
        : [];
    const referral = referralResult.status === "fulfilled" ? referralResult.value : null;
    updateHomeSmartCard({ tasks, referral });
}

function syncActiveNav() {
    const page = currentPage();
    ensureMobileNavCurrent(page);
    document.querySelectorAll(".mobile-nav-item, .nav-item").forEach((link) => {
        const href = link.getAttribute("href") || "";
        if (!href) {
            return;
        }
        const target = href.split("#")[0].split("/").pop()?.toLowerCase();
        if (!target) {
            return;
        }
        link.classList.toggle("active", target === page);
    });
}

function navPageFromHref(href) {
    if (!href) {
        return "";
    }
    const clean = href.split("#")[0].split("?")[0];
    return clean.split("/").pop()?.toLowerCase() || "";
}

function ensureMobileNavCurrent(page) {
    const nav = document.querySelector(".mobile-nav");
    if (!nav) {
        return;
    }

    const items = Array.from(nav.querySelectorAll(".mobile-nav-item"));
    if (!items.length) {
        return;
    }

    const exists = items.some((item) => navPageFromHref(item.getAttribute("href")) === page);
    if (exists) {
        return;
    }

    const meta = MOBILE_NAV_META[page];
    if (!meta) {
        return;
    }

    const replacement = pickMobileNavReplacement(items);
    const newLink = document.createElement("a");
    newLink.className = "mobile-nav-item";
    newLink.href = meta.href;
    newLink.innerHTML = `<i class="${meta.icon}"></i><span>${meta.label}</span>`;

    if (replacement) {
        nav.replaceChild(newLink, replacement);
    } else {
        nav.appendChild(newLink);
    }
}

function pickMobileNavReplacement(items) {
    const keep = new Set(["home.html", "wallet.html", "tasks.html"]);
    for (let i = items.length - 1; i >= 0; i -= 1) {
        const target = navPageFromHref(items[i].getAttribute("href"));
        if (!keep.has(target)) {
            return items[i];
        }
    }
    return items[items.length - 1] || null;
}

function bindNetworkIndicators() {
    if (document.documentElement.dataset.networkIndicatorsBound === "1") {
        return;
    }
    document.documentElement.dataset.networkIndicatorsBound = "1";

    const bar = document.querySelector(".page-loading-bar");
    const banner = document.querySelector(".network-status");
    const bannerText = banner?.querySelector(".network-status__text");

    if (bar) {
        bar.classList.add("active");
        window.addEventListener("load", () => {
            window.setTimeout(() => bar.classList.remove("active"), 400);
        });
    }

    const setBanner = (message, show = true) => {
        if (!banner || !bannerText) {
            return;
        }
        bannerText.textContent = message;
        banner.classList.toggle("active", show);
    };

    let wasOffline = false;

    const updateNetworkState = (source = "event") => {
        const isOnline = navigator.onLine;

        if (!isOnline) {
            wasOffline = true;
            setBanner("No internet connection. Reconnecting...");
            return;
        }

        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (connection && (connection.saveData || /2g/.test(connection.effectiveType || ""))) {
            setBanner("Slow network detected. Loading optimized view...");
            return;
        }

        if (source === "init") {
            setBanner("", false);
            wasOffline = false;
            return;
        }

        if (wasOffline) {
            setBanner("Connection restored.", true);
            window.setTimeout(() => setBanner("", false), 1200);
        }
        wasOffline = false;
    };

    window.addEventListener("offline", updateNetworkState);
    window.addEventListener("online", updateNetworkState);
    updateNetworkState("init");
}

function updateHomeSmartCard({ tasks = [], referral = null } = {}) {
    const card = document.getElementById("home-smart-card");
    if (!card) {
        return;
    }

    const title = document.getElementById("home-smart-title");
    const sub = document.getElementById("home-smart-sub");
    const goal = document.getElementById("home-smart-goal");
    const progressFill = document.getElementById("home-smart-progress-fill");
    const progressLabel = document.getElementById("home-smart-progress-label");
    const icon = document.getElementById("home-smart-icon");

    const totalTasks = 2;
    const completedTasks = getDailyGoalProgressCount();
    const pendingTasks = Math.max(0, totalTasks - completedTasks);
    const taskProgress = totalTasks > 0 ? clamp(Math.round((completedTasks / totalTasks) * 100), 0, 100) : (pendingTasks === 0 ? 100 : 0);
    const referralDelta = getHomeReferralDelta(referral);
    const dailyGoalClaimed = hasClaimedDailyGoalBonusToday();

    let tone = "tasks";
    let iconClass = "ri-flashlight-line";
    let titleText = "Daily Goal";
    let subText = "Complete 2 tasks today to unlock +50 bonus points.";
    let goalText = "Keep your streak alive to claim rewards.";
    let progressText = `${formatNumber(completedTasks)} / ${formatNumber(totalTasks)} tasks completed`;
    let href = "tasks.html";

    if (referralDelta.newCount > 0) {
        tone = "referral";
        iconClass = "ri-user-add-line";
        titleText = "New referral joined";
        subText = referralDelta.newCount > 1
            ? `${formatNumber(referralDelta.newCount)} friends joined using your code.`
            : `${referralDelta.latestName} joined using your code.`;
        goalText = "Check your referral rewards now.";
        progressText = "Referral progress updated.";
        href = "refer.html";
    } else if (pendingTasks > 0) {
        const bonusText = pendingTasks === 1 ? "+50 bonus" : `+50 bonus`;
        titleText = "Daily Goal";
        subText = `Complete ${formatNumber(pendingTasks)} more ${pendingTasks === 1 ? "task" : "tasks"} for ${bonusText}.`;
        goalText = `Finish ${formatNumber(pendingTasks)} more to unlock extra XP.`;
        href = "tasks.html";
    } else {
        titleText = "Daily Goal";
        subText = dailyGoalClaimed
            ? "Daily goal completed. +50 bonus credited today."
            : "Daily goal completed. Bonus will sync as soon as the reward is processed.";
        goalText = dailyGoalClaimed
            ? "Come back tomorrow to unlock the next daily goal bonus."
            : "Maintain your momentum to stay on track.";
        progressText = dailyGoalClaimed ? "Daily goal bonus claimed." : "All tasks completed for today.";
        href = "tasks.html";
    }

    card.dataset.tone = tone;
    card.setAttribute("href", href);
    if (title) {
        title.textContent = titleText;
    }
    if (sub) {
        sub.textContent = subText;
    }
    if (goal) {
        goal.textContent = goalText;
    }
    if (progressFill) {
        progressFill.style.width = `${taskProgress}%`;
    }
    if (progressLabel) {
        progressLabel.textContent = progressText;
    }
    if (icon) {
        icon.innerHTML = `<i class="${iconClass}"></i>`;
    }
}

function getPendingTaskCount(tasks) {
    if (!Array.isArray(tasks)) {
        return 0;
    }

    return tasks.filter((task) => !(task.completed || isTaskCompleted(task.id))).length;
}

function getDailyGoalProgressCount() {
    const excludedTaskIds = new Set(["daily-login", "daily-goal-bonus"]);
    const dayKey = todayKey();
    const countedTaskIds = new Set();

    state.activity.forEach((entry) => {
        if (entry?.type !== "task") {
            return;
        }

        const taskId = String(entry?.taskId || "").trim();
        if (!taskId || excludedTaskIds.has(taskId)) {
            return;
        }

        if (numberFrom(entry?.amount, 0) <= 0) {
            return;
        }

        if (todayKey(entry?.time || new Date()) !== dayKey) {
            return;
        }

        countedTaskIds.add(taskId);
    });

    return countedTaskIds.size;
}

function hasTaskActivityToday(taskIds) {
    const acceptedTaskIds = new Set((Array.isArray(taskIds) ? taskIds : []).map((taskId) => String(taskId || "").trim()).filter(Boolean));
    if (!acceptedTaskIds.size) {
        return false;
    }

    const key = todayKey();
    return state.activity.some((entry) => {
        if (entry?.type !== "task") {
            return false;
        }

        const taskId = String(entry?.taskId || "").trim();
        if (!acceptedTaskIds.has(taskId)) {
            return false;
        }

        const amount = numberFrom(entry?.amount, 0);
        if (amount <= 0) {
            return false;
        }

        return todayKey(entry?.time || new Date()) === key;
    });
}

function hasClaimedDailyGoalBonusToday() {
    return hasTaskActivityToday(["daily-goal-bonus"]);
}

function hasCompletedDailyGoalAnchorToday() {
    const lastLoginRewardAt = state.user?.lastDailyLoginRewardAt;
    if (lastLoginRewardAt && todayKey(lastLoginRewardAt) === todayKey()) {
        return true;
    }

    const taskState = todayTaskState();
    if (taskState.completed?.["daily-login"] || taskState.completed?.["daily-checkin"]) {
        return true;
    }

    return hasTaskActivityToday(["daily-login", "daily-checkin"]);
}

function getHomeDailyGoalTasks(tasks) {
    const tutorialDone = isTaskCompleted("watch-tutorial") || hasTaskActivityToday(["watch-tutorial"]);
    return [
        {
            id: "daily-checkin",
            title: "Daily Check-in",
            completed: hasCompletedDailyGoalAnchorToday()
        },
        {
            id: "watch-tutorial",
            title: "Watch Tutorial",
            completed: tutorialDone
        }
    ];
}

function mergeHomeDailyTasks(tasks) {
    const list = Array.isArray(tasks) ? [...tasks] : [];

    const ensure = (id, title) => {
        const cleanId = String(id || "").trim();
        if (!cleanId) {
            return;
        }

        const exists = list.some((task) => String(task?.id || "").trim() === cleanId);
        if (exists) {
            return;
        }

        list.push({
            id: cleanId,
            title: title || "Task",
            description: "",
            rewardPoints: 0,
            taskType: "daily",
            completed: isTaskCompleted(cleanId),
            link: ""
        });
    };

    ensure("daily-checkin", "Daily Check-in");
    ensure("watch-tutorial", "Watch Tutorial");

    return list;
}

function getHomeReferralDelta(referralData) {
    if (!referralData) {
        return { newCount: 0, latestName: "A friend" };
    }

    const totalReferrals = numberFrom(referralData.totalReferrals, 0);
    const todayReferrals = numberFrom(referralData.todayReferrals, 0);
    const stored = localStorage.getItem(STORAGE_KEYS.referralSeenCount);
    const previous = stored !== null ? numberFrom(stored, 0) : null;

    let newCount = previous === null ? todayReferrals : totalReferrals - previous;
    if (newCount < 0) {
        newCount = 0;
    }

    localStorage.setItem(STORAGE_KEYS.referralSeenCount, String(totalReferrals));

    const latest = Array.isArray(referralData.network) ? referralData.network[0] : null;
    const latestName = latest?.name || "A friend";

    return { newCount, latestName };
}

async function initTasksPage() {
    normalizeDailyTaskState();
    const taskStats = buildTaskStats();
    setText("task-total-earned", formatNumber(taskStats.earnedPoints));
    setText("task-completed-count", formatNumber(taskStats.completedCount));
    setText("task-streak-count", formatStreakDays(computeTaskStreakDays("daily-checkin")));

    bindTaskStreakBonusModal();
    bindStaticTaskButtons();
    bindTasksSectionTabs();
    // Don't leave the Tasks page stuck in a loading state while the API is slow/offline.
    renderTaskSections(getSharedTaskCatalog());
    const responseTasks = await fetchTasksPayload();
    renderTaskSections(responseTasks.tasks);
    // Sync static buttons with server-provided task completion state (prefer server when available)
    try {
        const serverTasks = Array.isArray(responseTasks.tasks) ? responseTasks.tasks : [];
        const checkinBtn = document.getElementById("btn-daily-checkin");
        const tutorialBtn = document.getElementById("btn-watch-video");

        const findBySeed = (seed) => serverTasks.find(t => String(t.seedKey || '').toLowerCase() === String(seed).toLowerCase() || String(t.id || '') === String(seed));
        const serverDaily = findBySeed('daily-checkin');
        const serverTutorial = findBySeed('watch-tutorial');

        if (serverDaily) {
            if (serverDaily.completed) {
                if (checkinBtn) { checkinBtn.disabled = true; checkinBtn.textContent = 'Claimed'; }
                try { markTaskCompleted('daily-checkin'); } catch (_) { }
            } else if (checkinBtn) {
                checkinBtn.disabled = false;
                checkinBtn.textContent = checkinBtn.getAttribute('data-default-label') || 'Claim';
            }
        }

        if (serverTutorial) {
            if (serverTutorial.completed) {
                if (tutorialBtn) { tutorialBtn.disabled = true; tutorialBtn.textContent = 'Completed'; }
                try { markTaskCompleted('watch-tutorial'); } catch (_) { }
            } else if (tutorialBtn) {
                tutorialBtn.disabled = false;
                tutorialBtn.textContent = tutorialBtn.getAttribute('data-default-label') || 'Watch';
            }
        }
    } catch (err) {
        // ignore sync failures
    }
    renderTaskHistory();

    if (state.taskRefreshTimer) {
        clearInterval(state.taskRefreshTimer);
    }

    const refreshTasks = async () => {
        const latestTasks = await fetchTasksPayload();
        renderTaskSections(latestTasks.tasks);
    };

    state.taskRefreshTimer = window.setInterval(() => {
        refreshTasks().catch(() => { });
    }, 45000);

    if (!state.taskRefreshBound) {
        state.taskRefreshBound = true;
        window.addEventListener("focus", () => {
            refreshTasks().catch(() => { });
        });

        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) {
                refreshTasks().catch(() => { });
            }
        });

        window.addEventListener("storage", (event) => {
            if (event.key === "anvi-task-catalog") {
                refreshTasks().catch(() => { });
            }
        });
    }
}

function getSharedTaskCatalog() {
    return taskCatalog?.getAll?.() || DEFAULT_ADMIN_TASKS;
}

function bindTasksSectionTabs() {
    const tabs = Array.from(document.querySelectorAll(".tasks-app-tab"));
    if (!tabs.length) {
        return;
    }

    const syncActive = () => {
        const hash = window.location.hash || "#section-daily";
        tabs.forEach((tab) => {
            tab.classList.toggle("is-active", tab.getAttribute("href") === hash);
        });
    };

    window.addEventListener("hashchange", syncActive);
    syncActive();
}

const TASK_STREAK_BONUS_RULES = [
    { days: 7, points: 100 },
    { days: 14, points: 250 },
    { days: 21, points: 500 }
];

function getTaskStreakBonusState() {
    const streakDays = computeTaskStreakDays("daily-login");
    const cycleDay = streakDays > 0 ? (((streakDays - 1) % 21) + 1) : 0;
    const nextRule = TASK_STREAK_BONUS_RULES.find((rule) => cycleDay < rule.days) || null;

    return {
        streakDays,
        cycleDay,
        nextRule
    };
}

function renderTaskStreakBonusModal() {
    const modal = document.getElementById("streak-bonus-modal");
    const currentEl = document.getElementById("streak-bonus-current");
    const cycleEl = document.getElementById("streak-bonus-cycle");
    const statusEl = document.getElementById("streak-bonus-status");
    const gridEl = document.getElementById("streak-bonus-grid");

    if (!modal || !currentEl || !cycleEl || !statusEl || !gridEl) {
        return;
    }

    const stateInfo = getTaskStreakBonusState();
    currentEl.textContent = formatStreakDays(stateInfo.streakDays);
    cycleEl.textContent = `${stateInfo.cycleDay} / 21`;

    if (!stateInfo.streakDays) {
        statusEl.textContent = "Start a streak by logging in daily. Bonuses restart every 21 days.";
    } else if (stateInfo.nextRule) {
        statusEl.textContent = `Next bonus unlocks at ${stateInfo.nextRule.days} days for +${formatNumber(stateInfo.nextRule.points)} points.`;
    } else {
        statusEl.textContent = "You’ve cleared the 21-day cycle. The bonus ladder restarts now.";
    }

    gridEl.innerHTML = TASK_STREAK_BONUS_RULES.map((rule) => {
        const unlocked = stateInfo.cycleDay >= rule.days;
        const isNext = !unlocked && stateInfo.nextRule?.days === rule.days;
        const remaining = unlocked ? 0 : Math.max(0, rule.days - stateInfo.cycleDay);
        return `
            <div class="streak-bonus-item ${unlocked ? "is-unlocked" : ""} ${isNext ? "is-next" : ""}">
                <div class="streak-bonus-item__days">${formatNumber(rule.days)} Days</div>
                <div class="streak-bonus-item__points">+${formatNumber(rule.points)} Points</div>
                <div class="streak-bonus-item__meta">${unlocked ? "Claimed in this cycle" : `${formatNumber(remaining)} more day${remaining === 1 ? "" : "s"} to go`}</div>
            </div>
        `;
    }).join("");
}

function openTaskStreakBonusModal() {
    const modal = document.getElementById("streak-bonus-modal");
    if (!modal) {
        return;
    }

    renderTaskStreakBonusModal();
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add("is-open"));
}

function closeTaskStreakBonusModal() {
    const modal = document.getElementById("streak-bonus-modal");
    if (!modal) {
        return;
    }

    modal.classList.remove("is-open");
    window.setTimeout(() => {
        modal.hidden = true;
    }, 160);
}

function bindTaskStreakBonusModal() {
    const card = document.getElementById("task-streak-card");
    const modal = document.getElementById("streak-bonus-modal");
    const closeBtn = document.getElementById("close-streak-bonus");
    const footerBtn = document.getElementById("streak-bonus-close-btn");

    if (card && !card.dataset.bound) {
        card.dataset.bound = "1";
        card.addEventListener("click", openTaskStreakBonusModal);
        card.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openTaskStreakBonusModal();
            }
        });
    }

    if (modal && !modal.dataset.bound) {
        modal.dataset.bound = "1";
        modal.addEventListener("click", (event) => {
            if (event.target === modal) {
                closeTaskStreakBonusModal();
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && !modal.hidden) {
                closeTaskStreakBonusModal();
            }
        });
    }

    if (closeBtn && !closeBtn.dataset.bound) {
        closeBtn.dataset.bound = "1";
        closeBtn.addEventListener("click", closeTaskStreakBonusModal);
    }

    if (footerBtn && !footerBtn.dataset.bound) {
        footerBtn.dataset.bound = "1";
        footerBtn.addEventListener("click", closeTaskStreakBonusModal);
    }
}

function bindStaticTaskButtons() {
    const checkinBtn = document.getElementById("btn-daily-checkin");
    const tutorialBtn = document.getElementById("btn-watch-video");

    updateTaskButton(checkinBtn, "daily-checkin", "Claimed");
    updateTaskButton(tutorialBtn, "watch-tutorial", "Completed");

    checkinBtn?.addEventListener("click", async () => {
        if (isTaskCompleted("daily-checkin")) {
            showToast("Daily check-in already claimed today.", "warning");
            return;
        }

        await completeRewardFlow({
            taskId: "daily-checkin",
            title: "Daily check-in",
            message: "Daily streak reward credited.",
            points: 10,
            type: "task"
        });

        updateTaskButton(checkinBtn, "daily-checkin", "Claimed");
        renderTaskHistory();
    });

    tutorialBtn?.addEventListener("click", () => {
        if (isTaskCompleted("watch-tutorial")) {
            showToast("Tutorial reward already used today.", "warning");
            return;
        }

        if (state.watchTimer) {
            return;
        }

        let secondsLeft = 10;
        tutorialBtn.disabled = true;
        tutorialBtn.textContent = `Watching ${secondsLeft}s`;

        state.watchTimer = window.setInterval(async () => {
            secondsLeft -= 1;

            if (secondsLeft <= 0) {
                window.clearInterval(state.watchTimer);
                state.watchTimer = null;

                await completeRewardFlow({
                    taskId: "watch-tutorial",
                    title: "Watch tutorial",
                    message: "Tutorial task completed.",
                    points: 15,
                    type: "task"
                });

                updateTaskButton(tutorialBtn, "watch-tutorial", "Completed");
                renderTaskHistory();
                return;
            }

            tutorialBtn.textContent = `Watching ${secondsLeft}s`;
        }, 1000);
    });

    // Bind Survey Task Buttons
    bindSurveyButtons();
}

let currentSurveyId = null;
let currentSurveyAnswers = {};
let currentSurveyTask = null;
let surveyHandlersBound = false;

function bindSurveyButtons() {
    if (surveyHandlersBound) {
        return;
    }

    surveyHandlersBound = true;

    document.getElementById('survey-task-container')?.addEventListener('click', (event) => {
        const card = event.target.closest('.survey-task-card');
        const button = event.target.closest('.btn-start-survey');
        if (!card && !button) {
            return;
        }

        const surveyId = card?.dataset.surveyId;
        const task = getSurveyTaskById(surveyId);
        if (!task) {
            return;
        }

        if (isTaskCompleted(task.id)) {
            if (button) {
                button.disabled = true;
                button.textContent = 'Completed';
                button.style.opacity = '0.6';
            }
            return;
        }

        openSurveyModal(task);
    });

    document.getElementById('survey-task-container')?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        const card = event.target.closest('.survey-task-card');
        if (!card) {
            return;
        }

        event.preventDefault();
        const task = getSurveyTaskById(card.dataset.surveyId);
        if (!task || isTaskCompleted(task.id)) {
            return;
        }

        openSurveyModal(task);
    });

    document.getElementById('close-survey')?.addEventListener('click', closeSurveyModal);
    document.getElementById('survey-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'survey-modal') closeSurveyModal();
    });
    document.getElementById('btn-submit-survey')?.addEventListener('click', submitSurvey);
}

function getSurveyTaskById(taskId) {
    const id = String(taskId || '').trim();
    if (!id) {
        return null;
    }

    return (taskCatalog?.getAll?.() || []).find((task) =>
        String(task.id || task._id || '') === id
        || String(task.seedKey || '') === id
    ) || null;
}

function getSurveyQuestions(task) {
    if (!task) {
        return [];
    }

    if (Array.isArray(task.questions) && task.questions.length) {
        return task.questions;
    }
    return [];
}

function openSurveyModal(task) {
    const questions = getSurveyQuestions(task);
    if (!questions.length) {
        showToast("Survey questions are not available.", "warning");
        return;
    }

    const survey = task ? {
        ...task,
        questions,
        reward: task.rewardPoints || task.reward || 0
    } : null;
    if (!survey) return;

    currentSurveyId = survey.id;
    currentSurveyTask = survey;
    currentSurveyAnswers = {};

    document.getElementById('survey-title').textContent = survey.title;
    document.getElementById('survey-progress').textContent = `1 of ${survey.questions.length} questions`;

    const content = document.getElementById('survey-content');
    content.innerHTML = survey.questions.map((q, idx) => renderQuestion(q, idx)).join('');

    document.getElementById('survey-modal').style.display = 'flex';

    // Add change listeners to inputs
    content.querySelectorAll('input, textarea').forEach(input => {
        input.addEventListener('change', updateSurveyProgress);
    });
}

function renderQuestion(question, index) {
    const number = index + 1;

    if (question.type === 'radio') {
        return `
            <div class="survey-question" data-qid="${question.id}" style="margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--border);">
                <p style="font-weight: 600; margin-bottom: 12px;">${number}. ${question.text}</p>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${question.options.map(opt => `
                        <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 8px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
                            <input type="radio" name="${question.id}" value="${opt}" style="width: 18px; height: 18px; accent-color: #8b5cf6;">
                            <span>${opt}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
        `;
    } else if (question.type === 'text') {
        return `
            <div class="survey-question" data-qid="${question.id}" style="margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--border);">
                <p style="font-weight: 600; margin-bottom: 12px;">${number}. ${question.text}</p>
                <textarea name="${question.id}" placeholder="${question.placeholder || 'Type your answer...'}" 
                    style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-input); color: var(--text); min-height: 80px; resize: vertical; font-family: inherit;"></textarea>
            </div>
        `;
    }

    return "";
}

function updateSurveyProgress() {
    const survey = currentSurveyTask || getSurveyTaskById(currentSurveyId);
    if (!survey) return;

    let answered = 0;
    const questions = getSurveyQuestions(survey);
    questions.forEach(q => {
        if (q.type === 'radio') {
            const selected = document.querySelector(`input[name="${q.id}"]:checked`);
            if (selected) answered++;
        } else if (q.type === 'text') {
            const textarea = document.querySelector(`textarea[name="${q.id}"]`);
            if (textarea && textarea.value.trim()) answered++;
        }
    });

    document.getElementById('survey-progress').textContent = `${answered} of ${questions.length} answered`;
}

function closeSurveyModal() {
    document.getElementById('survey-modal').style.display = 'none';
    currentSurveyId = null;
    currentSurveyTask = null;
    currentSurveyAnswers = {};
}

async function submitSurvey() {
    const survey = currentSurveyTask || getSurveyTaskById(currentSurveyId);
    if (!survey) return;
    const surveyReward = numberFrom(survey.rewardPoints, survey.reward, 0);

    // Collect answers
    const answers = {};
    let allAnswered = true;

    survey.questions.forEach(q => {
        if (q.type === 'radio') {
            const selected = document.querySelector(`input[name="${q.id}"]:checked`);
            if (selected) {
                answers[q.id] = selected.value;
            } else {
                allAnswered = false;
            }
        } else if (q.type === 'text') {
            const textarea = document.querySelector(`textarea[name="${q.id}"]`);
            if (textarea && textarea.value.trim()) {
                answers[q.id] = textarea.value.trim();
            }
        }
    });

    if (!allAnswered) {
        showToast("Please answer all questions before submitting.", "warning");
        return;
    }

    // Submit to API (placeholder - API endpoint to be provided)
    const btn = document.getElementById('btn-submit-survey');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    try {
        // Attempt API reward flow first (if backend supports surveys)
        await completeRewardFlow({
            taskId: survey.id,
            title: survey.title,
            message: `Survey completed! +${surveyReward} coins added.`,
            points: surveyReward,
            type: "survey",
            requestVariants: [
                {
                    path: "/surveys/submit",
                    method: "POST",
                    body: { surveyId: survey.id, answers }
                },
                {
                    path: "/add-points",
                    method: "POST",
                    body: { source: "survey", taskId: survey.id, points: surveyReward, title: survey.title }
                }
            ]
        });

        // Update UI
        const card = document.querySelector(`[data-survey-id="${survey.id}"]`);
        const startBtn = card?.querySelector('.btn-start-survey');
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.textContent = 'Completed';
            startBtn.style.opacity = '0.6';
        }

        renderTaskHistory();
        closeSurveyModal();
        showToast(`Survey completed! +${surveyReward} coins credited.`, "success");

    } catch (error) {
        console.error('Survey submission error:', error);
        // Fallback: local reward (offline-safe for surveys)
        if (!isTaskCompleted(currentSurveyId)) {
            markTaskCompleted(currentSurveyId);
            applyLocalRewardCredit({ points: surveyReward, source: "survey" });

            createWalletEntry({
                title: survey.title,
                message: `Survey completed! +${surveyReward} coins added.`,
                amount: surveyReward,
                type: "survey",
                direction: "credit",
                status: "completed",
                taskId: currentSurveyId
            });

            pushNotification({
                title: "Survey reward",
                message: `${survey.title}: ${surveyReward} points credited.`,
                type: "survey"
            });

            renderCommonUserState();
            playRewardSound();
            showRewardPopup({
                icon: "Reward",
                title: "Survey reward",
                message: `Survey completed! +${surveyReward} coins added.`,
                value: `${formatNumber(surveyReward)} Points`
            });
        }

        // Update UI locally
        const card = document.querySelector(`[data-survey-id="${currentSurveyId}"]`);
        const startBtn = card?.querySelector('.btn-start-survey');
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.textContent = 'Completed';
            startBtn.style.opacity = '0.6';
        }

        renderTaskHistory();
        closeSurveyModal();
        showToast(`Survey completed! +${surveyReward} coins credited.`, "success");
    } finally {
        btn.disabled = false;
        btn.textContent = 'Submit';
    }
}

async function fetchTasksPayload() {
    const withTimeout = async (promise, ms) => {
        let timer = null;
        try {
            return await Promise.race([
                promise,
                new Promise((_, reject) => {
                    timer = window.setTimeout(() => reject(new Error("timeout")), ms);
                })
            ]);
        } finally {
            if (timer) {
                window.clearTimeout(timer);
            }
        }
    };

    try {
        const data = await withTimeout(
            requestFirst([
                { path: "/tasks", method: "GET" },
                { path: "/user/tasks", method: "GET" }
            ], { auth: true }),
            12000
        );

        const tasks = normalizeTaskList(data?.tasks || data || []);
        if (taskCatalog?.saveAll) {
            taskCatalog.saveAll(tasks);
        }

        return {
            tasks,
            fromApi: true
        };
    } catch (error) {
        return {
            tasks: normalizeTaskList(getSharedTaskCatalog()),
            fromApi: false
        };
    }
}

function renderTaskSections(tasks) {
    const dailyContainer = document.getElementById("daily-task-container");
    const adminContainer = document.getElementById("admin-task-container");
    const surveyContainer = document.getElementById("survey-task-container");

    if (dailyContainer) {
        dailyContainer.innerHTML = renderProfileCompletionTask();
    }

    if (!adminContainer) {
        return;
    }

    const list = Array.isArray(tasks) ? tasks : [];
    const surveyTasks = list.filter((task) => String(task.taskType || "").toLowerCase() === "survey");
    const apiTasks = list.filter((task) => String(task.taskType || "").toLowerCase() !== "survey");
    const surveySource = surveyTasks;

    if (!apiTasks.length) {
        adminContainer.innerHTML = emptyStateMarkup("ri-inbox-archive-line", "No API-powered tasks are live right now.");
    } else {
        adminContainer.innerHTML = apiTasks.map((task) => {
            // Completion is tracked per-device/per-day in local task state (and optionally enforced server-side).
            // Do not trust the API's `completed` field for UI, as it may represent admin status / global state.
            const done = task.completed || isTaskCompleted(task.id);
            const badgeClass = done ? "success" : "warning";
            const actionLabel = done ? "Completed" : "Complete";
            const iconTone = done ? "success" : "warning";
            const iconClass = done ? "ri-checkbox-circle-line" : "ri-flashlight-line";
            const disabledAttr = done ? 'disabled aria-disabled="true" data-locked="true" data-locked-label="Completed"' : "";

            return `
                <div class="task-card" data-task-card="${escapeHtml(task.id)}">
                    <div class="task-card-head">
                        <div class="list-icon task-icon task-icon--${iconTone}"><i class="${iconClass}"></i></div>
                        <div class="list-info">
                            <div class="list-title">${escapeHtml(task.title)}</div>
                            <div class="list-sub">${escapeHtml(task.description || "Open the task and finish the required action.")}</div>
                        </div>
                    </div>
                    <div class="task-card-bottom">
                        <div class="task-card-badges">
                            <span class="task-pill reward"><i class="ri-coin-line"></i>${formatNumber(task.rewardPoints)} Coins</span>
                            <span class="status-pill ${badgeClass}">${done ? "Done today" : capitalize(task.taskType || "task")}</span>
                        </div>
                        <button type="button" class="btn-primary task-card-action" data-api-task="${escapeHtml(task.id)}" ${disabledAttr}>
                            ${actionLabel}
                        </button>
                    </div>
                </div>
            `;
        }).join("");
    }

    if (surveyContainer) {
        // Always show the "coming soon" placeholder for surveys on the Tasks page.
        // Surveys are not yet active in the UI per product decision, so hide survey cards.
        surveyContainer.innerHTML = emptyStateMarkup("ri-survey-line", "Survey tasks are coming soon! Stay tuned.");
    }

    adminContainer.querySelectorAll("[data-api-task]").forEach((button) => {
        button.addEventListener("click", async () => {
            const taskId = button.getAttribute("data-api-task") || "";
            const task = tasks.find((item) => item.id === taskId);
            if (!task || isTaskCompleted(task.id)) {
                showToast("This task is already completed.", "warning");
                return;
            }

            await withButtonState(button, "Completing...", async () => {
                if (task.link) {
                    window.open(task.link, "_blank", "noopener,noreferrer");
                }

                await completeRewardFlow({
                    taskId: task.id,
                    title: task.title,
                    message: `${task.title} completed successfully.`,
                    points: task.rewardPoints,
                    type: "task",
                    requestVariants: [
                        {
                            path: "/tasks/complete",
                            method: "POST",
                            body: { taskId: task.id, rewardPoints: task.rewardPoints }
                        },
                        {
                            path: "/add-points",
                            method: "POST",
                            body: { source: "task", taskId: task.id, points: task.rewardPoints, title: task.title }
                        }
                    ]
                });

                button.dataset.locked = "true";
                button.dataset.lockedLabel = "Completed";
                button.textContent = "Completed";
                button.disabled = true;
                renderTaskHistory();
            });
        });
    });
}

function renderSurveyTaskCards(tasks) {
    const items = Array.isArray(tasks) ? tasks : [];
    return items.map((task) => {
        const done = task.completed || isTaskCompleted(task.id);
        const rewardPoints = numberFrom(task.rewardPoints, task.reward, 0);
        const questionCount = Array.isArray(task.questions) && task.questions.length ? task.questions.length : 0;
        const disabledAttr = done ? 'disabled aria-disabled="true"' : "";

        return `
            <div class="card survey-task-card" data-survey-id="${escapeHtml(task.id)}" role="button" tabindex="0" aria-label="Open survey ${escapeHtml(task.title)}">
                <div class="task-card-head">
                    <div class="list-icon" style="background: rgba(139, 92, 246, 0.1); color: #8b5cf6;">
                        <i class="ri-survey-line"></i>
                    </div>
                    <div class="list-info">
                        <div class="list-title">${escapeHtml(task.title)}</div>
                        <div class="list-sub">${escapeHtml(task.description || `Complete the survey and earn ${formatNumber(rewardPoints)} Coins.`)}${questionCount ? ` • ${questionCount} questions` : ""}</div>
                    </div>
                </div>
                <div class="task-card-bottom">
                    <div class="task-card-badges">
                        <span class="task-pill reward"><i class="ri-coin-line"></i>${formatNumber(rewardPoints)} Coins</span>
                    </div>
                    <button type="button" class="btn-primary btn-start-survey task-card-action task-card-action-survey" style="background: #8b5cf6;" ${disabledAttr}>
                        ${done ? "Completed" : "Start"}
                    </button>
                </div>
            </div>
        `;
    }).join("");
}

function renderProfileCompletionTask() {
    return "";
}

function renderTaskHistory() {
    const container = document.getElementById("task-history-list");
    if (!container) {
        return;
    }

    const records = state.activity
        .filter((entry) => entry.type === "task" || entry.type === "spin");

    renderHistoryList(container, records, "Your completed tasks will appear here.", {
        emptyIcon: "ri-time-line"
    });
    const stats = buildTaskStats();
    setText("task-total-earned", formatNumber(stats.earnedPoints));
    setText("task-completed-count", formatNumber(stats.completedCount));
    setText("task-streak-count", formatStreakDays(computeTaskStreakDays("daily-checkin")));
}

async function initWalletPage() {
    const walletPayload = await fetchWalletPayload();
    renderWallet(walletPayload);
    bindWalletConversion();
}

async function fetchWalletPayload() {
    try {
        const data = await requestFirst([
            { path: "/wallet", method: "GET" },
            { path: "/user/wallet", method: "GET" }
        ], { auth: true });

        if (data?.user) {
            state.user = normalizeUser(data.user);
            persistUser(state.user);
        }

        const transactions = syncActivityState(data?.transactions || data?.history || [], { replace: true });

        return {
            transactions,
            user: state.user,
            stats: {
                referralEarnings: numberFrom(data?.stats?.referralEarnings, state.user?.referralEarnings, 0),
                taskRewards: Math.max(numberFrom(data?.stats?.taskRewards, state.user?.taskEarnings, 0), buildTaskStats().earnedPoints),
                surveyEarnings: Math.max(numberFrom(data?.stats?.surveyEarnings, state.user?.surveyEarnings, 0), buildSurveyStats().earnedPoints)
            }
        };
    } catch (error) {
        return {
            transactions: [...state.activity],
            user: state.user,
            stats: {
                referralEarnings: numberFrom(state.user?.referralEarnings, 0),
                taskRewards: buildTaskStats().earnedPoints,
                surveyEarnings: buildSurveyStats().earnedPoints
            }
        };
    }
}

function renderWallet(payload) {
    renderCommonUserState();
    const stats = payload?.stats || {};
    setText("wallet-refer-income", formatNumber(numberFrom(stats.referralEarnings, state.user?.referralEarnings, 0)));
    setText("wallet-task-income", formatNumber(numberFrom(stats.taskRewards, state.user?.taskEarnings, buildTaskStats().earnedPoints)));
    setText("wallet-survey-income", formatNumber(numberFrom(stats.surveyEarnings, state.user?.surveyEarnings, buildSurveyStats().earnedPoints)));

    const list = uniqueByKey(payload.transactions, (item) => `${item.id}:${item.time}`);
    const container = document.getElementById("transaction-list");
    if (!container) {
        return;
    }
    renderHistoryList(container, list, "Your wallet movements will show here.");
}

function bindWalletConversion() {
    const input = document.getElementById("points-input");
    const output = document.getElementById("token-output");
    const button = document.getElementById("convert-btn");
    const warning = document.getElementById("min-warning");

    if (!input || !output || !button) {
        return;
    }

    const updatePreview = () => {
        const points = Math.floor(Number(input.value || 0));
        const tokens = points / 1000;
        const balance = Math.floor(state.user?.points || 0);
        const valid = points > 0 && points <= balance;

        output.textContent = formatDecimal(tokens);
        button.disabled = !valid;
        button.textContent = valid ? "Convert Points" : "Enter Valid Points";

        if (warning) {
            warning.style.display = !points || valid ? "none" : "block";
            warning.textContent = points <= 0
                ? "Enter at least 1 point to continue."
                : "Entered points exceed your current balance.";
        }
    };

    input.addEventListener("input", updatePreview);
    updatePreview();

    button.addEventListener("click", async () => {
        const points = Math.floor(Number(input.value || 0));
        if (points <= 0) {
            showToast("Enter points to convert.", "error");
            return;
        }

        if (points > (state.user?.points || 0)) {
            showToast("Entered points exceed your current balance.", "error");
            return;
        }

        const tokens = roundTo(points / 1000, 2);

        await withButtonState(button, "Converting...", async () => {
            const requestData = await requestFirst([
                { path: "/wallet/convert", method: "POST", body: { points } },
                { path: "/convert-points", method: "POST", body: { points } }
            ], { auth: true });

            if (requestData?.user) {
                state.user = normalizeUser(requestData.user);
                persistUser(state.user);
                if (requestData?.transactions?.length || requestData?.activityEntry) {
                    syncActivityState(requestData.transactions || [requestData.activityEntry], { replace: true });
                }
            } else {
                throw new Error("Wallet conversion failed. Please try again.");
            }

            pushNotification({
                title: "Wallet updated",
                message: `${formatDecimal(tokens)} tokens added to your wallet.`,
                type: "wallet"
            });

            renderWallet({
                transactions: state.activity,
                user: state.user,
                stats: requestData?.stats
            });
            input.value = "";
            updatePreview();
            showRewardPopup({
                icon: "💳",
                title: "Conversion complete",
                message: "Your wallet is updated and ready to use on recharge.",
                value: `${formatDecimal(tokens)} Tokens`
            });
        });
    });
}

async function initReferPage() {
    // If we have a cached referral payload and the user navigated here from
    // the Tasks page (or the payload is already present), reuse it to avoid
    // an extra network request. On full reload or direct visit we fetch.
    let data = null;
    try {
        const navEntries = (performance.getEntriesByType && performance.getEntriesByType('navigation')) || [];
        const navType = (navEntries[0] && navEntries[0].type) || (performance.navigation && performance.navigation.type) || '';
        const fromTasks = String(document.referrer || '').includes('tasks.html');
        if (state.referralPayload && fromTasks && navType !== 'reload') {
            data = state.referralPayload;
        } else {
            data = await fetchReferralPayload();
            if (data) state.referralPayload = data;
        }
    } catch (err) {
        data = await fetchReferralPayload();
        if (data) state.referralPayload = data;
    }
    const referralCode = String(data.referralCode || state.user?.referralCode || "").trim().toUpperCase();
    const baseUrl = `${window.location.origin}${window.location.pathname.replace(/\/[^/]*$/, "/")}index.html?view=register`;
    const shareUrl = referralCode ? `${baseUrl}&ref=${encodeURIComponent(referralCode)}` : baseUrl;

    setText("my-refer-code", referralCode || "—");
    setText("total-ref-count", formatNumber(data.totalReferrals));
    setText("total-ref-earnings", formatNumber(data.totalEarnings));
    setText("daily-limit-text", `${formatNumber(data.todayReferrals)} / ${formatNumber(data.dailyLimit)} Today`);
    setText("pending-ref-rewards", formatNumber(data.todayReferrals));
    updateReferralProgress(data);
    bindInviteNow(shareUrl);
    bindReferralLeaderboard({
        leaderboard: data.leaderboard || [],
        weeklyLeaderboard: data.weeklyLeaderboard || [],
        network: data.network || []
    });

    document.getElementById("copy-btn")?.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(shareUrl);
            showToast("Referral link copied.", "success");
        } catch (error) {
            showToast("Copy failed on this device.", "error");
        }
    });

    document.getElementById("share-btn")?.addEventListener("click", async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: "Join AnviPayz",
                    text: `Use my invite code ${referralCode} to join AnviPayz.`,
                    url: shareUrl
                });
                showToast("Referral link shared.", "success");
                return;
            } catch (error) {
                // Silent fallback to copy.
            }
        }

        try {
            await navigator.clipboard.writeText(shareUrl);
            showToast("Referral link copied for sharing.", "success");
        } catch (error) {
            showToast("Share is not available right now.", "error");
        }
    });

    const whatsappBtn = document.getElementById("whatsapp-btn");
    if (whatsappBtn && whatsappBtn.dataset.bound !== "true") {
        whatsappBtn.dataset.bound = "true";
        whatsappBtn.addEventListener("click", () => {
            const text = `Join AnviPayz using my referral code ${String(referralCode || "").trim().toUpperCase()} and earn bonus points! ${shareUrl}`;
            const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
            window.open(waUrl, "_blank", "noopener,noreferrer");
        });
    }

    renderReferralNetwork(data.network);
    handleReferralAlerts(data);
}

function updateReferralProgress(data) {
    const tiers = [
        { referrals: 15, points: 1000 },
        { referrals: 25, points: 2000 },
        { referrals: 50, points: 6000 }
    ];
    const totalReferrals = numberFrom(data?.totalReferrals, state.user?.referrals, 0);
    const nextTier = tiers.find((tier) => totalReferrals < tier.referrals) || null;
    const previousTier = [...tiers].reverse().find((tier) => totalReferrals >= tier.referrals) || null;
    const goal = Math.max(1, nextTier?.referrals || previousTier?.referrals || totalReferrals || 1);
    const current = Math.min(totalReferrals, goal);
    const ratio = Math.min(current / goal, 1);
    const remaining = nextTier ? Math.max(0, nextTier.referrals - totalReferrals) : 0;

    setText("progress-current", formatNumber(current));
    setText("progress-goal", formatNumber(goal));

    const fill = document.getElementById("progress-fill");
    if (fill) {
        fill.style.width = `${Math.round(ratio * 100)}%`;
    }

    const bonusStatus = document.getElementById("bonus-status");
    if (bonusStatus) {
        if (nextTier) {
            bonusStatus.textContent = `Next reward: +${formatNumber(nextTier.points)} points at ${formatNumber(nextTier.referrals)} referrals. ${formatNumber(remaining)} more referral${remaining === 1 ? "" : "s"} needed.`;
            bonusStatus.classList.remove("unlocked");
        } else if (tiers.length) {
            bonusStatus.textContent = "All referral reward tiers unlocked.";
            bonusStatus.classList.add("unlocked");
        } else {
            bonusStatus.textContent = "Invite more friends to unlock rewards.";
            bonusStatus.classList.remove("unlocked");
        }
    }
}

function bindInviteNow(shareUrl) {
    const inviteBtn = document.getElementById("invite-now-btn");
    if (!inviteBtn || inviteBtn.dataset.bound === "true") {
        return;
    }
    inviteBtn.dataset.bound = "true";
    inviteBtn.addEventListener("click", async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: "Join AnviPayz",
                    text: "Use my invite code to join AnviPayz.",
                    url: shareUrl
                });
                showToast("Referral link shared.", "success");
                return;
            } catch (error) {
                // fallback to copy
            }
        }

        try {
            await navigator.clipboard.writeText(shareUrl);
            showToast("Referral link copied for sharing.", "success");
        } catch (error) {
            showToast("Share is not available right now.", "error");
        }
    });
}

function bindReferralLeaderboard({ leaderboard = [], weeklyLeaderboard = [], network = [] } = {}) {
    const listEl = document.getElementById("leaderboard-list");
    const toggleAll = document.getElementById("toggle-all");
    const toggleWeekly = document.getElementById("toggle-weekly");
    const rankCard = document.getElementById("your-rank-card");

    if (!listEl || !toggleAll || !toggleWeekly) {
        return;
    }

    if (!document.documentElement.dataset.referLeaderboardBound) {
        document.documentElement.dataset.referLeaderboardBound = "1";
        toggleAll.addEventListener("click", () => {
            toggleAll.classList.add("active");
            toggleWeekly.classList.remove("active");
            renderReferralLeaderboard(listEl, normalizeLeaderboardEntries(leaderboard, { timeLabel: "All time" }), "all", rankCard);
        });

        toggleWeekly.addEventListener("click", () => {
            toggleWeekly.classList.add("active");
            toggleAll.classList.remove("active");
            renderReferralLeaderboard(listEl, normalizeLeaderboardEntries(weeklyLeaderboard, { timeLabel: "This week" }), "weekly", rankCard);
        });
    }

    const mode = toggleWeekly.classList.contains("active") ? "weekly" : "all";
    renderReferralLeaderboard(
        listEl,
        mode === "weekly"
            ? normalizeLeaderboardEntries(weeklyLeaderboard, { timeLabel: "This week" })
            : normalizeLeaderboardEntries(leaderboard, { timeLabel: "All time" }),
        mode,
        rankCard
    );
}

function normalizeLeaderboardEntries(entries, { timeLabel = "All time" } = {}) {
    return (Array.isArray(entries) ? entries : []).map((item) => {
        const referrals = numberFrom(item.referrals, item.referralCount, 0);
        return {
            name: item.username || item.name || "Member",
            email: "",
            reward: numberFrom(item.points, item.reward, 0),
            time: item.time || item.createdAt || "",
            subLabel: `Referrals: ${formatNumber(referrals)}`,
            timeLabel: timeLabel,
            isMe: Boolean(item.isMe)
        };
    });
}

function handleReferralAlerts(data) {
    const totalReferrals = numberFrom(data?.totalReferrals, 0);
    const stored = localStorage.getItem(STORAGE_KEYS.referralSeenCount);
    const previous = stored !== null ? numberFrom(stored, 0) : null;

    let newCount = 0;
    if (previous === null) {
        newCount = numberFrom(data?.todayReferrals, 0);
        if (newCount <= 0) {
            localStorage.setItem(STORAGE_KEYS.referralSeenCount, String(totalReferrals));
            return;
        }
    } else {
        newCount = totalReferrals - previous;
        if (newCount <= 0) {
            localStorage.setItem(STORAGE_KEYS.referralSeenCount, String(totalReferrals));
            return;
        }
    }

    localStorage.setItem(STORAGE_KEYS.referralSeenCount, String(totalReferrals));
    const latest = Array.isArray(data?.network) ? data.network[0] : null;
    const latestName = latest?.name || "A friend";
    const message = newCount > 1
        ? `${formatNumber(newCount)} new referrals joined using your code.`
        : `${latestName} joined using your referral code.`;

    pushNotification({
        title: "Referral joined",
        message,
        type: "referral"
    });

    showToast(newCount > 1 ? "New referrals joined!" : "New referral joined!", "success");

    const rewardPoints = numberFrom(latest?.reward, 0) * newCount;
    showRewardPopup({
        icon: "Reward",
        title: "Referral Bonus",
        message,
        value: rewardPoints > 0 ? `${formatNumber(rewardPoints)} Points` : "Rewards updated"
    });
}

function renderReferralLeaderboard(listEl, network, mode, rankCard) {
    const now = Date.now();
    const windowMs = 7 * 24 * 60 * 60 * 1000;
    const sourceList = (network || []);
    const hasTime = sourceList.some((person) => toTimestamp(person.time));
    const filtered = sourceList.filter((person) => {
        if (mode !== "weekly" || !hasTime) {
            return true;
        }
        const timestamp = toTimestamp(person.time);
        return timestamp && now - timestamp <= windowMs;
    });

    const sorted = [...filtered].sort((a, b) => numberFrom(b.reward, 0) - numberFrom(a.reward, 0));

    if (!sorted.length) {
        listEl.innerHTML = emptyStateMarkup("ri-trophy-line", "No leaderboard data yet.");
        if (rankCard) {
            rankCard.hidden = true;
        }
        return;
    }

    listEl.innerHTML = sorted.slice(0, 8).map((person, index) => {
        const emailLabel = person.subLabel || (person.email ? maskEmail(person.email) : "Joined via invite link");
        const timeLabel = person.timeLabel || (person.time ? formatRelative(person.time) : "All time");
        const meClass = person.isMe ? "is-me" : "";
        return `
            <div class="network-item ${meClass}">
                <div class="list-info">
                    <div class="task-title">#${index + 1} ${escapeHtml(person.name || "Member")}</div>
                    <div class="task-body">${escapeHtml(emailLabel)}</div>
                </div>
                <div style="text-align:right;">
                    <div class="status-pill success">${formatNumber(person.reward)} Points</div>
                    <div class="network-time" style="margin-top:6px;">${escapeHtml(timeLabel)}</div>
                </div>
            </div>
        `;
    }).join("");

    if (rankCard) {
        rankCard.hidden = true;
    }
}

async function fetchReferralPayload() {
    try {
        const data = await requestFirst([
            { path: "/referrals", method: "GET" },
            { path: "/user/referrals", method: "GET" }
        ], { auth: true });

        if (data?.user) {
            state.user = normalizeUser(data.user);
            persistUser(state.user);
        }

        return {
            referralCode: data?.referralCode || state.user?.referralCode,
            totalReferrals: numberFrom(data?.totalReferrals, state.user?.referrals, 0),
            totalEarnings: numberFrom(data?.totalEarnings, state.user?.referralEarnings, 0),
            todayReferrals: numberFrom(data?.todayReferrals, 0),
            dailyLimit: numberFrom(data?.dailyLimit, 10),
            leaderboard: Array.isArray(data?.leaderboard) ? data.leaderboard : [],
            weeklyLeaderboard: Array.isArray(data?.weeklyLeaderboard) ? data.weeklyLeaderboard : [],
            network: normalizeNetwork(data?.network || [])
        };
    } catch (error) {
        return {
            referralCode: state.user?.referralCode || "",
            totalReferrals: numberFrom(state.user?.referrals, 0),
            totalEarnings: numberFrom(state.user?.referralEarnings, 0),
            todayReferrals: 0,
            dailyLimit: 10,
            leaderboard: [],
            weeklyLeaderboard: [],
            network: []
        };
    }
}

function renderReferralNetwork(network) {
    const container = document.getElementById("referral-list");
    if (!container) {
        return;
    }

    if (!network.length) {
        container.innerHTML = emptyStateMarkup("ri-user-follow-line", "Your verified referrals will appear here after they join.");
        return;
    }

    container.innerHTML = network.map((person) => {
        const emailLabel = person.email ? maskEmail(person.email) : "Joined via email link";
        return `
            <div class="network-item">
                <div class="list-info">
                    <div class="task-title">${escapeHtml(person.name)}</div>
                    <div class="task-body">${escapeHtml(emailLabel)}</div>
                </div>
                <div style="text-align:right;">
                    <div class="status-pill success">${formatNumber(person.reward)} Points</div>
                    <div class="network-time" style="margin-top:6px;">${escapeHtml(formatLongDate(person.time))}</div>
                </div>
            </div>
        `;
    }).join("");
}

async function initNotificationsPage() {
    const notifications = await fetchNotificationsPayload();
    renderNotifications(notifications);

    // Add "Mark All as Read" functionality
    const markAllReadBtn = document.getElementById("mark-all-read-btn");
    if (markAllReadBtn) {
        markAllReadBtn.addEventListener("click", () => {
            const updatedNotifications = state.notifications.map((item) => ({ ...item, unread: false }));
            state.notifications = updatedNotifications;
            persistNotifications();
            renderNotifications(updatedNotifications);
            markAllNotificationsReadOnServer().catch(() => null);
            showToast("All notifications marked as read", "success");
        });
    }
}

async function markNotificationsReadOnServer(ids) {
    const payloadIds = (Array.isArray(ids) ? ids : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .slice(0, 200);

    if (!payloadIds.length) {
        return true;
    }

    try {
        await requestJson("/notifications/read", {
            method: "POST",
            body: { ids: payloadIds },
            auth: true
        });
        return true;
    } catch (error) {
        // Ignore: local read state still applies on this device.
        return false;
    }
}

async function markAllNotificationsReadOnServer() {
    try {
        await requestJson("/notifications/read-all", {
            method: "POST",
            body: {},
            auth: true
        });
        return true;
    } catch (error) {
        // Ignore: local read state still applies on this device.
        return false;
    }
}

async function fetchNotificationsPayload({ force = false } = {}) {
    try {
        const now = Date.now();
        if (!force && state.page !== "notifications.html" && (now - lastNotificationsSyncAt) < 60 * 1000) {
            return state.notifications;
        }

        const data = await requestFirst([
            { path: "/notifications", method: "GET" },
            { path: "/user/notifications", method: "GET" }
        ], { auth: true });

        const normalized = normalizeNotifications(data?.notifications || data || []);
        state.notifications = mergeNotifications(normalized, state.notifications);
        persistNotifications();

        if (state.page === "home.html") {
            window.dispatchEvent(new Event("anvi:notifications-updated"));
        }

        if (!notificationReadMigrationDone) {
            // Avoid spamming older backends with read-sync calls that may not exist (404).
            // Local read state still works on-device, and we sync reads explicitly from the
            // notifications page actions.
            if (state.page !== "notifications.html") {
                notificationReadMigrationDone = true;
                lastNotificationsSyncAt = Date.now();
                return state.notifications;
            }

            const idsToSync = state.notifications
                .filter((item) => item && item.unread === false && item.id)
                .map((item) => item.id);
            markNotificationsReadOnServer(idsToSync)
                .then((synced) => {
                    if (synced) {
                        notificationReadMigrationDone = true;
                    }
                })
                .catch(() => null);
        }

        lastNotificationsSyncAt = Date.now();
        return state.notifications;
    } catch (error) {
        return state.notifications;
    }
}

function renderNotifications(list) {
    const container = document.getElementById("notification-list");
    if (!container) {
        return;
    }

    if (!list.length) {
        container.innerHTML = emptyStateMarkup("ri-notification-off-line", "No alerts yet. Reward updates will show here.");
        updateUnreadSummary(0);
        return;
    }

    const unreadCount = list.filter((item) => item.unread).length;
    updateUnreadSummary(unreadCount);

    renderPaginatedList({
        container,
        records: list,
        emptyMessage: "No alerts yet. Reward updates will show here.",
        initialCount: 30,
        stepCount: 15,
        listKey: "notifications",
        renderItem: (item, index) => `
            <article class="notification-card ${item.unread ? "notification-unread" : ""}" data-index="${index}" style="cursor:pointer;">
                <div class="notification-main">
                    <div class="notification-title">${escapeHtml(item.title)}</div>
                    <div class="notification-body">${escapeHtml(item.message)}</div>
                </div>
                <div style="text-align:right;">
                    <div class="notification-time">${escapeHtml(formatRelative(item.time))}</div>
                    <div class="meta-text" style="margin-top:6px;">${escapeHtml(formatLongDate(item.time))}</div>
                </div>
            </article>
        `,
        afterRender: () => {
            // Add click handlers to mark notifications as read
            container.querySelectorAll(".notification-card").forEach((card) => {
                card.addEventListener("click", () => {
                    const index = parseInt(card.dataset.index);
                    if (list[index] && list[index].unread) {
                        list[index].unread = false;
                        state.notifications = list;
                        persistNotifications(list);
                        renderNotifications(list);
                        markNotificationsReadOnServer([list[index].id]).catch(() => null);
                    }
                });
            });
        }
    });
}

function updateUnreadSummary(count) {
    setText("unread-count-label", `Unread: ${formatNumber(count)}`);
    setAllText("header-unread-badge", `${formatNumber(count)} Unread`);
    setText("mobile-unread-badge", `${formatNumber(count)} Unread`);
    updateSidebarUnreadBadge(count);
}

async function initSpinPage() {
    renderSpinWheel();

    const button = document.getElementById("btn-spin");
    const message = document.getElementById("spin-msg");
    const alreadyUsed = isTaskCompleted("daily-spin");
    let stopCooldown = () => { };

    const startCooldown = () => {
        stopCooldown();
        stopCooldown = startSpinCooldownTimer({ message, button });
    };

    if (alreadyUsed && message) {
        message.textContent = "Today's spin is already used.";
        if (button) {
            button.disabled = true;
            button.textContent = "Spin used";
        }
        startCooldown();
    }

    button?.addEventListener("click", async () => {
        if (state.spinning || isTaskCompleted("daily-spin")) {
            showToast("You already used your daily spin.", "warning");
            return;
        }

        state.spinning = true;
        const previousLabel = button.textContent;
        button.disabled = true;
        button.textContent = "SPINNING...";

        const container = document.querySelector(".wheel-container");
        container?.classList.add("is-spinning");

        const stopLoop = startWheelSpinLoop({ speedDegPerSec: 1080 });
        const stopTick = startSpinTickSound(12000);
        playSpinSound();

        try {
            const reward = await fetchSpinReward();
            stopLoop();
            const spins = 8 + Math.floor(Math.random() * 3);
            const spinDuration = getSpinDuration(spins);
            await animateWheelToReward(reward.index, { spins, duration: spinDuration });
            stopTick();
            await completeRewardFlow({
                taskId: "daily-spin",
                title: "Spin & Win",
                message: `Spin reward credited: ${reward.points} points.`,
                points: reward.points,
                type: "spin",
                requestVariants: reward.requestVariants
            });

            startCooldown();

            button.textContent = "Spin used";
        } catch (error) {
            stopLoop();
            stopTick();
            const friendly = error?.message || "Spin failed. Please try again.";
            showToast(friendly, "error");
            if (message) {
                message.textContent = friendly;
            }

            button.disabled = false;
            button.textContent = previousLabel || "SPIN NOW";
        } finally {
            container?.classList.remove("is-spinning");
            state.spinning = false;
        }
    });
}

function enforceAutoLogout() {
    const last = Number(localStorage.getItem(SECURITY_ACTIVITY_KEY) || 0);
    if (last && Date.now() - last > INACTIVITY_LIMIT_MS) {
        logout();
    }
}

function bindActivityListeners() {
    const mark = () => {
        localStorage.setItem(SECURITY_ACTIVITY_KEY, String(Date.now()));
    };
    mark();
    ["click", "keydown", "mousemove", "touchstart", "scroll"].forEach((evt) => {
        window.addEventListener(evt, mark, { passive: true });
    });
}

function renderSpinWheel() {
    const wheel = document.getElementById("wheel");
    if (!wheel) {
        return;
    }

    wheel.innerHTML = SPIN_REWARDS.map((reward, index) => {
        const angle = index * (360 / SPIN_REWARDS.length) + (360 / SPIN_REWARDS.length) / 2;
        return `<span class="wheel-segment-label" data-index="${index}" style="--angle:${angle}; --distance:120px;">${reward}</span>`;
    }).join("");
}

async function fetchSpinReward() {
    const data = await requestFirst([
        { path: "/spin", method: "POST", body: {} },
        { path: "/spin/reward", method: "POST", body: {} }
    ], { auth: true });

    const points = numberFrom(data?.points, data?.reward, SPIN_REWARDS[Math.floor(Math.random() * SPIN_REWARDS.length)]);
    const index = Math.max(0, SPIN_REWARDS.findIndex((value) => value === points));
    const rewardToken = String(data?.rewardToken || "").trim();

    if (!rewardToken) {
        throw new Error("Spin reward token missing. Please try again.");
    }

    return {
        points,
        index,
        requestVariants: [
            {
                path: "/add-points",
                method: "POST",
                body: {
                    source: "spin",
                    taskId: "daily-spin",
                    rewardToken,
                    points,
                    title: "Spin & Win"
                }
            }
        ]
    };
}

function animateWheelToReward(index, { spins = 7, duration = 4800 } = {}) {
    const wheel = document.getElementById("wheel");
    if (!wheel) {
        return delay(duration);
    }

    const segmentAngle = 360 / SPIN_REWARDS.length;
    const targetStopAngle = 360 - (index * segmentAngle + segmentAngle / 2);
    const current = normalizeAngle(state.wheelRotation);
    const deltaToTarget = (targetStopAngle - current + 360) % 360;
    const fromRotation = state.wheelRotation;
    state.wheelRotation += spins * 360 + deltaToTarget;

    // Use rAF animation so the wheel still spins even if transitions are reduced/overridden.
    wheel.style.transition = "none";
    return animateRotation(wheel, {
        from: fromRotation,
        to: state.wheelRotation,
        durationMs: duration,
        easing: easeOutQuint
    }).then(() => highlightSpinWinner(index));
}

function getSpinDuration(spins) {
    return Math.max(4200, spins * 520);
}

function startSpinCooldownTimer({ message, button }) {
    if (!message) {
        return () => { };
    }

    let intervalId = 0;

    const update = () => {
        const remainingMs = msUntilNextIstMidnight();
        if (remainingMs <= 0) {
            message.textContent = "Spin is available now.";
            if (button && !state.spinning && !isTaskCompleted("daily-spin")) {
                button.disabled = false;
                button.textContent = "SPIN NOW";
            }
            if (intervalId) {
                window.clearInterval(intervalId);
                intervalId = 0;
            }
            return;
        }

        message.textContent = `Next spin in ${formatDurationClock(remainingMs)} (resets at 12:00 AM IST).`;
    };

    update();
    intervalId = window.setInterval(update, 1000);

    return () => {
        if (intervalId) {
            window.clearInterval(intervalId);
            intervalId = 0;
        }
    };
}

function msUntilNextIstMidnight(nowMs = Date.now()) {
    const istOffsetMs = 330 * 60 * 1000;
    const istNow = new Date(nowMs + istOffsetMs);
    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const day = istNow.getUTCDate();
    const nextMidnightIstUtcMs = Date.UTC(year, month, day + 1, 0, 0, 0) - istOffsetMs;
    return nextMidnightIstUtcMs - nowMs;
}

function formatDurationClock(ms) {
    const totalSeconds = Math.max(0, Math.floor(numberFrom(ms, 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const hh = String(hours).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    return `${hh}h ${mm}m ${ss}s`;
}

function startWheelSpinLoop({ speedDegPerSec = 960 } = {}) {
    const wheel = document.getElementById("wheel");
    if (!wheel) {
        return () => { };
    }

    let active = true;
    let last = performance.now();

    const frame = (now) => {
        if (!active) return;
        const deltaSec = Math.min(0.05, Math.max(0, (now - last) / 1000));
        last = now;
        state.wheelRotation += speedDegPerSec * deltaSec;
        wheel.style.transition = "none";
        wheel.style.transform = `rotate(${state.wheelRotation}deg)`;
        requestAnimationFrame(frame);
    };

    requestAnimationFrame(frame);
    return () => {
        active = false;
    };
}

function highlightSpinWinner(index) {
    const wheel = document.getElementById("wheel");
    if (!wheel) return;

    wheel.querySelectorAll(".wheel-segment-label").forEach((label) => {
        label.classList.toggle("is-winner", Number(label.dataset.index) === Number(index));
    });
}

function animateRotation(el, { from, to, durationMs = 1200, easing = (t) => t } = {}) {
    const start = performance.now();

    return new Promise((resolve) => {
        const frame = (now) => {
            const t = Math.min(1, Math.max(0, (now - start) / durationMs));
            const eased = easing(t);
            const value = from + (to - from) * eased;
            el.style.transform = `rotate(${value}deg)`;

            if (t >= 1) {
                resolve();
                return;
            }
            requestAnimationFrame(frame);
        };

        requestAnimationFrame(frame);
    });
}

function easeOutQuint(t) {
    return 1 - Math.pow(1 - t, 5);
}

function normalizeAngle(value) {
    const v = Number(value) || 0;
    return ((v % 360) + 360) % 360;
}

function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function initRechargePage() {
    bindRechargePlanFilters();
    bindRechargeQuickAmounts();
    bindRechargeDiscount();
    updateRechargePreview();

    const form = document.getElementById("recharge-form");
    form?.addEventListener("submit", async (event) => {
        event.preventDefault();

        const payload = buildRechargePayload();
        if (!payload) {
            return;
        }

        const button = document.getElementById("recharge-pay-btn");
        await withButtonState(button, "Processing...", async () => {
            const data = await requestRechargeOrder(payload);

            createWalletEntry({
                title: "Recharge request created",
                message: `Recharge request for ${payload.mobile} is ready for payment.`,
                amount: payload.payableAmount,
                type: "recharge",
                direction: "debit",
                status: "pending"
            });

            pushNotification({
                title: "Recharge request created",
                message: `Payment link prepared for ${payload.operator} ₹${formatDecimal(payload.amount)} recharge.`,
                type: "recharge"
            });

            setText("recharge-status", data?.message || "Recharge request created. Continue in the payment window.");
            showRewardPopup({
                icon: "📱",
                title: "Recharge ready",
                message: data?.message || "Your order is created and waiting for checkout confirmation.",
                value: `Pay ₹${formatDecimal(payload.payableAmount)}`
            });

            if (data?.checkoutUrl) {
                window.location.href = data.checkoutUrl;
                return;
            }

            if (data?.paymentUrl) {
                window.location.href = data.paymentUrl;
                return;
            }
        });
    });
}

function bindRechargePlanFilters() {
    document.querySelectorAll(".rx-filter-btn").forEach((button) => {
        button.addEventListener("click", () => {
            const selected = button.getAttribute("data-cat") || "all";
            document.querySelectorAll(".rx-filter-btn").forEach((item) => item.classList.remove("active"));
            button.classList.add("active");

            document.querySelectorAll(".recharge-plan-item").forEach((plan) => {
                const category = plan.getAttribute("data-cat") || "";
                plan.style.display = selected === "all" || category === selected ? "" : "none";
            });
        });
    });

    document.querySelectorAll(".recharge-plan-item").forEach((button) => {
        button.addEventListener("click", () => {
            const amount = button.getAttribute("data-amount") || "";
            document.getElementById("recharge-amount").value = amount;
            document.querySelectorAll(".recharge-plan-item").forEach((item) => item.classList.remove("active"));
            button.classList.add("active");
            updateRechargePreview();
        });
    });
}

function bindRechargeQuickAmounts() {
    document.querySelectorAll(".rx-quick-btn").forEach((button) => {
        button.addEventListener("click", () => {
            const amount = button.getAttribute("data-quick") || "";
            document.getElementById("recharge-amount").value = amount;
            document.querySelectorAll(".rx-quick-btn").forEach((item) => item.classList.remove("active"));
            button.classList.add("active");
            updateRechargePreview();
        });
    });

    ["recharge-mobile", "recharge-operator", "recharge-circle", "recharge-amount", "token-discount-input"].forEach((id) => {
        document.getElementById(id)?.addEventListener("input", updateRechargePreview);
        document.getElementById(id)?.addEventListener("change", updateRechargePreview);
    });
}

function bindRechargeDiscount() {
    const checkbox = document.getElementById("use-token-discount");
    const input = document.getElementById("token-discount-input");

    checkbox?.addEventListener("change", () => {
        if (input) {
            input.disabled = !checkbox.checked;
            if (!checkbox.checked) {
                input.value = "";
            }
        }

        updateRechargePreview();
    });
}

function buildRechargePayload() {
    const mobile = document.getElementById("recharge-mobile")?.value.trim() || "";
    const operator = document.getElementById("recharge-operator")?.value.trim() || "";
    const circle = document.getElementById("recharge-circle")?.value.trim() || "";
    const amount = Number(document.getElementById("recharge-amount")?.value || 0);
    const useTokens = Boolean(document.getElementById("use-token-discount")?.checked);
    const requestedDiscount = Number(document.getElementById("token-discount-input")?.value || 0);
    const maxDiscount = maxRechargeDiscount(amount);
    const tokenDiscount = useTokens ? Math.min(maxDiscount, Math.max(0, requestedDiscount)) : 0;
    const payableAmount = Math.max(0, amount - tokenDiscount);

    if (!/^\d{10}$/.test(mobile)) {
        setText("recharge-status", "Enter a valid 10-digit mobile number.");
        showToast("Enter a valid 10-digit mobile number.", "error");
        return null;
    }

    if (!operator || !circle || amount < 10) {
        setText("recharge-status", "Complete the recharge details before continuing.");
        showToast("Complete the recharge details before continuing.", "error");
        return null;
    }

    return {
        mobile,
        operator,
        circle,
        amount,
        tokenDiscount,
        payableAmount
    };
}

async function requestRechargeOrder(payload) {
    try {
        const data = await requestFirst([
            { path: "/recharge", method: "POST", body: payload },
            { path: "/recharge/initiate", method: "POST", body: payload }
        ], { auth: true });

        if (data?.user) {
            state.user = normalizeUser(data.user);
            persistUser(state.user);
            renderCommonUserState();
        }

        return data || {};
    } catch (error) {
        return {
            message: "Recharge request saved. Payment gateway will be provided by your backend."
        };
    }
}

function updateRechargePreview() {
    const amount = Number(document.getElementById("recharge-amount")?.value || 0);
    const requestedDiscount = Number(document.getElementById("token-discount-input")?.value || 0);
    const useTokens = Boolean(document.getElementById("use-token-discount")?.checked);
    const selectedPlan = document.querySelector(".recharge-plan-item.active strong")?.textContent || "No plan selected";
    const maxDiscount = maxRechargeDiscount(amount);
    const discount = useTokens ? Math.min(maxDiscount, Math.max(0, requestedDiscount)) : 0;
    const payable = Math.max(0, amount - discount);

    setText("rx-mini-plan", selectedPlan);
    setText("rx-mini-amount", `Rs ${formatDecimal(amount)}`);
    setText("rx-mini-token-discount", `- Rs ${formatDecimal(discount)}`);
    setText("recharge-preview-amount", `Rs ${formatDecimal(amount)}`);
    setText("recharge-preview-token-discount", `- Rs ${formatDecimal(discount)}`);
    setText("recharge-preview-payable", `Rs ${formatDecimal(payable)}`);
    setText("token-available-pill", `${formatDecimal(state.user?.tokens || 0)} Tokens`);
    setText("token-max-note", amount > 0
        ? `Maximum usable token discount right now: ₹${formatDecimal(maxDiscount)}`
        : "Enter an amount to calculate the token discount limit.");
    setText("recharge-status", amount > 0
        ? `Payable amount after discount: ₹${formatDecimal(payable)}`
        : "Select a plan or enter a custom amount.");
}

function maxRechargeDiscount(amount) {
    return roundTo(Math.min(state.user?.tokens || 0, amount * 0.1), 2);
}

async function initProfilePage() {
    renderCommonUserState();
    const button = document.getElementById("delete-account-btn");
    button?.addEventListener("click", async () => {
        const confirmed = await showDeleteAccountFlow();
        if (!confirmed) {
            return;
        }

        await withButtonState(button, "Deleting...", async () => {
            const data = await requestFirst([
                { path: "/profile/delete", method: "DELETE" },
                { path: "/user", method: "DELETE" }
            ], { auth: true });
            const deadline = data?.recovery?.deleteAfter ? formatLongDate(data.recovery.deleteAfter) : "the next 7 days";
            showToast(`Account scheduled for deletion. Restore it before ${deadline}.`, "warning");
            logout();
        });
    });

    // Handle display name edits
    const nameForm = document.getElementById('profile-name-form');
    if (nameForm) {
        nameForm.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const saveBtn = document.getElementById('profile-name-save');
            const input = document.getElementById('profile-name-input');
            const nextName = (input?.value || '').trim();

            if (!nextName) {
                showToast('Name is required.', 'error');
                return;
            }
            if (nextName.length < 3 || nextName.length > 30) {
                showToast('Name must be between 3 and 30 characters.', 'error');
                return;
            }

            await withButtonState(saveBtn, 'Saving...', async () => {
                // Try both route variants for compatibility
                const data = await requestFirst([
                    { path: '/user/update-profile', method: 'PATCH', body: { name: nextName } },
                    { path: '/profile/update', method: 'PATCH', body: { name: nextName } }
                ], { auth: true });

                const updated = data?.user || data;
                if (updated) {
                    state.user = normalizeUser(updated);
                    persistUser(state.user);
                }

                renderCommonUserState();
                // Close the edit modal without relying on page-scoped toggleModal
                try {
                    const modal = document.getElementById('profile-edit-modal');
                    if (modal) {
                        modal.setAttribute('hidden', '');
                        document.body.style.overflow = '';
                    }
                } catch (err) {
                    // ignore
                }
                showToast('Profile updated successfully.', 'success');
            });
        });
    }
}

function initSupportPage() {
    renderCommonUserState();
}

async function completeRewardFlow({ taskId, title, message, points, type, requestVariants = null }) {
    if (taskId && isTaskCompleted(taskId)) {
        showToast("This reward is already claimed today.", "warning");
        return;
    }

    const xpBeforeReward = computeLifetimeXp();
    let serverActivityHandled = false;
    let responseData = null;

    try {
        if (requestVariants?.length) {
            const data = await requestVariantsLoop(requestVariants);
            responseData = data;
            if (data?.user) {
                state.user = normalizeUser(data.user);
                persistUser(state.user);
            }
            if (data?.history?.length || data?.transactions?.length || data?.activityEntry) {
                syncActivityState(data.history || data.transactions || [data.activityEntry], { replace: true });
                serverActivityHandled = true;
            }
        } else {
            const data = await requestFirst([
                { path: "/add-points", method: "POST", body: { source: type, taskId, points, title, message } }
            ], { auth: true });
            responseData = data;

            if (data?.user) {
                state.user = normalizeUser(data.user);
                persistUser(state.user);
            }
            if (data?.history?.length || data?.transactions?.length || data?.activityEntry) {
                syncActivityState(data.history || data.transactions || [data.activityEntry], { replace: true });
                serverActivityHandled = true;
            }
        }
    } catch (err) {
        const errMsg = String(err?.message || err || '').toLowerCase();
        const isAlreadyClaimed = /already claimed/.test(errMsg) || err?.status === 409 || err?.statusCode === 409;
        if (isAlreadyClaimed) {
            // Treat as success: mark locally and update UI without crediting again.
            if (taskId) {
                try { markTaskCompleted(taskId); } catch (_) { }
            }
            renderCommonUserState();
            showToast('This reward is already claimed.', 'warning');
            return;
        }

        throw err;
    }

    if (taskId) {
        markTaskCompleted(taskId);
    }

    if (!serverActivityHandled) {
        applyLocalRewardCredit({ points, source: type });
        createWalletEntry({
            title,
            message,
            amount: points,
            type,
            direction: "credit",
            status: "completed",
            taskId
        });
    }

    if (serverActivityHandled) {
        ensureRewardXpCredit(xpBeforeReward, points);
    }

    const dailyGoalBonus = responseData?.dailyGoalBonus || null;
    const totalRewardPoints = numberFrom(points, 0) + numberFrom(dailyGoalBonus?.points, 0);

    // Check for streak bonus milestone in the updated activity list
    const recentStreakEntry = state.activity.find(entry =>
        String(entry.taskId || "").startsWith("daily-streak-") &&
        (Date.now() - toTimestamp(entry.time)) < 15000
    );

    const milestoneDays = recentStreakEntry ? Number(recentStreakEntry.taskId.split('-').pop()) : 0;

    pushNotification({
        title: "Reward added",
        message: `${title}: ${points} points credited.`,
        type
    });

    if (dailyGoalBonus) {
        pushNotification({
            title: "Daily goal bonus",
            message: dailyGoalBonus.message || `Daily goal completed. ${dailyGoalBonus.points} points credited.`,
            type: "task"
        });
        showToast(`Daily goal bonus unlocked: +${formatNumber(numberFrom(dailyGoalBonus.points, 0))} points.`, "success");
    }

    renderCommonUserState();
    playRewardSound();
    showRewardPopup({
        icon: "🎉",
        title: dailyGoalBonus ? "Daily goal bonus unlocked!" : "Reward received",
        message: dailyGoalBonus?.message
            ? `${message || "Your account has been updated."} ${dailyGoalBonus.message}`
            : (message || "Your account has been updated."),
        value: dailyGoalBonus
            ? `${formatNumber(points)} + ${formatNumber(dailyGoalBonus.points)} = ${formatNumber(totalRewardPoints)} Points`
            : `${formatNumber(totalRewardPoints)} Points`
    });

    if (Array.isArray(responseData?.levelRewards) && responseData.levelRewards.length) {
        const levelBonus = responseData.levelRewards.reduce((sum, item) => sum + numberFrom(item.points, 0), 0);
        showToast(`Level up bonus unlocked: +${formatNumber(levelBonus)} points.`, "success");
    }
}

function ensureRewardXpCredit(previousXp, points) {
    const rewardPoints = Math.max(0, Math.floor(numberFrom(points, 0)));
    if (!state.user || rewardPoints <= 0) {
        return;
    }

    const currentXp = Math.max(numberFrom(state.user.lifetimeXp, 0), computeLifetimeXp());
    const expectedXp = Math.max(currentXp, numberFrom(previousXp, 0) + rewardPoints);

    if (expectedXp > currentXp) {
        state.user.lifetimeXp = expectedXp;
        persistUser(state.user);
    }
}

async function requestVariantsLoop(variants) {
    let lastError = null;

    for (const variant of variants) {
        try {
            return await requestJson(variant.path, {
                method: variant.method,
                body: variant.body,
                auth: true
            });
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error("Request failed.");
}

async function fetchDashboardPayload() {
    try {
        const data = await requestFirst([
            { path: "/dashboard", method: "GET" },
            { path: "/user/dashboard", method: "GET" }
        ], { auth: true });

        if (data?.user) {
            state.user = normalizeUser(data.user);
            persistUser(state.user);
        }

        const mergedHistory = syncActivityState(data?.history || data?.transactions || [], { replace: true });
        const taskStats = buildTaskStats();
        const surveyStats = buildSurveyStats();

        return {
            stats: {
                points: state.user?.points || 0,
                referralEarnings: numberFrom(data?.stats?.referralEarnings, state.user?.referralEarnings, 0),
                taskRewards: Math.max(numberFrom(data?.stats?.taskRewards, 0), taskStats.earnedPoints),
                surveyEarnings: Math.max(numberFrom(data?.stats?.surveyEarnings, 0), surveyStats.earnedPoints)
            },
            history: mergedHistory.sort((a, b) => toTimestamp(b.time) - toTimestamp(a.time))
        };
    } catch (error) {
        const taskStats = buildTaskStats();
        const surveyStats = buildSurveyStats();
        return {
            stats: {
                points: state.user?.points || 0,
                referralEarnings: numberFrom(state.user?.referralEarnings, 0),
                taskRewards: taskStats.earnedPoints,
                surveyEarnings: surveyStats.earnedPoints
            },
            history: [...state.activity].sort((a, b) => toTimestamp(b.time) - toTimestamp(a.time))
        };
    }
}

function renderPaginatedList({
    container,
    records,
    emptyMessage,
    emptyIcon = "ri-history-line",
    renderItem,
    initialCount = 10,
    stepCount = 15,
    buttonLabel = "Show All",
    listKey = "",
    afterRender
}) {
    if (!container) {
        return;
    }

    if (!records.length) {
        container.innerHTML = emptyStateMarkup(emptyIcon, emptyMessage);
        container.dataset.visibleCount = "";
        return;
    }

    const total = records.length;
    const key = listKey || container.id || "";
    const previousKey = container.dataset.listKey || "";
    const storedCount = Number(container.dataset.visibleCount);
    const shouldReset = !Number.isFinite(storedCount) || storedCount <= 0 || (key && previousKey && key !== previousKey);
    const baseCount = shouldReset ? initialCount : storedCount;
    const visibleCount = Math.min(Math.max(baseCount, initialCount), total);

    if (key) {
        container.dataset.listKey = key;
    }
    container.dataset.visibleCount = String(visibleCount);

    const visibleRecords = records.slice(0, visibleCount);
    const listMarkup = visibleRecords.map((item, index) => renderItem(item, index)).join("");
    const showMoreMarkup = total > visibleCount
        ? `
            <div class="show-more-row">
                <button type="button" class="btn-primary--ghost show-more-btn">${buttonLabel}</button>
                <div class="show-more-meta">Showing ${visibleCount} of ${total}</div>
            </div>
        `
        : "";

    container.innerHTML = listMarkup + showMoreMarkup;

    if (typeof afterRender === "function") {
        afterRender({
            container,
            records,
            visibleRecords,
            visibleCount,
            total
        });
    }

    if (total > visibleCount) {
        const button = container.querySelector(".show-more-btn");
        button?.addEventListener("click", () => {
            const nextCount = Math.min(visibleCount + stepCount, total);
            container.dataset.visibleCount = String(nextCount);
            renderPaginatedList({
                container,
                records,
                emptyMessage,
                renderItem,
                initialCount,
                stepCount,
                buttonLabel,
                listKey: key,
                afterRender
            });
        });
    }
}

function renderHistoryList(container, records, emptyMessage, options = {}) {
    const timeStyle = options.timeStyle || "long";
    const variant = options.variant || "default";
    renderPaginatedList({
        container,
        records,
        emptyMessage,
        emptyIcon: options.emptyIcon || "ri-history-line",
        renderItem: (entry) => historyMarkup(entry, { timeStyle, variant }),
        initialCount: numberFrom(options.initialCount, 10),
        stepCount: numberFrom(options.stepCount, 15),
        buttonLabel: options.buttonLabel || "Show All",
        listKey: options.listKey || ""
    });
}

function historyIconForEntry(entry) {
    const type = String(entry?.type || "").toLowerCase();
    switch (type) {
        case "spin":
            return "ri-refresh-line";
        case "task":
            return "ri-task-line";
        case "survey":
            return "ri-file-list-3-line";
        case "referral":
            return "ri-user-add-line";
        case "convert":
            return "ri-exchange-funds-line";
        case "recharge":
            return "ri-smartphone-line";
        default:
            return "ri-history-line";
    }
}

function historyMarkup(entry, options = {}) {
    const sign = entry.direction === "debit" ? "-" : "+";
    const amountClass = entry.direction === "debit" ? "warning" : "success";
    const timeStyle = options.timeStyle === "relative" ? "relative" : "long";
    const timeText = timeStyle === "relative" ? formatRelative(entry.time) : formatLongDate(entry.time);
    const longTime = formatLongDate(entry.time);
    const variant = options.variant || "default";

    if (variant === "compact") {
        const usesTokens = entry.type === "convert" || entry.type === "recharge";
        const amountSuffix = usesTokens ? " Tokens" : " pts";
        const amountText = `${sign}${formatDecimal(entry.amount)}${amountSuffix}`;
        const title = escapeHtml(entry.title || "Activity");
        const iconClass = historyIconForEntry(entry);

        return `
            <article class="history-row history-row--compact history-row--${escapeHtml(amountClass)}">
                <div class="history-icon history-icon--${escapeHtml(amountClass)}" aria-hidden="true">
                    <i class="${escapeHtml(iconClass)}"></i>
                </div>
                <div class="history-main">
                    <div class="history-title">
                        <span class="history-label">${title}</span>
                        <span class="history-amount ${amountClass}">${escapeHtml(amountText)}</span>
                    </div>
                    <div class="history-time" title="${escapeHtml(longTime)}">${escapeHtml(timeText)}</div>
                </div>
            </article>
        `;
    }

    return `
        <article class="history-row">
            <div class="history-main">
                <div class="history-title">${escapeHtml(entry.title)}</div>
                <div class="history-body">${escapeHtml(entry.message || "Account activity update")}</div>
                <div class="history-time" title="${escapeHtml(longTime)}">${escapeHtml(timeText)}</div>
            </div>
            <div class="history-side">
                <div class="status-pill ${amountClass}">${sign}${formatDecimal(entry.amount)}${entry.type === "convert" || entry.type === "recharge" ? "" : " pts"}</div>
                <div class="meta-text history-status">${escapeHtml(capitalize(entry.status || "completed"))}</div>
            </div>
        </article>
    `;
}

function buildTaskStats() {
    const taskEntries = state.activity.filter((entry) => entry.type === "task" || entry.type === "spin");
    return {
        completedCount: taskEntries.length,
        earnedPoints: taskEntries.reduce((sum, item) => sum + numberFrom(item.amount, 0), 0)
    };
}

function formatStreakDays(value) {
    const count = Math.max(0, Math.floor(numberFrom(value, 0)));
    const unit = count === 1 ? "day" : "days";
    return `${formatNumber(count)} ${unit}`;
}

function computeTaskStreakDays(taskId) {
    const id = String(taskId || "").trim();
    if (!id) {
        return 0;
    }

    const dayFormatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: INDIA_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });

    const acceptedTaskIds = new Set([id]);
    if (id === "daily-login" || id === "daily-checkin") {
        acceptedTaskIds.add("daily-login");
        acceptedTaskIds.add("daily-checkin");
    }

    const dayKeys = new Set(
        state.activity
            .filter((entry) => entry?.type === "task" && acceptedTaskIds.has(String(entry.taskId || "").trim()))
            .map((entry) => {
                const ts = toTimestamp(entry.time);
                if (!ts) {
                    return "";
                }
                return dayFormatter.format(new Date(ts));
            })
            .filter(Boolean)
    );

    let streak = 0;
    let cursor = new Date();
    const todayStr = dayFormatter.format(cursor);

    const tempCursor = new Date();
    tempCursor.setDate(tempCursor.getDate() - 1);
    const yesterdayStr = dayFormatter.format(tempCursor);

    // If not done today AND not done yesterday, streak is broken.
    if (!dayKeys.has(todayStr) && !dayKeys.has(yesterdayStr)) {
        return 0;
    }

    // If not done today yet, start counting from yesterday backwards to keep current count visible
    if (!dayKeys.has(todayStr)) {
        cursor.setDate(cursor.getDate() - 1);
    }

    while (dayKeys.has(dayFormatter.format(cursor))) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
    }

    return streak;
}

function buildSurveyStats() {
    const surveyEntries = state.activity.filter((entry) => entry.type === "survey");
    return {
        completedCount: surveyEntries.length,
        earnedPoints: surveyEntries.reduce((sum, item) => sum + numberFrom(item.amount, 0), 0)
    };
}

function computeLifetimeXp() {
    const directXp = numberFrom(state.user?.lifetimeXp, 0);
    if (directXp > 0) {
        return directXp;
    }

    return state.activity.reduce((sum, item) => {
        const entryType = String(item?.type || "").toLowerCase();
        if (entryType === "convert" || entryType === "level") {
            return sum;
        }

        const amount = numberFrom(item.amount, 0);
        if (amount <= 0 || String(item?.direction || "").toLowerCase() === "debit") {
            return sum;
        }

        return sum + amount;
    }, 0);
}

function getLevelUpBonusPoints(level) {
    const targetLevel = Math.max(2, Math.floor(numberFrom(level, 2)));
    return 150 + ((targetLevel - 2) * 25);
}

function getXpThreshold(level) {
    const thresholds = [0, 1000, 3000, 7000, 15000];
    if (level <= thresholds.length) {
        return thresholds[level - 1];
    }

    let threshold = thresholds[thresholds.length - 1];
    let increment = 8000;
    for (let nextLevel = thresholds.length + 1; nextLevel <= level; nextLevel += 1) {
        increment = Math.round(increment * 1.9);
        threshold += increment;
    }
    return threshold;
}

function getXpLevel(xp) {
    let level = 1;
    while (xp >= getXpThreshold(level + 1)) {
        level += 1;
    }

    const currentThreshold = getXpThreshold(level);
    const nextThreshold = getXpThreshold(level + 1);
    const progress = clamp((xp - currentThreshold) / Math.max(1, nextThreshold - currentThreshold) * 100, 0, 100);

    return {
        xp,
        level,
        currentThreshold,
        nextThreshold,
        progress: Math.round(progress)
    };
}

function renderLifetimeXp() {
    const xp = computeLifetimeXp();
    const { level, currentThreshold, nextThreshold, progress } = getXpLevel(xp);
    const nextRewardPoints = getLevelUpBonusPoints(level + 1);

    window.__anviLifetimeXp = xp;
    window.dispatchEvent(new CustomEvent("anvi:lifetime-xp-updated", {
        detail: {
            xp,
            level,
            currentThreshold,
            nextThreshold,
            progress,
            nextRewardPoints
        }
    }));
}

function hydratePersistedUser() {
    const cached = readStore(STORAGE_KEYS.user, null);
    if (!cached) {
        return null;
    }

    return normalizeUser(cached);
}

state.user = hydratePersistedUser();

function createWalletEntry(entry) {
    const normalized = normalizeActivityItem({
        id: `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        title: entry.title,
        message: entry.message,
        amount: numberFrom(entry.amount, 0),
        type: entry.type || "wallet",
        direction: entry.direction || "credit",
        status: entry.status || "completed",
        time: new Date().toISOString(),
        taskId: entry.taskId || ""
    });

    state.activity = [normalized, ...state.activity].slice(0, 30);
    persistActivity();
}

function applyLocalRewardCredit({ points = 0, source = "task" } = {}) {
    const amount = Math.max(0, Math.floor(numberFrom(points, 0)));
    if (!state.user || amount <= 0) {
        return;
    }

    state.user.points = numberFrom(state.user.points, 0) + amount;
    state.user.lifetimeXp = numberFrom(state.user.lifetimeXp, 0) + amount;

    if (source === "survey") {
        state.user.surveyEarnings = numberFrom(state.user.surveyEarnings, 0) + amount;
    } else if (source === "referral") {
        state.user.referralEarnings = numberFrom(state.user.referralEarnings, 0) + amount;
    } else if (source === "task" || source === "spin") {
        state.user.taskEarnings = numberFrom(state.user.taskEarnings, 0) + amount;
    }

    persistUser(state.user);
}

function pushNotification(notification) {
    const normalized = normalizeNotificationItem({
        id: `noti-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        title: notification.title,
        message: notification.message,
        type: notification.type || "system",
        unread: true,
        time: new Date().toISOString()
    });

    state.notifications = mergeNotifications([normalized], state.notifications);
    persistNotifications();
}

function showToast(message, type = "success") {
    const stack = document.querySelector(".app-toast-stack");
    if (!stack) {
        return;
    }

    const toast = document.createElement("div");
    toast.className = `app-toast ${type}`;
    toast.textContent = message;
    stack.appendChild(toast);

    window.setTimeout(() => {
        toast.remove();
    }, 3200);
}

function showRewardPopup({ icon, title, message, value, buttonLabel = "Continue" }) {
    const modal = document.querySelector(".reward-modal");
    if (!modal) {
        return;
    }

    setText("reward-icon", icon || "🎉");
    setText("reward-title", title || "Reward unlocked");
    setText("reward-message", message || "Your action completed successfully.");
    setText("reward-value", value || "Updated");

    const btn = document.getElementById("reward-close-btn");
    if (btn) btn.textContent = buttonLabel;

    modal.hidden = false;
}

function hideRewardPopup() {
    const modal = document.querySelector(".reward-modal");
    if (modal) {
        modal.hidden = true;
    }
}

function showDeleteAccountFlow() {
    const modal = document.querySelector(".danger-confirm-modal");
    if (!modal) {
        return Promise.resolve(window.confirm("Schedule this account for permanent deletion after 7 days?"));
    }

    if (deleteAccountFlowResolver) {
        closeDeleteAccountFlow(false);
    } else {
        closeDeleteAccountFlow(false, { silent: true });
    }

    deleteAccountFlowStep = 0;
    syncDeleteAccountModal();
    modal.hidden = false;
    document.body.classList.add("modal-open");

    window.setTimeout(() => {
        document.getElementById("danger-confirm-confirm")?.focus();
    }, 10);

    return new Promise((resolve) => {
        deleteAccountFlowResolver = resolve;
    });
}

function syncDeleteAccountModal() {
    const step = DELETE_ACCOUNT_FLOW_STEPS[deleteAccountFlowStep] || DELETE_ACCOUNT_FLOW_STEPS[0];
    const pointsContainer = document.getElementById("danger-confirm-points");
    const ackWrap = document.getElementById("danger-confirm-ack-wrap");
    const ackInput = document.getElementById("danger-confirm-ack");
    const progress = document.getElementById("danger-confirm-progress");
    const confirmButton = document.getElementById("danger-confirm-confirm");

    setText("danger-confirm-badge", step.badge);
    setText("danger-confirm-title", step.title);
    setText("danger-confirm-message", step.message);
    setText("danger-confirm-ack-label", step.acknowledgement || "I understand this action cannot be undone.");

    if (pointsContainer) {
        pointsContainer.innerHTML = step.points.map((item) => `
            <div class="danger-confirm-point">
                <i class="ri-alert-line"></i>
                <span>${escapeHtml(item)}</span>
            </div>
        `).join("");
    }

    if (progress) {
        progress.innerHTML = DELETE_ACCOUNT_FLOW_STEPS.map((_, index) => `
            <span class="danger-confirm-dot ${index <= deleteAccountFlowStep ? "active" : ""}"></span>
        `).join("");
    }

    if (ackWrap && ackInput) {
        ackWrap.hidden = !step.acknowledgement;
        ackInput.checked = false;
    }

    if (confirmButton) {
        confirmButton.textContent = step.confirmLabel;
    }

    syncDeleteAccountConfirmButton();
}

function syncDeleteAccountConfirmButton() {
    const step = DELETE_ACCOUNT_FLOW_STEPS[deleteAccountFlowStep] || DELETE_ACCOUNT_FLOW_STEPS[0];
    const ackInput = document.getElementById("danger-confirm-ack");
    const confirmButton = document.getElementById("danger-confirm-confirm");

    if (!confirmButton) {
        return;
    }

    confirmButton.disabled = Boolean(step.acknowledgement) && !ackInput?.checked;
}

function advanceDeleteAccountFlow() {
    if (deleteAccountFlowStep < DELETE_ACCOUNT_FLOW_STEPS.length - 1) {
        deleteAccountFlowStep += 1;
        syncDeleteAccountModal();
        return;
    }

    closeDeleteAccountFlow(true);
}

function closeDeleteAccountFlow(result, options = {}) {
    const modal = document.querySelector(".danger-confirm-modal");
    if (modal) {
        modal.hidden = true;
    }

    document.body.classList.remove("modal-open");
    deleteAccountFlowStep = 0;

    if (!options.silent && deleteAccountFlowResolver) {
        const resolver = deleteAccountFlowResolver;
        deleteAccountFlowResolver = null;
        resolver(Boolean(result));
        return;
    }

    if (options.silent) {
        deleteAccountFlowResolver = null;
    }
}

function showAccountRecoveryModal(data) {
    const modal = document.querySelector(".account-recovery-modal");
    if (!modal) {
        showToast(data?.message || "Account recovery is available.", "warning");
        return;
    }

    accountRestoreContext = {
        restoreToken: data?.restoreToken || "",
        email: data?.user?.email || data?.email || "",
        deleteAfter: data?.recovery?.deleteAfter || data?.user?.deleteAfter || "",
        recoveryWindowDays: data?.recovery?.recoveryWindowDays || 7
    };

    setText("account-recovery-email", accountRestoreContext.email || "Your account");
    setText("account-recovery-deadline", accountRestoreContext.deleteAfter
        ? formatLongDate(accountRestoreContext.deleteAfter)
        : `${accountRestoreContext.recoveryWindowDays} days from now`);
    setText("account-recovery-message", data?.message || "This account is scheduled for permanent deletion, but you can still bring it back before the deadline.");
    setText("account-recovery-note", `Restore now to keep your rewards, balance, and activity history. If you do nothing, permanent deletion happens automatically after ${accountRestoreContext.recoveryWindowDays} days.`);
    modal.hidden = false;
    document.body.classList.add("modal-open");

    window.setTimeout(() => {
        document.getElementById("account-recovery-confirm")?.focus();
    }, 10);
}

function hideAccountRecoveryModal() {
    const modal = document.querySelector(".account-recovery-modal");
    if (modal) {
        modal.hidden = true;
    }

    document.body.classList.remove("modal-open");
    accountRestoreContext = null;
}

async function restoreScheduledAccount() {
    const restoreButton = document.getElementById("account-recovery-confirm");

    if (!accountRestoreContext?.restoreToken) {
        showToast("Recovery session expired. Please login again.", "error");
        hideAccountRecoveryModal();
        return;
    }

    await withButtonState(restoreButton, "Restoring...", async () => {
        const data = await requestJson("/account/restore", {
            method: "POST",
            body: { restoreToken: accountRestoreContext.restoreToken },
            auth: false
        });

        if (data?.token) {
            storeAuthToken(data.token);
        }

        state.user = normalizeUser(data?.user || data);
        persistUser(state.user);
        hideAccountRecoveryModal();
        showToast("Account restored successfully.", "success");

        window.setTimeout(() => {
            window.location.replace("home.html");
        }, 700);
    });
}

function playRewardSound() {
    playToneSequence([
        { frequency: 523.25, duration: 0.12 },
        { frequency: 659.25, duration: 0.12 },
        { frequency: 783.99, duration: 0.18 }
    ]);
}

function playSpinSound() {
    const context = getSharedAudioContext();
    if (!context) {
        return;
    }

    playSpinWhoosh(context, 0.55);
    playToneGlide(context, {
        from: 190,
        to: 520,
        duration: 0.42,
        type: "sawtooth",
        gain: 0.05
    });
}

function startSpinTickSound(durationMs = 4800) {
    const context = getSharedAudioContext();
    if (!context) {
        return () => { };
    }

    let active = true;

    const playTick = () => {
        if (!active) return;
        playNoiseTick(context);
    };

    const interval = window.setInterval(playTick, 90);
    const stop = () => {
        if (!active) return;
        active = false;
        window.clearInterval(interval);
    };

    window.setTimeout(stop, durationMs + 200);
    return stop;
}

function playToneSequence(steps) {
    const context = getSharedAudioContext();
    if (!context) {
        return;
    }
    const now = context.currentTime;

    steps.forEach((step, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = now + index * 0.08;

        oscillator.type = "triangle";
        oscillator.frequency.value = step.frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.08, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + step.duration);

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start(start);
        oscillator.stop(start + step.duration + 0.02);
    });
}

function playStreakMilestoneSound() {
    const context = getSharedAudioContext();
    if (!context) return;
    const now = context.currentTime;

    // High-pitched celebratory arpeggio
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
        const osc = context.createOscillator();
        const gain = context.createGain();
        const start = now + (i * 0.08);
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
        osc.connect(gain).connect(context.destination);
        osc.start(start);
        osc.stop(start + 0.5);
    });
}

function triggerConfetti() {
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '10001';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const pieces = [];
    const colors = ['#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#3b82f6'];

    for (let i = 0; i < 150; i++) {
        pieces.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            r: Math.random() * 6 + 4,
            v: { x: (Math.random() - 0.5) * 6, y: Math.random() * 4 + 3 },
            color: colors[Math.floor(Math.random() * colors.length)]
        });
    }

    function frame() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        pieces.forEach(p => {
            p.x += p.v.x;
            p.y += p.v.y;
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, p.r, p.r);
        });
        if (pieces.some(p => p.y < canvas.height)) requestAnimationFrame(frame);
        else canvas.remove();
    }
    frame();
}

let sharedAudioContext = null;

function getSharedAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
        return null;
    }

    if (!sharedAudioContext || sharedAudioContext.state === "closed") {
        sharedAudioContext = new AudioContextClass();
    }

    void sharedAudioContext.resume().catch(() => { });
    return sharedAudioContext;
}

function playSpinWhoosh(context, durationSec = 0.55) {
    const buffer = createNoiseBuffer(context, durationSec);
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const now = context.currentTime;

    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(320, now);
    filter.frequency.exponentialRampToValueAtTime(1400, now + durationSec * 0.7);
    filter.Q.setValueAtTime(0.9, now);
    filter.Q.linearRampToValueAtTime(2.2, now + durationSec);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.085, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);

    source.start(now);
    source.stop(now + durationSec + 0.02);
}

function playToneGlide(context, { from = 220, to = 520, duration = 0.35, type = "triangle", gain = 0.06 } = {}) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const now = context.currentTime;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);

    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(envelope);
    envelope.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
}

function playNoiseTick(context) {
    const durationSec = 0.03;
    const buffer = createNoiseBuffer(context, durationSec);
    const source = context.createBufferSource();
    const highpass = context.createBiquadFilter();
    const gain = context.createGain();
    const now = context.currentTime;

    source.buffer = buffer;
    highpass.type = "highpass";
    highpass.frequency.setValueAtTime(900, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    source.connect(highpass);
    highpass.connect(gain);
    gain.connect(context.destination);
    source.start(now);
    source.stop(now + durationSec + 0.01);
}

function createNoiseBuffer(context, durationSec) {
    const length = Math.max(1, Math.floor(context.sampleRate * durationSec));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
        // Subtle decay to avoid harsh constant noise.
        const decay = 1 - i / length;
        data[i] = (Math.random() * 2 - 1) * decay;
    }
    return buffer;
}

async function withButtonState(button, busyLabel, callback) {
    if (!button) {
        await callback();
        return;
    }

    const originalText = button.textContent;
    const supportsDisabled = "disabled" in button;
    const originalPointerEvents = button.style.pointerEvents;
    const originalAriaDisabled = button.getAttribute("aria-disabled");
    if (supportsDisabled) {
        button.disabled = true;
    } else {
        button.setAttribute("aria-disabled", "true");
        button.style.pointerEvents = "none";
    }
    button.textContent = busyLabel;

    try {
        await callback();
    } catch (error) {
        showToast(error.message || "Something went wrong.", "error");
    } finally {
        if (button.dataset.locked === "true") {
            if (supportsDisabled) {
                button.disabled = true;
            } else {
                button.setAttribute("aria-disabled", "true");
                button.style.pointerEvents = "none";
            }
            button.textContent = button.dataset.lockedLabel || originalText;
        } else {
            if (supportsDisabled) {
                button.disabled = false;
            } else {
                if (originalAriaDisabled === null) {
                    button.removeAttribute("aria-disabled");
                } else {
                    button.setAttribute("aria-disabled", originalAriaDisabled);
                }
                button.style.pointerEvents = originalPointerEvents;
            }
            button.textContent = originalText;
        }
    }
}

async function requestFirst(variants, options = {}) {
    const records = Array.isArray(variants) ? variants : [];
    const auth = options.auth !== false;

    let lastError = null;

    for (const variant of records) {
        const path = String(variant?.path || "").trim();
        if (!path) {
            continue;
        }

        try {
            return await requestJson(path, {
                method: variant.method || "GET",
                body: variant.body,
                auth
            });
        } catch (error) {
            lastError = error;

            // Auth failures shouldn't fall through to other endpoints.
            const status = Number(error?.status || error?.statusCode || 0);
            if (status === 401 || status === 403) {
                throw error;
            }
        }
    }

    throw lastError || new Error("Request failed.");
}

async function requestJson(path, { method = "GET", body, auth = true } = {}) {
    const headers = {
        Accept: "application/json"
    };

    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
    }

    const token = auth ? getSafeToken() : "";
    if (auth && token) {
        headers.Authorization = `Bearer ${token}`;
    }

    let response;
    const makeUrl = (base) => `${base}${API_PREFIX}${path.startsWith("/") ? "" : "/"}${path}`;
    const url = makeUrl(activeApiBase);
    const requestKey = method === "GET" && body === undefined
        ? `${method}:${url}:${auth ? token : ""}`
        : "";

    if (DEBUG_LOGS) {
        console.log(`🔗 API Call: ${method} ${url}`);
    }

    if (requestKey && inflightRequests.has(requestKey)) {
        return inflightRequests.get(requestKey);
    }
    const fetchPromise = (async () => {
        let timer = null;
        let controller = null;
        const isLocalBase = /localhost|127\.0\.0\.1/i.test(activeApiBase);
        const timeoutMs = isLocalBase ? 2500 : 12000;

        try {
            controller = new AbortController();
            timer = window.setTimeout(() => controller.abort(), timeoutMs);

            response = await fetch(url, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });
        } catch (networkError) {
            console.error("❌ FAILED TO FETCH:", url);
            console.error("❌ Error:", networkError.message);

            // If local backend is down/hanging, retry once on remote for this session.
            if (isLocalDev && /localhost|127\.0\.0\.1/i.test(activeApiBase)) {
                try {
                    activeApiBase = normalizeApiBase(API_BASE_FALLBACK_REMOTE);
                    const retryController = new AbortController();
                    const retryTimer = window.setTimeout(() => retryController.abort(), 12000);
                    response = await fetch(makeUrl(activeApiBase), {
                        method,
                        headers,
                        body: body !== undefined ? JSON.stringify(body) : undefined,
                        signal: retryController.signal
                    });
                    window.clearTimeout(retryTimer);
                } catch (_) {
                    // Ignore, fall through.
                }
            }

            if (!response) {
                if (networkError?.name === "AbortError") {
                    throw new Error("Request timed out. Please try again.");
                }
                console.error("💡 Make sure the backend server is running and reachable.");
                throw new Error("Server unreachable. Is backend running? (" + String(networkError?.message || "") + ")");
            }
        } finally {
            if (timer) {
                window.clearTimeout(timer);
            }
        }
        const contentType = response.headers.get("content-type") || "";
        const payload = contentType.includes("application/json")
            ? await response.json().catch(() => null)
            : await response.text().catch(() => "");

        if (!response.ok) {
            // If local backend is unavailable, retry once on remote for this session.
            if (response.status === 503 && isLocalDev && /localhost|127\.0\.0\.1/i.test(activeApiBase)) {
                try {
                    activeApiBase = normalizeApiBase(API_BASE_FALLBACK_REMOTE);
                    return await requestJson(path, { method, body, auth });
                } catch (_) {
                    // Ignore, fall through to error handling below.
                }
            }

            const message = typeof payload === "object" && payload?.message
                ? payload.message
                : `Request failed with status ${response.status}.`;
            const error = new Error(message);
            error.status = response.status;
            if (typeof payload === "object" && payload) {
                error.code = payload.code;
                error.recovery = payload.recovery;
            }
            throw error;
        }

        return payload;
    })();

    if (requestKey) {
        inflightRequests.set(requestKey, fetchPromise);
    }

    try {
        return await fetchPromise;
    } finally {
        if (requestKey) {
            inflightRequests.delete(requestKey);
        }
    }
}

function logout() {
    Object.values(STORAGE_KEYS).forEach((key) => {
        localStorage.removeItem(key);
    });
    state.token = "";
    state.user = null;
    state.activity = [];
    state.notifications = [];
    state.notificationReads = {};
    window.location.replace("index.html");
}

function redirectToLogin() {
    window.location.replace("index.html");
}


function readStore(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        return fallback;
    }
}

function persistUser(user) {
    state.user = normalizeUser(user);
    try {
        localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(state.user));
    } catch (error) {
        // Ignore storage failures; server state remains the source of truth.
    }
    syncUserLocalCache(state.user);
}

function syncUserLocalCache(user) {
    if (!user) {
        return;
    }

    const userKey = String(user.id || user.email || "").trim().toLowerCase();
    if (!userKey) {
        return;
    }

    try {
        const previous = localStorage.getItem(STORAGE_KEYS.activeUser) || "";
        if (previous && previous !== userKey) {
            localStorage.removeItem(STORAGE_KEYS.notifications);
            localStorage.removeItem(STORAGE_KEYS.notificationReads);
            localStorage.removeItem(STORAGE_KEYS.activity);
            localStorage.removeItem(STORAGE_KEYS.tasks);
            localStorage.removeItem(STORAGE_KEYS.watchState);
            localStorage.removeItem(STORAGE_KEYS.referralSeenCount);
            localStorage.removeItem(STORAGE_KEYS.user);
            state.notifications = [];
            state.notificationReads = {};
            state.activity = [];
            updateSidebarUnreadBadge(0);
        }

        localStorage.setItem(STORAGE_KEYS.activeUser, userKey);
    } catch (error) {
        // Ignore storage errors (private mode, quota, etc.)
    }
}

function persistNotifications(list = state.notifications) {
    const normalized = normalizeNotifications(Array.isArray(list) ? list : []);
    const pruned = pruneNotifications(normalized);
    const merged = applyNotificationReadState(pruned);
    state.notificationReads = syncNotificationReadsFromList(pruneNotificationReads(state.notificationReads), merged);
    state.notifications = merged;
    localStorage.setItem(STORAGE_KEYS.notifications, JSON.stringify(state.notifications.slice(0, NOTIFICATION_MAX_STORED)));
    localStorage.setItem(STORAGE_KEYS.notificationReads, JSON.stringify(state.notificationReads));
    updateSidebarUnreadBadge();
}

function persistActivity() {
    localStorage.setItem(STORAGE_KEYS.activity, JSON.stringify(state.activity.slice(0, 40)));
}

function activityDedupKey(item) {
    return [
        item.taskId || "",
        item.type || "",
        item.title || "",
        item.message || "",
        numberFrom(item.amount, 0),
        toTimestamp(item.time)
    ].join(":");
}

function syncActivityState(records, { replace = false } = {}) {
    const normalized = normalizeActivity(records || []);
    const merged = replace
        ? normalized
        : uniqueByKey([...normalized, ...state.activity], activityDedupKey)
            .sort((a, b) => toTimestamp(b.time) - toTimestamp(a.time));

    state.activity = merged.slice(0, 40);
    persistActivity();
    return state.activity;
}

function normalizeUser(user) {
    if (!user) {
        return null;
    }

    const existingReferralCode = state.user?.referralCode || "";

    const referralCode = String(user.referralCode || user.refCode || user.myReferCode || existingReferralCode || "").trim().toUpperCase();

    return {
        id: user.id || user._id || "",
        name: user.name || user.fullName || user.userName || "AnviPayz User",
        email: user.email || "",
        phone: user.phone || user.mobile || user.phoneNumber || "",
        points: numberFrom(user.points, user.balance, user.walletPoints, 0),
        lifetimeXp: Math.max(
            numberFrom(user.lifetimeXp, user.totalLifetimeXp, 0),
            numberFrom(state.user?.lifetimeXp, 0)
        ),
        tokens: roundTo(numberFrom(user.tokens, user.tokenBalance, user.walletTokens, 0), 2),
        referrals: numberFrom(user.referrals, user.totalReferrals, user.referralCount, 0),
        referralEarnings: numberFrom(user.referralEarnings, user.referIncome, user.referralIncome, 0),
        taskEarnings: numberFrom(user.taskEarnings, user.taskRewards, user.taskIncome, 0),
        surveyEarnings: numberFrom(user.surveyEarnings, user.surveyIncome, 0),
        joinedAt: user.joinedAt || user.createdAt || user.registeredAt || new Date().toISOString(),
        referralCode,
        accountStatus: user.accountStatus || "active",
        lastDailyLoginRewardAt: user.lastDailyLoginRewardAt || null,
        deletionRequestedAt: user.deletionRequestedAt || null,
        deleteAfter: user.deleteAfter || null,
        recoveryWindowDays: numberFrom(user.recoveryWindowDays, 7)
    };
}

function normalizeTaskList(tasks) {
    return (Array.isArray(tasks) ? tasks : []).map((task) => ({
        id: task.id || task._id || `task-${Math.random().toString(16).slice(2, 7)}`,
        title: task.title || "Task",
        description: task.description || task.desc || "",
        rewardPoints: numberFrom(task.rewardPoints, task.points, task.reward, 0),
        taskType: task.taskType || task.type || "task",
        completed: boolFrom(task.completed),
        link: task.link || task.url || "",
        seedKey: task.seedKey || "",
        questions: Array.isArray(task.questions)
            ? task.questions
            : (typeof task.questions === "string" ? safeJsonParse(task.questions, []) : []),
        questionCount: Array.isArray(task.questions)
            ? task.questions.length
            : (typeof task.questions === "string" ? (safeJsonParse(task.questions, []) || []).length : 0)
    }));
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

function normalizeNotifications(list) {
    return (Array.isArray(list) ? list : []).map(normalizeNotificationItem);
}

function hashString32(value) {
    const raw = String(value || "");
    let hash = 2166136261;
    for (let i = 0; i < raw.length; i += 1) {
        hash ^= raw.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function stableNotificationId(item) {
    const existing = String(item?.id || item?._id || "").trim();
    if (existing) {
        return existing;
    }

    const message = String(item?.message || item?.body || "").trim();
    const title = String(item?.title || "Notification").trim();
    const type = String(item?.type || "system").trim();
    const timestamp = toTimestamp(item?.time || item?.date || item?.createdAt || 0);
    const dayKey = timestamp ? new Date(timestamp).toISOString().slice(0, 10) : "";
    const fingerprint = `${type}|${title}|${message}|${dayKey}`;
    return `noti-${hashString32(fingerprint).toString(36)}`;
}

function normalizeNotificationItem(item) {
    const message = item.message || item.body || "";
    return {
        id: stableNotificationId(item),
        title: normalizeDisplayTitle(item.title, {
            fallback: "Notification",
            type: item.type,
            message
        }),
        message,
        type: item.type || "system",
        unread: item.unread !== undefined ? Boolean(item.unread) : item.read !== undefined ? !Boolean(item.read) : true,
        time: item.time || item.date || item.createdAt || new Date().toISOString()
    };
}

function pruneNotificationReads(readMap) {
    const map = readMap && typeof readMap === "object" ? readMap : {};
    const now = Date.now();
    const next = {};
    for (const [id, value] of Object.entries(map)) {
        const timestamp = toTimestamp(value);
        if (timestamp && (now - timestamp) <= NOTIFICATION_RETENTION_MS) {
            next[id] = timestamp;
        }
    }
    return next;
}

function pruneNotifications(list) {
    const now = Date.now();
    return (Array.isArray(list) ? list : [])
        .filter((item) => {
            const timestamp = toTimestamp(item?.time);
            if (!timestamp) {
                return true;
            }
            return (now - timestamp) <= NOTIFICATION_RETENTION_MS;
        })
        .sort((a, b) => toTimestamp(b.time) - toTimestamp(a.time))
        .slice(0, NOTIFICATION_MAX_STORED);
}

function applyNotificationReadState(list) {
    const readMap = pruneNotificationReads(state.notificationReads);
    const records = Array.isArray(list) ? list : [];
    return records.map((item) => {
        const id = String(item?.id || "").trim();
        if (id && readMap[id]) {
            return { ...item, unread: false };
        }
        return item;
    });
}

function syncNotificationReadsFromList(readMap, list) {
    const map = readMap && typeof readMap === "object" ? { ...readMap } : {};
    const now = Date.now();
    (Array.isArray(list) ? list : []).forEach((item) => {
        const id = String(item?.id || "").trim();
        if (!id) {
            return;
        }
        if (item.unread === false && !map[id]) {
            map[id] = now;
        }
    });
    return map;
}

function mergeNotifications(primary, secondary) {
    const readMap = pruneNotificationReads(state.notificationReads);
    const merged = uniqueByKey([...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])], (item) => item.id)
        .map((item) => {
            const id = String(item?.id || "").trim();
            if (id && readMap[id]) {
                return { ...item, unread: false };
            }
            return item;
        });

    return pruneNotifications(merged);
}

function normalizeActivity(list) {
    return (Array.isArray(list) ? list : []).map(normalizeActivityItem)
        .sort((a, b) => toTimestamp(b.time) - toTimestamp(a.time));
}

function normalizeActivityItem(item) {
    const message = item.message || item.description || "";
    return {
        id: item.id || item._id || `act-${Math.random().toString(16).slice(2, 8)}`,
        title: normalizeDisplayTitle(item.title || item.name, {
            fallback: "Account activity",
            type: item.type,
            message
        }),
        message,
        amount: numberFrom(item.amount, item.points, item.value, 0),
        type: item.type || "wallet",
        direction: item.direction || (numberFrom(item.amount, 0) < 0 ? "debit" : "credit"),
        status: item.status || "completed",
        time: item.time || item.date || item.createdAt || new Date().toISOString(),
        taskId: item.taskId || item.taskKey || ""
    };
}

function normalizeNetwork(list) {
    return (Array.isArray(list) ? list : []).map((person) => ({
        name: person.name || person.fullName || "New referral",
        email: person.email || "",
        reward: numberFrom(person.reward, person.points, 0),
        time: person.time || person.createdAt || new Date().toISOString()
    }));
}

function isTaskCompleted(taskId) {
    const taskState = todayTaskState();
    return Boolean(taskState.completed?.[taskId]);
}

function markTaskCompleted(taskId) {
    const taskState = todayTaskState();
    taskState.completed = taskState.completed || {};
    taskState.completed[taskId] = new Date().toISOString();
    localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(taskState));
}

function todayTaskState() {
    const saved = readStore(STORAGE_KEYS.tasks, {});
    const key = todayKey();
    if (saved.date !== key) {
        return { date: key, completed: {} };
    }

    return saved;
}

function todayKey(value = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: INDIA_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date(value));
}

function normalizeDailyTaskState() {
    // Removed auto-deletion logic to keep Daily Check-in and Login separate as requested.
    return;
}

function updateTaskButton(button, taskId, doneLabel) {
    if (!button) {
        return;
    }

    if (isTaskCompleted(taskId)) {
        button.disabled = true;
        button.textContent = doneLabel;
    }
}

function emptyStateMarkup(icon, message) {
    return `
        <div class="empty-state">
            <i class="${icon}"></i>
            <p>${escapeHtml(message)}</p>
        </div>
    `;
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}

function setAllText(id, value) {
    document.querySelectorAll(`[id="${id}"]`).forEach((element) => {
        element.textContent = value;
    });
}

function formatNumber(value) {
    return Math.round(numberFrom(value, 0)).toLocaleString("en-IN");
}

function formatDecimal(value) {
    const formatted = roundTo(numberFrom(value, 0), 2).toFixed(2);
    return formatted.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function formatLongDate(value) {
    const timestamp = toTimestamp(value);
    if (!timestamp) {
        return "-";
    }

    return new Date(timestamp).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function formatRelative(value) {
    const timestamp = toTimestamp(value);
    if (!timestamp) {
        return "Just now";
    }

    const diff = Date.now() - timestamp;
    if (diff < 60 * 1000) {
        return "Just now";
    }

    if (diff < 60 * 60 * 1000) {
        return `${Math.floor(diff / (60 * 1000))}m ago`;
    }

    if (diff < 24 * 60 * 60 * 1000) {
        return `${Math.floor(diff / (60 * 60 * 1000))}h ago`;
    }

    return `${Math.floor(diff / (24 * 60 * 60 * 1000))}d ago`;
}

function initialsFromName(name) {
    return String(name || "A")
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() || "")
        .join("") || "A";
}

function firstName(name) {
    return String(name || "Member").split(" ")[0] || "Member";
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function maskEmail(email) {
    const raw = String(email || "").trim();
    if (!raw || !raw.includes("@")) {
        return raw;
    }

    const [local, domain] = raw.split("@");
    if (!local || !domain) {
        return raw;
    }

    const visibleStart = local.slice(0, Math.min(6, local.length));
    const visibleEnd = local.length > 1 ? local.slice(-1) : "";
    const dots = ".....";

    if (local.length <= 2) {
        return `${local.charAt(0) || "*"}${dots}@${domain}`;
    }

    return `${visibleStart}${dots}${visibleEnd}@${domain}`;
}

function boolFrom(value, fallback = false) {
    if (value === null || value === undefined) {
        return fallback;
    }

    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
        return value === 1;
    }

    if (typeof value === "string") {
        const raw = value.trim().toLowerCase();
        if (!raw) {
            return fallback;
        }

        if (["true", "1", "yes", "y", "done", "completed", "complete"].includes(raw)) {
            return true;
        }

        if (["false", "0", "no", "n", "pending", "incomplete", "not_completed", "not-completed"].includes(raw)) {
            return false;
        }

        return fallback;
    }

    if (typeof value === "object") {
        return fallback;
    }

    return Boolean(value);
}

function numberFrom(...values) {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number)) {
            return number;
        }
    }

    return 0;
}

function roundTo(value, digits) {
    const factor = 10 ** digits;
    return Math.round(numberFrom(value, 0) * factor) / factor;
}

function toTimestamp(value) {
    if (!value) {
        return 0;
    }

    if (typeof value === "number") {
        return value > 100_000_000_000 ? value : value * 1000;
    }

    if (typeof value === "string") {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return numeric > 100_000_000_000 ? numeric : numeric * 1000;
        }

        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    if (typeof value.toMillis === "function") {
        return value.toMillis();
    }

    if (typeof value.seconds === "number") {
        return value.seconds * 1000;
    }

    return 0;
}

function uniqueByKey(list, keyFn) {
    const seen = new Set();
    return list.filter((item) => {
        const key = keyFn(item);
        if (seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
}

function capitalize(value) {
    const raw = String(value || "");
    if (!raw) {
        return "";
    }

    return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function normalizeDisplayTitle(value, { fallback = "Item", type = "", message = "" } = {}) {
    const raw = String(value || "").trim();
    if (!raw) {
        return fallback;
    }

    const compact = raw.toLowerCase();
    const aliasMap = {
        fttr: "Reward Credit",
        rtrr: "Reward Credit"
    };
    if (aliasMap[compact]) {
        return aliasMap[compact];
    }

    const cleaned = raw
        .replace(/[_-]+/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim();

    if (/^[a-z0-9 ]+$/i.test(cleaned)) {
        const titled = cleaned
            .split(" ")
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
            .join(" ");

        if (/^[a-z]{2,5}$/i.test(raw) && /credited successfully|coins added|reward/i.test(message)) {
            return type === "survey" ? "Survey Reward" : "Reward Credit";
        }

        return titled || fallback;
    }

    return cleaned || fallback;
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
