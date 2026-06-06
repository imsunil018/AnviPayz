import {
    requestFirst,
    fetchBackendHealth,
    setAdminToken,
    clearAdminToken,
    getAdminToken,
    formatDateTime,
    formatRelativeTime,
    normalizeUserRecord,
    normalizeTaskRecord,
    escapeHtml,
    toNumber,
    capitalize
} from "./admin-config.js";

const taskCatalog = globalThis.AnviTaskCatalog || null;

const state = {
    users: [],
    tasks: [],
    activity: [],
    overview: {},
    leaderboardMode: "refer",
    userSort: "newest",
    userSearch: "",
    taskFilter: "all",
    refreshTimer: null,
    connectionStatus: "signed_out",
    retryTimer: null,
    lastSyncAt: 0,
    editingTaskId: null,
    editingSurveyId: null
};

const refs = {
    authScreen: document.getElementById("authScreen"),
    appInterface: document.getElementById("appInterface"),
    toastBox: document.getElementById("toast-box"),
    notifSound: document.getElementById("notifSound"),
    pageTitle: document.getElementById("pageTitle"),
    headerTime: document.getElementById("headerTime"),
    liveChip: document.getElementById("liveChip"),
    themeToggle: document.getElementById("themeToggle"),
    sidebar: document.getElementById("sidebar"),
    sidebarOverlay: document.getElementById("sidebarOverlay"),
    leaderboardTopCards: document.getElementById("leaderboardTopCards"),
    leaderboardTableBody: document.getElementById("leaderboardTableBody"),
    leaderboardValueHeader: document.getElementById("leaderboardValueHeader"),
    userTableBody: document.getElementById("userTableBody"),
    taskTableBody: document.getElementById("taskTableBody"),
    miniFeed: document.getElementById("miniFeed"),
    fullFeed: document.getElementById("fullFeed"),
    joinAlerts: document.getElementById("joinAlerts"),
    topPointsUser: document.getElementById("topPointsUser"),
    topReferralUser: document.getElementById("topReferralUser"),
    overviewTopUser: document.getElementById("overviewTopUser"),
    overviewTopReferrer: document.getElementById("overviewTopReferrer"),
    overviewSyncStatus: document.getElementById("overviewSyncStatus"),
    systemBanner: document.getElementById("systemBanner"),
    systemBannerTitle: document.getElementById("systemBannerTitle"),
    systemBannerMessage: document.getElementById("systemBannerMessage"),
    systemBannerRetryBtn: document.getElementById("systemBannerRetryBtn")
};

initTheme();
bindStaticEvents();
void bootstrap();

async function bootstrap() {
    updateClock();
    window.setInterval(updateClock, 1000);

    if (!getAdminToken()) {
        showAuthScreen();
        return;
    }

    const dbOnline = await ensureDatabaseOnline();
    if (!dbOnline) {
        showApp({ status: "offline" });
        return;
    }

    try {
        await refreshAdminData();
        showApp({ status: "live" });
        state.refreshTimer = window.setInterval(() => {
            refreshAdminData().catch(handleBackgroundRefreshError);
        }, 30000);
    } catch (error) {
        if (error?.code === "DB_OFFLINE" || error?.status === 503) {
            state.users = [];
            state.tasks = getLocalTaskCatalog().map(normalizeTaskRecord);
            state.activity = [];
            state.overview = {};
            renderOverview();
            renderUsers();
            renderTasks();
            renderLeaderboards();
            renderActivity();
            renderJoinAlerts();
            showToast(error.message || "Database is offline. Start MongoDB and reload to sync.", "warning");
            showApp({ status: "offline" });
            return;
        }

        clearAdminToken();
        showToast(error.message || "Session expired. Please sign in again.", "error");
        showAuthScreen();
    }
}

function bindStaticEvents() {
    document.getElementById("loginForm")?.addEventListener("submit", handleLogin);
    document.getElementById("logoutBtn")?.addEventListener("click", logout);
    document.getElementById("themeToggle")?.addEventListener("click", toggleTheme);
    document.getElementById("mobileToggle")?.addEventListener("click", toggleSidebar);
    refs.sidebarOverlay?.addEventListener("click", closeSidebar);
    refs.systemBannerRetryBtn?.addEventListener("click", () => void retrySync());
    document.getElementById("userSearch")?.addEventListener("input", (event) => {
        state.userSearch = event.target.value || "";
        renderUsers();
    });

    document.querySelectorAll(".nav-item[data-tab]").forEach((button) => {
        button.addEventListener("click", () => switchTab(button.dataset.tab || "overview"));
    });

    document.querySelectorAll("[data-tab-jump]").forEach((button) => {
        button.addEventListener("click", () => switchTab(button.dataset.tabJump || "overview"));
    });

    document.querySelectorAll("#leaderboardMode .segmented-btn").forEach((button) => {
        button.addEventListener("click", () => {
            state.leaderboardMode = button.dataset.mode || "refer";
            document.querySelectorAll("#leaderboardMode .segmented-btn").forEach((item) => item.classList.remove("active"));
            button.classList.add("active");
            renderLeaderboards();
        });
    });

    document.querySelectorAll("#userSortMode .segmented-btn").forEach((button) => {
        button.addEventListener("click", () => {
            state.userSort = button.dataset.sort || "newest";
            document.querySelectorAll("#userSortMode .segmented-btn").forEach((item) => item.classList.remove("active"));
            button.classList.add("active");
            renderUsers();
        });
    });

    document.querySelectorAll("#taskFilterMode .segmented-btn").forEach((button) => {
        button.addEventListener("click", () => {
            state.taskFilter = button.dataset.filter || "all";
            document.querySelectorAll("#taskFilterMode .segmented-btn").forEach((item) => item.classList.remove("active"));
            button.classList.add("active");
            renderTasks();
        });
    });

    document.getElementById("openTaskModalBtn")?.addEventListener("click", () => openTaskEditor());
    document.getElementById("openSurveyModalBtn")?.addEventListener("click", () => openSurveyEditor());
    document.getElementById("openGiftAllBtn")?.addEventListener("click", () => openModal("giftAllModal"));
    document.getElementById("overviewCreateTaskBtn")?.addEventListener("click", () => openTaskEditor());
    document.getElementById("overviewGiftAllBtn")?.addEventListener("click", () => openModal("giftAllModal"));
    document.querySelectorAll("[data-close-modal]").forEach((button) => {
        button.addEventListener("click", () => closeModal(button.dataset.closeModal || ""));
    });

    document.getElementById("taskForm")?.addEventListener("submit", handleTaskSubmit);
    document.getElementById("surveyForm")?.addEventListener("submit", handleSurveySubmit);
    document.getElementById("addSurveyQuestionBtn")?.addEventListener("click", () => addSurveyQuestionRow());
    document.getElementById("giftForm")?.addEventListener("submit", handleGiftUser);
    document.getElementById("giftAllForm")?.addEventListener("submit", handleGiftAll);
    refs.userTableBody?.addEventListener("click", handleUserTableActions);
    refs.taskTableBody?.addEventListener("click", handleTaskTableActions);
}

