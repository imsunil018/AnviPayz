let rechargeStageError = null;
let rechargeLoadingMode = "lookup";
let rechargeCheckoutContext = null;
let rechargeFlowStage = "entry";
let rechargeActiveCategory = "popular";
let rechargeDetectedDetails = null;
let rechargeOperatorOverride = "";
let rechargePlanGroups = [];
let rechargeSelectedPlanId = "";
let rechargeSelectedPlan = null;
let rechargeCheckoutState = null;
let rechargeManualOperatorOpen = false;
let rechargeUseTokens = true;
let rechargeLookupNonce = 0;
let rechargePlansNonce = 0;
let rechargeCheckoutNonce = 0;
let rechargePayNonce = 0;
let rechargeLookupTimer = null;
const RECHARGE_HISTORY_STORAGE_KEY = "anvi-recharge-history";
const RECHARGE_SAVED_STORAGE_KEY = "anvi-recharge-saved";
let rechargePlanSearchQuery = "";
const RECHARGE_OPERATOR_OPTIONS = ["Jio", "Airtel", "Vi", "BSNL"];

function initRechargePage() {
    resetRechargeFlow(true);
    renderCommonUserState();
    renderRechargeTokenBalance();
    renderRechargeQuickLists();
    bindRechargeForm();
    bindRechargeShellEvents();
    bindRechargeStageEvents();
    renderRechargeStage();
    updateRechargePrimaryButton();
    updateRechargeStatus("Enter a 10-digit mobile number to start.");
}

function bindRechargeShellEvents() {
    const shell = document.querySelector(".rx-shell");
    if (!shell || shell.dataset.bound === "1") {
        return;
    }

    shell.dataset.bound = "1";
    shell.addEventListener("click", async (event) => {
        const trigger = event.target.closest("[data-recharge-action]");
        if (!trigger) {
            return;
        }

        const action = String(trigger.dataset.rechargeAction || "");
        const value = String(trigger.dataset.value || "");

        if (action === "use-mobile") {
            const mobileInput = document.getElementById("recharge-mobile");
            if (mobileInput) {
                mobileInput.value = value;
                mobileInput.dispatchEvent(new Event("input", { bubbles: true }));
                mobileInput.focus();
            }
            return;
        }

        if (action === "operator-pick") {
            setRechargeOperator(value);
            rechargeManualOperatorOpen = true;
            renderRechargeStage();
            updateRechargePrimaryButton();
            updateRechargeStatus(value ? `${value} selected. Loading plans...` : "Select an operator to continue.");

            if (isValidRechargeMobile(cleanRechargeMobile()) && rechargeFlowStage !== "loading") {
                await loadRechargePlans();
            }
        }
    });
}

function bindRechargeForm() {
    const form = document.getElementById("recharge-form");
    const mobileInput = document.getElementById("recharge-mobile");

    if (form?.dataset.bound === "1") {
        return;
    }

    form.dataset.bound = "1";
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        await handleRechargePrimaryAction();
    });

    mobileInput?.addEventListener("input", () => {
        const cleaned = cleanRechargeMobile();
        if (mobileInput.value !== cleaned) {
            mobileInput.value = cleaned;
        }

        if (rechargeLookupTimer) {
            window.clearTimeout(rechargeLookupTimer);
            rechargeLookupTimer = null;
        }

        if (cleaned.length < 10) {
            resetRechargeFlow(true);
            renderRechargeStage();
            updateRechargePrimaryButton();
            updateRechargeStatus("Enter a 10-digit mobile number to start.");
            return;
        }

        if (rechargeFlowStage === "entry") {
            updateRechargeStatus("Number complete. Detecting operator...");
            updateRechargePrimaryButton();
            rechargeLookupTimer = window.setTimeout(() => {
                if (cleanRechargeMobile() === cleaned && rechargeFlowStage === "entry") {
                    startRechargeLookup();
                }
            }, 420);
        }
    });
}

function bindRechargeStageEvents() {
    const stage = document.getElementById("recharge-stage");
    if (!stage || stage.dataset.bound === "1") {
        return;
    }

    stage.dataset.bound = "1";

    stage.addEventListener("click", async (event) => {
        const trigger = event.target.closest("[data-recharge-action]");
        if (!trigger) {
            return;
        }

        const action = String(trigger.dataset.rechargeAction || "");
        const value = String(trigger.dataset.value || "");

        if (action === "use-mobile") {
            const mobileInput = document.getElementById("recharge-mobile");
            if (mobileInput) {
                mobileInput.value = value;
                mobileInput.dispatchEvent(new Event("input", { bubbles: true }));
                mobileInput.focus();
            }
            return;
        }

        if (action === "edit-operator") {
            rechargeManualOperatorOpen = true;
            renderRechargeStage();
            updateRechargePrimaryButton();
            return;
        }

        if (action === "retry-lookup") {
            await startRechargeLookup();
            return;
        }

        if (action === "load-plans" || action === "retry-plans") {
            await loadRechargePlans();
            return;
        }

        if (action === "tab") {
            rechargeActiveCategory = value;
            renderRechargeStage();
            return;
        }

        if (action === "clear-plan-search") {
            rechargePlanSearchQuery = "";
            rerenderRechargeStagePreservingSearch();
            updateRechargePrimaryButton();
            return;
        }

        if (action === "plan") {
            await selectRechargePlan(value);
            return;
        }

        if (action === "retry-error") {
            await retryRechargeFlow();
        }
    });

    stage.addEventListener("change", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const action = String(target.dataset.rechargeAction || "");
        if (action === "operator-select") {
            setRechargeOperator(target.value || "");
            rechargeManualOperatorOpen = true;
            renderRechargeStage();
            updateRechargePrimaryButton();
            updateRechargeStatus(target.value ? `${target.value} selected. Loading plans...` : "Select an operator to continue.");
            if (target.value && isValidRechargeMobile(cleanRechargeMobile()) && rechargeFlowStage !== "loading") {
                await loadRechargePlans();
            }
            return;
        }

        if (action === "use-tokens") {
            rechargeUseTokens = Boolean(target.checked);
            await syncRechargeCheckout();
        }
    });

    stage.addEventListener("input", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }

        if (String(target.dataset.rechargeAction || "") === "plan-search") {
            rechargePlanSearchQuery = target.value || "";
            rerenderRechargeStagePreservingSearch();
            updateRechargePrimaryButton();
        }
    });
}

function renderRechargeTokenBalance() {
    const tokens = Number(state.user?.tokens || 0);
    const formatted = formatDecimal(tokens);
    setText("rx-token-balance", `${formatted} Tokens`);
    setText("rx-token-discount-value", `₹${formatted}`);
}

function renderRechargeQuickLists() {
    renderRechargeRecentNumbers();
    renderRechargeSavedNumbers();
}

function getRechargeRecentEntries() {
    const stored = readStore(RECHARGE_HISTORY_STORAGE_KEY, []);
    return uniqueByKey(Array.isArray(stored) ? stored : [], (item) => `${item.mobile || ""}:${item.time || ""}`)
        .filter((item) => /^\d{10}$/.test(String(item.mobile || "")))
        .sort((a, b) => toTimestamp(b.time) - toTimestamp(a.time))
        .slice(0, 4);
}

function getRechargeSavedNumbers() {
    const stored = readStore(RECHARGE_SAVED_STORAGE_KEY, []);
    return uniqueByKey(Array.isArray(stored) ? stored : [], (item) => String(item.mobile || ""))
        .filter((item) => /^\d{10}$/.test(String(item.mobile || "")))
        .sort((a, b) => toTimestamp(b.time) - toTimestamp(a.time))
        .slice(0, 4);
}

