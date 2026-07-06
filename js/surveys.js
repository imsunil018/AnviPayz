function surveyFormatNumber(value) {
    if (typeof formatNumber === "function") {
        return formatNumber(value);
    }

    const num = Number(value);
    if (!Number.isFinite(num)) {
        return "0";
    }

    return new Intl.NumberFormat("en-IN").format(num);
}

function escapeSurveyHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#39;");
}

function updateBalanceChips(points, tokens) {
    const desktopChip = document.getElementById("survey-balance-chip");
    if (desktopChip) {
        desktopChip.innerHTML = `<i class="ri-coin-fill token-badge__icon"></i><span>${surveyFormatNumber(points)} pts</span>`;
    }

    const tokenChip = document.getElementById("survey-token-chip");
    if (tokenChip) {
        tokenChip.innerHTML = `<i class="ri-wallet-3-line"></i><span>${surveyFormatNumber(tokens)} tokens</span>`;
    }

    const mobilePoints = document.getElementById("survey-balance-chip-mobile-points");
    if (mobilePoints) {
        mobilePoints.innerHTML = `<i class="ri-coin-fill"></i><span>${surveyFormatNumber(points)} pts</span>`;
    }

    const mobileTokens = document.getElementById("survey-balance-chip-mobile-tokens");
    if (mobileTokens) {
        mobileTokens.innerHTML = `<i class="ri-wallet-3-line"></i><span>${surveyFormatNumber(tokens)} tokens</span>`;
    }
}

function getCurrentUserName() {
    return String(state?.user?.fullName || state?.user?.name || "your account").trim() || "your account";
}

function updateSurveyCopy() {
    const subtitleNodes = document.querySelectorAll("#survey-page-subtitle, #survey-page-subtitle-desktop");
    const displayName = getCurrentUserName();

    subtitleNodes.forEach((node) => {
        node.textContent = `Verified survey offers are ready for ${displayName}.`;
    });
}

function updateSurveySystemStatus(data = {}) {
    const chip = document.getElementById("survey-system-chip");
    const copy = document.getElementById("survey-system-copy");
    const providerConfigured = Boolean(data?.providerConfigured);
    const availableCount = Number(data?.summary?.availableSurveys ?? data?.surveys?.length ?? 0);
    const completedCount = Number(data?.summary?.completedSurveys ?? 0);
    const todaysEarnings = Number(data?.summary?.todaysEarnings ?? 0);

    if (chip) {
        const title = providerConfigured ? "Survey system active" : "Survey system needs setup";
        const icon = providerConfigured ? "ri-shield-check-line" : "ri-error-warning-line";
        chip.innerHTML = `<i class="${icon}"></i><strong>${title}</strong>`;
    }

    if (copy) {
        if (providerConfigured) {
            copy.textContent = `${availableCount} live offer${availableCount === 1 ? "" : "s"} ready. Points are credited after verified completion and CPX postback. Completed: ${completedCount}. Today: ${surveyFormatNumber(todaysEarnings)} pts.`;
        } else {
            copy.textContent = "Survey provider is not configured yet, so live survey crediting is unavailable until CPX settings are added.";
        }
    }
}

function waitForSurveyUser(maxAttempts = 24, delayMs = 100) {
    return new Promise((resolve) => {
        let attempt = 0;
        const tick = () => {
            if (state?.user || attempt >= maxAttempts) {
                resolve(Boolean(state?.user));
                return;
            }
            attempt += 1;
            window.setTimeout(tick, delayMs);
        };
        tick();
    });
}

function getLocalSurveyTasks() {
    const catalog = window.AnviTaskCatalog?.getAll?.();
    if (!Array.isArray(catalog)) {
        return [];
    }

    return catalog.filter((task) => String(task?.taskType || "").toLowerCase() === "survey");
}

