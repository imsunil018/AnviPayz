const User = require('../models/User');
const OTP = require('../models/Otp');
const Notification = require('../models/Notification');
const nodemailer = require('nodemailer');
const { createOtpEmail } = require('../../api/_lib/otp-email');
const {
    RECOVERY_WINDOW_DAYS,
    createRestoreToken,
    getDeletionMetadata,
    isPendingDeletion,
    purgeUserIfExpired,
    restoreUserAccount,
    verifyRestoreToken
} = require('../utils/accountLifecycle');

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'anvipayz@gmail.com';
const SENDER_NAME = process.env.BREVO_SENDER_NAME || 'AnviPayz';
const WELCOME_POINTS = 50;
const REFERRAL_REFERRER_POINTS = 250;
const REFERRAL_NEW_USER_POINTS = 150;
const REFERRAL_DAILY_LIMIT = 10;
const DAILY_LOGIN_REWARD_POINTS = 10;
const DAILY_GOAL_BONUS_POINTS = 50;
const STREAK_BONUS_RULES = Object.freeze([
    { days: 7, points: 100 },
    { days: 14, points: 250 },
    { days: 21, points: 500 }
]);
const REFERRAL_BONUS_TIERS = Object.freeze([
    { referrals: 15, points: 1000 },
    { referrals: 25, points: 2000 },
    { referrals: 50, points: 6000 }
]);
const INDIA_TIME_ZONE = 'Asia/Kolkata';
const INDIA_TIME_ZONE_OFFSET = '+05:30';
const POLICY_VERSION = '2026-03-31';

function indiaDateKey(value = Date.now()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: INDIA_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date(value));
}

function indiaDayRange(value = Date.now()) {
    const key = indiaDateKey(value);
    const start = new Date(`${key}T00:00:00.000${INDIA_TIME_ZONE_OFFSET}`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end, key };
}

function hasDailyLoginRewardToday(user) {
    const todayKey = indiaDateKey();
    if (user?.lastDailyLoginRewardAt && indiaDateKey(user.lastDailyLoginRewardAt) === todayKey) {
        return true;
    }

    return (Array.isArray(user?.activity) ? user.activity : []).some((entry) => {
        const taskId = String(entry?.taskId || '').trim();
        if (taskId !== 'daily-login' && taskId !== 'daily-checkin') {
            return false;
        }

        if (String(entry?.type || '').toLowerCase() !== 'task') {
            return false;
        }

        return indiaDateKey(entry.time || Date.now()) === todayKey;
    });
}

function getDailyStreakDays(user) {
    const activity = Array.isArray(user?.activity) ? user.activity : [];
    const dayFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: INDIA_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const acceptedTaskIds = new Set(['daily-login', 'daily-checkin']);
    const dayKeys = new Set(
        activity
            .filter((entry) => acceptedTaskIds.has(String(entry?.taskId || '').trim()))
            .map((entry) => {
                const timestamp = new Date(entry?.time || Date.now()).getTime();
                if (!Number.isFinite(timestamp)) {
                    return '';
                }
                return dayFormatter.format(new Date(timestamp));
            })
            .filter(Boolean)
    );

    let streak = 0;
    const cursor = new Date();
    while (true) {
        const key = dayFormatter.format(cursor);
        if (!dayKeys.has(key)) {
            break;
        }
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
    }

    return streak;
}

function getStreakBonusForDays(streakDays) {
    const cycleDay = Math.max(1, Math.floor(Number(streakDays || 0))) % 21 || 21;
    return STREAK_BONUS_RULES.find((rule) => rule.days === cycleDay) || null;
}

function getDailyGoalClaimKey(dayKey = indiaDateKey()) {
    return `daily-goal:${dayKey}`;
}

function getCompletedTaskIdsForDay(activity, dayKey = indiaDateKey()) {
    const entries = Array.isArray(activity) ? activity : [];
    const completedTaskIds = new Set();

    for (const entry of entries) {
        if (String(entry?.type || '').toLowerCase() !== 'task') {
            continue;
        }

        const taskId = String(entry?.taskId || '').trim();
        if (!taskId) {
            continue;
        }

        const amount = Number(entry?.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) {
            continue;
        }

        if (String(entry?.direction || '').toLowerCase() === 'debit') {
            continue;
        }

        if (indiaDateKey(entry?.time || Date.now()) !== dayKey) {
            continue;
        }

        completedTaskIds.add(taskId);
    }

    return completedTaskIds;
}

