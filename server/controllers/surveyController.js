const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Notification = require('../models/Notification');
const SurveyHistory = require('../models/SurveyHistory');
const {
    buildCpxLaunchUrl,
    buildCpxIframeUrl,
    createSurveyClaimKey,
    getPostbackSecretCandidate,
    getSurveyDefinitions,
    normalizeProviderKey,
    verifyCpxPostbackSecret
} = require('../services/cpx.service');

function numberValue(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function escapePattern(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSurveySummary(user, surveys, history) {
    const todayKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    const today = todayKey.format(new Date());
    const todaysEarnings = history.reduce((sum, item) => {
        const stamp = item.completedAt || item.startedAt || item.createdAt;
        const key = stamp ? todayKey.format(new Date(stamp)) : '';
        if (key !== today) {
            return sum;
        }
        return sum + numberValue(item.rewardPoints, 0);
    }, 0);

    return {
        currentPoints: numberValue(user.points, 0),
        currentTokens: numberValue(user.tokens, 0),
        todaysEarnings,
        lifetimeEarnings: numberValue(user.surveyEarnings, 0),
        availableSurveys: surveys.length,
        completedSurveys: history.filter((item) => item.status === 'completed').length
    };
}

function formatSurveyCard(survey, historyEntry = null) {
    return {
        id: survey.id,
        title: survey.title,
        description: survey.description,
        rewardPoints: numberValue(survey.rewardPoints, 0),
        estimatedMinutes: numberValue(survey.estimatedMinutes, 0),
        difficulty: survey.difficulty || 'Medium',
        category: survey.category || 'General',
        countryAvailability: survey.countryAvailability || 'India',
        provider: survey.providerLabel || survey.provider || 'Provider',
        providerKey: normalizeProviderKey(survey.provider),
        status: historyEntry?.status === 'completed' ? 'completed' : (survey.status || 'available'),
        completedAt: historyEntry?.completedAt || null,
        sessionId: historyEntry?.sessionId || null,
        launchAvailable: Boolean(survey.launchAvailable !== false),
        ctaLabel: historyEntry?.status === 'completed' ? 'Completed' : (survey.ctaLabel || 'Start Survey')
    };
}

async function getSurveys(req, res) {
    try {
        const user = req.user || await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const catalog = getSurveyDefinitions();
        const histories = await SurveyHistory.find({
            userId: user._id,
            status: { $in: ['started', 'completed', 'duplicate', 'expired'] }
        }).sort({ createdAt: -1 }).lean();

        const historyBySurvey = new Map();
        histories.forEach((entry) => {
            const surveyId = String(entry.surveyId || '').trim();
            if (!surveyId || historyBySurvey.has(surveyId)) {
                return;
            }
            historyBySurvey.set(surveyId, entry);
        });

        const surveys = catalog.map((survey) => formatSurveyCard(survey, historyBySurvey.get(survey.id) || null));
        const summary = buildSurveySummary(user, surveys, histories);

        res.json({
            success: true,
            surveys,
            summary,
            providerConfigured: surveys.length > 0
        });
    } catch (error) {
        console.error('Survey list error:', error);
        res.status(500).json({ success: false, message: 'Failed to load surveys.' });
    }
}

async function getCpxIframe(req, res) {
    try {
        const user = req.user || await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const iframeUrl = buildCpxIframeUrl({ user });
        if (!iframeUrl) {
            return res.status(503).json({
                success: false,
                message: 'CPX surveys are not configured yet.'
            });
        }

        res.json({
            success: true,
            iframeUrl,
            provider: 'cpx',
            frameHeight: 2000,
            user: {
                id: String(user._id || ''),
                name: user.fullName || user.name || 'AnviPayz Member',
                email: user.emailVerified ? (user.email || '') : ''
            }
        });
    } catch (error) {
        console.error('CPX iframe error:', error);
        res.status(500).json({ success: false, message: 'Unable to load CPX surveys right now.' });
    }
}

async function launchSurvey(req, res) {
    try {
        const user = req.user || await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const surveyId = String(req.params.surveyId || req.body?.surveyId || '').trim();
        const catalog = getSurveyDefinitions();
        const survey = catalog.find((item) => item.id === surveyId);
        if (!survey) {
            return res.status(404).json({ success: false, message: 'Survey is not available right now.' });
        }

        const existingCompleted = await SurveyHistory.findOne({
            userId: user._id,
            surveyId: survey.id,
            status: 'completed'
        }).lean();

        if (existingCompleted) {
            return res.status(409).json({ success: false, message: 'This survey has already been completed.' });
        }

        const sessionId = crypto.randomUUID();
        const rewardPoints = numberValue(survey.rewardPoints, 0);
        const claimKey = createSurveyClaimKey({
            provider: survey.provider,
            surveyId: survey.id,
            sessionId
        });

        const claimToken = jwt.sign({
            sub: String(user._id),
            surveyId: survey.id,
            provider: survey.provider,
            sessionId,
            rewardPoints,
            claimKey
        }, process.env.JWT_SECRET, { expiresIn: '1d' });

        const launchUrl = buildCpxLaunchUrl({ user, survey, sessionId });

        await SurveyHistory.findOneAndUpdate(
            { sessionId },
            {
                surveyId: survey.id,
                provider: survey.provider,
                providerLabel: survey.providerLabel,
                userId: user._id,
                rewardPoints,
                status: 'started',
                startedAt: new Date(),
                sessionId,
                claimKey,
                launchUrl,
                providerPayload: {
                    title: survey.title,
                    category: survey.category,
                    difficulty: survey.difficulty,
                    countryAvailability: survey.countryAvailability
                },
                rewardPayload: {
                    claimToken
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.json({
            success: true,
            launchUrl,
            sessionId,
            survey: formatSurveyCard(survey)
        });
    } catch (error) {
        console.error('Survey launch error:', error);
        res.status(500).json({ success: false, message: 'Unable to launch survey right now.' });
    }
}

async function applySurveyReward({ user, history, rewardPoints, transactionId, rewardPayload = {} }) {
    const reward = Math.max(0, Math.floor(numberValue(rewardPoints, 0)));
    if (!user || !history || reward <= 0) {
        throw new Error('Invalid survey reward payload.');
    }

    const claimKey = history.claimKey || createSurveyClaimKey({
        provider: history.provider,
        surveyId: history.surveyId,
        sessionId: history.sessionId || transactionId
    });

    const duplicateClaim = user.rewardClaimKeys.includes(claimKey);
    if (history.status === 'completed' || duplicateClaim) {
        history.status = 'duplicate';
        history.transactionId = history.transactionId || transactionId || null;
        history.rewardPayload = {
            ...(history.rewardPayload || {}),
            ...rewardPayload,
            duplicate: true
        };
        await history.save();
        return { duplicate: true };
    }

    user.points = numberValue(user.points, 0) + reward;
    user.lifetimeXp = numberValue(user.lifetimeXp, 0) + reward;
    user.surveyEarnings = numberValue(user.surveyEarnings, 0) + reward;
    user.rewardClaimKeys = Array.from(new Set([...(user.rewardClaimKeys || []), claimKey]));
    user.activity = [
        {
            title: history.providerLabel ? `${history.providerLabel} reward` : 'Survey reward',
            message: `${history.providerLabel || 'Survey'} completed successfully.`,
            amount: reward,
            type: 'survey',
            direction: 'credit',
            status: 'completed',
            time: new Date(),
            taskId: history.surveyId
        },
        ...(Array.isArray(user.activity) ? user.activity : [])
    ].slice(0, 50);

    history.status = 'completed';
    history.completedAt = new Date();
    history.transactionId = transactionId || history.transactionId || history.sessionId || null;
    history.rewardPoints = reward;
    history.rewardPayload = {
        ...(history.rewardPayload || {}),
        ...rewardPayload,
        claimKey
    };
    history.duplicateKey = history.duplicateKey || `${history.provider}:${history.sessionId || history.transactionId || history._id}`;

    const notification = await Notification.create({
        title: history.providerLabel ? `${history.providerLabel} reward received` : 'Survey reward received',
        message: `${history.providerLabel || 'Survey'} completed. +${reward} points credited.`,
        type: 'survey',
        audience: 'user',
        userId: String(user._id),
        link: 'surveys.html',
        meta: {
            surveyId: history.surveyId,
            provider: history.provider,
            rewardPoints: reward
        }
    });

    await Promise.all([
        user.save(),
        history.save()
    ]);

    return {
        duplicate: false,
        user,
        history,
        notification
    };
}

async function submitSurveyReward(req, res) {
    try {
        const user = req.user || await User.findById(req.userId);
        const surveyId = String(req.body?.surveyId || req.body?.taskId || '').trim();
        const rewardPoints = numberValue(req.body?.rewardPoints || req.body?.points, 0);
        if (!user || !surveyId || rewardPoints <= 0) {
            return res.status(400).json({ success: false, message: 'Survey reward payload is invalid.' });
        }

        const sessionId = String(req.body?.sessionId || '').trim();
        const transactionId = String(req.body?.transactionId || '').trim();
        const historyQuery = {
            userId: user._id,
            surveyId
        };

        const idFilters = [];
        if (sessionId) {
            idFilters.push({ sessionId });
        }
        if (transactionId) {
            idFilters.push({ transactionId });
        }
        if (idFilters.length) {
            historyQuery.$or = idFilters;
        }

        let history = await SurveyHistory.findOne(historyQuery);

        if (!history) {
            history = new SurveyHistory({
                surveyId,
                provider: normalizeProviderKey(req.body?.provider || 'cpx'),
                providerLabel: String(req.body?.providerLabel || 'CPX Research').trim(),
                userId: user._id,
                rewardPoints,
                startedAt: new Date(),
                sessionId: sessionId || undefined,
                transactionId: transactionId || undefined,
                claimKey: createSurveyClaimKey({
                    provider: req.body?.provider || 'cpx',
                    surveyId,
                    sessionId: sessionId || transactionId || surveyId
                }),
                duplicateKey: req.body?.duplicateKey || null,
                rewardPayload: {}
            });
        }

        const result = await applySurveyReward({
            user,
            history,
            rewardPoints,
            transactionId: transactionId || sessionId || surveyId,
            rewardPayload: {
                source: 'legacy-submit',
                submittedAt: new Date().toISOString()
            }
        });

        if (result.duplicate) {
            return res.status(409).json({ success: false, message: 'Survey reward already processed.' });
        }

        return res.json({
            success: true,
            message: 'Survey reward credited successfully.',
            points: rewardPoints
        });
    } catch (error) {
        console.error('Survey submit error:', error);
        res.status(500).json({ success: false, message: 'Unable to credit survey reward.' });
    }
}

async function handleCpxPostback(req, res) {
    try {
        if (!verifyCpxPostbackSecret(getPostbackSecretCandidate(req))) {
            return res.status(403).json({ success: false, message: 'Invalid postback secret.' });
        }

        const sessionId = String(req.body?.subid_1 || req.body?.session_id || req.query?.subid_1 || req.query?.session_id || '').trim();
        const transactionId = String(req.body?.transaction_id || req.body?.txid || req.body?.reward_id || req.query?.transaction_id || req.query?.txid || '').trim();
        const surveyId = String(req.body?.subid_3 || req.body?.survey_id || req.query?.subid_3 || req.query?.survey_id || '').trim();
        const provider = normalizeProviderKey(req.body?.provider || req.query?.provider || 'cpx');
        const rewardPoints = numberValue(
            req.body?.reward_points ||
            req.body?.amount ||
            req.body?.points ||
            req.query?.reward_points ||
            req.query?.amount ||
            req.query?.points,
            0
        );

        if (!sessionId || !surveyId || rewardPoints <= 0) {
            return res.status(400).json({ success: false, message: 'Missing postback data.' });
        }

        const history = await SurveyHistory.findOne({
            sessionId,
            surveyId,
            provider
        });

        if (!history) {
            return res.status(404).json({ success: false, message: 'Survey session not found.' });
        }

        const user = await User.findById(history.userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const result = await applySurveyReward({
            user,
            history,
            rewardPoints,
            transactionId: transactionId || sessionId,
            rewardPayload: {
                provider,
                cpx: {
                    ip: req.ip,
                    params: { ...req.query },
                    body: { ...req.body }
                }
            }
        });

        if (result.duplicate) {
            return res.json({ success: true, duplicate: true, message: 'Survey reward already processed.' });
        }

        return res.json({
            success: true,
            message: 'Survey reward credited.',
            points: rewardPoints
        });
    } catch (error) {
        console.error('CPX postback error:', error);
        res.status(500).json({ success: false, message: 'Unable to process postback.' });
    }
}

module.exports = {
    getCpxIframe,
    getSurveys,
    launchSurvey,
    submitSurveyReward,
    handleCpxPostback
};