function normalizeServerSurvey(item = {}) {
    const rewardPoints = Number(item.rewardPoints ?? item.points ?? 0) || 0;
    const estimatedMinutes = Number(item.estimatedMinutes ?? item.minutes ?? 0) || 0;

    return {
        id: String(item.id || "").trim(),
        title: String(item.title || "Survey").trim(),
        description: String(item.description || "Complete the survey and earn rewards.").trim(),
        rewardPoints,
        estimatedMinutes,
        difficulty: String(item.difficulty || "Easy").trim(),
        category: String(item.category || "General").trim(),
        provider: String(item.provider || item.providerLabel || "CPX Research").trim(),
        providerKey: String(item.providerKey || item.provider || "cpx").trim().toLowerCase(),
        launchAvailable: item.launchAvailable !== false,
        source: "server",
        mode: "cpx"
    };
}

function normalizeLocalSurvey(task = {}) {
    const questions = Array.isArray(task.questions) ? task.questions : [];
    const estimatedMinutes = Math.max(3, Math.min(20, Math.ceil((questions.length || 3) * 2)));
    const rewardPoints = Number(task.rewardPoints ?? task.reward ?? task.points ?? 0) || 0;

    return {
        id: String(task.id || task._id || "").trim(),
        title: String(task.title || "Survey").trim(),
        description: String(task.description || "Complete the survey and earn rewards.").trim(),
        rewardPoints,
        estimatedMinutes,
        difficulty: questions.length <= 3 ? "Easy" : (questions.length <= 6 ? "Medium" : "Hard"),
        category: "Custom",
        provider: "Survey catalog",
        providerKey: "catalog",
        launchAvailable: true,
        source: "local",
        mode: "modal",
        task
    };
}

function surveyMatchesFilter(card, filter) {
    switch (filter) {
        case "high":
            return card.rewardPoints >= 100;
        case "short":
            return card.estimatedMinutes <= 10;
        case "cpx":
            return card.providerKey === "cpx";
        default:
            return true;
    }
}