function buildDailyGoalBonus(user, reward = null) {
    const source = String(reward?.source || '').trim().toLowerCase();
    if (source !== 'task' && source !== 'login') {
        return null;
    }

    const dayKey = indiaDateKey();
    const claimKey = getDailyGoalClaimKey(dayKey);
    const existingKeys = new Set(Array.isArray(user?.rewardClaimKeys) ? user.rewardClaimKeys : []);
    if (existingKeys.has(claimKey)) {
        return null;
    }

    const completedTaskIds = getCompletedTaskIdsForDay(user?.activity, dayKey);
    const rewardTaskId = String(reward?.taskId || '').trim();
    if (rewardTaskId) {
        completedTaskIds.add(rewardTaskId);
    }

    const hasDailyAnchor = completedTaskIds.has('daily-login') || completedTaskIds.has('daily-checkin');
    const hasTutorial = completedTaskIds.has('watch-tutorial');

    if (!hasDailyAnchor || !hasTutorial) {
        return null;
    }

    return {
        points: DAILY_GOAL_BONUS_POINTS,
        claimKey,
        title: 'Daily goal bonus',
        message: 'Daily goal completed. Bonus credited successfully.',
        taskId: 'daily-goal-bonus',
        rewardType: 'task',
        earningsField: 'taskEarnings',
        source: 'task'
    };
}

function addLifetimeXp(user, points) {
    const amount = Number(points || 0);
    if (Number.isFinite(amount) && amount > 0) {
        user.lifetimeXp = Number(user.lifetimeXp || 0) + amount;
    }
}

function getLevelUpBonusPoints(level) {
    const targetLevel = Math.max(2, Math.floor(Number(level || 2)));
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

    return level;
}

function getLifetimeXp(user) {
    const directValue = Number(user?.lifetimeXp);
    if (Number.isFinite(directValue) && directValue > 0) {
        return directValue;
    }

    const activity = Array.isArray(user?.activity) ? user.activity : [];
    return activity.reduce((sum, entry) => {
        const entryType = String(entry?.type || '').toLowerCase();
        if (entryType === 'convert' || entryType === 'level') {
            return sum;
        }

        const amount = Number(entry?.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) {
            return sum;
        }

        if (String(entry?.direction || '').toLowerCase() === 'debit') {
            return sum;
        }

        return sum + amount;
    }, 0);
}

function collectLevelRewards(user, previousXp, nextXp) {
    const previousLevel = getXpLevel(previousXp);
    const nextLevel = getXpLevel(nextXp);
    const rewards = [];
    const existingKeys = new Set(Array.isArray(user?.rewardClaimKeys) ? user.rewardClaimKeys : []);

    for (let level = previousLevel + 1; level <= nextLevel; level += 1) {
        const claimKey = `xp-level-${level}`;
        if (existingKeys.has(claimKey)) {
            continue;
        }

        rewards.push({
            level,
            points: getLevelUpBonusPoints(level),
            claimKey
        });
    }

    return rewards;
}

function getReferralTierClaimKey(referrals) {
    return `referral-tier-${referrals}`;
}

function getReferralBonusPoints(referralCount) {
    const count = Math.max(0, Math.floor(Number(referralCount || 0)));
    return REFERRAL_BONUS_TIERS.reduce((sum, tier) => sum + (count >= tier.referrals ? tier.points : 0), 0);
}

function hasReferralTierClaim(user, referrals) {
    const claimKey = getReferralTierClaimKey(referrals);
    const existingKeys = Array.isArray(user?.rewardClaimKeys) ? user.rewardClaimKeys : [];
    if (existingKeys.includes(claimKey)) {
        return true;
    }

    if (referrals === 15 && existingKeys.some((key) => String(key || '').startsWith('referral-bonus-'))) {
        return true;
    }

    return false;
}

function getMissingReferralTierRewards(user, referralCount) {
    const count = Math.max(0, Math.floor(Number(referralCount || 0)));
    return REFERRAL_BONUS_TIERS
        .filter((tier) => count >= tier.referrals && !hasReferralTierClaim(user, tier.referrals))
        .map((tier) => ({
            referrals: tier.referrals,
            points: tier.points,
            claimKey: getReferralTierClaimKey(tier.referrals)
        }));
}

const readBrevoError = async (response) => {
    const rawBody = await response.text();

    try {
        const parsed = JSON.parse(rawBody);
        return parsed.message || parsed.code || rawBody;
    } catch (error) {
        return rawBody;
    }
};

const serializeUser = (user, extra = {}) => ({
    id: user._id,
    email: user.email,
    name: user.name,
    phone: user.phone || '',
    emailVerified: Boolean(user.emailVerified || user.emailVerifiedAt),
    mobileVerified: Boolean(user.mobileVerified),
    points: user.points || 0,
    lifetimeXp: getLifetimeXp(user),
    tokens: user.tokens || 0,
    referralEarnings: user.referralEarnings || 0,
    taskEarnings: user.taskEarnings || 0,
    surveyEarnings: user.surveyEarnings || 0,
    referralCode: user.referralCode,
    joinedAt: user.joinedAt,
    lastLogin: user.lastLogin,
    lastDailyLoginRewardAt: user.lastDailyLoginRewardAt || null,
    emailVerifiedAt: user.emailVerifiedAt || user.joinedAt || null,
    avatarUrl: user.avatarUrl || '',
    referredByCode: user.referredByCode || '',
    termsAcceptedAt: user.termsAcceptedAt || null,
    acceptedPolicyVersion: user.acceptedPolicyVersion || '',
    nameChangeCountThisMonth: user.nameChangeCountThisMonth || 0,
    lastNameChangeMonth: user.lastNameChangeMonth || null,
    emailChangeCountThisMonth: user.emailChangeCountThisMonth || 0,
    lastEmailChangeMonth: user.lastEmailChangeMonth || null,
    lastEmailChangeDate: user.lastEmailChangeDate || null,
    ...getDeletionMetadata(user),
    ...extra
});