function renderRechargeRecentNumbers() {
    const container = document.getElementById("recent-recharges-list");
    if (!container) return;

    const items = getRechargeRecentEntries();
    if (!items.length) {
        container.innerHTML = `<span class="rx-chip" data-kind="empty">No recent recharges yet</span>`;
        return;
    }

    container.innerHTML = items.map((item) => `
        <button type="button" class="rx-chip" data-recharge-action="use-mobile" data-value="${escapeHtml(String(item.mobile || ""))}">
            ${escapeHtml(formatRechargeLabel(item.mobile, item.amount ? `₹${formatDecimal(item.amount)}` : ""))}
        </button>
    `).join("");
}

function renderRechargeSavedNumbers() {
    const container = document.getElementById("saved-numbers-list");
    if (!container) return;

    const items = getRechargeSavedNumbers();
    if (!items.length) {
        container.innerHTML = `<span class="rx-chip" data-kind="empty">Save a number after your first recharge</span>`;
        return;
    }

    container.innerHTML = items.map((item) => `
        <button type="button" class="rx-chip" data-recharge-action="use-mobile" data-value="${escapeHtml(String(item.mobile || ""))}">
            ${escapeHtml(formatRechargeLabel(item.mobile, item.label || item.operator || "Saved"))}
        </button>
    `).join("");
}

