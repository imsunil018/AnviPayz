(function () {
    "use strict";

    function $(id) {
        return document.getElementById(id);
    }

    function toNumber(value, fallback = 0) {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    }

    function formatNumber(value) {
        try {
            return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(toNumber(value, 0));
        } catch (error) {
            return String(Math.floor(toNumber(value, 0)));
        }
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function maskEmail(email) {
        const raw = String(email || "").trim();
        if (!raw || !raw.includes("@")) {
            return "";
        }

        const [local, domain] = raw.split("@");
        if (!local || !domain) {
            return "";
        }

        const head = local.slice(0, Math.min(6, local.length));
        return `${head}****@${domain}`;
    }

    function resolveApiBase() {
        try {
            if (typeof API_BASE_URL === "string" && API_BASE_URL.trim()) {
                return API_BASE_URL.trim().replace(/\/+$/, "");
            }
        } catch (error) {
            // ignore
        }

        try {
            if (typeof API_URL === "string" && API_URL.trim()) {
                return API_URL.trim().replace(/\/+$/, "");
            }
        } catch (error) {
            // ignore
        }

        return "";
    }

    function getToken() {
        return String(localStorage.getItem("anvi-token") || "").trim();
    }

    function buildShareUrl(referralCode) {
        const code = String(referralCode || "").trim().toUpperCase();
        const base = `${window.location.origin}${window.location.pathname.replace(/\/[^/]*$/, "/")}`;
        if (!code) {
            return `${base}index.html?view=register`;
        }
        return `${base}index.html?view=register&ref=${encodeURIComponent(code)}`;
    }

    function normalizeLeaderboardEntries(entries) {
        return (Array.isArray(entries) ? entries : []).map((item) => {
            const referrals = toNumber(item.referrals ?? item.referralCount ?? 0, 0);
            const points = toNumber(item.points ?? item.reward ?? 0, 0);
            const name = String(item.username || item.name || "Member");
            const emailMasked = String(item.emailMasked || "").trim() || maskEmail(item.email);
            return {
                id: String(item.id || item._id || ""),
                name,
                emailMasked,
                referrals,
                points,
                isMe: Boolean(item.isMe)
            };
        })
            .filter((entry) => entry.referrals > 0)
            .sort((a, b) => (b.referrals - a.referrals) || (b.points - a.points));
    }

    function normalizeReferralTiers(payload) {
        const defaultTiers = [
            { referrals: 15, points: 1000 },
            { referrals: 25, points: 2000 },
            { referrals: 50, points: 6000 }
        ];

        const list = Array.isArray(payload?.milestoneRewards) && payload.milestoneRewards.length
            ? payload.milestoneRewards
            : defaultTiers;

        return list.map((item) => ({
            referrals: toNumber(item.referrals ?? item.goal ?? item.milestone ?? 0, 0),
            points: toNumber(item.points ?? item.bonusPoints ?? item.reward ?? 0, 0),
            claimed: Boolean(item.claimed),
            remaining: Math.max(0, toNumber(item.remaining, 0))
        }))
            .filter((tier) => tier.referrals > 0 && tier.points > 0)
            .sort((a, b) => a.referrals - b.referrals);
    }

    function renderLeaderboard(listEl, entries, rankCard) {
        if (!listEl) {
            return;
        }

        const sorted = normalizeLeaderboardEntries(entries);

        if (!sorted.length) {
            listEl.innerHTML = `
                <div class="empty-state">
                    <i class="ri-trophy-line"></i>
                    <p>No leaderboard data yet.</p>
                </div>
            `;
            if (rankCard) {
                rankCard.hidden = true;
            }
            return;
        }

        const top = sorted.slice(0, 10);
        listEl.innerHTML = top.map((person, index) => `
            <div class="lb-row ${person.isMe ? "lb-row--me" : ""}">
                <div class="lb-rank">#${index + 1}</div>
                <div class="lb-user">
                    <div class="lb-name">${escapeHtml(person.name)}</div>
                    <div class="lb-email">${escapeHtml(person.emailMasked || "-")}</div>
                </div>
                <div class="lb-metric">
                    ${formatNumber(person.referrals)}
                    <div class="lb-metric-sub">Referrals</div>
                </div>
                <div class="lb-metric">
                    ${formatNumber(person.points)}
                    <div class="lb-metric-sub">Points</div>
                </div>
            </div>
        `).join("");

        if (rankCard) {
            const meIndex = top.findIndex((entry) => entry.isMe);
            if (meIndex >= 0) {
                const me = top[meIndex];
                rankCard.hidden = false;
                rankCard.innerHTML = `
                    <div class="section-title">Your leaderboard</div>
                    <div class="summary-value summary-value--primary">#${meIndex + 1}</div>
                    <div class="summary-meta">${escapeHtml(me.name)} - ${escapeHtml(me.emailMasked)}</div>
                    <div style="display:flex; gap:0.75rem; margin-top:0.85rem; flex-wrap:wrap;">
                        <div class="status-pill success">${formatNumber(me.referrals)} Referrals</div>
                        <div class="status-pill success">${formatNumber(me.points)} Points</div>
                    </div>
                `;
            } else {
                rankCard.hidden = true;
            }
        }
    }

    function renderBonusProgress(payload) {
        const titleEl = $("bonus-progress-title");
        const currentEl = $("progress-current");
        const goalEl = $("progress-goal");
        const fillEl = $("progress-fill");
        const statusEl = $("bonus-status");
        const tiers = normalizeReferralTiers(payload);

        if (!currentEl || !goalEl || !fillEl) {
            return;
        }

        const totalReferrals = toNumber(payload?.totalReferrals, 0);
        const nextTier = tiers.find((tier) => totalReferrals < tier.referrals) || null;
        const previousTier = [...tiers].reverse().find((tier) => totalReferrals >= tier.referrals) || null;
        const goal = Math.max(1, nextTier?.referrals || previousTier?.referrals || totalReferrals || 1);
        const displayProgress = Math.min(totalReferrals, goal);
        const remaining = nextTier ? Math.max(0, nextTier.referrals - totalReferrals) : 0;
        const ratio = Math.min(displayProgress / goal, 1);
        const milestoneLabel = nextTier
            ? `${formatNumber(nextTier.points)} points at ${formatNumber(nextTier.referrals)} referrals`
            : "All referral reward tiers unlocked";

        if (titleEl) {
            titleEl.textContent = nextTier
                ? `Bonus Progress toward ${formatNumber(nextTier.referrals)} referrals`
                : "Bonus Progress";
        }

        currentEl.textContent = formatNumber(displayProgress);
        goalEl.textContent = formatNumber(goal);
        fillEl.style.width = `${Math.round(ratio * 100)}%`;

        if (statusEl) {
            if (nextTier) {
                statusEl.textContent = `Next reward: +${formatNumber(nextTier.points)} points at ${formatNumber(nextTier.referrals)} referrals. ${formatNumber(remaining)} more referral${remaining === 1 ? "" : "s"} needed.`;
                statusEl.classList.remove("unlocked");
            } else if (tiers.length) {
                statusEl.textContent = `Milestone unlocked! ${milestoneLabel}.`;
                statusEl.classList.add("unlocked");
            } else {
                statusEl.textContent = "Invite more friends to unlock rewards.";
                statusEl.classList.remove("unlocked");
            }
        }
    }

    function renderReferralTiers(payload) {
        const container = $("referral-tier-grid");
        if (!container) {
            return;
        }

        const totalReferrals = toNumber(payload?.totalReferrals, 0);
        const tiers = normalizeReferralTiers(payload);

        if (!tiers.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="ri-award-line"></i>
                    <p>Referral reward tiers will appear here once data loads.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = tiers.map((tier) => {
            const unlocked = totalReferrals >= tier.referrals || tier.claimed;
            const remaining = Math.max(0, tier.referrals - totalReferrals);
            const accent = unlocked ? "#10b981" : "#7c89ff";
            const label = unlocked ? "Unlocked" : `${formatNumber(remaining)} more to go`;
            return `
                <div class="card" style="border-color:${accent}33; box-shadow:0 12px 30px rgba(0,0,0,0.08);">
                    <div class="feature-head" style="align-items:flex-start;">
                        <div class="feature-icon" style="background:${accent}14;color:${accent};">
                            <i class="ri-trophy-line"></i>
                        </div>
                        <div class="feature-copy">
                            <h3>${formatNumber(tier.referrals)} Referrals</h3>
                            <p>Extra <strong>${formatNumber(tier.points)}</strong> points on top of the base <strong>250 / referral</strong>.</p>
                        </div>
                    </div>
                    <div style="display:flex; gap:0.6rem; margin-top:1rem; flex-wrap:wrap;">
                        <div class="status-pill success">${label}</div>
                        <div class="status-pill success">+${formatNumber(tier.points)} Bonus</div>
                    </div>
                </div>
            `;
        }).join("");
    }

    function formatLongDate(value) {
        const timestamp = Date.parse(String(value || ""));
        const date = Number.isFinite(timestamp) ? new Date(timestamp) : new Date();
        try {
            return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
        } catch (error) {
            return date.toISOString();
        }
    }

    function renderNetwork(container, network) {
        if (!container) {
            return;
        }

        const list = (Array.isArray(network) ? network : []).map((person) => ({
            name: String(person?.name || "New referral"),
            emailMasked: String(person?.emailMasked || "").trim() || maskEmail(person?.email),
            reward: toNumber(person?.reward ?? person?.points ?? 0, 0),
            time: person?.time || person?.createdAt || ""
        }));

        if (!list.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="ri-user-follow-line"></i>
                    <p>Your verified referrals will appear here after they join.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = list.map((person) => `
            <div class="network-item">
                <div class="list-info">
                    <div class="task-title">${escapeHtml(person.name)}</div>
                    <div class="task-body">${escapeHtml(person.emailMasked || "-")}</div>
                </div>
                <div style="text-align:right;">
                    <div class="status-pill success">${formatNumber(person.reward)} Points</div>
                    <div class="network-time" style="margin-top:6px;">${escapeHtml(formatLongDate(person.time))}</div>
                </div>
            </div>
        `).join("");
    }

    async function fetchReferralPayload() {
        const token = getToken();
        if (!token) {
            return null;
        }

        const apiBase = resolveApiBase();
        const response = await fetch(`${apiBase}/api/referrals`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            }
        });

        if (!response.ok) {
            return null;
        }

        return await response.json();
    }

    async function init() {
        const container = document.querySelector(".ref-container");
        if (!container) {
            return;
        }

        // Reuse cached payload from global `state` when available and when
        // navigated from tasks to avoid extra network calls. Otherwise fetch.
        let payload = null;
        try {
            const navEntries = (performance.getEntriesByType && performance.getEntriesByType('navigation')) || [];
            const navType = (navEntries[0] && navEntries[0].type) || (performance.navigation && performance.navigation.type) || '';
            const fromTasks = String(document.referrer || '').includes('tasks.html');
            if (window.state && window.state.referralPayload && fromTasks && navType !== 'reload') {
                payload = window.state.referralPayload;
            } else {
                payload = (await fetchReferralPayload()) || {};
                if (window.state) window.state.referralPayload = payload;
            }
        } catch (err) {
            payload = (await fetchReferralPayload()) || {};
            if (window.state) window.state.referralPayload = payload;
        }

        renderReferralTiers(payload);
    }

    document.addEventListener("DOMContentLoaded", () => {
        // Let auth.js paint first; then enhance.
        setTimeout(() => {
            init().catch(() => { });
        }, 50);
    });
})();