function renderSurveyCards(cards) {
    const container = document.getElementById("survey-cards-grid");
    if (!container) {
        return;
    }

    if (!cards.length) {
        container.innerHTML = `
            <div class="survey-card survey-card--empty">
                <div class="survey-card__minutes">
                    <strong>0</strong>
                    <span>offers</span>
                </div>
                <h4 class="survey-card__title">No surveys available</h4>
                <p class="survey-card__desc">CPX or survey catalog entries are not ready yet. Try refreshing in a moment.</p>
                <button type="button" class="btn-primary survey-card__start" data-open-cpx>
                    <span>Open CPX Wall</span>
                    <i class="ri-arrow-right-line"></i>
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = cards.map((card) => {
        const tone = card.difficulty === "Hard" ? "amber" : (card.difficulty === "Medium" ? "green" : "blue");
        const providerLabel = card.providerKey === "cpx" ? "CPX Research" : card.provider;
        const badgeLabel = card.providerKey === "cpx" ? "Live" : "Catalog";
        const actionLabel = card.providerKey === "cpx" ? "Start Survey" : "Start Survey";
        const rewardText = `${surveyFormatNumber(card.rewardPoints)} pts`;

        return `
            <article class="survey-card" data-survey-card data-survey-id="${escapeSurveyHtml(card.id)}" data-filter-key="${escapeSurveyHtml(card.providerKey)}" data-reward="${escapeSurveyHtml(card.rewardPoints)}" data-minutes="${escapeSurveyHtml(card.estimatedMinutes)}">
                <div class="survey-card__meta">
                    <div class="survey-card__provider"><i class="ri-checkbox-circle-line"></i> ${escapeSurveyHtml(providerLabel)}</div>
                    <div class="survey-card__points">${escapeSurveyHtml(rewardText)}</div>
                </div>
                <div class="survey-card__minutes">
                    <strong>${escapeSurveyHtml(card.estimatedMinutes || 0)}</strong>
                    <span>Minutes</span>
                </div>
                <div class="survey-card__difficulty" data-tone="${tone}">
                    ${escapeSurveyHtml(card.difficulty || "Easy")}
                </div>
                <h4 class="survey-card__title">${escapeSurveyHtml(card.title)}</h4>
                <p class="survey-card__desc">${escapeSurveyHtml(card.description)}</p>
                <button type="button" class="btn-primary survey-card__start" data-survey-start="${escapeSurveyHtml(card.id)}">
                    <span>${escapeSurveyHtml(actionLabel)}</span>
                    <i class="ri-arrow-right-line"></i>
                </button>
            </article>
        `;
    }).join("");
}

function getVisibleCards(cards, filter) {
    return cards.filter((card) => surveyMatchesFilter(card, filter));
}

let surveyDelegationBound = false;

async function syncSurveyBalances() {
    const fallbackPoints = Number(state?.user?.points || 0);
    const fallbackTokens = Number(state?.user?.tokens || 0);

    let points = fallbackPoints;
    let tokens = fallbackTokens;

    if (typeof fetchDashboardPayload === "function") {
        try {
            const dashboard = await fetchDashboardPayload();
            points = Number(dashboard?.stats?.points ?? points);
            tokens = Number(dashboard?.stats?.tokens ?? tokens);
        } catch (error) {
            // Keep cached balances if the dashboard sync is slow or offline.
        }
    }

    updateBalanceChips(points, tokens);
}

function bindSurveyActions(cards) {
    window.__surveyCardsById = new Map(cards.map((card) => [card.id, card]));

    if (surveyDelegationBound) {
        return;
    }

    surveyDelegationBound = true;

    document.addEventListener("click", async (event) => {
        const filterButton = event.target.closest("[data-filter]");
        if (filterButton) {
            const filter = String(filterButton.getAttribute("data-filter") || "all").trim();
            setActiveFilter(filter);
            return;
        }

        if (event.target.closest("#survey-refresh")) {
            await initSurveysPage(true);
            return;
        }

        if (event.target.closest("[data-open-cpx]")) {
            await openCpxWall();
            return;
        }

        const startButton = event.target.closest("[data-survey-start]");
        if (!startButton) {
            return;
        }

        const cardId = String(startButton.getAttribute("data-survey-start") || "").trim();
        const card = window.__surveyCardsById?.get(cardId);
        if (!card) {
            return;
        }

        if (card.mode === "modal" && typeof window.openSurveyModal === "function" && card.task) {
            window.openSurveyModal(card.task);
            return;
        }

        await openCpxWall();
    });
}

function setActiveFilter(filter) {
    const safeFilter = filter || "all";
    document.querySelectorAll("[data-filter]").forEach((button) => {
        button.classList.toggle("active", button.getAttribute("data-filter") === safeFilter);
    });
    renderSurveyDashboard(safeFilter);
}

async function openCpxWall() {
    const wrapper = document.getElementById("cpx-survey-wrapper");
    const hasUser = await waitForSurveyUser();

    if (!hasUser) {
        if (wrapper) {
            wrapper.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
    }

    if (typeof initCpxSurvey === "function") {
        await initCpxSurvey();
    }

    wrapper?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderEmptyWall(message, title = "Surveys unavailable") {
    const container = document.getElementById("cpx-iframe-container");
    if (!container) {
        return;
    }

    container.innerHTML = `
        <div class="survey-embed-state survey-embed-state--empty">
            <div class="survey-embed-state__art" aria-hidden="true"></div>
            <div class="survey-embed-state__title">${escapeSurveyHtml(title)}</div>
            <p>${escapeSurveyHtml(message)}</p>
            <button type="button" class="btn-primary survey-card__start" data-open-cpx>
                <span>Open CPX Wall</span>
                <i class="ri-refresh-line"></i>
            </button>
        </div>
    `;

    container.querySelectorAll("[data-open-cpx]").forEach((button) => {
        button.addEventListener("click", async () => {
            await openCpxWall();
        });
    });
}

function renderSurveyDashboard(filter = "all") {
    const localCards = getLocalSurveyTasks().map(normalizeLocalSurvey).filter((card) => card.id);
    const serverCards = (window.__surveyData?.surveys || []).map(normalizeServerSurvey).filter((card) => card.id);
    const cards = [...serverCards, ...localCards];
    const visibleCards = getVisibleCards(cards, filter);
    renderSurveyCards(visibleCards);
    bindSurveyActions(cards);
}

async function loadSurveyData() {
    const fallback = { surveys: [], summary: null };

    if (typeof requestFirst !== "function") {
        window.__surveyData = fallback;
        updateSurveySystemStatus(fallback);
        return fallback;
    }

    try {
        const response = await requestFirst([{ path: "/surveys", method: "GET" }], { auth: true });
        const data = {
            surveys: Array.isArray(response?.surveys) ? response.surveys : [],
            summary: response?.summary || null,
            providerConfigured: Boolean(response?.providerConfigured)
        };
        window.__surveyData = data;
        updateSurveySystemStatus(data);
        return data;
    } catch (error) {
        window.__surveyData = fallback;
        updateSurveySystemStatus(fallback);
        return fallback;
    }
}

async function initSurveysPage(forceReload = false) {
    const cardsGrid = document.getElementById("survey-cards-grid");
    const wallWrapper = document.getElementById("cpx-survey-wrapper");
    const wallContainer = document.getElementById("cpx-iframe-container");

    if (!cardsGrid || !wallWrapper || !wallContainer) {
        return;
    }

    if (forceReload) {
        wallContainer.dataset.cpxLoaded = "0";
        wallContainer.innerHTML = "";
    }

    const hasUser = await waitForSurveyUser();
    updateSurveyCopy();
    await syncSurveyBalances();

    if (!hasUser) {
        renderEmptyWall("Please sign in again to load the live survey wall.", "Sign in required");
        cardsGrid.innerHTML = "";
        return;
    }

    const surveyData = await loadSurveyData();
    const summary = surveyData.summary || {};

    if (summary.currentPoints !== undefined || summary.currentTokens !== undefined) {
        updateBalanceChips(summary.currentPoints ?? state?.user?.points ?? 0, summary.currentTokens ?? state?.user?.tokens ?? 0);
    }

    renderSurveyDashboard(document.querySelector("[data-filter].active")?.getAttribute("data-filter") || "all");

    if (!surveyData.surveys.length && typeof initCpxSurvey !== "function") {
        renderEmptyWall(
            surveyData.providerConfigured
                ? "Survey offers could not be loaded right now. Please try again later."
                : "Survey provider setup is missing, so live offers are not available right now."
        );
    } else if (wallContainer.dataset.cpxLoaded !== "1" && typeof initCpxSurvey === "function") {
        await initCpxSurvey();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initSurveysPage();
});

window.addEventListener("anvi:home-points-updated", () => {
    syncSurveyBalances();
});

async function initCpxSurvey() {
    const container = document.getElementById("cpx-iframe-container");
    const shell = document.querySelector(".survey-wall__frame-shell");
    if (!container) return;

    if (shell) {
        shell.classList.add("active");
    }

    container.innerHTML = `
        <div class="survey-embed-state survey-embed-state--loading" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; color: #fff;">
            <div class="spinner" style="border: 4px solid rgba(255,255,255,0.1); border-top: 4px solid #3b82f6; border-radius: 50%; width: 40px; height: 40px; animation: spin_cpx 1s linear infinite; margin-bottom: 15px;"></div>
            <p>Loading CPX Survey Wall...</p>
        </div>
        <style>
            @keyframes spin_cpx {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        </style>
    `;

    try {
        const response = await requestFirst([{ path: "/surveys/cpx/iframe", method: "GET" }], { auth: true });
        if (response && response.success && response.iframeUrl) {
            container.innerHTML = `
                <div class="cpx-action-bar" style="display: flex; justify-content: flex-end; padding: 10px; background: rgba(30, 41, 59, 0.9); border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                    <a href="${response.iframeUrl}" target="_blank" rel="noopener noreferrer" class="btn-primary" style="padding: 6px 12px; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px; text-decoration: none; border-radius: 6px; color: #fff; background-color: #3b82f6;">
                        <i class="ri-external-link-line"></i>
                        <span>Open Fullscreen (Better for Mobile)</span>
                    </a>
                </div>
                <iframe src="${response.iframeUrl}" width="100%" height="100%" style="border: none; background: #fff;" allow="geolocation"></iframe>
            `;
            container.dataset.cpxLoaded = "1";
        } else {
            if (shell) shell.classList.remove("active");
            renderEmptyWall(response?.message || "Could not load CPX Survey Wall. Please make sure CPX settings are configured.");
        }
    } catch (error) {
        console.error("Failed to load CPX Survey Wall:", error);
        if (shell) shell.classList.remove("active");
        renderEmptyWall("An error occurred while loading CPX surveys. Please try again later.");
    }
}
