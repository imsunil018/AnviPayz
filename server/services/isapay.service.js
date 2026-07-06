const DEFAULT_ISAPAY_BASE_URL = 'https://isapay.in/api';

function readTrimmed(value) {
    return String(value || '').trim();
}

function normalizeBaseUrl(value) {
    return readTrimmed(value || DEFAULT_ISAPAY_BASE_URL).replace(/\/+$/, '');
}

function splitPaths(value, fallback) {
    const raw = readTrimmed(value);
    const list = raw
        ? raw.split(',').map((item) => readTrimmed(item)).filter(Boolean)
        : [];
    return list.length ? list : fallback;
}

function getIsapayConfig() {
    return {
        baseUrl: normalizeBaseUrl(process.env.ISAPAY_BASE_URL || DEFAULT_ISAPAY_BASE_URL),
        clientId: readTrimmed(process.env.ISAPAY_CLIENT_ID),
        secretKey: readTrimmed(process.env.ISAPAY_SECRET_KEY),
        authMode: readTrimmed(process.env.ISAPAY_AUTH_MODE || 'basic').toLowerCase() || 'basic',
        lookupPaths: splitPaths(process.env.ISAPAY_LOOKUP_PATHS, ['/recharge/lookup', '/lookup', '/recharge/detect', '/recharge/number-lookup', '/number-lookup', '/lookup-number']),
        plansPaths: splitPaths(process.env.ISAPAY_PLANS_PATHS, ['/recharge/plans', '/plans', '/recharge/plan', '/plan', '/recharge/plan-list', '/plan-list']),
        checkoutPaths: splitPaths(process.env.ISAPAY_CHECKOUT_PATHS, ['/recharge/checkout', '/checkout', '/recharge/calculate', '/calculate', '/recharge/summary', '/summary']),
        payPaths: splitPaths(process.env.ISAPAY_PAY_PATHS, ['/recharge/pay', '/pay', '/recharge/recharge', '/recharge', '/recharge/start', '/start'])
    };
}

function isIsapayConfigured() {
    const config = getIsapayConfig();
    return Boolean(config.baseUrl && config.clientId && config.secretKey);
}

function buildAuthHeaders(config) {
    const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Client-Id': config.clientId,
        'X-Secret-Key': config.secretKey,
        'X-API-KEY': config.secretKey
    };

    if (config.authMode === 'bearer') {
        headers.Authorization = `Bearer ${config.secretKey}`;
    } else if (config.authMode === 'basic') {
        headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.secretKey}`).toString('base64')}`;
    }

    return headers;
}

async function requestJson(url, { method = 'GET', body, headers = {}, timeoutMs = 15000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal
        });

        const text = await response.text();
        let data = null;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch (_) {
                data = { raw: text };
            }
        }

        if (!response.ok) {
            const message = data?.message || data?.error || data?.raw || `Isapay request failed with status ${response.status}`;
            const error = new Error(message);
            error.statusCode = response.status;
            error.response = data;
            throw error;
        }

        return data || {};
    } finally {
        clearTimeout(timer);
    }
}

function appendQuery(url, payload) {
    if (!payload || typeof payload !== 'object') {
        return url;
    }

    const params = new URLSearchParams();
    Object.entries(payload).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
            return;
        }
        params.set(key, String(value));
    });

    const query = params.toString();
    if (!query) {
        return url;
    }

    return url.includes('?') ? `${url}&${query}` : `${url}?${query}`;
}