const serializeActivityList = (activity) => (Array.isArray(activity) ? activity : [])
    .map((entry) => ({
        id: String(entry?._id || entry?.id || ''),
        title: entry?.title || 'Account activity',
        message: entry?.message || '',
        amount: Number(entry?.amount || 0),
        type: entry?.type || 'wallet',
        direction: entry?.direction || 'credit',
        status: entry?.status || 'completed',
        time: entry?.time || new Date(),
        taskId: entry?.taskId || ''
    }))
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

const appendActivity = (user, activity) => {
    user.activity = [
        {
            title: activity.title || 'Account activity',
            message: activity.message || '',
            amount: Number(activity.amount || 0),
            type: activity.type || 'wallet',
            direction: activity.direction || 'credit',
            status: activity.status || 'completed',
            time: activity.time || new Date(),
            taskId: activity.taskId || ''
        },
        ...(Array.isArray(user.activity) ? user.activity : [])
    ].slice(0, 50);
};

const sendEmailViaSmtp = async (toEmail, emailContent) => {
    if (!process.env.BREVO_API_KEY) {
        throw new Error('BREVO_API_KEY is missing. Add it in .env to send OTP emails.');
    }

    const transporter = nodemailer.createTransport({
        host: 'smtp-relay.brevo.com',
        port: 587,
        secure: false,
        auth: {
            user: 'apikey',
            pass: process.env.BREVO_API_KEY
        }
    });

    await transporter.sendMail({
        from: `"${SENDER_NAME}" <${SENDER_EMAIL}>`,
        to: toEmail,
        replyTo: `"AnviPayz Support" <${SENDER_EMAIL}>`,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text
    });
};

const sendEmailViaBrevo = async (toEmail, otp, mode = 'login') => {
    const emailContent = createOtpEmail(mode === 'register'
        ? {
            otp,
            subject: 'Complete your AnviPayz sign up',
            heading: 'Confirm your email to continue',
            intro: 'Use the verification code below to verify your email address and finish creating your AnviPayz account.',
            purposeLine: 'Enter this code only on the AnviPayz registration screen.'
        }
        : {
            otp,
            subject: 'Your AnviPayz login code',
            heading: 'Your sign-in code is ready',
            intro: 'Use the verification code below to complete your AnviPayz login.',
            purposeLine: 'Enter this code only on the AnviPayz login screen.'
        });

    if (typeof fetch !== 'function') {
        await sendEmailViaSmtp(toEmail, emailContent);
        return { success: true, via: 'smtp' };
    }

    try {
        const response = await fetch(BREVO_API_URL, {
            method: 'POST',
            headers: {
                'api-key': process.env.BREVO_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sender: {
                    email: SENDER_EMAIL,
                    name: SENDER_NAME
                },
                replyTo: {
                    email: SENDER_EMAIL,
                    name: 'AnviPayz Support'
                },
                to: [{ email: toEmail }],
                subject: emailContent.subject,
                htmlContent: emailContent.html,
                textContent: emailContent.text
            })
        });

        if (!response.ok) {
            const errorMessage = await readBrevoError(response);
            const isSenderInvalid = /sender.+not valid|validate your sender/i.test(errorMessage);

            if (isSenderInvalid) {
                throw new Error(`Brevo sender "${SENDER_EMAIL}" is not validated. Verify this sender or domain in Brevo before sending OTP emails.`);
            }

            try {
                await sendEmailViaSmtp(toEmail, emailContent);
                return { success: true, via: 'smtp-fallback' };
            } catch (smtpError) {
                throw new Error(errorMessage || smtpError.message || 'Failed to send email');
            }
        }

        return { success: true, via: 'api' };
    } catch (error) {
        if (!/sender.+not valid|validate your sender/i.test(error.message || '')) {
            try {
                await sendEmailViaSmtp(toEmail, emailContent);
                return { success: true, via: 'smtp-fallback' };
            } catch (smtpError) {
                // fall through to throw below
            }
        }

        console.error('Brevo Email Error:', error);
        throw new Error(error.message || 'Failed to send OTP email');
    }
};