async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById("loginEmail")?.value.trim();
    const password = document.getElementById("loginPassword")?.value;
    const submitBtn = document.querySelector("#loginForm button[type=\"submit\"]");

    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = "Signing in...";
        }

        const data = await requestFirst([
            { path: "/login", method: "POST", body: { email, password } },
            { path: "/auth/login", method: "POST", body: { email, password } }
        ], { auth: false });

        if (!data?.token) {
            throw new Error("Admin token missing in response.");
        }

        setAdminToken(data.token);

        try {
            const dbOnline = await ensureDatabaseOnline();
            if (!dbOnline) {
                state.users = [];
                state.tasks = getLocalTaskCatalog().map(normalizeTaskRecord);
                state.activity = [];
                state.overview = {};
                renderOverview();
                renderUsers();
                renderTasks();
                renderLeaderboards();
                renderActivity();
                renderJoinAlerts();
                showApp({ status: "offline" });
                showToast("Logged in, but database is offline.", "warning");
                return;
            }

            await refreshAdminData();
            if (state.refreshTimer) {
                clearInterval(state.refreshTimer);
            }
            state.refreshTimer = window.setInterval(() => {
                refreshAdminData().catch(handleBackgroundRefreshError);
            }, 30000);
            showApp({ status: "live" });
            showToast("Admin console ready.", "success");
            playNotificationSound();
        } catch (refreshError) {
            if (refreshError?.code === "DB_OFFLINE" || refreshError?.status === 503) {
                // Let the admin UI load even when MongoDB is offline, so the user can see the console.
                state.users = [];
                state.tasks = getLocalTaskCatalog().map(normalizeTaskRecord);
                state.activity = [];
                state.overview = {};
                renderOverview();
                renderUsers();
                renderTasks();
                renderLeaderboards();
                renderActivity();
                renderJoinAlerts();
                showApp({ status: "offline" });
                showToast(refreshError.message || "Logged in, but database is offline.", "warning");
                return;
            }

            throw refreshError;
        }
    } catch (error) {
        if (error?.code === "DB_OFFLINE" || error?.status === 503) {
            showToast(error.message || "Database is offline. Start MongoDB and retry.", "warning");
            return;
        }

        showToast(error.message || "Invalid admin credentials.", "error");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Login";
        }
    }
}

async function refreshAdminData() {
    const [overviewPayload, usersPayload, tasksPayload, activityPayload] = await Promise.allSettled([
        requestFirst([
            { path: "/overview", method: "GET" },
            { path: "/stats", method: "GET" }
        ]),
        requestFirst([
            { path: "/users", method: "GET" }
        ]),
        requestFirst([
            { path: "/tasks", method: "GET" }
        ]),
        requestFirst([
            { path: "/activity", method: "GET" }
        ])
    ]);

    const failures = [overviewPayload, usersPayload, tasksPayload, activityPayload]
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason);

    const authFailure = failures.find((error) => error?.status === 401 || error?.status === 403);
    if (authFailure) {
        throw authFailure;
    }

    if (failures.length === 4) {
        throw failures[0] || new Error("Admin data could not be loaded.");
    }

    state.overview = overviewPayload.status === "fulfilled" ? overviewPayload.value?.overview || overviewPayload.value || {} : {};
    state.users = usersPayload.status === "fulfilled"
        ? (usersPayload.value?.users || usersPayload.value || []).map(normalizeUserRecord)
        : [];
    if (tasksPayload.status === "fulfilled") {
        const fetchedTasks = (tasksPayload.value?.tasks || tasksPayload.value || []).map(normalizeTaskRecord);
        saveLocalTaskCatalog(fetchedTasks);
        state.tasks = getLocalTaskCatalog().map(normalizeTaskRecord);
    } else {
        state.tasks = getLocalTaskCatalog().map(normalizeTaskRecord);
    }
    state.activity = activityPayload.status === "fulfilled"
        ? normalizeActivityFeed(activityPayload.value?.activity || activityPayload.value || [])
        : [];

    renderOverview();
    renderUsers();
    renderTasks();
    renderLeaderboards();
    renderActivity();
    renderJoinAlerts();
    state.lastSyncAt = Date.now();
    stopRetryLoop();
    setConnectionStatus("live");
    setLiveStatus("live");

    if (!state.refreshTimer) {
        state.refreshTimer = window.setInterval(() => {
            refreshAdminData().catch(handleBackgroundRefreshError);
        }, 30000);
    }
}