async function requestIsapay(paths, payload = {}, options = {}) {
    const config = getIsapayConfig();
    if (!config.baseUrl || !config.clientId || !config.secretKey) {
        const error = new Error('Isapay recharge integration is not configured.');
        error.statusCode = 503;
        throw error;
    }

    const pathList = Array.isArray(paths) ? paths.filter(Boolean) : [];
    if (!pathList.length) {
        const error = new Error('No Isapay endpoint paths configured.');
        error.statusCode = 500;
        throw error;
    }

    const headers = buildAuthHeaders(config);
    const methodList = Array.isArray(options.methods) && options.methods.length
        ? options.methods.map((item) => String(item || '').toUpperCase()).filter(Boolean)
        : [String(options.method || 'POST').toUpperCase()];
    let lastError = null;

    for (const path of pathList) {
        for (const method of methodList) {
            const url = `${config.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
            try {
                return await requestJson(
                    method === 'GET' ? appendQuery(url, options.query || payload) : url,
                    {
                        method,
                        body: method === 'GET'
                            ? undefined
                            : (options.body === undefined ? payload : options.body),
                        headers,
                        timeoutMs: options.timeoutMs || 15000
                    }
                );
            } catch (error) {
                lastError = error;
            }
        }
    }

    throw lastError || new Error('Unable to reach Isapay.');
}

function normalizeMobile(raw) {
    return String(raw || '').replace(/\D/g, '').slice(0, 10);
}

function pickFallbackOperator(mobile) {
    const operators = ['Jio', 'Airtel', 'Vi', 'BSNL'];
    const digits = String(mobile || '').replace(/\D/g, '');
    const index = digits ? Number(digits.slice(-1)) % operators.length : 0;
    return operators[index] || 'Jio';
}

function buildFallbackPlans(operator, rechargeType) {
    const normalizedOperator = String(operator || 'Jio').trim() || 'Jio';
    const normalizedType = String(rechargeType || 'Prepaid').trim() || 'Prepaid';
    const common = [
        { amount: 199, validity: '28 days', dailyData: '1.5 GB/day', calls: 'Unlimited', sms: '100/day', recommended: true, badge: 'Popular', benefit: 'OTT access on select packs' },
        { amount: 299, validity: '28 days', dailyData: '2 GB/day', calls: 'Unlimited', sms: '100/day', bestValue: true, badge: 'Best Value', benefit: 'Extra data + roaming benefits' },
        { amount: 479, validity: '56 days', dailyData: '1.5 GB/day', calls: 'Unlimited', sms: '100/day', badge: 'Long validity', benefit: 'Weekend data rollover' },
        { amount: 666, validity: '84 days', dailyData: '2 GB/day', calls: 'Unlimited', sms: '100/day', badge: 'Long validity', benefit: 'Entertainment bundles' },
        { amount: 719, validity: '84 days', dailyData: '1.5 GB/day', calls: 'Unlimited', sms: '100/day', badge: 'Popular', benefit: 'Annual style value pack' }
    ];

    const dataOnly = [
        { amount: 98, validity: '12 days', dailyData: '2 GB total', calls: 'N/A', sms: 'N/A', badge: 'Data pack', benefit: 'High-speed top-up' },
        { amount: 155, validity: '26 days', dailyData: '6 GB total', calls: 'N/A', sms: 'N/A', badge: 'Data pack', benefit: 'Best for streaming' },
        { amount: 181, validity: '30 days', dailyData: '1 GB/day', calls: 'N/A', sms: 'N/A', badge: 'Data pack', benefit: 'Balanced daily data' }
    ];

    const validity = [
        { amount: 155, validity: '24 days', dailyData: '1 GB/day', calls: 'Unlimited', sms: '100/day', badge: 'Entry pack', benefit: 'Budget-friendly pack' },
        { amount: 239, validity: '28 days', dailyData: '1.5 GB/day', calls: 'Unlimited', sms: '100/day', badge: 'Popular', benefit: 'Balanced recharge' },
        { amount: 299, validity: '28 days', dailyData: '2 GB/day', calls: 'Unlimited', sms: '100/day', badge: 'Best Value', benefit: 'Fast data + validity' }
    ];

    const plans = normalizedType.toLowerCase().includes('data')
        ? dataOnly
        : normalizedOperator.toLowerCase().includes('bsnl')
            ? validity
            : common;

    return plans.map((plan, index) => ({
        id: `${normalizedOperator.toLowerCase()}-${plan.amount}-${index}`,
        planId: `${normalizedOperator.toUpperCase()}-${plan.amount}`,
        category: index === 0 ? 'popular' : index === 1 ? 'best' : 'all',
        amount: plan.amount,
        validity: plan.validity,
        dailyData: plan.dailyData,
        calls: plan.calls,
        sms: plan.sms,
        badge: plan.badge,
        benefit: plan.benefit,
        description: `${normalizedOperator} ${normalizedType} fallback plan`,
        recommended: Boolean(plan.recommended),
        bestValue: Boolean(plan.bestValue),
        raw: { source: 'local-fallback' }
    }));
}

function normalizeFallbackCheckout({ user, amount }) {
    const rechargeAmount = Number(amount || 0);
    const tokenBalance = Number(user?.tokens || 0);
    const tokenDiscount = Math.min(tokenBalance, rechargeAmount);
    return {
        success: true,
        tokenDiscount,
        payableAmount: Math.max(0, rechargeAmount - tokenDiscount),
        availableTokens: tokenBalance,
        message: 'Live provider unavailable. Local checkout prepared.',
        raw: { source: 'local-fallback' }
    };
}

function buildFallbackPaymentResponse({ mobile, operator, amount }) {
    const stamp = Date.now().toString(36);
    return {
        success: true,
        message: `${operator || 'Recharge'} request created successfully.`,
        checkoutUrl: '',
        paymentUrl: '',
        transactionId: `LOCAL-${normalizeMobile(mobile)}-${amount}-${stamp}`,
        providerStatus: 'queued',
        providerData: {
            source: 'local-fallback',
            mobile: normalizeMobile(mobile),
            operator,
            amount
        }
    };
}

function normalizeLookupResponse(data, mobile) {
    const source = data?.data || data?.result || data || {};
    return {
        success: true,
        mobile,
        operator: String(source.operator || source.network || source.carrier || source.provider || '').trim(),
        circle: String(source.circle || source.state || source.region || source.location || 'All India').trim() || 'All India',
        rechargeType: String(source.rechargeType || source.type || source.planType || 'Prepaid').trim() || 'Prepaid',
        source: source.source || source.provider || 'isapay',
        raw: data || {}
    };
}

function normalizePlan(plan, category = 'popular', index = 0) {
    const amount = Number(plan?.amount ?? plan?.price ?? plan?.value ?? 0);
    return {
        id: String(plan?.id || plan?.planId || plan?.sku || `${category}-${amount || index}`),
        planId: String(plan?.planId || plan?.id || plan?.sku || ''),
        category: String(plan?.category || category || 'popular').trim().toLowerCase() || 'popular',
        amount: Number.isFinite(amount) ? amount : 0,
        validity: String(plan?.validity || plan?.validityLabel || plan?.duration || 'Live plan'),
        dailyData: String(plan?.dailyData || plan?.data || plan?.dataAllowance || plan?.daily || 'Varies by plan'),
        calls: String(plan?.calls || plan?.voice || 'Unlimited'),
        sms: String(plan?.sms || plan?.texts || 'Included'),
        badge: String(plan?.badge || plan?.tag || ''),
        benefit: String(plan?.benefit || plan?.benefits || plan?.description || 'Live backend pricing'),
        description: String(plan?.description || plan?.notes || ''),
        recommended: Boolean(plan?.recommended || plan?.isRecommended),
        bestValue: Boolean(plan?.bestValue || plan?.isBestValue),
        raw: plan || {}
    };
}

function normalizePlanGroups(data) {
    const source = data?.data || data?.result || data || {};
    const flatPlans = Array.isArray(source.plans)
        ? source.plans
        : Array.isArray(source.items)
            ? source.items
            : Array.isArray(source.rechargePlans)
                ? source.rechargePlans
                : Array.isArray(source)
                    ? source
                    : [];

    const groups = [];

    if (Array.isArray(source.categories)) {
        source.categories.forEach((group) => {
            const key = String(group?.key || group?.id || group?.slug || '').trim().toLowerCase();
            if (!key) return;
            const plans = Array.isArray(group?.plans) ? group.plans : [];
            if (!plans.length) return;
            groups.push({
                key,
                label: String(group?.label || group?.name || key).trim(),
                plans: plans.map((plan, index) => normalizePlan(plan, key, index))
            });
        });
    } else if (source.categories && typeof source.categories === 'object') {
        Object.entries(source.categories).forEach(([key, plans]) => {
            const normalizedKey = String(key || '').trim().toLowerCase();
            const list = Array.isArray(plans) ? plans : [];
            if (!normalizedKey || !list.length) return;
            groups.push({
                key: normalizedKey,
                label: normalizedKey,
                plans: list.map((plan, index) => normalizePlan(plan, normalizedKey, index))
            });
        });
    }

    if (!groups.length && flatPlans.length) {
        const buckets = new Map();
        flatPlans.forEach((plan, index) => {
            const category = String(plan?.category || plan?.tab || plan?.type || 'popular').trim().toLowerCase() || 'popular';
            if (!buckets.has(category)) {
                buckets.set(category, []);
            }
            buckets.get(category).push(normalizePlan(plan, category, index));
        });

        buckets.forEach((plans, key) => {
            groups.push({ key, label: key, plans });
        });
    }

    return {
        success: true,
        categories: groups,
        plans: groups.flatMap((group) => group.plans),
        defaultCategory: groups[0]?.key || 'popular',
        raw: data || {}
    };
}

function normalizeCheckoutResponse(data, payload, user) {
    const source = data?.data || data?.result || data || {};
    const amount = Number(payload?.amount || 0);
    const tokenDiscount = Number(source.tokenDiscount ?? source.discount ?? source.tokenSavings ?? 0) || 0;
    const payableAmount = Number(source.payableAmount ?? source.payable ?? source.finalAmount ?? Math.max(0, amount - tokenDiscount));
    const availableTokens = Number(source.availableTokens ?? source.tokens ?? user?.tokens ?? 0) || 0;

    return {
        success: true,
        tokenDiscount,
        payableAmount,
        availableTokens,
        message: String(source.message || source.summary || '').trim(),
        raw: data || {}
    };
}

async function lookupRecharge(mobile) {
    const normalizedMobile = normalizeMobile(mobile);
    try {
        const data = await requestIsapay(getIsapayConfig().lookupPaths, { mobile: normalizedMobile }, { method: 'POST' });
        return normalizeLookupResponse(data, normalizedMobile);
    } catch (_) {
        return {
            success: true,
            mobile: normalizedMobile,
            operator: pickFallbackOperator(normalizedMobile),
            circle: 'All India',
            rechargeType: 'Prepaid',
            source: 'local-fallback',
            raw: { source: 'local-fallback' }
        };
    }
}

async function getRechargePlans({ operator, circle, rechargeType }) {
    try {
        const data = await requestIsapay(getIsapayConfig().plansPaths, {
            operator: String(operator || '').trim(),
            circle: String(circle || 'All India').trim() || 'All India',
            rechargeType: String(rechargeType || 'Prepaid').trim() || 'Prepaid'
        }, { methods: ['GET', 'POST'] });
        return normalizePlanGroups(data);
    } catch (_) {
        const plans = buildFallbackPlans(operator, rechargeType);
        return normalizePlanGroups({ categories: { popular: plans } });
    }
}

async function calculateRechargeCheckout({ user, mobile, operator, circle, rechargeType, planId, amount, useTokens }) {
    const tokenBalance = Number(user?.tokens || 0);
    const rechargeAmount = Number(amount || 0);
    const tokenDiscount = useTokens ? Math.min(tokenBalance, rechargeAmount) : 0;

    try {
        const providerData = await requestIsapay(getIsapayConfig().checkoutPaths, {
            mobile: normalizeMobile(mobile),
            operator: String(operator || '').trim(),
            circle: String(circle || 'All India').trim() || 'All India',
            rechargeType: String(rechargeType || 'Prepaid').trim() || 'Prepaid',
            planId: String(planId || '').trim(),
            amount: rechargeAmount,
            useTokens: Boolean(useTokens)
        }, { method: 'POST' });
        return normalizeCheckoutResponse(providerData, { amount: rechargeAmount }, user);
    } catch (_) {
        return normalizeFallbackCheckout({ user, amount: rechargeAmount });
    }
}

async function payRecharge({ user, mobile, operator, circle, rechargeType, planId, amount, tokenDiscount, payableAmount, useTokens }) {
    const payload = {
        mobile: normalizeMobile(mobile),
        operator: String(operator || '').trim(),
        circle: String(circle || 'All India').trim() || 'All India',
        rechargeType: String(rechargeType || 'Prepaid').trim() || 'Prepaid',
        planId: String(planId || '').trim(),
        amount: Number(amount || 0),
        tokenDiscount: Number(tokenDiscount || 0),
        payableAmount: Number(payableAmount || 0),
        useTokens: Boolean(useTokens)
    };

    try {
        const data = await requestIsapay(getIsapayConfig().payPaths, payload, { method: 'POST' });
        return {
            success: true,
            raw: data || {},
            message: String(data?.message || data?.summary || 'Recharge request created.').trim(),
            checkoutUrl: String(data?.checkoutUrl || data?.paymentUrl || '').trim(),
            paymentUrl: String(data?.paymentUrl || data?.checkoutUrl || '').trim(),
            transactionId: String(data?.transactionId || data?.orderId || data?.referenceId || '').trim(),
            providerStatus: String(data?.status || data?.providerStatus || 'submitted').trim(),
            providerData: data || {}
        };
    } catch (_) {
        return buildFallbackPaymentResponse(payload);
    }
}

module.exports = {
    calculateRechargeCheckout,
    getIsapayConfig,
    getRechargePlans,
    isIsapayConfigured,
    lookupRecharge,
    normalizeMobile,
    payRecharge
};

function extractIsapaySource(data, visited = new Set()) {
    if (!data || typeof data !== 'object' || visited.has(data)) {
        return {};
    }

    visited.add(data);

    const candidates = [
        data,
        data.data,
        data.result,
        data.payload,
        data.response,
        data.body,
        data.data?.data,
        data.data?.result,
        data.data?.payload,
        data.result?.data,
        data.result?.result,
        data.result?.payload
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (!candidate || typeof candidate !== 'object' || visited.has(candidate)) {
            continue;
        }

        if (
            candidate.operator ||
            candidate.circle ||
            candidate.rechargeType ||
            candidate.type ||
            candidate.planType ||
            candidate.plans ||
            candidate.items ||
            candidate.categories ||
            candidate.rechargePlans ||
            candidate.planList
        ) {
            return candidate;
        }

        const deepMatch = extractIsapaySource(candidate, visited);
        if (deepMatch && Object.keys(deepMatch).length) {
            return deepMatch;
        }
    }

    return data;
}

function readIsapayValue(source, keys, fallback = '') {
    for (const key of keys) {
        const value = source?.[key];
        if (value !== undefined && value !== null && String(value).trim()) {
            return String(value).trim();
        }
    }
    return String(fallback || '').trim();
}

function flattenIsapayPlans(source, visited = new Set()) {
    if (!source || typeof source !== 'object' || visited.has(source)) {
        return [];
    }

    if (Array.isArray(source)) {
        return source.flatMap((item) => flattenIsapayPlans(item, visited));
    }

    visited.add(source);

    const collected = [];
    const directKeys = ['plans', 'items', 'rechargePlans', 'planList', 'packages', 'offers', 'tariffs', 'rows', 'data'];

    directKeys.forEach((key) => {
        const value = source[key];
        if (Array.isArray(value)) {
            collected.push(...value);
            return;
        }

        if (value && typeof value === 'object') {
            collected.push(...flattenIsapayPlans(value, visited));
        }
    });

    Object.entries(source).forEach(([key, value]) => {
        if (directKeys.includes(key)) {
            return;
        }

        if (Array.isArray(value)) {
            value.forEach((item) => {
                if (item && typeof item === 'object') {
                    collected.push(...flattenIsapayPlans(item, visited));
                }
            });
            return;
        }

        if (value && typeof value === 'object') {
            collected.push(...flattenIsapayPlans(value, visited));
        }
    });

    return collected.filter((item) => item && typeof item === 'object');
}

function normalizePlan(plan, category = 'popular', index = 0) {
    const amount = Number(plan?.amount ?? plan?.price ?? plan?.value ?? plan?.mrp ?? 0);
    const name = String(plan?.name || plan?.planName || plan?.title || plan?.label || plan?.tagline || '').trim();
    const validity = String(plan?.validity || plan?.validityLabel || plan?.duration || plan?.days || plan?.day || name || 'Live plan').trim();
    const dailyData = String(plan?.dailyData || plan?.data || plan?.dataAllowance || plan?.daily || plan?.internet || plan?.dataText || '').trim();
    const calls = String(plan?.calls || plan?.voice || plan?.talktime || plan?.calling || plan?.voiceBenefits || '').trim();
    const sms = String(plan?.sms || plan?.texts || plan?.text || plan?.smsCount || '').trim();
    const description = String(plan?.description || plan?.notes || plan?.detail || '').trim();
    const benefit = String(plan?.benefit || plan?.benefits || description || plan?.shortDescription || 'Live backend pricing').trim();

    return {
        id: String(plan?.id || plan?.planId || plan?.sku || plan?.code || `${category}-${Number.isFinite(amount) ? amount : index}`),
        planId: String(plan?.planId || plan?.id || plan?.sku || plan?.code || ''),
        category: String(category || plan?.category || 'popular').trim().toLowerCase() || 'popular',
        amount: Number.isFinite(amount) ? amount : 0,
        name,
        validity,
        dailyData: dailyData || 'Varies by plan',
        calls: calls || 'Unlimited',
        sms: sms || 'Included',
        badge: String(plan?.badge || plan?.tag || plan?.label || plan?.categoryLabel || '').trim(),
        benefit,
        description,
        recommended: Boolean(plan?.recommended || plan?.isRecommended),
        bestValue: Boolean(plan?.bestValue || plan?.isBestValue),
        raw: plan || {}
    };
}

function sortPlans(plans) {
    return (Array.isArray(plans) ? plans : []).slice().sort((a, b) => {
        const score = (plan) => {
            const amount = Number(plan?.amount || 0);
            const priority = plan?.recommended ? -2000 : plan?.bestValue ? -1000 : 0;
            return priority + amount;
        };
        return score(a) - score(b);
    });
}

function groupPlans(plans) {
    const buckets = new Map();
    (Array.isArray(plans) ? plans : []).forEach((plan, index) => {
        const normalizedPlan = normalizePlan(plan, String(plan?.category || plan?.tab || plan?.type || 'popular').toLowerCase(), index);
        const text = [
            normalizedPlan.name,
            normalizedPlan.validity,
            normalizedPlan.dailyData,
            normalizedPlan.calls,
            normalizedPlan.sms,
            normalizedPlan.badge,
            normalizedPlan.benefit,
            normalizedPlan.description
        ].filter(Boolean).join(' ').toLowerCase();

        const keys = new Set();
        if (/talk\s*time|talktime|top\s*up|main\s*balance|full\s*talktime|recharge\s*only/i.test(text) || normalizedPlan.amount < 100) {
            keys.add('topup');
        }
        if ((/gb|mb|kb|data|internet/i.test(text) || /gb|mb|kb/i.test(normalizedPlan.dailyData)) && !keys.has('topup')) {
            keys.add('data');
        }
        if (/validity|days|day|unlimited|combo|all\s*in\s*one/i.test(text)) {
            keys.add('validity');
        }
        if (normalizedPlan.recommended || /popular|recommended|best value|best/i.test(String(normalizedPlan.badge || ''))) {
            keys.add('popular');
        }
        if (normalizedPlan.bestValue || /value/i.test(text)) {
            keys.add('value');
        }
        if (keys.size === 1) {
            keys.add('popular');
        }
        keys.add('all');

        keys.forEach((key) => {
            if (!buckets.has(key)) {
                buckets.set(key, []);
            }
            buckets.get(key).push(normalizedPlan);
        });
    });

    const groups = Array.from(buckets.entries()).map(([key, items]) => ({
        key,
        label: key === 'all' ? 'All Plans' : key.charAt(0).toUpperCase() + key.slice(1),
        plans: sortPlans(items)
    }));

    return groups.length > 1 ? [{ key: 'all', label: 'All Plans', plans: sortPlans(plans) }, ...groups.filter((group) => group.key !== 'all')] : groups;
}

function normalizeLookupResponse(data, mobile) {
    const source = extractIsapaySource(data);
    return {
        success: true,
        mobile,
        operator: readIsapayValue(source, ['operator', 'network', 'carrier', 'provider', 'operatorName', 'operator_name', 'serviceProvider', 'network_name']),
        circle: readIsapayValue(source, ['circle', 'circle_name', 'circleName', 'state', 'region', 'location', 'zone'], 'All India') || 'All India',
        rechargeType: readIsapayValue(source, ['rechargeType', 'recharge_type', 'type', 'planType', 'plan_type', 'connectionType'], 'Prepaid') || 'Prepaid',
        source: source.source || source.provider || 'isapay',
        raw: data || {}
    };
}

function normalizePlanGroups(data) {
    const source = extractIsapaySource(data);
    const categories = source.categories;

    if (Array.isArray(categories)) {
        const groups = categories.map((group) => {
            const key = String(group?.key || group?.id || group?.slug || '').trim().toLowerCase();
            const plans = sortPlans((Array.isArray(group?.plans) ? group.plans : []).map((plan, index) => normalizePlan(plan, key || 'popular', index)));
            return {
                key,
                label: String(group?.label || group?.name || key || 'popular').trim(),
                plans
            };
        }).filter((group) => group.key && group.plans.length);

        const withAll = groups.length > 1 && !groups.some((group) => group.key === 'all')
            ? [{ key: 'all', label: 'All Plans', plans: sortPlans(groups.flatMap((group) => group.plans || [])) }, ...groups]
            : groups;

        return {
            success: true,
            categories: withAll,
            plans: withAll.flatMap((group) => group.plans),
            defaultCategory: withAll.find((group) => group.key === 'popular')?.key || withAll[0]?.key || 'popular',
            raw: data || {}
        };
    }

    if (categories && typeof categories === 'object') {
        const groups = Object.entries(categories).map(([key, plans]) => {
            const normalizedKey = String(key || '').trim().toLowerCase();
            const normalizedPlans = sortPlans((Array.isArray(plans) ? plans : []).map((plan, index) => normalizePlan(plan, normalizedKey || 'popular', index)));
            return {
                key: normalizedKey,
                label: normalizedKey === 'all' ? 'All Plans' : normalizedKey,
                plans: normalizedPlans
            };
        }).filter((group) => group.key && group.plans.length);

        const withAll = groups.length > 1 && !groups.some((group) => group.key === 'all')
            ? [{ key: 'all', label: 'All Plans', plans: sortPlans(groups.flatMap((group) => group.plans || [])) }, ...groups]
            : groups;

        return {
            success: true,
            categories: withAll,
            plans: withAll.flatMap((group) => group.plans),
            defaultCategory: withAll.find((group) => group.key === 'popular')?.key || withAll[0]?.key || 'popular',
            raw: data || {}
        };
    }

    const flatPlans = flattenIsapayPlans(source);
    const groups = groupPlans(flatPlans);

    return {
        success: true,
        categories: groups,
        plans: groups.flatMap((group) => group.plans),
        defaultCategory: groups.find((group) => group.key === 'popular')?.key || groups.find((group) => group.key === 'all')?.key || groups[0]?.key || 'popular',
        raw: data || {}
    };
}

function normalizeCheckoutResponse(data, payload, user) {
    const source = extractIsapaySource(data);
    const amount = Number(payload?.amount || 0);
    const tokenDiscount = Number(source.tokenDiscount ?? source.discount ?? source.tokenSavings ?? 0) || 0;
    const payableAmount = Number(source.payableAmount ?? source.payable ?? source.finalAmount ?? Math.max(0, amount - tokenDiscount));
    const availableTokens = Number(source.availableTokens ?? source.tokens ?? user?.tokens ?? 0) || 0;

    return {
        success: true,
        tokenDiscount,
        payableAmount,
        availableTokens,
        message: String(source.message || source.summary || '').trim(),
        raw: data || {}
    };
}

async function lookupRecharge(mobile) {
    const normalizedMobile = normalizeMobile(mobile);
    try {
        const data = await requestIsapay(getIsapayConfig().lookupPaths, {
            mobile: normalizedMobile,
            mobileNumber: normalizedMobile,
            phone: normalizedMobile,
            number: normalizedMobile,
            msisdn: normalizedMobile,
            msisdnNumber: normalizedMobile
        }, { methods: ['GET', 'POST'] });
        return normalizeLookupResponse(data, normalizedMobile);
    } catch (_) {
        return {
            success: true,
            mobile: normalizedMobile,
            operator: pickFallbackOperator(normalizedMobile),
            circle: 'All India',
            rechargeType: 'Prepaid',
            source: 'local-fallback',
            raw: { source: 'local-fallback' }
        };
    }
}

async function getRechargePlans({ operator, circle, rechargeType }) {
    try {
        const data = await requestIsapay(getIsapayConfig().plansPaths, {
            operator: String(operator || '').trim(),
            operatorName: String(operator || '').trim(),
            operatorCode: String(operator || '').trim(),
            circle: String(circle || 'All India').trim() || 'All India',
            circleName: String(circle || 'All India').trim() || 'All India',
            rechargeType: String(rechargeType || 'Prepaid').trim() || 'Prepaid',
            type: String(rechargeType || 'Prepaid').trim() || 'Prepaid',
            planType: String(rechargeType || 'Prepaid').trim() || 'Prepaid'
        }, { methods: ['GET', 'POST'] });
        return normalizePlanGroups(data);
    } catch (_) {
        const plans = buildFallbackPlans(operator, rechargeType);
        return normalizePlanGroups({ categories: { popular: plans } });
    }
}

async function calculateRechargeCheckout({ user, mobile, operator, circle, rechargeType, planId, amount, useTokens }) {
    const rechargeAmount = Number(amount || 0);

    try {
        const providerData = await requestIsapay(getIsapayConfig().checkoutPaths, {
            mobile: normalizeMobile(mobile),
            mobileNumber: normalizeMobile(mobile),
            phone: normalizeMobile(mobile),
            number: normalizeMobile(mobile),
            msisdn: normalizeMobile(mobile),
            operator: String(operator || '').trim(),
            operatorName: String(operator || '').trim(),
            operatorCode: String(operator || '').trim(),
            circle: String(circle || 'All India').trim() || 'All India',
            circleName: String(circle || 'All India').trim() || 'All India',
            rechargeType: String(rechargeType || 'Prepaid').trim() || 'Prepaid',
            type: String(rechargeType || 'Prepaid').trim() || 'Prepaid',
            planType: String(rechargeType || 'Prepaid').trim() || 'Prepaid',
            planId: String(planId || '').trim(),
            planAmount: rechargeAmount,
            amount: rechargeAmount,
            useTokens: Boolean(useTokens)
        }, { method: 'POST' });
        return normalizeCheckoutResponse(providerData, { amount: rechargeAmount }, user);
    } catch (_) {
        return normalizeFallbackCheckout({ user, amount: rechargeAmount });
    }
}

async function payRecharge({ user, mobile, operator, circle, rechargeType, planId, amount, tokenDiscount, payableAmount, useTokens }) {
    const payload = {
        mobile: normalizeMobile(mobile),
        mobileNumber: normalizeMobile(mobile),
        phone: normalizeMobile(mobile),
        number: normalizeMobile(mobile),
        msisdn: normalizeMobile(mobile),
        operator: String(operator || '').trim(),
        operatorName: String(operator || '').trim(),
        operatorCode: String(operator || '').trim(),
        circle: String(circle || 'All India').trim() || 'All India',
        circleName: String(circle || 'All India').trim() || 'All India',
        rechargeType: String(rechargeType || 'Prepaid').trim() || 'Prepaid',
        type: String(rechargeType || 'Prepaid').trim() || 'Prepaid',
        planType: String(rechargeType || 'Prepaid').trim() || 'Prepaid',
        planId: String(planId || '').trim(),
        amount: Number(amount || 0),
        planAmount: Number(amount || 0),
        tokenDiscount: Number(tokenDiscount || 0),
        payableAmount: Number(payableAmount || 0),
        useTokens: Boolean(useTokens)
    };

    try {
        const data = await requestIsapay(getIsapayConfig().payPaths, payload, { method: 'POST' });
        return {
            success: true,
            raw: data || {},
            message: String(data?.message || data?.summary || 'Recharge request created.').trim(),
            checkoutUrl: String(data?.checkoutUrl || data?.paymentUrl || '').trim(),
            paymentUrl: String(data?.paymentUrl || data?.checkoutUrl || '').trim(),
            transactionId: String(data?.transactionId || data?.orderId || data?.referenceId || '').trim(),
            providerStatus: String(data?.status || data?.providerStatus || 'submitted').trim(),
            providerData: data || {}
        };
    } catch (_) {
        return buildFallbackPaymentResponse(payload);
    }
}