const sendOTP = async (req, res) => {
    try {
        const identityRaw = String(req.body?.identity || req.body?.mobileNumber || req.body?.phone || req.body?.email || '').trim();

        if (!identityRaw) {
            return res.status(400).json({ success: false, message: 'Please enter a valid email or mobile number' });
        }

        const isEmail = identityRaw.includes('@');
        let normalizedPhone = '';
        let email = '';

        if (isEmail) {
            email = identityRaw.toLowerCase();
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
            }
        } else {
            // Check if valid Indian mobile number
            const isValidIndianPhone = (phoneStr) => {
                const clean = phoneStr.replace(/\D/g, '');
                return /^[6-9]\d{9}$/.test(clean) || /^91[6-9]\d{9}$/.test(clean);
            };
            const normalizeIndianMobile = (phoneStr) => {
                const clean = phoneStr.replace(/\D/g, '');
                return clean.length === 10 ? '91' + clean : clean;
            };

            if (!isValidIndianPhone(identityRaw)) {
                return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit mobile number' });
            }
            normalizedPhone = normalizeIndianMobile(identityRaw);
        }

        let existingUser = null;
        if (isEmail) {
            existingUser = await User.findOne({ email });
        } else {
            existingUser = await User.findOne({ 
                $or: [
                    { mobileNumber: normalizedPhone },
                    { phone: normalizedPhone }
                ]
            });
        }

        if (existingUser && await purgeUserIfExpired(existingUser)) {
            existingUser = null;
        }

        if (!existingUser) {
            return res.status(400).json({ success: false, message: 'Account not registered. Please register first.' });
        }

        let targetEmail = '';
        if (isEmail) {
            targetEmail = email;
        } else {
            if (!existingUser.email) {
                return res.status(400).json({
                    success: false,
                    message: 'No registered email address found for this mobile number. Please register with your email address.'
                });
            }
            targetEmail = existingUser.email;
        }

        // We use user.email or user.mobileNumber as identifier for OTP throttling
        const identifier = existingUser.email || existingUser.mobileNumber || targetEmail;
        const canRequest = await OTP.canRequestOTP(identifier);
        if (!canRequest) {
            return res.status(429).json({
                success: false,
                message: 'Please wait 30 seconds before requesting new OTP',
                retryAfter: 30
            });
        }

        const otp = OTP.generateOTP();
        const otpHash = OTP.hashOTP(otp);
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        
        // Save the OTP record using the user's primary email so verifyOTP can look it up by email
        const otpRecord = await OTP.create({
            email: targetEmail,
            otpHash,
            expiresAt
        });

        try {
            await sendEmailViaBrevo(targetEmail, otp, 'login');
        } catch (emailError) {
            console.error('[Email Error] Failed to send email OTP:', emailError.message);
            await OTP.deleteOne({ _id: otpRecord._id });
            throw emailError;
        }

        const maskEmail = (emailStr) => {
            const parts = emailStr.split('@');
            if (parts.length !== 2) return emailStr;
            const name = parts[0];
            const domain = parts[1];
            if (name.length <= 2) {
                return name[0] + '*@' + domain;
            }
            return name.slice(0, 2) + '***' + name.slice(-1) + '@' + domain;
        };

        res.status(200).json({
            success: true,
            message: `OTP sent to your registered email: ${maskEmail(targetEmail)}`,
            email: targetEmail
        });
    } catch (error) {
        console.error('Send OTP Error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to send OTP'
        });
    }
};

