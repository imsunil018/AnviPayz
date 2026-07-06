const User = require('../models/User');
const Notification = require('../models/Notification');
const {
    calculateRechargeCheckout,
    getRechargePlans,
    isIsapayConfigured,
    lookupRecharge,
    normalizeMobile,
    payRecharge
} = require('../services/isapay.service');

function numberValue(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeText(value, maxLength = 120) {
    return String(value || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function formatCurrency(value) {
    return `₹${numberValue(value, 0).toFixed(0)}`;
}

function buildRechargeActivity(payload, status = 'pending') {
    return {
        title: `${payload.operator || 'Recharge'} recharge`,
        message: `${payload.operator || 'Recharge'} ${formatCurrency(payload.amount)} ${status === 'completed' ? 'completed' : 'created'}.`,
        amount: numberValue(payload.payableAmount ?? payload.amount, 0),
        type: 'recharge',
        direction: 'debit',
        status,
        time: new Date(),
        taskId: String(payload.planId || '').trim()
    };
}

async function ensureRechargeUser(req, res) {
    const user = req.user || await User.findById(req.userId);
    if (!user) {
        res.status(404).json({ success: false, message: 'User not found.' });
        return null;
    }
    return user;
}

async function lookup(req, res) {
    try {
        const user = await ensureRechargeUser(req, res);
        if (!user) return;

        const mobile = normalizeMobile(req.body?.mobile || req.query?.mobile);
        if (!/^\d{10}$/.test(mobile)) {
            return res.status(400).json({ success: false, message: 'Enter a valid 10-digit mobile number.' });
        }

        const data = await lookupRecharge(mobile);
        return res.json({
            success: true,
            mobile,
            operator: data.operator,
            circle: data.circle,
            rechargeType: data.rechargeType,
            source: data.source,
            raw: data.raw
        });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
            success: false,
            message: error.message || 'Unable to detect operator right now.'
        });
    }
}

async function plans(req, res) {
    try {
        const user = await ensureRechargeUser(req, res);
        if (!user) return;

        const operator = sanitizeText(req.body?.operator || req.query?.operator, 60);
        const circle = sanitizeText(req.body?.circle || req.query?.circle, 60) || 'All India';
        const rechargeType = sanitizeText(req.body?.rechargeType || req.query?.rechargeType || 'Prepaid', 40) || 'Prepaid';

        if (!operator) {
            return res.status(400).json({ success: false, message: 'Operator is required.' });
        }

        const data = await getRechargePlans({ operator, circle, rechargeType });
        return res.json({
            success: true,
            operator,
            circle,
            rechargeType,
            defaultCategory: data.defaultCategory,
            categories: data.categories,
            plans: data.plans
        });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
            success: false,
            message: error.message || 'Unable to load recharge plans right now.'
        });
    }
}

async function checkout(req, res) {
    try {
        const user = await ensureRechargeUser(req, res);
        if (!user) return;

        const payload = {
            mobile: normalizeMobile(req.body?.mobile),
            operator: sanitizeText(req.body?.operator, 60),
            circle: sanitizeText(req.body?.circle, 60) || 'All India',
            rechargeType: sanitizeText(req.body?.rechargeType || 'Prepaid', 40) || 'Prepaid',
            planId: sanitizeText(req.body?.planId, 80),
            amount: numberValue(req.body?.amount, 0),
            useTokens: Boolean(req.body?.useTokens)
        };

        if (!/^\d{10}$/.test(payload.mobile)) {
            return res.status(400).json({ success: false, message: 'Enter a valid 10-digit mobile number.' });
        }

        if (!payload.operator) {
            return res.status(400).json({ success: false, message: 'Operator is required.' });
        }

        if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
            return res.status(400).json({ success: false, message: 'Plan amount is required.' });
        }

        const checkout = await calculateRechargeCheckout({ user, ...payload });
        return res.json({
            success: true,
            ...checkout
        });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
            success: false,
            message: error.message || 'Unable to calculate recharge checkout.'
        });
    }
}