function renderOverview() {
    const overview = state.overview;
    const live = state.connectionStatus === "live";
    const computedPoints = state.users.reduce((sum, user) => sum + user.balance, 0);
    const computedTokens = state.users.reduce((sum, user) => sum + toNumber(user.tokens, 0), 0);
    const computedTokensConverted = state.users.reduce((sum, user) => sum + toNumber(user.tokensConverted, 0), 0);
    const computedUsersConverted = state.users.filter((user) => toNumber(user.tokensConverted, 0) > 0).length;
    const activeTasks = state.tasks.filter((task) => task.status === "active").length;
    const recentJoins = state.users.filter((user) => Date.now() - toMillis(user.joinedAt) < 30 * 86_400_000).length;
    const recentReferralJoins = state.users.filter((user) => user.joinType === "referral" && Date.now() - toMillis(user.joinedAt) < 30 * 86_400_000).length;
    const visits24 = state.users.filter((user) => Date.now() - toMillis(user.lastActive) < 86_400_000).length;

    if (live) {
        setStat("statUsers", toNumber(overview.totalUsers, state.users.length));
        setStat("statBalance", toNumber(overview.totalPoints, computedPoints));
        setTokenStat("statTokens", toNumber(overview.totalTokens, computedTokens));
        setTokenStat("statTokensConverted", toNumber(overview.totalTokensConverted, computedTokensConverted));
        setStat("statUsersConverted", toNumber(overview.usersConverted, computedUsersConverted));
        setStat("statTasks", toNumber(overview.activeTasks, activeTasks));
        setStat("statVisits24", toNumber(overview.visits24h, visits24));
        setStat("statJoins30", toNumber(overview.joins30d, recentJoins));
        setStat("statReferralJoins30", toNumber(overview.referralJoins30d, recentReferralJoins));
    } else {
        setStat("statUsers", "—");
        setStat("statBalance", "—");
        setTokenStat("statTokens", "—");
        setTokenStat("statTokensConverted", "—");
        setStat("statUsersConverted", "—");
        setStat("statTasks", "—");
        setStat("statVisits24", "—");
        setStat("statJoins30", "—");
        setStat("statReferralJoins30", "—");
    }

    const topPointsUser = [...state.users].sort((a, b) => b.balance - a.balance)[0];
    const topReferralUser = [...state.users].sort((a, b) => b.totalReferrals - a.totalReferrals)[0];
    if (refs.topPointsUser) refs.topPointsUser.textContent = topPointsUser ? `${topPointsUser.fullName} - ${topPointsUser.balance}` : "-";
    if (refs.topReferralUser) refs.topReferralUser.textContent = topReferralUser ? `${topReferralUser.fullName} - ${topReferralUser.totalReferrals}` : "-";
    if (refs.overviewTopUser) refs.overviewTopUser.textContent = topPointsUser ? topPointsUser.fullName : "-";
    if (refs.overviewTopReferrer) refs.overviewTopReferrer.textContent = topReferralUser ? topReferralUser.fullName : "-";
    if (live && refs.overviewSyncStatus) {
        refs.overviewSyncStatus.textContent = state.activity.length ? "Live data ready" : "Waiting for activity";
    }
}

function renderUsers() {
    if (!refs.userTableBody) return;

    if (state.connectionStatus !== "live") {
        refs.userTableBody.innerHTML = `<tr><td class="table-empty" colspan="10">Database offline. Click Retry to sync once MongoDB is running.</td></tr>`;
        return;
    }

    let users = [...state.users];
    const keyword = state.userSearch.trim().toLowerCase();

    if (keyword) {
        users = users.filter((user) =>
            user.fullName.toLowerCase().includes(keyword) ||
            user.email.toLowerCase().includes(keyword) ||
            user.phone.toLowerCase().includes(keyword)
        );
    }

    users.sort((a, b) => state.userSort === "points"
        ? b.balance - a.balance
        : toMillis(b.joinedAt) - toMillis(a.joinedAt));

    refs.userTableBody.innerHTML = users.length ? users.map((user) => `
        <tr>
            <td data-label="User"><div class="user-title">${escapeHtml(user.fullName)}</div><div class="user-sub">${escapeHtml(user.email)}</div></td>
            <td data-label="Mobile">${escapeHtml(user.phone)}</td>
            <td data-label="Points">${formatNumber(user.balance)}</td>
            <td data-label="Tokens">${formatToken(user.tokens)}</td>
            <td data-label="Tokens Converted">${formatToken(user.tokensConverted)}</td>
            <td data-label="Referrals">${formatNumber(user.totalReferrals)}</td>
            <td data-label="Join Type">${escapeHtml(capitalize(user.joinType))}</td>
            <td data-label="Last Active">${escapeHtml(formatRelativeTime(user.lastActive))}</td>
            <td data-label="Joined">${escapeHtml(formatDateTime(user.joinedAt))}</td>
            <td data-label="Action">
                <div class="actions">
                    <button class="icon-btn" data-user-gift="${user.id}" title="Send Gift"><i class="ri-gift-line"></i></button>
                    <button class="icon-btn delete" data-user-delete="${user.id}" title="Delete User"><i class="ri-delete-bin-line"></i></button>
                </div>
            </td>
        </tr>
    `).join("") : `<tr><td class="table-empty" colspan="10">No users found.</td></tr>`;
}

function renderTasks() {
    if (!refs.taskTableBody) return;

    if (state.connectionStatus !== "live" && !state.tasks.length) {
        refs.taskTableBody.innerHTML = `<tr><td class="table-empty" colspan="7">Database offline and no local task catalog is available.</td></tr>`;
        return;
    }

    const filtered = state.tasks.filter((task) => {
        if (state.taskFilter === "all") return true;
        return String(task.taskType || "").toLowerCase() === state.taskFilter;
    });

    refs.taskTableBody.innerHTML = filtered.length ? filtered.map((task) => `
        <tr>
            <td data-label="Title">${escapeHtml(task.title)}</td>
            <td data-label="Type">${escapeHtml(capitalize(task.taskType))}</td>
            <td data-label="Reward">${formatNumber(task.rewardPoints)}</td>
            <td data-label="Status">${escapeHtml(capitalize(task.status))}</td>
            <td data-label="Questions">${task.taskType === "survey" ? formatNumber(task.questionCount || 0) : "-"}</td>
            <td data-label="Created">${escapeHtml(formatDateTime(task.createdAt))}</td>
            <td data-label="Action">
                <div class="actions">
                    <button class="icon-btn" data-task-edit="${task.id}" title="Edit Task"><i class="ri-pencil-line"></i></button>
                    <button class="icon-btn delete" data-task-delete="${task.id}" title="Delete Task"><i class="ri-delete-bin-line"></i></button>
                </div>
            </td>
        </tr>
    `).join("") : `<tr><td class="table-empty" colspan="7">No tasks available for this filter.</td></tr>`;
}