const registerSendOTP = async (req, res) => {
    try {
        const email = req.body?.email?.trim().toLowerCase();
        const name = req.body?.name?.trim();
        const acceptedTerms = Boolean(req.body?.acceptedTerms);
        let referCode = req.body?.referCode?.trim().toUpperCase() || null;

        if (!email || !name) {
            return res.status(400).json({ success: false, message: 'Email and Name are required' });
        }

        if (!acceptedTerms) {
            return res.status(400).json({ success: false, message: 'Please accept the Terms & Conditions to continue.' });
        }

        const isValidReferralCode = (code) => {
            const normalized = String(code || '').trim().toUpperCase();
            if (!normalized) {
                return false;
            }
            return /^[0-9]{4,5}ANVI[0-9]{4,5}$/.test(normalized) || /^ANVI[A-Z][0-9]{4}$/.test(normalized);
        };

        // Validate referral code format if provided
        if (referCode) {
            if (!isValidReferralCode(referCode)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid referral code format. Use format like: ANVIA1234'
                });
            }

            // Only keep referral code if the referrer exists.
            let referrer = await User.findOne({ referralCode: referCode });
            if (referrer && await purgeUserIfExpired(referrer)) {
                referrer = null;
            }

            if (referrer && isPendingDeletion(referrer)) {
                referrer = null;
            }

            if (!referrer) {
                console.warn(`Unknown referral code provided during registration: ${referCode}`);
                referCode = null;
            } else {
                const { start, end } = indiaDayRange();
                const todayCount = await User.countDocuments({
                    referredByCode: referCode,
                    joinedAt: { $gte: start, $lt: end }
                });

                if (todayCount >= REFERRAL_DAILY_LIMIT) {
                    return res.status(400).json({
                        success: false,
                        message: 'This referral code has reached the daily limit. Try again tomorrow.'
                    });
                }
            }
        }

        let existingUser = await User.findOne({ email });
        if (existingUser && await purgeUserIfExpired(existingUser)) {
            existingUser = null;
        }

        if (existingUser) {
            if (isPendingDeletion(existingUser)) {
                return res.status(409).json({
                    success: false,
                    message: `This account is scheduled for permanent deletion in ${RECOVERY_WINDOW_DAYS} days. Please login to restore it instead.`,
                    code: 'ACCOUNT_PENDING_DELETION',
                    recovery: getDeletionMetadata(existingUser)
                });
            }

            return res.status(400).json({ success: false, message: 'Email already registered. Please login.' });
        }

        const canRequest = await OTP.canRequestOTP(email);
        if (!canRequest) {
            return res.status(429).json({ success: false, message: 'Please wait 30s before retrying' });
        }

        const otp = OTP.generateOTP();
        const otpHash = OTP.hashOTP(otp);
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        const otpRecord = await OTP.create({
            email,
            otpHash,
            expiresAt,
            referCode: referCode || undefined  // Store referCode for verification phase
        });

        try {
            await sendEmailViaBrevo(email, otp, 'register');
        } catch (emailError) {
            await OTP.deleteOne({ _id: otpRecord._id });
            throw emailError;
        }

        res.status(200).json({
            success: true,
            message: 'Registration OTP sent successfully'
        });
    } catch (error) {
        console.error('Register Send OTP Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const verifyOTP = async (req, res) => {
    try {
        const email = req.body?.email?.trim().toLowerCase();
        const otp = req.body?.otp?.trim();

        if (!email || !otp) {
            return res.status(400).json({
                success: false,
                message: 'Email and OTP are required'
            });
        }

        const otpRecord = await OTP.findValidOTP(email);

        if (!otpRecord) {
            return res.status(400).json({
                success: false,
                message: 'OTP expired or not found. Please request new OTP.'
            });
        }

        const verification = await otpRecord.verifyOTP(otp);

        if (!verification.success) {
            const remainingAttempts = 5 - otpRecord.attempts;
            return res.status(400).json({
                success: false,
                message: verification.message,
                remainingAttempts: Math.max(0, remainingAttempts)
            });
        }

        // Only allow login for existing registered users. If the email is
        // not registered, ask the client to use the registration flow first.
        let user = await User.findOne({ email });
        if (user && await purgeUserIfExpired(user)) {
            user = null;
        }

        if (!user) {
            await OTP.deleteOne({ _id: otpRecord._id });
            return res.status(400).json({
                success: false,
                message: 'Email not registered. Please register before attempting to login.'
            });
        }

        if (isPendingDeletion(user)) {
            await OTP.deleteOne({ _id: otpRecord._id });
            return res.status(200).json({
                success: true,
                restoreRequired: true,
                message: 'This account is scheduled for permanent deletion. Restore it to continue.',
                restoreToken: createRestoreToken(user),
                recovery: getDeletionMetadata(user),
                user: serializeUser(user)
            });
        }

        const previousLifetimeXp = getLifetimeXp(user);
        const now = new Date();
        let dailyReward = null;
        const shouldGrantDailyReward = !hasDailyLoginRewardToday(user);

        if (shouldGrantDailyReward) {
            user.points = Number(user.points || 0) + DAILY_LOGIN_REWARD_POINTS;
            addLifetimeXp(user, DAILY_LOGIN_REWARD_POINTS);
            user.lastDailyLoginRewardAt = now;
            appendActivity(user, {
                title: 'Daily Login',
                message: 'Daily login reward credited.',
                amount: DAILY_LOGIN_REWARD_POINTS,
                type: 'task',
                taskId: 'daily-login'
            });
            dailyReward = {
                message: `Daily login reward credited. You earned ${DAILY_LOGIN_REWARD_POINTS} points.`,
                points: DAILY_LOGIN_REWARD_POINTS
            };

            const streakDays = getDailyStreakDays(user);
            const streakBonus = getStreakBonusForDays(streakDays);
            if (streakBonus) {
                user.points = Number(user.points || 0) + streakBonus.points;
                addLifetimeXp(user, streakBonus.points);
                appendActivity(user, {
                    title: 'Daily streak bonus',
                    message: `${streakDays} day streak bonus credited.`,
                    amount: streakBonus.points,
                    type: 'bonus',
                    taskId: `daily-streak-${streakBonus.days}`
                });
                dailyReward.message += ` Streak bonus unlocked: +${streakBonus.points} points for your ${streakBonus.days}-day streak.`;
                dailyReward.points += streakBonus.points;
                dailyReward.streakBonus = {
                    days: streakBonus.days,
                    points: streakBonus.points
                };
            }
        }

        let dailyGoalBonus = null;
        if (shouldGrantDailyReward) {
            dailyGoalBonus = buildDailyGoalBonus(user, {
                source: 'login',
                taskId: 'daily-login'
            });

            if (dailyGoalBonus) {
                user.points = Number(user.points || 0) + dailyGoalBonus.points;
                user.taskEarnings = Number(user.taskEarnings || 0) + dailyGoalBonus.points;
                addLifetimeXp(user, dailyGoalBonus.points);
                appendActivity(user, {
                    title: dailyGoalBonus.title,
                    message: dailyGoalBonus.message,
                    amount: dailyGoalBonus.points,
                    type: dailyGoalBonus.rewardType,
                    taskId: dailyGoalBonus.taskId
                });
                user.rewardClaimKeys = Array.from(new Set([
                    ...(Array.isArray(user.rewardClaimKeys) ? user.rewardClaimKeys : []),
                    dailyGoalBonus.claimKey
                ])).slice(0, 250);
            }
        }

        const levelRewards = collectLevelRewards(user, previousLifetimeXp, getLifetimeXp(user));
        if (levelRewards.length) {
            const existingKeys = new Set(Array.isArray(user.rewardClaimKeys) ? user.rewardClaimKeys : []);
            for (const levelReward of levelRewards) {
                existingKeys.add(levelReward.claimKey);
                user.points = Number(user.points || 0) + levelReward.points;
                addLifetimeXp(user, levelReward.points);
                appendActivity(user, {
                    title: `Level ${levelReward.level} bonus`,
                    message: `Level ${levelReward.level} reached. Bonus credited.`,
                    amount: levelReward.points,
                    type: 'level',
                    taskId: `xp-level-${levelReward.level}`
                });
            }
            user.rewardClaimKeys = Array.from(existingKeys).slice(0, 250);
        }

        user.lastLogin = new Date();
        user.loginCount = Number(user.loginCount || 0) + 1;
        user.emailVerifiedAt = user.emailVerifiedAt || new Date();

        // Ensure user has referral code
        if (!user.referralCode) {
            await user.ensureReferralCode();
        }

        await user.save();

        if (dailyGoalBonus) {
            try {
                await Notification.create({
                    title: 'Daily goal bonus',
                    message: `${dailyGoalBonus.points} points credited for completing your daily goal.`,
                    type: 'task',
                    audience: 'user',
                    userId: String(user._id),
                    link: 'tasks.html',
                    meta: {
                        taskId: dailyGoalBonus.taskId,
                        points: dailyGoalBonus.points,
                        source: 'task',
                        bonusType: 'daily-goal'
                    }
                });
            } catch (notificationError) {
                console.warn('Daily goal notification error:', notificationError.message);
            }
        }

        const token = user.generateAuthToken();

        const response = {
            success: true,
            message: 'Login successful',
            token,
            user: serializeUser(user),
            history: serializeActivityList(user.activity).slice(0, 12),
            transactions: serializeActivityList(user.activity).slice(0, 30)
        };

        if (dailyReward) {
            response.dailyReward = dailyReward;
            if (dailyReward.streakBonus) {
                response.streakReward = dailyReward.streakBonus;
            }
        }

        if (dailyGoalBonus) {
            response.dailyGoalBonus = {
                message: `Daily goal completed. You earned ${dailyGoalBonus.points} bonus points.`,
                points: dailyGoalBonus.points
            };
        }

        if (levelRewards.length) {
            response.levelRewards = levelRewards.map((item) => ({
                level: item.level,
                points: item.points
            }));
        }

        await OTP.deleteOne({ _id: otpRecord._id });

        res.status(200).json(response);
    } catch (error) {
        console.error('Verify OTP Error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to verify OTP'
        });
    }
};

