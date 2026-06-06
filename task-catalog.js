(function initTaskCatalog(globalScope) {
    const STORAGE_KEY = "anvi-task-catalog";

    const DEFAULT_CATALOG = [
        {
            id: "daily-checkin",
            seedKey: "daily-checkin",
            title: "Daily Check-in",
            description: "Open the app once a day to keep your streak active.",
            link: "",
            rewardPoints: 10,
            taskType: "daily",
            status: "active",
            notifyUsers: false,
            questions: []
        },
        {
            id: "watch-tutorial",
            seedKey: "watch-tutorial",
            title: "Watch Tutorial",
            description: "Watch the guided tutorial for 10 seconds.",
            link: "",
            rewardPoints: 15,
            taskType: "daily",
            status: "active",
            notifyUsers: false,
            questions: []
        },
        {
            id: "invite-a-friend",
            seedKey: "invite-a-friend",
            title: "Invite a Friend",
            description: "Invite one friend and grow your reward network.",
            link: "",
            rewardPoints: 50,
            taskType: "task",
            status: "active",
            notifyUsers: false,
            questions: []
        }
    ];

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

    function normalizeQuestion(question = {}, index = 0) {
        const type = String(question.type || "radio").trim().toLowerCase() === "text" ? "text" : "radio";
        return {
            id: String(question.id || question.key || `q${index + 1}`).trim() || `q${index + 1}`,
            text: String(question.text || question.title || "").trim(),
            type,
            options: Array.isArray(question.options) ? question.options.map((option) => String(option || "").trim()).filter(Boolean) : [],
            placeholder: String(question.placeholder || "").trim()
        };
    }

    function normalizeTask(task = {}, index = 0) {
        const rawQuestions = Array.isArray(task.questions)
            ? task.questions
            : safeJsonParse(task.questions, []);
        const questions = (Array.isArray(rawQuestions) ? rawQuestions : []).map(normalizeQuestion).filter((question) => question.text);

        return {
            id: String(task.id || task._id || `task-${index + 1}`).trim(),
            seedKey: String(task.seedKey || "").trim(),
            title: String(task.title || "Task").trim(),
            description: String(task.description || task.desc || "").trim(),
            link: String(task.link || task.url || "").trim(),
            rewardPoints: Number(task.rewardPoints ?? task.points ?? task.reward ?? 0) || 0,
            taskType: String(task.taskType || task.type || "task").trim().toLowerCase(),
            status: String(task.status || "active").trim().toLowerCase(),
            notifyUsers: Boolean(task.notifyUsers),
            questions
        };
    }

    const LEGACY_SURVEY_IDS = new Set(["survey_001", "survey_002", "survey_003"]);
    const LEGACY_SURVEY_SEED_KEYS = new Set([
        "survey-product-feedback",
        "survey-user-experience",
        "survey-market-research"
    ]);

    function isLegacySurveyTask(task = {}) {
        const id = String(task.id || task._id || "").trim();
        const seedKey = String(task.seedKey || "").trim().toLowerCase();
        return LEGACY_SURVEY_IDS.has(id) || LEGACY_SURVEY_SEED_KEYS.has(seedKey);
    }

    function filterLegacySurveyTasks(items) {
        return (Array.isArray(items) ? items : []).filter((task) => !isLegacySurveyTask(task));
    }

    function readRawCatalog() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? safeJsonParse(raw, null) : null;
            return Array.isArray(parsed) ? filterLegacySurveyTasks(parsed) : parsed;
        } catch (_) {
            return null;
        }
    }

    function normalizeCatalog(items) {
        return filterLegacySurveyTasks(items)
            .map((item, index) => normalizeTask(item, index))
            .filter((task) => Boolean(task.id));
    }

    function writeCatalog(items) {
        const normalized = normalizeCatalog(items);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        } catch (_) {
            // Ignore storage failures.
        }
        return normalized;
    }

    function ensureCatalog() {
        const existing = readRawCatalog();
        if (Array.isArray(existing)) {
            if (existing.length) {
                return normalizeCatalog(existing);
            }
            return writeCatalog(DEFAULT_CATALOG);
        }

        return writeCatalog(DEFAULT_CATALOG);
    }

    function getAll() {
        return ensureCatalog();
    }

    function saveAll(items) {
        return writeCatalog(items);
    }

    function upsert(item) {
        const next = getAll();
        const normalized = normalizeTask(item, next.length);
        const matchIndex = next.findIndex((existing) =>
            existing.id === normalized.id
            || (normalized.seedKey && existing.seedKey === normalized.seedKey)
            || (normalized.seedKey && existing.id === normalized.seedKey)
        );

        if (matchIndex >= 0) {
            next[matchIndex] = {
                ...next[matchIndex],
                ...normalized,
                id: next[matchIndex].id || normalized.id
            };
        } else {
            next.unshift(normalized);
        }

        return saveAll(next);
    }

    function remove(id) {
        const target = String(id || "").trim();
        const next = getAll().filter((item) => item.id !== target && item.seedKey !== target);
        return saveAll(next);
    }

    function clear() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (_) {
            // Ignore.
        }
    }

    globalScope.AnviTaskCatalog = {
        getAll,
        saveAll,
        upsert,
        remove,
        clear,
        normalizeTask,
        normalizeQuestion
    };
})(globalThis);