async function pay(req, res) {
    try {
        const user = await ensureRechargeUser(req, res);
        if (!user) return;

        const payload = {
            mobile: normalizeMobile(req.body?.mobile),
            operator: sanitizeText(req.body?.operator, 60),
            circle: sanitizeText(req.body?.circle, 60) || 'All India',
            rechargeType: sanitizeText(req.body?.rechargeType || 'Prepaid', 40) || 'Prepaid',
            planId: sanitizeText(req.body?.planId, 80),
            amount: numberValue(req.body?.amount, 0),
            tokenDiscount: numberValue(req.body?.tokenDiscount, 0),
            payableAmount: numberValue(req.body?.payableAmount, 0),
            useTokens: Boolean(req.body?.useTokens)
        };

        if (!/^\d{10}$/.test(payload.mobile)) {
            return res.status(400).json({ success: false, message: 'Enter a valid 10-digit mobile number.' });
        }

        if (!payload.operator) {
            return res.status(400).json({ success: false, message: 'Operator is required.' });
        }

        if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
            return res.status(400).json({ success: false, message: 'Plan amount is required.' });
        }

        const providerResponse = await payRecharge({ user, ...payload });
        const nextTokens = Math.max(0, numberValue(user.tokens, 0) - numberValue(payload.tokenDiscount, 0));

        user.tokens = nextTokens;
        user.activity = [
            buildRechargeActivity(payload, 'pending'),
            ...(Array.isArray(user.activity) ? user.activity : [])
        ].slice(0, 50);

        await user.save();

        try {
            await Notification.create({
                title: 'Recharge payment created',
                message: `${payload.operator} recharge for ${formatCurrency(payload.amount)} is ready for payment.`,
                type: 'recharge',
                audience: 'user',
                userId: String(user._id),
                link: 'recharge.html',
                meta: {
                    mobile: payload.mobile,
                    operator: payload.operator,
                    amount: payload.amount,
                    payableAmount: payload.payableAmount,
                    tokenDiscount: payload.tokenDiscount,
                    planId: payload.planId,
                    provider: 'isapay'
                }
            });
        } catch (_) {
            // Notifications should not block recharge flow.
        }

        return res.json({
            success: true,
            message: providerResponse.message || 'Recharge request created successfully.',
            checkoutUrl: providerResponse.checkoutUrl || '',
            paymentUrl: providerResponse.paymentUrl || '',
            transactionId: providerResponse.transactionId || '',
            providerStatus: providerResponse.providerStatus || 'submitted',
            user: {
                ...user.toObject(),
                tokens: nextTokens
            },
            providerData: providerResponse.providerData || {}
        });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
            success: false,
            message: error.message || 'Unable to start recharge payment right now.'
        });
    }
}

function normalizeWebhookStatus(rawStatus) {
    const status = String(rawStatus || '').trim().toLowerCase();
    if (!status) return 'pending';
    if (['success', 'successful', 'successfully', 'paid', 'completed', 'complete', 'done'].includes(status)) {
        return 'completed';
    }
    if (['failed', 'failure', 'fail', 'rejected', 'declined', 'cancelled', 'canceled', 'expired'].includes(status)) {
        return 'failed';
    }
    return 'pending';
}

async function webhook(req, res) {
    try {
        const payload = {
            orderid: sanitizeText(req.body?.orderid || req.query?.orderid, 120),
            status: sanitizeText(req.body?.status || req.query?.status, 40),
            mobile: normalizeMobile(req.body?.mobile || req.query?.mobile),
            amount: numberValue(req.body?.amount || req.query?.amount, 0),
            opid: sanitizeText(req.body?.opid || req.query?.opid, 120),
            utr: sanitizeText(req.body?.utr || req.query?.utr, 120)
        };

        if (!payload.orderid) {
            return res.status(400).json({ success: false, message: 'orderid is required.' });
        }

        const normalizedStatus = normalizeWebhookStatus(payload.status);
        const transactionKeys = [
            payload.orderid,
            payload.opid,
            payload.utr
        ].filter(Boolean);

        const query = {
            $or: [
                { 'activity.taskId': { $in: transactionKeys } },
                { 'activity.meta.transactionId': { $in: transactionKeys } },
                { 'activity.meta.orderid': { $in: transactionKeys } }
            ]
        };

        const user = await User.findOne(query);
        if (user) {
            user.activity = Array.isArray(user.activity) ? user.activity : [];
            user.activity.unshift({
                title: 'Recharge update',
                message: `Recharge ${payload.orderid} marked ${normalizedStatus}.`,
                amount: payload.amount,
                type: 'recharge',
                direction: 'debit',
                status: normalizedStatus,
                time: new Date(),
                taskId: payload.orderid,
                meta: {
                    mobile: payload.mobile,
                    orderid: payload.orderid,
                    opid: payload.opid,
                    utr: payload.utr,
                    provider: 'inspay'
                }
            });
            user.activity = user.activity.slice(0, 50);
            await user.save();
        }

        try {
            await Notification.create({
                title: 'Recharge status update',
                message: `Order ${payload.orderid} updated to ${normalizedStatus}.`,
                type: 'recharge',
                audience: 'user',
                userId: user ? String(user._id) : undefined,
                meta: {
                    orderid: payload.orderid,
                    status: normalizedStatus,
                    mobile: payload.mobile,
                    amount: payload.amount,
                    opid: payload.opid,
                    utr: payload.utr,
                    provider: 'inspay'
                }
            });
        } catch (_) {
            // Webhook acknowledgements should not fail because notifications failed.
        }

        return res.status(200).json({
            success: true,
            message: 'Webhook received.',
            status: normalizedStatus
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message || 'Unable to process webhook.'
        });
    }
}

module.exports = {
    checkout,
    isIsapayConfigured,
    lookup,
    plans,
    pay,
    webhook
};