const registerVerifyOTP = async (req, res) => {
    try {
        const email = req.body?.email?.trim().toLowerCase();
        const otp = req.body?.otp?.trim();
        const name = req.body?.name?.trim();
        const bodyReferCode = req.body?.referCode?.trim().toUpperCase();
        const acceptedTerms = Boolean(req.body?.acceptedTerms);

        if (!email || !otp || !name) {
            return res.status(400).json({
                success: false,
                message: 'Name, email and OTP are required'
            });
        }

        if (!acceptedTerms) {
            return res.status(400).json({
                success: false,
                message: 'Please accept the Terms & Conditions before creating your account.'
            });
        }

        const otpRecord = await OTP.findValidOTP(email);
        if (!otpRecord) {
            return res.status(400).json({
                success: false,
                message: 'OTP expired or not found. Please request new OTP.'
            });
        }

        const verification = await otpRecord.verifyOTP(otp);
        if (!verification.success) {
            const remainingAttempts = 5 - otpRecord.attempts;
            return res.status(400).json({
                success: false,
                message: verification.message,
                remainingAttempts: Math.max(0, remainingAttempts)
            });
        }

        const storedReferCode = String(otpRecord.referCode || '').trim().toUpperCase();
        let referCode = storedReferCode || (bodyReferCode || '');

        if (storedReferCode && bodyReferCode && storedReferCode !== bodyReferCode) {
            console.warn(`Referral code mismatch during registration verify. Using stored referCode=${storedReferCode}, body referCode=${bodyReferCode}`);
        }

        let existingUser = await User.findOne({ email });
        if (existingUser && await purgeUserIfExpired(existingUser)) {
            existingUser = null;
        }

        if (existingUser) {
            await OTP.deleteOne({ _id: otpRecord._id });
            if (isPendingDeletion(existingUser)) {
                return res.status(409).json({
                    success: false,
                    message: `This email already belongs to an account scheduled for deletion. Login first to restore it before ${new Date(existingUser.deleteAfter).toLocaleString('en-IN')}.`,
                    code: 'ACCOUNT_PENDING_DELETION',
                    recovery: getDeletionMetadata(existingUser)
                });
            }

            return res.status(400).json({
                success: false,
                message: 'Email already registered. Please login.'
            });
        }

        let referrer = null;
        const isValidReferralCode = (code) => {
            const normalized = String(code || '').trim().toUpperCase();
            if (!normalized) {
                return false;
            }
            return /^[0-9]{4,5}ANVI[0-9]{4,5}$/.test(normalized) || /^ANVI[A-Z][0-9]{4}$/.test(normalized);
        };

        if (referCode) {
            if (!isValidReferralCode(referCode)) {
                console.warn(`Invalid referral code format during registration verify: ${referCode}`);
                referCode = '';
            }
        }

        if (referCode) {
            referrer = await User.findOne({ referralCode: referCode });
            if (referrer && await purgeUserIfExpired(referrer)) {
                referrer = null;
            }

            if (referrer && isPendingDeletion(referrer)) {
                referrer = null;
            }

            if (!referrer) {
                console.warn(`Referral code lookup failed during registration verify: ${referCode}`);
                referCode = '';
            } else {
                const { start, end } = indiaDayRange();
                const todayCount = await User.countDocuments({
                    referredByCode: referCode,
                    joinedAt: { $gte: start, $lt: end }
                });

                if (todayCount >= REFERRAL_DAILY_LIMIT) {
                    console.warn(`Referral daily limit reached for code=${referCode} (${todayCount}/${REFERRAL_DAILY_LIMIT}). Skipping referral bonus.`);
                    referrer = null;
                    referCode = '';
                }
            }
        }

        const user = new User({
            email,
            name,
            points: WELCOME_POINTS,
            lifetimeXp: WELCOME_POINTS,
            referredByCode: referCode || '',
            emailVerifiedAt: new Date(),
            termsAcceptedAt: new Date(),
            acceptedPolicyVersion: POLICY_VERSION
        });

        // Generate referral code for new user
        await user.ensureReferralCode();

        appendActivity(user, {
            title: 'Welcome bonus',
            message: 'Welcome bonus credited after registration.',
            amount: WELCOME_POINTS,
            type: 'register'
        });

        const userXpBeforeReferralBonus = getLifetimeXp(user);
        let referralReward = null;
        let referralNotice = null;
        let referralBonusAwarded = 0;
        let milestoneBonusAwarded = 0;

        if (referrer) {
            const referrerName = String(referrer.name || 'a friend').trim() || 'a friend';

            user.points += REFERRAL_NEW_USER_POINTS;
            addLifetimeXp(user, REFERRAL_NEW_USER_POINTS);
            referralBonusAwarded = REFERRAL_NEW_USER_POINTS;
            appendActivity(user, {
                title: 'Referral bonus',
                message: `Referral code ${referCode} applied successfully. Referred by ${referrerName}.`,
                amount: REFERRAL_NEW_USER_POINTS,
                type: 'referral'
            });

            referralReward = {
                message: `Referral code applied successfully. You earned ${REFERRAL_NEW_USER_POINTS} bonus points from ${referrerName}.`,
                points: REFERRAL_NEW_USER_POINTS,
                referrerName
            };

            referralNotice = {
                referrerId: String(referrer._id),
                referrerName,
                referredName: name
            };
        }

        const userLevelRewards = collectLevelRewards(user, userXpBeforeReferralBonus, getLifetimeXp(user));
        if (userLevelRewards.length) {
            const existingKeys = new Set(Array.isArray(user.rewardClaimKeys) ? user.rewardClaimKeys : []);
            for (const levelReward of userLevelRewards) {
                existingKeys.add(levelReward.claimKey);
                user.points = Number(user.points || 0) + levelReward.points;
                addLifetimeXp(user, levelReward.points);
                appendActivity(user, {
                    title: `Level ${levelReward.level} bonus`,
                    message: `Level ${levelReward.level} reached. Bonus credited.`,
                    amount: levelReward.points,
                    type: 'level',
                    taskId: `xp-level-${levelReward.level}`
                });
            }
            user.rewardClaimKeys = Array.from(existingKeys).slice(0, 250);
        }

        user.lastLogin = new Date();
        user.loginCount = 1;
        await user.save();

        if (referrer) {
            const referrerXpBeforeBonus = getLifetimeXp(referrer);
            const totalReferrals = await User.countDocuments({ referredByCode: referCode });
            const referralTierRewards = getMissingReferralTierRewards(referrer, totalReferrals);

            referrer.points = Number(referrer.points || 0) + REFERRAL_REFERRER_POINTS;
            addLifetimeXp(referrer, REFERRAL_REFERRER_POINTS);
            referrer.referralEarnings = Number(referrer.referralEarnings || 0) + REFERRAL_REFERRER_POINTS;
            appendActivity(referrer, {
                title: 'Referral joined',
                message: `${name} joined using your referral code.`,
                amount: REFERRAL_REFERRER_POINTS,
                type: 'referral'
            });

            if (referralTierRewards.length) {
                const existingKeys = new Set(Array.isArray(referrer.rewardClaimKeys) ? referrer.rewardClaimKeys : []);
                for (const tierReward of referralTierRewards) {
                    existingKeys.add(tierReward.claimKey);
                    referrer.points += tierReward.points;
                    addLifetimeXp(referrer, tierReward.points);
                    referrer.referralEarnings += tierReward.points;
                    milestoneBonusAwarded += tierReward.points;
                    appendActivity(referrer, {
                        title: `Referral milestone bonus`,
                        message: `${tierReward.referrals} referral milestone unlocked. Bonus credited.`,
                        amount: tierReward.points,
                        type: 'referral',
                        taskId: tierReward.claimKey
                    });
                }
                referrer.rewardClaimKeys = Array.from(existingKeys).slice(0, 250);
            }

            const referrerLevelRewards = collectLevelRewards(referrer, referrerXpBeforeBonus, getLifetimeXp(referrer));
            if (referrerLevelRewards.length) {
                const existingKeys = new Set(Array.isArray(referrer.rewardClaimKeys) ? referrer.rewardClaimKeys : []);
                for (const levelReward of referrerLevelRewards) {
                    existingKeys.add(levelReward.claimKey);
                    referrer.points = Number(referrer.points || 0) + levelReward.points;
                    addLifetimeXp(referrer, levelReward.points);
                    appendActivity(referrer, {
                        title: `Level ${levelReward.level} bonus`,
                        message: `Level ${levelReward.level} reached. Bonus credited.`,
                        amount: levelReward.points,
                        type: 'level',
                        taskId: `xp-level-${levelReward.level}`
                    });
                }
                referrer.rewardClaimKeys = Array.from(existingKeys).slice(0, 250);
            }

            await referrer.save();
        }

        if (referralNotice) {
            try {
                const referredUserMessage = referralBonusAwarded > 0
                    ? `Referral code applied successfully. You earned ${referralBonusAwarded} bonus points from ${referralNotice.referrerName}.`
                    : `Referral code applied successfully.`;

                const referrerMessage = milestoneBonusAwarded > 0
                    ? `${referralNotice.referredName} joined using your referral code. +${REFERRAL_REFERRER_POINTS} points, plus ${milestoneBonusAwarded} milestone bonus!`
                    : `${referralNotice.referredName} joined using your referral code. +${REFERRAL_REFERRER_POINTS} points credited.`;

                await Notification.insertMany([
                    {
                        title: 'Referral bonus',
                        message: referredUserMessage,
                        type: 'referral',
                        audience: 'user',
                        userId: String(user._id),
                        meta: {
                            referrerName: referralNotice.referrerName,
                            referrerId: referralNotice.referrerId
                        }
                    },
                    {
                        title: 'Referral joined',
                        message: referrerMessage,
                        type: 'referral',
                        audience: 'user',
                        userId: referralNotice.referrerId,
                        meta: {
                            referredName: referralNotice.referredName,
                            referredUserId: String(user._id)
                        }
                    }
                ]);
            } catch (error) {
                console.warn('Referral notification error:', error.message);
            }
        }

        const token = user.generateAuthToken();

        await OTP.deleteOne({ _id: otpRecord._id });

        res.status(200).json({
            success: true,
            message: 'Registration successful',
            token,
            user: serializeUser(user, { isNewUser: true }),
            history: serializeActivityList(user.activity).slice(0, 12),
            transactions: serializeActivityList(user.activity).slice(0, 30),
            welcomeReward: {
                message: `Welcome! You earned ${WELCOME_POINTS} points as a signup reward`,
                points: WELCOME_POINTS
            },
            ...(userLevelRewards.length ? {
                levelRewards: userLevelRewards.map((item) => ({
                    level: item.level,
                    points: item.points
                }))
            } : {}),
            referralReward
        });
    } catch (error) {
        console.error('Register Verify OTP Error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to verify OTP'
        });
    }
};