function renderLeaderboards() {
    if (state.connectionStatus !== "live") {
        if (refs.leaderboardTopCards) {
            refs.leaderboardTopCards.innerHTML = `
                <article class="stat-card">
                    <div class="stat-top"><span>Leaderboard</span><i class="ri-cloud-off-line"></i></div>
                    <div class="stat-val">Database offline</div>
                    <p class="user-sub">Retry sync to load rankings.</p>
                </article>
            `;
        }
        if (refs.leaderboardTableBody) {
            refs.leaderboardTableBody.innerHTML = `<tr><td class="table-empty" colspan="4">Database offline. Retry sync.</td></tr>`;
        }
        return;
    }

    const users = [...state.users].sort((a, b) => state.leaderboardMode === "refer"
        ? b.totalReferrals - a.totalReferrals
        : b.balance - a.balance);

    if (refs.leaderboardValueHeader) {
        refs.leaderboardValueHeader.textContent = state.leaderboardMode === "refer" ? "Referrals" : "Points";
    }

    if (refs.leaderboardTopCards) {
        refs.leaderboardTopCards.innerHTML = users.slice(0, 3).map((user, index) => `
            <article class="stat-card">
                <div class="stat-top"><span>#${index + 1}</span><i class="ri-award-line"></i></div>
                <div class="stat-val">${escapeHtml(user.fullName)}</div>
                <p class="user-sub">${state.leaderboardMode === "refer" ? formatNumber(user.totalReferrals) : formatNumber(user.balance)}</p>
            </article>
        `).join("");
    }

    if (refs.leaderboardTableBody) {
        refs.leaderboardTableBody.innerHTML = users.length ? users.map((user, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(user.fullName)}</td>
                <td>${escapeHtml(user.email)}</td>
                <td>${state.leaderboardMode === "refer" ? formatNumber(user.totalReferrals) : formatNumber(user.balance)}</td>
            </tr>
        `).join("") : `<tr><td class="table-empty" colspan="4">Leaderboard is empty.</td></tr>`;
    }
}

function renderActivity() {
    const items = state.connectionStatus !== "live"
        ? [{ message: "Database offline. Activity will appear once sync is restored.", time: Date.now() }]
        : (state.activity.length ? state.activity : [{ message: "No admin activity yet.", time: Date.now() }]);
    const markup = items.map(renderFeedItem).join("");
    if (refs.miniFeed) refs.miniFeed.innerHTML = markup;
    if (refs.fullFeed) refs.fullFeed.innerHTML = markup;
}

function renderJoinAlerts() {
    if (!refs.joinAlerts) return;
    if (state.connectionStatus !== "live") {
        refs.joinAlerts.innerHTML = `<div class="feed-item"><div class="feed-title">Database offline. Join alerts paused.</div></div>`;
        return;
    }
    const items = [...state.users]
        .sort((a, b) => toMillis(b.joinedAt) - toMillis(a.joinedAt))
        .slice(0, 10)
        .map((user) => ({
            message: `${user.fullName} joined via ${user.joinType === "referral" ? "referral" : "direct signup"}`,
            time: user.joinedAt
        }));

    refs.joinAlerts.innerHTML = items.length ? items.map(renderFeedItem).join("") : `<div class="feed-item"><div class="feed-title">No recent joins.</div></div>`;
}

function getLocalTaskCatalog() {
    return taskCatalog?.getAll?.() || [];
}

function saveLocalTaskCatalog(tasks) {
    return taskCatalog?.saveAll?.(tasks) || [];
}

function upsertLocalTask(task) {
    return taskCatalog?.upsert?.(task) || [];
}

function removeLocalTask(id) {
    return taskCatalog?.remove?.(id) || [];
}

function isOfflineTaskError(error) {
    return error?.status === 503
        || error?.code === "DB_OFFLINE"
        || /503/i.test(String(error?.message || ""));
}

function isAuthTaskError(error) {
    return error?.status === 401 || error?.status === 403;
}

function isValidationTaskError(error) {
    return error?.status === 400
        || /fill all|required task fields|task title and reward points are required|survey title and reward points are required|add at least one survey question/i.test(String(error?.message || ""));
}

function openTaskEditor(task = null) {
    state.editingTaskId = task ? task.id : null;
    state.editingSurveyId = null;
    const modalTitle = document.getElementById("taskModalTitle");
    const submitBtn = document.getElementById("taskSubmitBtn");
    const form = document.getElementById("taskForm");

    if (modalTitle) {
        modalTitle.textContent = task ? "Edit Task" : "Create New Task";
    }

    if (submitBtn) {
        submitBtn.textContent = task ? "Save Changes" : "Create Task";
    }

    document.getElementById("tId").value = task?.id || "";
    document.getElementById("tTitle").value = task?.title || "";
    document.getElementById("tLink").value = task?.link || "";
    document.getElementById("tDesc").value = task?.description || "";
    document.getElementById("tPoints").value = task?.rewardPoints || "";
    document.getElementById("tType").value = task?.taskType || "task";
    document.getElementById("tStatus").value = task?.status || "active";
    document.getElementById("tNotifyUsers").checked = Boolean(task?.notifyUsers);

    if (form) {
        form.dataset.mode = task ? "edit" : "create";
    }

    openModal("taskModal");
}

function openSurveyEditor(task = null) {
    state.editingSurveyId = task ? task.id : null;
    state.editingTaskId = null;
    const modalTitle = document.getElementById("surveyModalTitle");
    const submitBtn = document.getElementById("surveySubmitBtn");
    const form = document.getElementById("surveyForm");

    if (modalTitle) {
        modalTitle.textContent = task ? "Edit Survey" : "Create New Survey";
    }

    if (submitBtn) {
        submitBtn.textContent = task ? "Save Changes" : "Create Survey";
    }

    document.getElementById("sId").value = task?.id || "";
    document.getElementById("sTitle").value = task?.title || "";
    document.getElementById("sDesc").value = task?.description || "";
    document.getElementById("sPoints").value = task?.rewardPoints || "";
    document.getElementById("sStatus").value = task?.status || "active";
    document.getElementById("sNotifyUsers").checked = Boolean(task?.notifyUsers);

    const questionList = document.getElementById("surveyQuestionList");
    if (questionList) {
        const questions = Array.isArray(task?.questions) && task.questions.length ? task.questions : [createEmptySurveyQuestion()];
        questionList.innerHTML = questions.map((question) => renderSurveyQuestionRow(question)).join("");
        questionList.querySelectorAll("[data-question-row]").forEach((row) => bindSurveyQuestionRow(row));
    }

    if (form) {
        form.dataset.mode = task ? "edit" : "create";
    }

    openModal("surveyModal");
    scrollSurveyEditorToTop();
    window.requestAnimationFrame(() => {
        document.getElementById("sTitle")?.focus();
    });
}

function resetTaskEditor() {
    state.editingTaskId = null;
    const modalTitle = document.getElementById("taskModalTitle");
    const submitBtn = document.getElementById("taskSubmitBtn");
    const form = document.getElementById("taskForm");

    if (modalTitle) {
        modalTitle.textContent = "Create New Task";
    }

    if (submitBtn) {
        submitBtn.textContent = "Create Task";
    }

    if (form) {
        form.dataset.mode = "create";
        form.reset();
    }

    const idField = document.getElementById("tId");
    if (idField) {
        idField.value = "";
    }
}

function resetSurveyEditor() {
    state.editingSurveyId = null;
    const modalTitle = document.getElementById("surveyModalTitle");
    const submitBtn = document.getElementById("surveySubmitBtn");
    const form = document.getElementById("surveyForm");
    const questionList = document.getElementById("surveyQuestionList");

    if (modalTitle) {
        modalTitle.textContent = "Create New Survey";
    }

    if (submitBtn) {
        submitBtn.textContent = "Create Survey";
    }

    if (form) {
        form.dataset.mode = "create";
        form.reset();
    }

    if (questionList) {
        questionList.innerHTML = renderSurveyQuestionRow(createEmptySurveyQuestion());
        questionList.querySelectorAll("[data-question-row]").forEach((row) => bindSurveyQuestionRow(row));
    }

    const idField = document.getElementById("sId");
    if (idField) {
        idField.value = "";
    }

    scrollSurveyEditorToTop();
}

function scrollSurveyEditorToTop() {
    const modal = document.getElementById("surveyModal");
    const panel = modal?.querySelector(".modal--survey");
    if (modal) {
        modal.scrollTop = 0;
    }
    if (panel) {
        panel.scrollTop = 0;
    }
}

function createEmptySurveyQuestion() {
    return {
        text: "",
        type: "radio",
        options: ["Option 1", "Option 2"],
        placeholder: ""
    };
}

function renderSurveyQuestionRow(question = {}) {
    const type = String(question.type || "radio").toLowerCase() === "text" ? "text" : "radio";
    const optionsText = Array.isArray(question.options) ? question.options.join("\n") : "";
    const placeholder = String(question.placeholder || "");

    return `
        <div class="survey-question-row" data-question-row>
            <div class="survey-question-row__top">
                <input type="text" class="input" data-question-field="text" placeholder="Question text" value="${escapeHtml(question.text || "")}" required>
                <select class="input" data-question-field="type">
                    <option value="radio" ${type === "radio" ? "selected" : ""}>Multiple choice</option>
                    <option value="text" ${type === "text" ? "selected" : ""}>Text answer</option>
                </select>
            </div>
            <div class="survey-question-row__bottom">
                <div data-question-options-wrapper>
                    <textarea class="input text-area" data-question-field="options" placeholder="Options one per line">${escapeHtml(optionsText)}</textarea>
                </div>
                <div data-question-placeholder-wrapper>
                    <input type="text" class="input" data-question-field="placeholder" placeholder="Text answer placeholder" value="${escapeHtml(placeholder)}">
                </div>
            </div>
            <div class="survey-question-row__actions">
                <button type="button" class="btn btn-danger" data-question-remove>Remove</button>
            </div>
        </div>
    `;
}

function bindSurveyQuestionRow(row) {
    const typeSelect = row.querySelector('[data-question-field="type"]');
    const removeBtn = row.querySelector('[data-question-remove]');

    const sync = () => {
        const type = String(typeSelect?.value || "radio").toLowerCase();
        const optionsWrap = row.querySelector("[data-question-options-wrapper]");
        const placeholderWrap = row.querySelector("[data-question-placeholder-wrapper]");
        if (optionsWrap) {
            optionsWrap.style.display = type === "text" ? "none" : "block";
        }
        if (placeholderWrap) {
            placeholderWrap.style.display = type === "text" ? "block" : "none";
        }
    };

    typeSelect?.addEventListener("change", sync);
    removeBtn?.addEventListener("click", () => {
        const list = document.getElementById("surveyQuestionList");
        if (!list) return;
        if (list.querySelectorAll("[data-question-row]").length <= 1) {
            row.remove();
            list.insertAdjacentHTML("beforeend", renderSurveyQuestionRow(createEmptySurveyQuestion()));
            list.querySelectorAll("[data-question-row]").forEach((item) => bindSurveyQuestionRow(item));
            return;
        }
        row.remove();
    });

    sync();
}

function addSurveyQuestionRow(question = createEmptySurveyQuestion()) {
    const list = document.getElementById("surveyQuestionList");
    if (!list) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderSurveyQuestionRow(question).trim();
    const row = wrapper.firstElementChild;
    if (!row) return;
    list.appendChild(row);
    bindSurveyQuestionRow(row);
}

function collectSurveyQuestions() {
    const rows = Array.from(document.querySelectorAll("#surveyQuestionList [data-question-row]"));
    const questions = [];

    for (const row of rows) {
        const text = String(row.querySelector('[data-question-field="text"]')?.value || "").trim();
        const type = String(row.querySelector('[data-question-field="type"]')?.value || "radio").trim().toLowerCase() === "text" ? "text" : "radio";
        const optionsValue = String(row.querySelector('[data-question-field="options"]')?.value || "");
        const placeholder = String(row.querySelector('[data-question-field="placeholder"]')?.value || "").trim();
        const options = optionsValue
            .split(/\r?\n|,/)
            .map((item) => item.trim())
            .filter(Boolean);

        if (!text) {
            continue;
        }

        if (type === "radio" && !options.length) {
            throw new Error(`Add options for question: ${text}`);
        }

        questions.push({
            id: `q${questions.length + 1}`,
            text,
            type,
            options: type === "radio" ? options : [],
            placeholder: type === "text" ? placeholder : ""
        });
    }

    return questions;
}

async function submitAdminTask({ isEdit, taskId, body, successMessage }) {
    // Check if the taskId is a valid MongoDB ObjectId (24 hex chars)
    // If not, we must use POST (Create) instead of PUT (Update) to avoid 404 errors.
    const isMongoId = taskId && /^[0-9a-fA-F]{24}$/.test(String(taskId));
    const useUpdate = isEdit && isMongoId;
    const method = useUpdate ? "PUT" : "POST";
    const path = useUpdate ? `/tasks/${taskId}` : "/tasks";

    return await requestFirst([{
        path,
        method,
        body
    }]);
}

function buildLocalTaskPayload({ id, body, taskTypeOverride = null }) {
    const taskType = String(taskTypeOverride || body.taskType || "task").trim().toLowerCase();
    return {
        id: String(id || `local-${Date.now().toString(36)}`).trim(),
        seedKey: "",
        title: String(body.title || "").trim(),
        description: String(body.description || "").trim(),
        link: String(body.link || "").trim(),
        rewardPoints: toNumber(body.rewardPoints, 0),
        taskType,
        status: String(body.status || "active").trim().toLowerCase(),
        notifyUsers: Boolean(body.notifyUsers),
        questions: taskType === "survey" && Array.isArray(body.questions) ? body.questions : []
    };
}

async function handleTaskSubmit(event) {
    event.preventDefault();
    const taskId = String(document.getElementById("tId")?.value || state.editingTaskId || "").trim();
    const title = String(document.getElementById("tTitle")?.value || "").trim();
    const rewardPoints = toNumber(document.getElementById("tPoints")?.value, 0);
    const body = {
        title,
        link: document.getElementById("tLink")?.value.trim(),
        description: document.getElementById("tDesc")?.value.trim(),
        rewardPoints,
        taskType: document.getElementById("tType")?.value || "task",
        status: document.getElementById("tStatus")?.value || "active",
        notifyUsers: Boolean(document.getElementById("tNotifyUsers")?.checked),
        questions: []
    };

    if (!title || !Number.isFinite(rewardPoints) || rewardPoints <= 0) {
        showToast("Task title and reward points are required.", "error");
        return;
    }

    try {
        // Strictly check if we are in Edit mode using form state
        const isEdit = event.target.dataset.mode === "edit";
        const isMongoId = taskId && /^[0-9a-fA-F]{24}$/.test(String(taskId).trim());

        // If editing a non-Mongo task (like daily-checkin), force isEdit to false 
        // so submitAdminTask uses POST to create it on the server instead of 404ing.

        const response = await submitAdminTask({
            isEdit: isEdit && isMongoId,
            taskId,
            body,
            successMessage: isEdit ? "Task updated." : "Task created."
        });

        // Ensure local catalog reflects admin changes immediately so the
        // user-facing Tasks page can pick them up (cross-tab via storage).
        try {
            upsertLocalTask(buildLocalTaskPayload({ id: response?.id || taskId, body }));
        } catch (_) {
            // ignore local catalog failures
        }

        await refreshAdminData();
        closeModal("taskModal");
        resetTaskEditor();
        showToast(response?.message || (isEdit ? "Task updated." : "Task created."), "success");
    } catch (error) {
        // If backend rejects due to missing/validation fields or is offline,
        // allow the admin to save the task locally so it appears in the
        // user-facing task catalog immediately.
        const msg = String(error?.message || "");
        const isValidation = /fill all|required task fields/i.test(msg);
        if (isValidation || isOfflineTaskError(error)) {
            try {
                upsertLocalTask(buildLocalTaskPayload({ id: taskId || undefined, body }));
                await refreshAdminData();
                closeModal("taskModal");
                resetTaskEditor();
                showToast("Task saved locally (backend rejected).", "warning");
                return;
            } catch (localErr) {
                // fall through to showing original error
            }
        }

        showToast(error.message || "Failed to save task to server. Check database connection.", "error");
    }
}

async function handleSurveySubmit(event) {
    event.preventDefault();
    const surveyId = String(document.getElementById("sId")?.value || state.editingSurveyId || "").trim();
    const titleInput = document.getElementById("sTitle");
    const pointsInput = document.getElementById("sPoints");
    const title = String(titleInput?.value || "").trim();
    const rewardPoints = toNumber(pointsInput?.value, 0);

    let questions = [];
    try {
        questions = collectSurveyQuestions();
    } catch (error) {
        showToast(error.message || "Survey questions are invalid.", "error");
        return;
    }

    if (!title) {
        showToast("Survey title is required.", "error");
        titleInput?.focus();
        return;
    }

    if (!Number.isFinite(rewardPoints) || rewardPoints <= 0) {
        showToast("Reward points are required.", "error");
        pointsInput?.focus();
        return;
    }

    if (!questions.length) {
        showToast("Add at least one survey question.", "error");
        return;
    }

    const body = {
        title,
        description: document.getElementById("sDesc")?.value.trim(),
        rewardPoints,
        taskType: "survey",
        status: document.getElementById("sStatus")?.value || "active",
        notifyUsers: Boolean(document.getElementById("sNotifyUsers")?.checked),
        questions
    };

    try {
        const isEdit = event.target.dataset.mode === "edit";
        const isMongoId = surveyId && /^[0-9a-fA-F]{24}$/.test(String(surveyId).trim());

        const response = await submitAdminTask({
            isEdit: isEdit && isMongoId,
            taskId: surveyId,
            body,
            successMessage: isEdit ? "Survey updated." : "Survey created and synced."
        });

        // Update local catalog immediately so surveys appear for users.
        try {
            upsertLocalTask(buildLocalTaskPayload({ id: response?.id || surveyId, body, taskTypeOverride: "survey" }));
        } catch (_) {
            // ignore local catalog failures
        }

        await refreshAdminData();
        closeModal("surveyModal");
        resetSurveyEditor();
        showToast(response?.message || (isEdit ? "Survey updated." : "Survey created."), "success");
    } catch (error) {
        const msg = String(error?.message || "");
        const isValidation = /add at least one survey question|fill all|required survey fields/i.test(msg);
        if (isValidation || isOfflineTaskError(error)) {
            try {
                upsertLocalTask(buildLocalTaskPayload({ id: surveyId || undefined, body, taskTypeOverride: "survey" }));
                await refreshAdminData();
                closeModal("surveyModal");
                resetSurveyEditor();
                showToast("Survey saved locally (backend rejected).", "warning");
                return;
            } catch (_) {
                // fall through to showing original error
            }
        }

        showToast(error.message || "Failed to save survey to server. Check database connection.", "error");
    }
}

async function handleGiftUser(event) {
    event.preventDefault();
    const userId = document.getElementById("giftUserId")?.value;
    const title = document.getElementById("giftTitle")?.value.trim();
    const points = toNumber(document.getElementById("giftPoints")?.value, 0);

    try {
        await requestFirst([
            { path: `/users/${userId}/gift`, method: "POST", body: { title, points } },
            { path: "/gift", method: "POST", body: { userId, title, points } }
        ], { auth: true });
        closeModal("giftModal");
        event.target.reset();
        await refreshAdminData();
        showToast("Gift sent.", "success");
    } catch (error) {
        showToast(error.message || "Gift failed.", "error");
    }
}

async function handleGiftAll(event) {
    event.preventDefault();
    const body = {
        title: document.getElementById("giftAllTitle")?.value.trim(),
        message: document.getElementById("giftAllMsg")?.value.trim(),
        points: toNumber(document.getElementById("giftAllPoints")?.value, 0)
    };

    try {
        await requestFirst([
            { path: "/users/gift-all", method: "POST", body },
            { path: "/gift-all", method: "POST", body }
        ], { auth: true });
        closeModal("giftAllModal");
        event.target.reset();
        await refreshAdminData();
        showToast("Gift sent to all users.", "success");
    } catch (error) {
        showToast(error.message || "Bulk gift failed.", "error");
    }
}

async function handleUserTableActions(event) {
    const giftButton = event.target.closest("[data-user-gift]");
    const deleteButton = event.target.closest("[data-user-delete]");

    if (giftButton) {
        document.getElementById("giftUserId").value = giftButton.dataset.userGift;
        openModal("giftModal");
        return;
    }

    if (!deleteButton) return;
    if (!window.confirm("Delete this user?")) return;

    try {
        await requestFirst([{ path: `/users/${deleteButton.dataset.userDelete}`, method: "DELETE" }]);
        await refreshAdminData();
        showToast("User deleted.", "warning");
    } catch (error) {
        showToast(error.message || "User delete failed.", "error");
    }
}

async function handleTaskTableActions(event) {
    const editButton = event.target.closest("[data-task-edit]");
    const deleteButton = event.target.closest("[data-task-delete]");
    if (editButton) {
        const task = state.tasks.find((item) => String(item.id) === String(editButton.dataset.taskEdit));
        if (!task) {
            showToast("Task not found.", "error");
            return;
        }

        if (String(task.taskType || "").toLowerCase() === "survey") {
            openSurveyEditor(task);
        } else {
            openTaskEditor(task);
        }
        return;
    }

    if (!deleteButton) return;
    if (!window.confirm("Delete this task?")) return;

    try {
        await requestFirst([{ path: `/tasks/${deleteButton.dataset.taskDelete}`, method: "DELETE" }]);
        await refreshAdminData();
        showToast("Task deleted.", "warning");
    } catch (error) {
        if (isAuthTaskError(error)) {
            showToast(error.message || "Task delete failed.", "error");
            return;
        }

        if (!isOfflineTaskError(error) && !isValidationTaskError(error) && error?.status !== 404) {
            showToast(error.message || "Task delete failed.", "error");
            return;
        }

        removeLocalTask(deleteButton.dataset.taskDelete);
        state.tasks = getLocalTaskCatalog().map(normalizeTaskRecord);
        renderTasks();
        renderOverview();
        showToast("Task deleted locally. Backend did not remove the record, so this browser catalog was updated.", "warning");
    }
}

function showAuthScreen() {
    refs.authScreen?.classList.remove("hidden");
    refs.appInterface?.classList.add("hidden");
    setLiveStatus("signed_out");
    setConnectionStatus("signed_out");
    stopRetryLoop();
}

function showApp({ status = "live" } = {}) {
    refs.authScreen?.classList.add("hidden");
    refs.appInterface?.classList.remove("hidden");
    switchTab("overview");
    setLiveStatus(status);
    setConnectionStatus(status);
}

function logout() {
    if (state.refreshTimer) {
        clearInterval(state.refreshTimer);
        state.refreshTimer = null;
    }
    clearAdminToken();
    showAuthScreen();
}

function setConnectionStatus(status) {
    state.connectionStatus = status === "offline" || status === "signed_out" ? status : "live";
    updateSystemBanner();
    toggleDataActions(state.connectionStatus === "live");
}

async function ensureDatabaseOnline() {
    const health = await fetchBackendHealth({ timeoutMs: 6500 });
    const dbOk = health.ok && String(health.database || "").toLowerCase() === "connected";

    if (!dbOk) {
        setConnectionStatus("offline");
        renderOverview();
        renderUsers();
        renderTasks();
        renderLeaderboards();
        renderActivity();
        renderJoinAlerts();
        return false;
    }

    setConnectionStatus("live");
    return true;
}

function updateSystemBanner() {
    const banner = refs.systemBanner;
    if (!banner) return;

    banner.classList.remove("is-live", "is-signedout");

    if (state.connectionStatus === "live") {
        banner.classList.add("hidden");
        return;
    }

    banner.classList.remove("hidden");

    if (state.connectionStatus === "signed_out") {
        banner.classList.add("is-signedout");
        if (refs.systemBannerTitle) refs.systemBannerTitle.textContent = "Signed out";
        if (refs.systemBannerMessage) refs.systemBannerMessage.textContent = "Please sign in again to access admin tools.";
        if (refs.systemBannerRetryBtn) refs.systemBannerRetryBtn.textContent = "Login";
        return;
    }

    if (refs.systemBannerTitle) refs.systemBannerTitle.textContent = "Database offline";
    if (refs.systemBannerMessage) refs.systemBannerMessage.textContent = "MongoDB is not connected. Local task data is still available here. Start MongoDB / check MONGO_URI, then click Retry once.";
    if (refs.systemBannerRetryBtn) refs.systemBannerRetryBtn.textContent = "Retry";
}

function toggleDataActions(enabled) {
    const selectors = [
        "#openGiftAllBtn",
        "#overviewGiftAllBtn",
        "#giftForm button[type=\"submit\"]",
        "#giftAllForm button[type=\"submit\"]"
    ];

    selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((el) => {
            if (el instanceof HTMLButtonElement) {
                el.disabled = !enabled;
            }
        });
    });
}

async function retrySync() {
    if (state.connectionStatus === "signed_out") {
        showAuthScreen();
        return;
    }

    try {
        const dbOnline = await ensureDatabaseOnline();
        if (!dbOnline) {
            showToast("Database is still offline.", "warning");
            return;
        }

        await refreshAdminData();
        showToast("Synced successfully.", "success");
    } catch (error) {
        if (error?.code === "DB_OFFLINE" || error?.status === 503) {
            setConnectionStatus("offline");
            showToast(error.message || "Database is still offline.", "warning");
            return;
        }

        showToast(error.message || "Sync failed.", "error");
    }
}

function startRetryLoop() {
    // Background polling is intentionally disabled while offline to avoid
    // repeated 503 spam in the browser console. Use the Retry button for a
    // single manual attempt after MongoDB is back online.
    stopRetryLoop();
}

function stopRetryLoop() {
    if (state.retryTimer) {
        clearInterval(state.retryTimer);
        state.retryTimer = null;
    }
}

function handleBackgroundRefreshError(error) {
    if (error?.status === 401 || error?.status === 403) {
        showToast(error.message || "Session expired. Please sign in again.", "error");
        logout();
        return;
    }

    if (error?.code === "DB_OFFLINE" || error?.status === 503) {
        const wasLive = state.connectionStatus === "live";
        setConnectionStatus("offline");

        if (state.refreshTimer) {
            clearInterval(state.refreshTimer);
            state.refreshTimer = null;
        }

        if (wasLive) {
            showToast(error.message || "Database went offline. Retrying...", "warning");
        }
    }
}

function switchTab(tabId) {
    document.querySelectorAll(".section").forEach((section) => {
        section.classList.toggle("active", section.id === tabId);
        section.classList.toggle("hidden", section.id !== tabId);
    });

    document.querySelectorAll(".nav-item[data-tab]").forEach((button) => {
        button.classList.toggle("active", button.dataset.tab === tabId);
    });

    document.querySelectorAll("[data-tab-jump]").forEach((button) => {
        button.classList.toggle("active", button.dataset.tabJump === tabId);
    });

    if (refs.pageTitle) refs.pageTitle.textContent = capitalize(tabId);
    closeSidebar();
}

function openModal(id) {
    document.getElementById(id)?.classList.add("active");
}

function closeModal(id) {
    document.getElementById(id)?.classList.remove("active");
    if (id === "taskModal") {
        resetTaskEditor();
        return;
    }

    if (id === "surveyModal") {
        resetSurveyEditor();
    }
}

function toggleSidebar() {
    refs.sidebar?.classList.toggle("open");
    refs.sidebarOverlay?.classList.toggle("active");
}

function closeSidebar() {
    refs.sidebar?.classList.remove("open");
    refs.sidebarOverlay?.classList.remove("active");
}

function updateClock() {
    if (refs.headerTime) {
        refs.headerTime.textContent = new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
    }
}

function showToast(message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    refs.toastBox?.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3400);
}

function playNotificationSound() {
    refs.notifSound?.play().catch(() => { });
}

function setLiveStatus(status) {
    if (!refs.liveChip) return;

    refs.liveChip.classList.remove("is-offline", "is-signedout");

    const normalized = typeof status === "string"
        ? status
        : (status ? "live" : "signed_out");

    if (normalized === "offline") {
        refs.liveChip.classList.add("is-offline");
        refs.liveChip.innerHTML = `<i class="ri-cloud-off-line"></i> DB Offline`;
        if (refs.overviewSyncStatus) {
            refs.overviewSyncStatus.textContent = "Database offline";
        }
        return;
    }

    if (normalized === "signed_out") {
        refs.liveChip.classList.add("is-signedout");
        refs.liveChip.innerHTML = `<i class="ri-logout-circle-line"></i> Signed out`;
        if (refs.overviewSyncStatus) {
            refs.overviewSyncStatus.textContent = "Signed out";
        }
        return;
    }

    refs.liveChip.innerHTML = `<i class="ri-radar-line"></i> Synced`;
    if (refs.overviewSyncStatus) {
        refs.overviewSyncStatus.textContent = "Live data ready";
    }
}

function setStat(id, value) {
    const element = document.getElementById(id);
    if (!element) {
        return;
    }

    if (typeof value === "string") {
        element.textContent = value;
        return;
    }

    element.textContent = formatNumber(value);
}

function setTokenStat(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = typeof value === "string" ? value : formatToken(value);
    }
}

function formatNumber(value) {
    return Math.round(toNumber(value, 0)).toLocaleString("en-IN");
}

function formatToken(value) {
    const numeric = toNumber(value, 0);
    return numeric.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function normalizeActivityFeed(items) {
    return (Array.isArray(items) ? items : []).map((item) => ({
        message: item.message || item.title || "Admin activity",
        time: item.time || item.createdAt || item.timestamp || Date.now()
    }));
}

function renderFeedItem(item) {
    return `
        <div class="feed-item">
            <div class="feed-title">${escapeHtml(item.message)}</div>
            <div class="feed-meta">${escapeHtml(formatDateTime(item.time))}</div>
        </div>
    `;
}

function toMillis(value) {
    if (!value) return 0;
    if (typeof value === "number") return value > 100_000_000_000 ? value : value * 1000;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function initTheme() {
    const saved = localStorage.getItem("anvi_admin_theme") || "dark";
    setTheme(saved);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(current === "dark" ? "light" : "dark");
}

function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("anvi_admin_theme", theme);
    if (refs.themeToggle) {
        refs.themeToggle.innerHTML = theme === "dark" ? '<i class="ri-sun-line"></i>' : '<i class="ri-moon-line"></i>';
    }
}