function formatRechargeLabel(mobile, suffix) {
    const digits = String(mobile || "").replace(/\D/g, "");
    const short = digits.length === 10 ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}` : digits;
    return suffix ? `${short} · ${suffix}` : short;
}

function resetRechargeFlow(clearPlanState = false) {
    rechargeFlowStage = "entry";
    rechargeDetectedDetails = null;
    rechargeOperatorOverride = "";
    rechargeCheckoutContext = null;
    rechargeCheckoutState = null;
    rechargeSelectedPlanId = "";
    rechargeSelectedPlan = null;
    rechargeManualOperatorOpen = false;
    rechargeActiveCategory = "popular";
    rechargeStageError = null;
    rechargeUseTokens = true;
    rechargeLoadingMode = "lookup";
    rechargePlanSearchQuery = "";

    if (clearPlanState) {
        rechargePlanGroups = [];
    }
}

async function handleRechargePrimaryAction() {
    if (rechargeFlowStage === "loading") {
        return;
    }

    if (rechargeFlowStage === "entry") {
        await startRechargeLookup();
        return;
    }

    if (rechargeFlowStage === "detected") {
        await loadRechargePlans();
        return;
    }

    if (rechargeFlowStage === "plans") {
        if (!rechargeSelectedPlan) {
            updateRechargeStatus("Choose a plan before continuing.");
            showToast("Choose a plan before continuing.", "error");
            return;
        }
        await handleRechargePay();
        return;
    }

    if (rechargeFlowStage === "empty" || rechargeFlowStage === "error") {
        await retryRechargeFlow();
    }
}

async function retryRechargeFlow() {
    if (rechargeDetectedDetails?.operator) {
        await loadRechargePlans();
        return;
    }

    await startRechargeLookup();
}

async function startRechargeLookup() {
    const mobile = cleanRechargeMobile();
    if (!isValidRechargeMobile(mobile)) {
        updateRechargeStatus("Please enter a valid 10-digit mobile number.");
        showToast("Enter a valid 10-digit mobile number.", "error");
        updateRechargePrimaryButton();
        return;
    }

    rechargeFlowStage = "loading";
    rechargeLoadingMode = "lookup";
    rechargeCheckoutContext = null;
    rechargeCheckoutState = null;
    rechargeSelectedPlan = null;
    rechargeSelectedPlanId = "";
    rechargePlanGroups = [];
    renderRechargeStage();
    updateRechargePrimaryButton();
    updateRechargeStatus("Detecting operator...");

    const nonce = ++rechargeLookupNonce;
    await delay(220);

    try {
        const lookup = await requestRechargeLookup(mobile);
        if (nonce !== rechargeLookupNonce) {
            return;
        }

        rechargeDetectedDetails = normalizeRechargeLookupResponse(lookup, mobile);
        rechargeManualOperatorOpen = !rechargeDetectedDetails.operator;
        rechargeFlowStage = "detected";
        renderRechargeStage();
        updateRechargePrimaryButton();
        updateRechargeStatus(rechargeDetectedDetails.operator
            ? "Operator detected. Loading recharge plans..."
            : "Operator not found. Select one manually to continue.");

        if (!rechargeDetectedDetails.operator) {
            return;
        }

        await delay(220);
        await loadRechargePlans();
    } catch (error) {
        if (nonce !== rechargeLookupNonce) {
            return;
        }

        rechargeFlowStage = "error";
        rechargeStageError = {
            title: "Network Error",
            copy: error?.message || "We could not detect the operator right now. Retry to continue."
        };
        renderRechargeStage();
        updateRechargePrimaryButton();
        updateRechargeStatus(rechargeStageError.copy);
        showToast(rechargeStageError.copy, "error");
    }
}

async function loadRechargePlans() {
    const mobile = cleanRechargeMobile();
    const operator = getRechargeOperator();
    const circle = getRechargeCircle();
    const rechargeType = String(rechargeDetectedDetails?.rechargeType || "Prepaid").trim() || "Prepaid";

    if (!isValidRechargeMobile(mobile)) {
        updateRechargeStatus("Enter a valid 10-digit mobile number first.");
        return;
    }

    if (!operator) {
        rechargeFlowStage = "detected";
        rechargeManualOperatorOpen = true;
        renderRechargeStage();
        updateRechargePrimaryButton();
        updateRechargeStatus("Select an operator to load plans.");
        return;
    }

    rechargeFlowStage = "loading";
    rechargeLoadingMode = "plans";
    rechargeCheckoutContext = null;
    rechargeCheckoutState = null;
    renderRechargeStage();
    updateRechargePrimaryButton();
    updateRechargeStatus("Loading recharge plans...");

    const nonce = ++rechargePlansNonce;
    await delay(180);

    try {
        const response = await requestRechargePlans({ operator, circle, rechargeType });
        if (nonce !== rechargePlansNonce) {
            return;
        }

        const normalized = normalizeRechargePlanGroups(response);
        rechargePlanGroups = normalized.groups;
        rechargeActiveCategory = normalized.defaultCategory || "all";
        rechargePlanSearchQuery = "";
        rechargeSelectedPlanId = "";
        rechargeSelectedPlan = null;
        rechargeCheckoutState = null;

        if (!rechargePlanGroups.length) {
            rechargeFlowStage = "empty";
            renderRechargeStage();
            updateRechargePrimaryButton();
            updateRechargeStatus("Plans are not available right now.");
            return;
        }

        rechargeFlowStage = "plans";
        renderRechargeStage();
        updateRechargePrimaryButton();
        updateRechargeStatus("Choose a plan to reveal checkout summary.");
    } catch (error) {
        if (nonce !== rechargePlansNonce) {
            return;
        }

        rechargeFlowStage = "error";
        rechargeStageError = {
            title: "Plans not available",
            copy: error?.message || "Unable to load recharge plans right now."
        };
        renderRechargeStage();
        updateRechargePrimaryButton();
        updateRechargeStatus(rechargeStageError.copy);
        showToast(rechargeStageError.copy, "error");
    }
}

async function selectRechargePlan(planId) {
    const plan = findRechargePlanById(planId);
    if (!plan) {
        return;
    }

    rechargeSelectedPlanId = String(plan.id || plan.planId || plan.amount || "");
    rechargeSelectedPlan = plan;
    rechargeActiveCategory = plan.category || rechargeActiveCategory || "popular";
    renderRechargeStage();
    updateRechargePrimaryButton();
    updateRechargeStatus(`Selected ₹${formatDecimal(numberFrom(plan.amount, 0))}. Calculating checkout...`);
    await syncRechargeCheckout();
}

async function syncRechargeCheckout() {
    if (!rechargeSelectedPlan) {
        rechargeCheckoutState = null;
        renderRechargeStage();
        updateRechargePrimaryButton();
        return;
    }

    const nonce = ++rechargeCheckoutNonce;
    const payload = buildRechargeCheckoutPayload();
    rechargeCheckoutState = {
        loading: true,
        discount: 0,
        payable: numberFrom(payload.amount, 0),
        availableTokens: numberFrom(state.user?.tokens, 0)
    };
    renderRechargeStage();

    try {
        const response = await requestRechargeCheckout(payload);
        if (nonce !== rechargeCheckoutNonce) {
            return;
        }

        rechargeCheckoutState = normalizeRechargeCheckout(response, payload);
        renderRechargeStage();
        updateRechargePrimaryButton();
        updateRechargeStatus(rechargeCheckoutState.message || `Final payable amount updated for ₹${formatDecimal(payload.amount)}.`);
    } catch (error) {
        if (nonce !== rechargeCheckoutNonce) {
            return;
        }

        rechargeCheckoutState = {
            loading: false,
            error: true,
            discount: 0,
            payable: numberFrom(payload.amount, 0),
            availableTokens: numberFrom(state.user?.tokens, 0),
            message: error?.message || "Checkout calculation failed."
        };
        renderRechargeStage();
        updateRechargePrimaryButton();
        updateRechargeStatus(rechargeCheckoutState.message);
        showToast(rechargeCheckoutState.message, "error");
    }
}

async function handleRechargePay() {
    if (!rechargeSelectedPlan) {
        updateRechargeStatus("Choose a plan before continuing.");
        showToast("Choose a plan before continuing.", "error");
        return;
    }

    const button = document.getElementById("recharge-primary-btn");
    const payload = buildRechargePayPayload();

    await withButtonState(button, "Coming Soon...", async () => {
        recordRechargeContext(payload);
        rechargeCheckoutState = {
            ...(rechargeCheckoutState || {}),
            loading: false,
            error: false,
            message: "Payment integration coming soon."
        };
        renderRechargeStage();
        updateRechargePrimaryButton();
        updateRechargeStatus("Payment integration is coming soon. Use search and compare plans for now.");
        showToast("Payment integration coming soon. Plan search and comparison are live.", "warning");
    });
}

function renderRechargeStage() {
    const stage = document.getElementById("recharge-stage");
    if (!stage) {
        return;
    }

    if (rechargeFlowStage === "entry") {
        stage.innerHTML = renderRechargeEntryStage();
        return;
    }

    if (rechargeFlowStage === "loading") {
        stage.innerHTML = renderRechargeLoadingStage();
        return;
    }

    if (rechargeFlowStage === "detected") {
        stage.innerHTML = renderRechargeDetectedStage();
        return;
    }

    if (rechargeFlowStage === "plans") {
        stage.innerHTML = renderRechargePlansStage();
        return;
    }

    if (rechargeFlowStage === "empty") {
        stage.innerHTML = renderRechargeEmptyStage();
        return;
    }

    stage.innerHTML = renderRechargeErrorStage();
}

function rerenderRechargeStagePreservingSearch() {
    const searchInput = document.querySelector('[data-recharge-action="plan-search"]');
    const active = document.activeElement === searchInput ? searchInput : null;
    const selectionStart = active && typeof active.selectionStart === "number" ? active.selectionStart : null;
    const selectionEnd = active && typeof active.selectionEnd === "number" ? active.selectionEnd : null;
    const value = active ? active.value : rechargePlanSearchQuery;

    renderRechargeStage();

    const nextSearchInput = document.querySelector('[data-recharge-action="plan-search"]');
    if (nextSearchInput && value !== null) {
        nextSearchInput.value = value;
        if (active) {
            nextSearchInput.focus({ preventScroll: true });
            if (selectionStart !== null && selectionEnd !== null && typeof nextSearchInput.setSelectionRange === "function") {
                nextSearchInput.setSelectionRange(selectionStart, selectionEnd);
            }
        }
    }
}

function renderRechargeEntryStage() {
    return `
        <section class="rx-stage-card">
            <div class="rx-stage-head">
                <div>
                    <div class="rx-kicker">State 1</div>
                    <h2 class="rx-stage-title">Start with one mobile number</h2>
                    <p class="rx-copy">Only the entry card, token balance, shortcuts, and offers are visible at this point.</p>
                </div>
            </div>
            <div class="rx-step-list">
                <div class="rx-step-row">
                    <span class="rx-step-dot" aria-hidden="true"></span>
                    <div>
                        <strong style="display:block;color:var(--rx-text-strong);">Step 1</strong>
                        <span class="rx-step-copy">Enter mobile number</span>
                    </div>
                    <span class="rx-step-copy">Idle</span>
                </div>
            </div>
        </section>
    `;
}

function renderRechargeLoadingStage() {
    const heading = rechargeLoadingMode === "plans" ? "Loading recharge plans..." : "Detecting operator...";
    const copy = rechargeLoadingMode === "plans"
        ? "Fetching live plans, categories, and price options from the backend."
        : "Checking mobile number, detecting operator, detecting circle, and preparing plans.";

    return `
        <section class="rx-loading-card">
            <div class="rx-stage-head">
                <div>
                    <div class="rx-kicker">Loading</div>
                    <h2 class="rx-stage-title">${escapeHtml(heading)}</h2>
                    <p class="rx-copy">${escapeHtml(copy)}</p>
                </div>
            </div>
            <div class="rx-step-list" aria-hidden="true">
                <div class="rx-loading-step">
                    <span class="rx-step-dot rx-skeleton"></span>
                    <div class="rx-skeleton rx-loading-line small"></div>
                    <div class="rx-skeleton rx-loading-line xs"></div>
                </div>
                <div class="rx-loading-step">
                    <span class="rx-step-dot rx-skeleton"></span>
                    <div class="rx-skeleton rx-loading-line small"></div>
                    <div class="rx-skeleton rx-loading-line xs"></div>
                </div>
                <div class="rx-loading-step">
                    <span class="rx-step-dot rx-skeleton"></span>
                    <div class="rx-skeleton rx-loading-line small"></div>
                    <div class="rx-skeleton rx-loading-line xs"></div>
                </div>
                <div class="rx-loading-step">
                    <span class="rx-step-dot rx-skeleton"></span>
                    <div class="rx-skeleton rx-loading-line small"></div>
                    <div class="rx-skeleton rx-loading-line xs"></div>
                </div>
            </div>
        </section>
    `;
}

function renderRechargeDetectedStage() {
    const details = rechargeDetectedDetails || {};
    const mobile = cleanRechargeMobile();
    const operator = String(details.operator || "").trim();
    const circle = String(details.circle || "All India").trim() || "All India";
    const rechargeType = String(details.rechargeType || "Prepaid").trim() || "Prepaid";
    const activeOperator = getRechargeOperator();

    return `
        <section class="rx-stage-card">
            <div class="rx-stage-head">
                <div>
                    <div class="rx-kicker">State 3</div>
                    <h2 class="rx-stage-title">Operator detected</h2>
                    <p class="rx-copy">If the detection looks wrong, pick the operator manually below and continue.</p>
                </div>
                <button type="button" class="rx-secondary-btn" data-recharge-action="edit-operator">
                    <i class="ri-edit-line"></i>
                    Change
                </button>
            </div>
            <div class="rx-detection-card" style="padding:1rem;margin-top:1rem;display:grid;gap:0.85rem;">
                <div class="rx-summary-row">
                    <span>Mobile</span>
                    <strong>${escapeHtml(formatRechargeLabel(mobile))}</strong>
                </div>
                <div class="rx-summary-row">
                    <span>Operator</span>
                    <strong>${escapeHtml(operator || "Select operator")}</strong>
                </div>
                <div class="rx-summary-row">
                    <span>Circle</span>
                    <strong>${escapeHtml(circle)}</strong>
                </div>
                <div class="rx-summary-row">
                    <span>Recharge Type</span>
                    <strong>${escapeHtml(rechargeType)}</strong>
                </div>
            </div>
            <div class="rx-manual-panel" style="margin-top:1rem;">
                <div class="rx-stage-head" style="align-items:center;">
                    <div>
                        <strong style="display:block;color:var(--rx-text-strong);">Choose operator</strong>
                        <span class="rx-step-copy">Tap an operator or use the dropdown to continue.</span>
                    </div>
                </div>
                <div class="rx-operator-pills" role="list" aria-label="Operator options">
                    ${RECHARGE_OPERATOR_OPTIONS.map((item) => `
                        <button
                            type="button"
                            class="rx-chip rx-operator-chip${item === activeOperator ? " is-active" : ""}"
                            data-recharge-action="operator-pick"
                            data-value="${escapeHtml(item)}"
                            aria-pressed="${item === activeOperator ? "true" : "false"}"
                        >
                            ${escapeHtml(item)}
                        </button>
                    `).join("")}
                </div>
                <select class="rx-select" data-recharge-action="operator-select" aria-label="Operator">
                    <option value="">Choose operator</option>
                    ${RECHARGE_OPERATOR_OPTIONS.map((item) => `<option value="${escapeHtml(item)}"${item === activeOperator ? " selected" : ""}>${escapeHtml(item)}</option>`).join("")}
                </select>
                <p class="rx-step-copy">Press Continue or pick an operator chip to load recharge plans.</p>
            </div>
        </section>
    `;
}

function renderRechargePlansStage() {
    const selectedPlan = getSelectedRechargePlan();
    const groups = getRechargeVisiblePlanGroups();
    const activeGroup = groups.find((group) => group.key === rechargeActiveCategory) || groups[0];
    const summaryHidden = !selectedPlan;
    const hasSearch = Boolean(String(rechargePlanSearchQuery || "").trim());
    const visiblePlanCount = Array.from(new Map(
        groups.flatMap((group) => (group?.plans || []).map((plan) => [String(plan?.id || plan?.planId || plan?.amount || ""), plan]))
    ).values()).length;

    return `
        <div class="rx-stage-layout${summaryHidden ? " is-summary-hidden" : ""}">
            <section class="rx-stage-card">
                <div class="rx-stage-head">
                    <div>
                        <div class="rx-kicker">State 4</div>
                        <h2 class="rx-stage-title">Recharge plans</h2>
                        <p class="rx-copy">Search by amount, validity, data or benefit. Tap a plan to see the next step.</p>
                    </div>
                    <div class="rx-plan-count">${escapeHtml(`${visiblePlanCount} plans`)}</div>
                </div>

                <div class="rx-search-bar">
                    <i class="ri-search-line" aria-hidden="true"></i>
                    <input
                        type="search"
                        class="rx-search-input"
                        data-recharge-action="plan-search"
                        placeholder="Search plan, data, validity, price..."
                        value="${escapeHtml(rechargePlanSearchQuery || "")}"
                        aria-label="Search recharge plans"
                    >
                    ${hasSearch ? `
                        <button type="button" class="rx-search-clear" data-recharge-action="clear-plan-search" aria-label="Clear plan search">
                            <i class="ri-close-line"></i>
                        </button>
                    ` : ""}
                </div>

                <div class="rx-stage-tabs" role="tablist" aria-label="Recharge categories">
                    ${groups.map((group) => `
                        <button type="button" class="rx-tab${group.key === rechargeActiveCategory ? " active" : ""}" data-recharge-action="tab" data-value="${escapeHtml(group.key)}">${escapeHtml(`${group.label || titleCase(group.key)} (${numberFrom(group?.plans?.length, 0)})`)}</button>
                    `).join("")}
                </div>

                ${activeGroup?.plans?.length ? `
                    <div class="rx-plan-grid" aria-label="Recharge plans">
                        ${activeGroup.plans.map((plan, index) => renderRechargePlanCard(plan, index)).join("")}
                    </div>
                ` : `
                    <div class="rx-empty-card" style="margin-top:0.95rem;">
                        <strong>${hasSearch ? "No matching plans" : "No plans in this category"}</strong>
                        <p>${hasSearch ? "Try a different keyword like 199, 1.5 GB, or validity." : "Try another tab or retry the backend lookup."}</p>
                    </div>
                `}
            </section>

            ${summaryHidden ? "" : renderRechargeSummaryCard(selectedPlan)}
        </div>
    `;
}

function renderRechargeEmptyStage() {
    return `
        <section class="rx-empty-card">
            <div class="rx-stage-head">
                <div>
                    <div class="rx-kicker">No plans</div>
                    <h2 class="rx-stage-title">Plans not available</h2>
                    <p class="rx-copy">The backend did not return any recharge plans for this operator and circle.</p>
                </div>
            </div>
            <div class="rx-action-row">
                <button type="button" class="rx-action-btn" data-recharge-action="retry-plans">
                    <i class="ri-refresh-line"></i>
                    Retry
                </button>
            </div>
        </section>
    `;
}

function renderRechargeErrorStage() {
    const title = rechargeStageError?.title || "Something went wrong";
    const copy = rechargeStageError?.copy || "We could not continue the recharge flow right now.";

    return `
        <section class="rx-error-card">
            <div class="rx-stage-head">
                <div>
                    <div class="rx-kicker">Error</div>
                    <h2 class="rx-stage-title">${escapeHtml(title)}</h2>
                    <p class="rx-copy">${escapeHtml(copy)}</p>
                </div>
            </div>
            <div class="rx-action-row">
                <button type="button" class="rx-action-btn" data-recharge-action="retry-error">
                    <i class="ri-restart-line"></i>
                    Retry
                </button>
            </div>
        </section>
    `;
}

function renderRechargePlanCard(plan, index) {
    const amount = numberFrom(plan.amount, plan.price, 0);
    const isSelected = String(plan.id || plan.planId || amount) === String(rechargeSelectedPlanId);
    const badges = [];
    if (plan.recommended || plan.isRecommended || /recommended/i.test(String(plan.badge || ""))) {
        badges.push("Recommended");
    }
    if (plan.bestValue || plan.isBestValue || /best/i.test(String(plan.badge || ""))) {
        badges.push("Best Value");
    }
    if (plan.badge && !badges.includes(String(plan.badge))) {
        badges.push(String(plan.badge));
    }

    return `
        <button
            type="button"
            class="rx-plan-card${isSelected ? " selected" : ""}"
            data-recharge-action="plan"
            data-value="${escapeHtml(String(plan.id || plan.planId || amount))}"
            style="--delay:${index}"
        >
            <div class="rx-plan-top">
                <div>
                    <div class="rx-plan-price">₹${escapeHtml(formatDecimal(amount))}</div>
                    <div class="rx-plan-desc">${escapeHtml(plan.validity || plan.validityLabel || "Live plan")}</div>
                </div>
                <div class="rx-plan-badges">
                    ${badges.slice(0, 2).map((badge) => `<span class="rx-badge">${escapeHtml(badge)}</span>`).join("")}
                </div>
            </div>

            <div class="rx-plan-meta">
                <div>
                    <span>Daily Data</span>
                    <strong>${escapeHtml(plan.dailyData || plan.data || plan.dataAllowance || "Varies by plan")}</strong>
                </div>
                <div>
                    <span>Calls</span>
                    <strong>${escapeHtml(plan.calls || plan.voice || "Unlimited")}</strong>
                </div>
                <div>
                    <span>SMS</span>
                    <strong>${escapeHtml(plan.sms || plan.texts || "Included")}</strong>
                </div>
                <div>
                    <span>Extra Benefits</span>
                    <strong>${escapeHtml(plan.benefit || plan.benefits || "Live backend pricing")}</strong>
                </div>
            </div>

            <div class="rx-plan-footnote">
                ${escapeHtml(plan.description || "Tap to reveal checkout summary and token discount.")}
            </div>
        </button>
    `;
}

function renderRechargeSummaryCard(plan) {
    const checkout = rechargeCheckoutState || {};
    const availableTokens = numberFrom(checkout.availableTokens, state.user?.tokens, 0);
    const amount = numberFrom(plan.amount, 0);
    const discount = numberFrom(checkout.discount, 0);
    const payable = numberFrom(checkout.payable, amount);
    const loading = Boolean(checkout.loading);
    const error = Boolean(checkout.error);
    const summaryRows = loading
        ? `
            <div class="rx-summary-row"><span class="rx-skeleton rx-loading-line small"></span><strong class="rx-skeleton rx-loading-line xs"></strong></div>
            <div class="rx-summary-row"><span class="rx-skeleton rx-loading-line small"></span><strong class="rx-skeleton rx-loading-line xs"></strong></div>
            <div class="rx-summary-row"><span class="rx-skeleton rx-loading-line small"></span><strong class="rx-skeleton rx-loading-line xs"></strong></div>
        `
        : `
            <div class="rx-summary-row">
                <span>Recharge Amount</span>
                <strong>₹${escapeHtml(formatDecimal(amount))}</strong>
            </div>
            <div class="rx-summary-row">
                <span>Token Discount</span>
                <strong>-${escapeHtml(`₹${formatDecimal(discount)}`)}</strong>
            </div>
            <div class="rx-summary-row">
                <span>Payable Amount</span>
                <strong>₹${escapeHtml(formatDecimal(payable))}</strong>
            </div>
        `;

    return `
        <aside class="rx-summary-shell">
            <div class="rx-summary-card">
                <div class="rx-stage-head">
                    <div>
                        <div class="rx-kicker">State 5</div>
                        <h3 class="rx-stage-title">Checkout summary</h3>
                        <p class="rx-copy">This summary appears only after a plan is selected.</p>
                    </div>
                </div>

                <label class="rx-toggle">
                    <div>
                        <strong style="display:block;color:var(--rx-text-strong);">Use Tokens</strong>
                        <span class="rx-step-copy">Available: ${escapeHtml(formatDecimal(availableTokens))} tokens</span>
                    </div>
                    <input type="checkbox" data-recharge-action="use-tokens"${rechargeUseTokens ? " checked" : ""}${availableTokens <= 0 ? " disabled" : ""} aria-label="Use tokens for this recharge">
                </label>

                <div class="rx-summary-total">
                    <strong>${escapeHtml(loading ? "Calculating..." : error ? "Checkout unavailable" : `₹${formatDecimal(payable)}`)}</strong>
                    <span>${escapeHtml(error ? "Retry to calculate your discount and final amount." : "Final amount after token discount.")}</span>
                </div>

                <div class="rx-summary-note">
                    1000 points = 1 token. The backend determines the live checkout discount for the selected plan.
                </div>

                ${summaryRows}
            </div>
        </aside>
    `;
}

async function requestRechargeLookup(mobile) {
    return requestJson("/recharge/lookup", {
        method: "POST",
        body: { mobile },
        auth: true
    });
}

async function requestRechargePlans({ operator, circle, rechargeType }) {
    const params = new URLSearchParams();
    if (operator) params.set("operator", operator);
    if (circle) params.set("circle", circle);
    if (rechargeType) params.set("rechargeType", rechargeType);

    return requestJson(params.toString() ? `/recharge/plans?${params.toString()}` : "/recharge/plans", {
        method: "GET",
        auth: true
    });
}

async function requestRechargeCheckout(payload) {
    return requestJson("/recharge/checkout", {
        method: "POST",
        body: payload,
        auth: true
    });
}

async function requestRechargePay(payload) {
    return requestJson("/recharge/pay", {
        method: "POST",
        body: payload,
        auth: true
    });
}

function normalizeRechargeLookupResponse(data, mobile) {
    return {
        mobile,
        operator: String(data?.operator || data?.operator_name || data?.network || data?.carrier || data?.provider || data?.operatorName || "").trim(),
        circle: String(data?.circle || data?.circle_name || data?.state || data?.region || data?.location || "All India").trim() || "All India",
        rechargeType: String(data?.rechargeType || data?.type || data?.recharge_type || data?.planType || "Prepaid").trim() || "Prepaid",
        raw: data || {}
    };
}

function normalizeRechargePlanGroups(data) {
    const source = Array.isArray(data?.plans)
        ? data.plans
        : Array.isArray(data?.data)
            ? data.data
            : Array.isArray(data?.items)
                ? data.items
                : Array.isArray(data)
                    ? data
                    : [];

    if (Array.isArray(data?.categories)) {
        const groups = data.categories.map((group) => {
            const key = String(group?.key || group?.id || group?.slug || "").trim().toLowerCase();
            return {
                key,
                label: String(group?.label || group?.name || titleCase(key)).trim(),
                plans: normalizeRechargePlanArray(group?.plans || [])
            };
        }).filter((group) => group.key && group.plans.length);

        return {
            groups,
            defaultCategory: groups.find((group) => group.key === "all")?.key || groups[0]?.key || "popular"
        };
    }

    if (data?.categories && typeof data.categories === "object") {
        const groups = Object.entries(data.categories).map(([key, plans]) => {
            const normalizedKey = String(key || "").trim().toLowerCase();
            return {
                key: normalizedKey,
                label: titleCase(normalizedKey),
                plans: normalizeRechargePlanArray(plans)
            };
        }).filter((group) => group.key && group.plans.length);

        return {
            groups,
            defaultCategory: groups.find((group) => group.key === "all")?.key || groups[0]?.key || "popular"
        };
    }

    const buckets = new Map();
    source.forEach((plan) => {
        const key = String(plan?.category || plan?.tab || plan?.type || "popular").trim().toLowerCase() || "popular";
        if (!buckets.has(key)) {
            buckets.set(key, []);
        }
        buckets.get(key).push(normalizeRechargePlan(plan, key));
    });

    const groups = Array.from(buckets.entries()).map(([key, plans]) => ({
        key,
        label: titleCase(key),
        plans
    }));

    return {
        groups,
        defaultCategory: groups.length > 1 ? "all" : groups[0]?.key || "popular"
    };
}

function normalizeRechargePlanArray(plans) {
    return (Array.isArray(plans) ? plans : []).map((plan, index) => normalizeRechargePlan(plan, String(plan?.category || plan?.tab || "popular").toLowerCase(), index));
}

function normalizeRechargePlan(plan, category, index = 0) {
    const amount = numberFrom(plan?.amount, plan?.price, plan?.value, 0);
    return {
        id: String(plan?.id || plan?.planId || plan?.sku || `${category}-${amount}-${index}`),
        planId: String(plan?.planId || plan?.id || plan?.sku || ""),
        category: String(category || plan?.category || "popular").trim().toLowerCase() || "popular",
        amount,
        validity: String(plan?.validity || plan?.validityLabel || plan?.duration || "Live plan"),
        dailyData: String(plan?.dailyData || plan?.data || plan?.dataAllowance || plan?.daily || "Varies by plan"),
        calls: String(plan?.calls || plan?.voice || "Unlimited"),
        sms: String(plan?.sms || plan?.texts || "Included"),
        badge: String(plan?.badge || plan?.tag || ""),
        benefit: String(plan?.benefit || plan?.benefits || plan?.description || "Live backend pricing"),
        description: String(plan?.description || plan?.notes || ""),
        recommended: Boolean(plan?.recommended || plan?.isRecommended),
        bestValue: Boolean(plan?.bestValue || plan?.isBestValue),
        raw: plan || {}
    };
}

function normalizeRechargeCheckout(data, payload) {
    const discount = numberFrom(data?.tokenDiscount, data?.discount, data?.tokenSavings, 0);
    const fallbackPayable = Math.max(0, numberFrom(payload?.amount, 0) - discount);
    return {
        loading: false,
        error: false,
        discount,
        payable: numberFrom(data?.payableAmount, data?.payable, data?.finalAmount, fallbackPayable),
        availableTokens: numberFrom(data?.availableTokens, data?.tokens, state.user?.tokens, 0),
        message: String(data?.message || data?.summary || "").trim(),
        raw: data || {}
    };
}

function buildRechargeCheckoutPayload() {
    const plan = getSelectedRechargePlan();
    const amount = numberFrom(plan?.amount, 0);
    return {
        mobile: cleanRechargeMobile(),
        operator: getRechargeOperator(),
        circle: getRechargeCircle(),
        rechargeType: String(rechargeDetectedDetails?.rechargeType || "Prepaid").trim() || "Prepaid",
        planId: String(plan?.id || plan?.planId || amount || ""),
        amount,
        useTokens: rechargeUseTokens
    };
}

function buildRechargePayPayload() {
    const checkout = rechargeCheckoutState || {};
    const payload = buildRechargeCheckoutPayload();
    return {
        ...payload,
        tokenDiscount: numberFrom(checkout.discount, 0),
        payableAmount: numberFrom(checkout.payable, payload.amount)
    };
}

function getRechargeOperator() {
    return String(rechargeOperatorOverride || rechargeDetectedDetails?.operator || "").trim();
}

function setRechargeOperator(operator) {
    const normalized = String(operator || "").trim();
    rechargeOperatorOverride = normalized;
    rechargeDetectedDetails = {
        ...(rechargeDetectedDetails || {}),
        operator: normalized,
        circle: rechargeDetectedDetails?.circle || "All India",
        rechargeType: rechargeDetectedDetails?.rechargeType || "Prepaid"
    };
}

function getRechargeCircle() {
    return String(rechargeDetectedDetails?.circle || "All India").trim() || "All India";
}

function cleanRechargeMobile() {
    return String(document.getElementById("recharge-mobile")?.value || "").replace(/\D/g, "").slice(0, 10);
}

function isValidRechargeMobile(mobile) {
    return /^\d{10}$/.test(String(mobile || ""));
}

function getSelectedRechargePlan() {
    if (rechargeSelectedPlan) {
        return rechargeSelectedPlan;
    }
    return findRechargePlanById(rechargeSelectedPlanId);
}

function findRechargePlanById(planId) {
    const id = String(planId || "");
    for (const group of rechargePlanGroups) {
        const plan = (group.plans || []).find((item) => String(item.id || item.planId || item.amount) === id);
        if (plan) {
            return plan;
        }
    }
    return null;
}

function updateRechargePrimaryButton() {
    const button = document.getElementById("recharge-primary-btn");
    if (!button) return;

    button.disabled = getRechargePrimaryButtonDisabled();
    button.innerHTML = `<i class="ri-arrow-right-line"></i><span>${escapeHtml(getRechargePrimaryButtonLabel())}</span>`;
}

function getRechargePrimaryButtonLabel() {
    if (rechargeFlowStage === "entry") return "Continue";
    if (rechargeFlowStage === "loading") return "Loading...";
    if (rechargeFlowStage === "detected") {
        return getRechargeOperator() ? "Load Plans" : "Choose Operator";
    }
    if (rechargeFlowStage === "plans") return "Coming Soon";
    if (rechargeFlowStage === "empty" || rechargeFlowStage === "error") return "Retry";
    return "Continue";
}

function getRechargePrimaryButtonDisabled() {
    if (rechargeFlowStage === "loading") return true;
    if (rechargeFlowStage === "entry") return !isValidRechargeMobile(cleanRechargeMobile());
    if (rechargeFlowStage === "detected") return !getRechargeOperator();
    if (rechargeFlowStage === "plans") return !Boolean(getSelectedRechargePlan()) || Boolean(rechargeCheckoutState?.loading);
    return false;
}

function updateRechargeStatus(message) {
    if (message) {
        setText("recharge-status", message);
    }
}

function recordRechargeContext(payload) {
    if (!payload?.mobile) {
        return;
    }

    const recent = readStore(RECHARGE_HISTORY_STORAGE_KEY, []);
    const saved = readStore(RECHARGE_SAVED_STORAGE_KEY, []);
    const entry = {
        mobile: String(payload.mobile || "").replace(/\D/g, "").slice(0, 10),
        operator: String(payload.operator || "").trim(),
        amount: numberFrom(payload.amount, 0),
        time: Date.now()
    };

    try {
        localStorage.setItem(RECHARGE_HISTORY_STORAGE_KEY, JSON.stringify([entry, ...(Array.isArray(recent) ? recent : [])].slice(0, 6)));
    } catch (_) {
        // ignore
    }

    const nextSaved = uniqueByKey([
        {
            mobile: entry.mobile,
            label: entry.operator || "Saved number",
            time: entry.time
        },
        ...(Array.isArray(saved) ? saved : [])
    ], (item) => String(item.mobile || "")).slice(0, 6);

    try {
        localStorage.setItem(RECHARGE_SAVED_STORAGE_KEY, JSON.stringify(nextSaved));
    } catch (_) {
        // ignore
    }

    renderRechargeQuickLists();
}

function maxRechargeDiscount(amount) {
    return roundTo(Math.min(numberFrom(state.user?.tokens, 0), numberFrom(amount, 0)), 2);
}

function titleCase(value) {
    return String(value || "")
        .split(/[\s_-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(" ");
}

function normalizeRechargeLookupResponse(data, mobile) {
    const source = extractRechargeSource(data);
    return {
        mobile,
        operator: readRechargeValue(source, ["operator", "operator_name", "operatorName", "network", "carrier", "provider", "serviceProvider", "network_name"], ""),
        circle: readRechargeValue(source, ["circle", "circle_name", "circleName", "state", "region", "location", "zone"], "All India") || "All India",
        rechargeType: readRechargeValue(source, ["rechargeType", "recharge_type", "type", "planType", "plan_type", "connectionType"], "Prepaid") || "Prepaid",
        raw: data || {}
    };
}

function normalizeRechargePlanGroups(data) {
    const source = extractRechargeSource(data);
    const directPlans = collectRechargePlans(source);
    const explicitGroups = collectRechargeGroups(source);

    if (explicitGroups.length) {
        return {
            groups: ensureRechargeDisplayGroups(explicitGroups),
            defaultCategory: explicitGroups.length > 1
                ? "all"
                : explicitGroups[0]?.key || "popular"
        };
    }

    const buckets = new Map();
    directPlans.forEach((plan, index) => {
        const normalizedPlan = normalizeRechargePlan(plan, String(plan?.category || plan?.tab || plan?.type || "popular").toLowerCase(), index);
        const groupKeys = inferRechargePlanGroups(normalizedPlan);
        groupKeys.forEach((key) => {
            if (!buckets.has(key)) {
                buckets.set(key, []);
            }
            buckets.get(key).push(normalizedPlan);
        });
    });

    const groups = Array.from(buckets.entries()).map(([key, plans]) => ({
        key,
        label: titleCase(key === "all" ? "All Plans" : key),
        plans: sortRechargePlans(plans)
    }));

    return {
        groups: ensureRechargeDisplayGroups(groups),
        defaultCategory: groups.length > 1
            ? "all"
            : groups[0]?.key || "popular"
    };
}

function normalizeRechargePlanArray(plans) {
    return sortRechargePlans((Array.isArray(plans) ? plans : []).map((plan, index) => normalizeRechargePlan(plan, String(plan?.category || plan?.tab || "popular").toLowerCase(), index)));
}

function normalizeRechargePlan(plan, category, index = 0) {
    const amount = numberFrom(plan?.amount, plan?.price, plan?.value, plan?.mrp, 0);
    const name = String(plan?.name || plan?.planName || plan?.title || plan?.label || plan?.tagline || "").trim();
    const validity = String(plan?.validity || plan?.validityLabel || plan?.duration || plan?.days || plan?.day || name || "Live plan").trim();
    const dailyData = String(plan?.dailyData || plan?.data || plan?.dataAllowance || plan?.daily || plan?.internet || plan?.dataText || "").trim();
    const calls = String(plan?.calls || plan?.voice || plan?.talktime || plan?.calling || plan?.voiceBenefits || "").trim();
    const sms = String(plan?.sms || plan?.texts || plan?.text || plan?.smsCount || "").trim();
    const description = String(plan?.description || plan?.notes || plan?.detail || "").trim();
    const benefit = String(plan?.benefit || plan?.benefits || description || plan?.shortDescription || "Live backend pricing").trim();

    return {
        id: String(plan?.id || plan?.planId || plan?.sku || plan?.code || `${category}-${amount}-${index}`),
        planId: String(plan?.planId || plan?.id || plan?.sku || plan?.code || ""),
        category: String(category || plan?.category || "popular").trim().toLowerCase() || "popular",
        amount,
        name,
        validity,
        dailyData: dailyData || "Varies by plan",
        calls: calls || "Unlimited",
        sms: sms || "Included",
        badge: String(plan?.badge || plan?.tag || plan?.label || plan?.categoryLabel || "").trim(),
        benefit,
        description,
        recommended: Boolean(plan?.recommended || plan?.isRecommended),
        bestValue: Boolean(plan?.bestValue || plan?.isBestValue),
        keywords: [
            name,
            validity,
            dailyData,
            calls,
            sms,
            description,
            benefit,
            plan?.badge,
            plan?.tag
        ].filter(Boolean).map((item) => String(item).toLowerCase()),
        raw: plan || {}
    };
}

function normalizeRechargeCheckout(data, payload) {
    const source = extractRechargeSource(data);
    const discount = numberFrom(source.tokenDiscount, source.discount, source.tokenSavings, 0);
    const fallbackPayable = Math.max(0, numberFrom(payload?.amount, 0) - discount);

    return {
        loading: false,
        error: false,
        discount,
        payable: numberFrom(source.payableAmount, source.payable, source.finalAmount, fallbackPayable),
        availableTokens: numberFrom(source.availableTokens, source.tokens, state.user?.tokens, 0),
        message: String(source.message || source.summary || "").trim(),
        raw: data || {}
    };
}

function buildRechargeCheckoutPayload() {
    const plan = getSelectedRechargePlan();
    const amount = numberFrom(plan?.amount, 0);
    const operator = getRechargeOperator();
    const circle = getRechargeCircle();
    const rechargeType = String(rechargeDetectedDetails?.rechargeType || "Prepaid").trim() || "Prepaid";

    return {
        mobile: cleanRechargeMobile(),
        operator,
        operatorName: operator,
        circle,
        circleName: circle,
        rechargeType,
        type: rechargeType,
        planType: rechargeType,
        planId: String(plan?.id || plan?.planId || amount || ""),
        amount,
        planAmount: amount,
        useTokens: rechargeUseTokens
    };
}

function buildRechargePayPayload() {
    const checkout = rechargeCheckoutState || {};
    const payload = buildRechargeCheckoutPayload();
    return {
        ...payload,
        tokenDiscount: numberFrom(checkout.discount, 0),
        payableAmount: numberFrom(checkout.payable, payload.amount)
    };
}

function renderRechargePlanCard(plan, index) {
    const amount = numberFrom(plan.amount, plan.price, 0);
    const isSelected = String(plan.id || plan.planId || amount) === String(rechargeSelectedPlanId);
    const badges = [];

    if (plan.recommended || plan.isRecommended || /recommended/i.test(String(plan.badge || ""))) {
        badges.push("Recommended");
    }
    if (plan.bestValue || plan.isBestValue || /best/i.test(String(plan.badge || ""))) {
        badges.push("Best Value");
    }
    if (plan.badge && !badges.includes(String(plan.badge))) {
        badges.push(String(plan.badge));
    }

    const specLine = formatRechargePlanSpecs(plan);

    return `
        <button
            type="button"
            class="rx-plan-card${isSelected ? " selected" : ""}"
            data-recharge-action="plan"
            data-value="${escapeHtml(String(plan.id || plan.planId || amount))}"
            style="--delay:${index}"
        >
            <div class="rx-plan-top">
                <div>
                    <div class="rx-plan-price">\u20B9${escapeHtml(formatDecimal(amount))}</div>
                    <div class="rx-plan-desc">${escapeHtml(plan.name || plan.planName || plan.validity || plan.validityLabel || "Live plan")}</div>
                </div>
                <div class="rx-plan-badges">
                    ${badges.slice(0, 2).map((badge) => `<span class="rx-badge">${escapeHtml(badge)}</span>`).join("")}
                </div>
            </div>

            <div class="rx-plan-meta">
                <div>
                    <span>Daily Data</span>
                    <strong>${escapeHtml(plan.dailyData || plan.data || plan.dataAllowance || "Varies by plan")}</strong>
                </div>
                <div>
                    <span>Calls</span>
                    <strong>${escapeHtml(plan.calls || plan.voice || "Unlimited")}</strong>
                </div>
                <div>
                    <span>SMS</span>
                    <strong>${escapeHtml(plan.sms || plan.texts || "Included")}</strong>
                </div>
                <div>
                    <span>Extra Benefits</span>
                    <strong>${escapeHtml(plan.benefit || plan.benefits || "Live backend pricing")}</strong>
                </div>
            </div>

            <div class="rx-plan-footnote">
                ${escapeHtml(specLine || plan.description || "Tap to reveal checkout summary and token discount.")}
            </div>
        </button>
    `;
}

function buildRechargeDisplayGroups(groups) {
    const baseGroups = ensureRechargeDisplayGroups(Array.isArray(groups) ? groups : []);
    const plans = sortRechargePlans(baseGroups.flatMap((group) => group.plans || []));
    const knownKeys = new Set(baseGroups.map((group) => group.key));

    const displayGroups = [...baseGroups];
    if (plans.length > 1 && !knownKeys.has("all")) {
        displayGroups.unshift({
            key: "all",
            label: "All Plans",
            plans
        });
    }

    if (plans.length > 0 && !knownKeys.has("popular")) {
        const popular = plans.filter((plan) => plan.recommended || plan.bestValue || /popular|recommended|best value|best/i.test(String(plan.badge || "")));
        if (popular.length) {
            displayGroups.splice(displayGroups[0]?.key === "all" ? 1 : 0, 0, {
                key: "popular",
                label: "Popular",
                plans: sortRechargePlans(popular)
            });
        }
    }

    return displayGroups.filter((group) => group.plans && group.plans.length);
}

function getRechargeVisiblePlanGroups() {
    const groups = buildRechargeDisplayGroups(rechargePlanGroups);
    const query = String(rechargePlanSearchQuery || "").trim().toLowerCase();

    if (!query) {
        return groups;
    }

    const filteredGroups = groups
        .map((group) => ({
            key: group.key,
            label: group.label,
            plans: filterRechargePlans(group.plans || [], query)
        }))
        .filter((group) => group.plans.length);

    if (!filteredGroups.length) {
        return [];
    }

    if (!filteredGroups.some((group) => group.key === rechargeActiveCategory)) {
        rechargeActiveCategory = filteredGroups[0].key;
    }

    return filteredGroups;
}

function filterRechargePlans(plans, query) {
    return sortRechargePlans((Array.isArray(plans) ? plans : []).filter((plan) => {
        const haystack = [
            plan?.name,
            plan?.validity,
            plan?.dailyData,
            plan?.calls,
            plan?.sms,
            plan?.badge,
            plan?.benefit,
            plan?.description,
            plan?.planId,
            plan?.amount,
            ...(Array.isArray(plan?.keywords) ? plan.keywords : [])
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        return haystack.includes(query);
    }));
}

function ensureRechargeDisplayGroups(groups) {
    const normalized = Array.isArray(groups)
        ? groups.filter((group) => group?.key && Array.isArray(group.plans) && group.plans.length).map((group) => ({
            key: String(group.key).trim().toLowerCase(),
            label: String(group.label || titleCase(group.key)).trim(),
            plans: sortRechargePlans(group.plans)
        }))
        : [];

    if (!normalized.length) {
        return [];
    }

    const hasAll = normalized.some((group) => group.key === "all");
    if (!hasAll && normalized.length > 1) {
        normalized.unshift({
            key: "all",
            label: "All Plans",
            plans: sortRechargePlans(normalized.flatMap((group) => group.plans || []))
        });
    }

    return normalized;
}

function sortRechargePlans(plans) {
    return (Array.isArray(plans) ? plans : []).slice().sort((a, b) => {
        const score = (plan) => {
            const amount = numberFrom(plan?.amount, 0);
            const priority = plan?.recommended ? -2000 : plan?.bestValue ? -1000 : 0;
            return priority + amount;
        };
        return score(a) - score(b);
    });
}

function inferRechargePlanGroups(plan) {
    const text = [
        plan?.name,
        plan?.validity,
        plan?.dailyData,
        plan?.calls,
        plan?.sms,
        plan?.badge,
        plan?.benefit,
        plan?.description,
        plan?.raw?.description,
        plan?.raw?.notes
    ].filter(Boolean).join(" ").toLowerCase();

    const amount = numberFrom(plan?.amount, 0);
    const hasData = /(?:\d+(?:\.\d+)?\s*(?:gb|mb|kb)|data|internet)/i.test(text) || /gb|mb|kb/i.test(String(plan?.dailyData || ""));
    const hasTopup = /talk\s*time|talktime|top\s*up|main\s*balance|full\s*talktime|recharge\s*only/i.test(text) || amount < 100;
    const hasValidity = /validity|days|day/i.test(text);
    const hasValue = /best value|value|recommended|popular/i.test(text) || Boolean(plan?.bestValue);

    const keys = new Set(["all"]);
    if (hasTopup) keys.add("topup");
    if (hasData && !hasTopup) keys.add("data");
    if (hasValidity) keys.add("validity");
    if (hasValue || plan?.recommended) keys.add("popular");
    if (plan?.bestValue) keys.add("value");
    if (keys.size === 1) keys.add("popular");

    return Array.from(keys);
}

function formatRechargePlanSpecs(plan) {
    const parts = [];
    if (plan?.validity) parts.push(plan.validity);
    if (plan?.dailyData && !/varies by plan/i.test(plan.dailyData)) parts.push(plan.dailyData);
    if (plan?.calls) parts.push(plan.calls);
    if (plan?.sms) parts.push(plan.sms);
    if (plan?.benefit && !/live backend pricing/i.test(plan.benefit)) parts.push(plan.benefit);
    return parts.filter(Boolean).join(" • ");
}

function extractRechargeSource(data) {
    if (!data || typeof data !== "object") {
        return {};
    }

    return data.data || data.result || data.payload || data.response || data.body || data;
}

function collectRechargeGroups(source) {
    if (!source || typeof source !== "object") {
        return [];
    }

    const directGroups = [];
    const categories = source.categories;
    if (Array.isArray(categories)) {
        categories.forEach((group) => {
            const key = String(group?.key || group?.id || group?.slug || "").trim().toLowerCase();
            if (!key) return;
            const plans = normalizeRechargePlanArray(group?.plans || []);
            if (plans.length) {
                directGroups.push({
                    key,
                    label: String(group?.label || group?.name || titleCase(key)).trim(),
                    plans
                });
            }
        });
    } else if (categories && typeof categories === "object") {
        Object.entries(categories).forEach(([key, plans]) => {
            const normalizedKey = String(key || "").trim().toLowerCase();
            const normalizedPlans = normalizeRechargePlanArray(plans);
            if (normalizedKey && normalizedPlans.length) {
                directGroups.push({
                    key: normalizedKey,
                    label: titleCase(normalizedKey),
                    plans: normalizedPlans
                });
            }
        });
    }

    return directGroups;
}

function collectRechargePlans(source, visited = new Set()) {
    if (!source || typeof source !== "object" || visited.has(source)) {
        return [];
    }

    visited.add(source);

    if (Array.isArray(source)) {
        return source.flatMap((item) => collectRechargePlans(item, visited));
    }

    const directKeys = ["plans", "items", "rechargePlans", "planList", "packages", "offers"];
    const collected = [];

    directKeys.forEach((key) => {
        const value = source[key];
        if (Array.isArray(value)) {
            collected.push(...value);
        }
    });

    if (Array.isArray(source.data)) {
        collected.push(...source.data);
    }
    if (Array.isArray(source.result)) {
        collected.push(...source.result);
    }

    if (collected.length) {
        return collected.flatMap((item) => {
            if (Array.isArray(item)) {
                return item;
            }
            return [item];
        });
    }

    return [];
}

function readRechargeValue(source, keys, fallback = "") {
    for (const key of keys) {
        const value = source?.[key];
        if (value !== undefined && value !== null && String(value).trim()) {
            return String(value).trim();
        }
    }
    return String(fallback || "").trim();
}

window.initRechargePage = initRechargePage;