const getMe = async (req, res) => {
    try {
        const user = await User.findById(req.userId).select('-__v');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const existingReferralCode = user.referralCode || '';
        await user.ensureReferralCode();
        if (user.referralCode !== existingReferralCode) {
            await user.save();
        }

        res.status(200).json({
            success: true,
            user: serializeUser(user, {
                loginCount: user.loginCount
            })
        });
    } catch (error) {
        console.error('Get Me Error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

const restoreAccount = async (req, res) => {
    try {
        const restoreToken = req.body?.restoreToken?.trim();

        if (!restoreToken) {
            return res.status(400).json({
                success: false,
                message: 'Restore token is required.'
            });
        }

        const user = await verifyRestoreToken(restoreToken);
        await restoreUserAccount(user);

        if (!user.referralCode) {
            await user.ensureReferralCode();
            await user.save();
        }

        const token = user.generateAuthToken();

        res.status(200).json({
            success: true,
            message: 'Account restored successfully.',
            token,
            user: serializeUser(user)
        });
    } catch (error) {
        console.error('Restore Account Error:', error);
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || 'Failed to restore account'
        });
    }
};

module.exports = {
    sendOTP,
    registerSendOTP,
    verifyOTP,
    registerVerifyOTP,
    getMe,
    restoreAccount
};
