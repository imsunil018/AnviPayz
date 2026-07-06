const crypto = require('crypto');
const User = require('../models/User');
const { sendOtpEmail } = require('./emailService');

const PROFILE_NAME_MIN = 3;
const PROFILE_NAME_MAX = 30;
const OTP_EXPIRY_MS = 5 * 60 * 1000;
const OTP_COOLDOWN_MS = 30 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const EMAIL_CHANGE_STAGE_WINDOW_MS = 15 * 60 * 1000;

const MAX_NAME_CHANGES_PER_MONTH = 5;
const MAX_EMAIL_CHANGES_PER_MONTH = 5;

// Helper to get current month in YYYY-MM format (IST) for consistency
const getCurrentMonthKey = () => {
    const now = new Date();
    const options = { year: 'numeric', month: '2-digit', timeZone: 'Asia/Kolkata' };
    return new Intl.DateTimeFormat('en-CA', options).format(now).replace('-', '-'); // YYYY-MM
};

function createHttpError(statusCode, message, extra = {}) {
    const error = new Error(message);
    error.statusCode = statusCode;
    Object.assign(error, extra);
    return error;
}

function sanitizeName(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function sanitizeEmail(value) {
    return String(value || '')
        .trim()
        .toLowerCase();
}

function validateName(name) {
    if (!name) {
        throw createHttpError(422, 'Name is required.');
    }

    if (name.length < PROFILE_NAME_MIN || name.length > PROFILE_NAME_MAX) {
        throw createHttpError(422, `Name must be between ${PROFILE_NAME_MIN} and ${PROFILE_NAME_MAX} characters.`);
    }

    if (!/^[a-zA-Z][a-zA-Z0-9 .'-]{2,29}$/.test(name)) {
        throw createHttpError(422, 'Use only letters, numbers, spaces, dot, apostrophe, or hyphen in your name.');
    }
}

function validateEmail(email) {
    if (!email) {
        throw createHttpError(422, 'New email is required.');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw createHttpError(422, 'Enter a valid email address.');
    }
}

function hashOtp(otp) {
    return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

function generateOtp() {
    return crypto.randomInt(100000, 1000000).toString();
}

function maskEmail(email) {
    const [local, domain = ''] = String(email || '').split('@');
    if (!local || !domain) {
        return email || '';
    }

    const localVisible = local.length <= 2
        ? `${local[0] || ''}*`
        : `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}`;
    return `${localVisible}@${domain}`;
}

function serializeProfileUser(user) {
    return {
        id: user._id,
        email: user.email,
        name: user.name,
        fullName: user.fullName || user.name,
        phone: user.phone || '',
        mobileNumber: user.mobileNumber || '',
        mobileVerified: Boolean(user.mobileVerified),
        emailVerified: Boolean(user.emailVerified || user.emailVerifiedAt),
        points: user.points || 0,
        tokens: user.tokens || 0,
        referralCode: user.referralCode || '',
        joinedAt: user.joinedAt,
        lastLogin: user.lastLogin || null,
        emailVerifiedAt: user.emailVerifiedAt || user.joinedAt || null,
        avatarUrl: user.avatarUrl || '',
        mobileEnabled: false,
        nameChangeCountThisMonth: user.nameChangeCountThisMonth || 0,
        lastNameChangeMonth: user.lastNameChangeMonth || null,
        emailChangeCountThisMonth: user.emailChangeCountThisMonth || 0,
        lastEmailChangeMonth: user.lastEmailChangeMonth || null,
        lastEmailChangeDate: user.lastEmailChangeDate || null
    };
}

function prependActivity(user, activity) {
    // Ensure activity array is initialized
    if (!Array.isArray(user.activity)) {
        user.activity = [];
    }

    // Create a new activity entry object to avoid modifying the input directly
    const newActivityEntry = {
        title: activity.title || 'Account activity',
        message: activity.message || '',
        amount: Number(activity.amount || 0),
        type: activity.type || 'profile',
        direction: activity.direction || 'credit',
        status: activity.status || 'completed',
        time: activity.time || new Date(),
        taskId: activity.taskId || ''
    };

    // Prepend the new activity and slice to maintain limit
    user.activity = [
        {
            title: activity.title || 'Account activity',
            message: activity.message || '',
            amount: Number(activity.amount || 0),
            type: activity.type || 'profile',
            direction: activity.direction || 'credit',
            status: activity.status || 'completed',
            time: activity.time || new Date(),
            taskId: activity.taskId || ''
        },
        ...(Array.isArray(user.activity) ? user.activity : [])
    ].slice(0, 50);
}

function ensureCooldown(lastRequestedAt) {
    if (!lastRequestedAt) {
        return;
    }

    const elapsed = Date.now() - new Date(lastRequestedAt).getTime();
    if (elapsed < OTP_COOLDOWN_MS) {
        throw createHttpError(429, 'Please wait before requesting another OTP.', {
            retryAfterSeconds: Math.ceil((OTP_COOLDOWN_MS - elapsed) / 1000)
        });
    }
}

function ensureOtpWindow(expiresAt, fallbackMessage) {
    if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) {
        throw createHttpError(400, fallbackMessage);
    }
}

function ensureEmailChangeSession(user) {
    const verifiedAt = user.pendingEmailChange?.oldEmailVerifiedAt;
    if (!verifiedAt) {
        throw createHttpError(400, 'Verify your current email first.');
    }

    const age = Date.now() - new Date(verifiedAt).getTime();
    if (age > EMAIL_CHANGE_STAGE_WINDOW_MS) {
        user.clearPendingEmailChange();
        throw createHttpError(400, 'Your email change session expired. Start again from current email verification.');
    }
}

function verifyOtpAgainstHash(user, { hash, attemptsField, maxAttemptsMessage, invalidMessage }, otp) {
    const providedHash = hashOtp(otp);
    if (providedHash !== hash) {
        user.pendingEmailChange[attemptsField] = Number(user.pendingEmailChange?.[attemptsField] || 0) + 1;
        if (user.pendingEmailChange[attemptsField] >= OTP_MAX_ATTEMPTS) {
            throw createHttpError(429, maxAttemptsMessage);
        }

        throw createHttpError(400, invalidMessage, {
            remainingAttempts: OTP_MAX_ATTEMPTS - user.pendingEmailChange[attemptsField]
        });
    }
}

async function updateProfile(user, payload) {
    const nextName = sanitizeName(payload?.name);
    validateName(nextName);

    if (user.name === nextName) {
        return serializeProfileUser(user);
    }

    const currentMonth = getCurrentMonthKey();
    const activityEntry = {
        title: 'Name updated',
        message: `Display name changed to ${nextName}.`,
        type: 'profile',
        direction: 'credit',
        amount: 0,
        time: new Date()
    };

    // Atomic update using a pipeline to handle monthly reset and limit check
    const updatedUser = await User.findByIdAndUpdate(
        user._id,
        [
            {
                $set: {
                    // Reset count if month changed
                    nameChangeCountThisMonth: {
                        $cond: [
                            { $ne: ["$lastNameChangeMonth", currentMonth] },
                            0,
                            { $ifNull: ["$nameChangeCountThisMonth", 0] }
                        ]
                    },
                    lastNameChangeMonth: currentMonth
                }
            },
            {
                $set: {
                    // Only update name if under limit
                    name: {
                        $cond: [
                            { $lt: ["$nameChangeCountThisMonth", MAX_NAME_CHANGES_PER_MONTH] },
                            nextName,
                            "$name"
                        ]
                    },
                    nameChangeCountThisMonth: {
                        $cond: [
                            { $lt: ["$nameChangeCountThisMonth", MAX_NAME_CHANGES_PER_MONTH] },
                            { $add: ["$nameChangeCountThisMonth", 1] },
                            "$nameChangeCountThisMonth"
                        ]
                    },
                    activity: {
                        $cond: [
                            { $lt: ["$nameChangeCountThisMonth", MAX_NAME_CHANGES_PER_MONTH] },
                            { $slice: [{ $concatArrays: [[activityEntry], { $ifNull: ["$activity", []] }] }, 50] },
                            "$activity"
                        ]
                    }
                }
            }
        ],
        { new: true }
    );

    if (!updatedUser || updatedUser.name !== nextName) {
        throw createHttpError(429, `You have reached the monthly limit of ${MAX_NAME_CHANGES_PER_MONTH} name changes.`);
    }

    return serializeProfileUser(updatedUser);
}

async function requestEmailChange(user, payload) {
    const step = String(payload?.step || '').trim().toLowerCase();

    if (step === 'old-email') {
        if (!user.email) {
            return {
                step: 'old-email-skipped',
                message: 'No email currently linked. Please proceed directly to adding a new email.',
                bypassOldEmail: true
            };
        }

        ensureCooldown(user.pendingEmailChange?.oldEmailOtpRequestedAt);
        const otp = generateOtp();

        user.clearPendingEmailChange();
        user.pendingEmailChange.oldEmailOtpHash = hashOtp(otp);
        user.pendingEmailChange.oldEmailOtpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
        user.pendingEmailChange.oldEmailOtpRequestedAt = new Date();
        user.pendingEmailChange.oldEmailOtpAttempts = 0;

        await user.save();

        try {
            await sendOtpEmail({
                toEmail: user.email,
                otp,
                subject: 'Verify your current AnviPayz email',
                heading: 'Verify your current email',
                intro: `We received a request to change the email address on your AnviPayz account.`,
                purposeLine: 'Enter this OTP to confirm you still have access to your current email address.'
            });
        } catch (error) {
            user.clearPendingEmailChange();
            await user.save();
            throw createHttpError(500, error.message || 'Unable to send OTP right now.');
        }

        return {
            step: 'old-email',
            deliveryTarget: maskEmail(user.email),
            expiresInSeconds: OTP_EXPIRY_MS / 1000,
            cooldownSeconds: OTP_COOLDOWN_MS / 1000,
            message: 'Verification OTP sent to your current email.'
        };
    }

    if (step === 'new-email') {
        if (user.email) {
            ensureEmailChangeSession(user);
        }

        const newEmail = sanitizeEmail(payload?.newEmail);
        validateEmail(newEmail);

        if (user.email && newEmail === user.email) {
            throw createHttpError(422, 'Enter a different email address.');
        }

        ensureCooldown(user.pendingEmailChange?.newEmailOtpRequestedAt);

        const existingUser = await User.findOne({
            email: newEmail,
            _id: { $ne: user._id }
        }).select('_id');

        if (existingUser) {
            throw createHttpError(409, 'This email is already in use.');
        }

        const otp = generateOtp();
        user.pendingEmailChange.newEmail = newEmail;
        user.pendingEmailChange.newEmailOtpHash = hashOtp(otp);
        user.pendingEmailChange.newEmailOtpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
        user.pendingEmailChange.newEmailOtpRequestedAt = new Date();
        user.pendingEmailChange.newEmailOtpAttempts = 0;
        await user.save();

        try {
            await sendOtpEmail({
                toEmail: newEmail,
                otp,
                subject: 'Verify your new AnviPayz email',
                heading: 'Confirm your new email',
                intro: `You're almost done updating your AnviPayz login email.`,
                purposeLine: 'Enter this OTP to verify the new email address before we update your account.'
            });
        } catch (error) {
            user.pendingEmailChange.newEmail = '';
            user.pendingEmailChange.newEmailOtpHash = '';
            user.pendingEmailChange.newEmailOtpExpiresAt = null;
            user.pendingEmailChange.newEmailOtpAttempts = 0;
            user.pendingEmailChange.newEmailOtpRequestedAt = null;
            await user.save();
            throw createHttpError(500, error.message || 'Unable to send OTP right now.');
        }

        return {
            step: 'new-email',
            deliveryTarget: maskEmail(newEmail),
            expiresInSeconds: OTP_EXPIRY_MS / 1000,
            cooldownSeconds: OTP_COOLDOWN_MS / 1000,
            message: 'Verification OTP sent to your new email.'
        };
    }

    throw createHttpError(422, 'Invalid email change step.');
}

async function verifyEmailChange(user, payload) {
    const step = String(payload?.step || '').trim().toLowerCase();
    const otp = String(payload?.otp || '').trim();

    if (!/^\d{6}$/.test(otp)) {
        throw createHttpError(422, 'Enter a valid 6-digit OTP.');
    }

    if (step === 'old-email') {
        if (!user.email) {
            throw createHttpError(400, 'No email currently linked. Please proceed directly to adding a new email.');
        }

        ensureOtpWindow(
            user.pendingEmailChange?.oldEmailOtpExpiresAt,
            'Current email OTP expired. Request a new OTP to continue.'
        );

        const currentAttempts = Number(user.pendingEmailChange?.oldEmailOtpAttempts || 0);
        if (currentAttempts >= OTP_MAX_ATTEMPTS) {
            throw createHttpError(429, 'Too many invalid attempts. Request a new OTP to continue.');
        }

        try {
            verifyOtpAgainstHash(user, {
                hash: user.pendingEmailChange?.oldEmailOtpHash,
                attemptsField: 'oldEmailOtpAttempts',
                maxAttemptsMessage: 'Too many invalid attempts. Request a new OTP to continue.',
                invalidMessage: 'Current email OTP is invalid.'
            }, otp);
        } catch (error) {
            await user.save();
            throw error;
        }

        user.pendingEmailChange.oldEmailOtpHash = '';
        user.pendingEmailChange.oldEmailOtpExpiresAt = null;
        user.pendingEmailChange.oldEmailOtpAttempts = 0;
        user.pendingEmailChange.oldEmailVerifiedAt = new Date();
        await user.save();

        return {
            step: 'old-email-verified',
            message: 'Current email verified. Now verify your new email.'
        };
    }

    if (step === 'new-email') {
        if (user.email) {
            ensureEmailChangeSession(user);
        }
        ensureOtpWindow(
            user.pendingEmailChange?.newEmailOtpExpiresAt,
            'New email OTP expired. Request a new OTP to continue.'
        );

        const currentAttempts = Number(user.pendingEmailChange?.newEmailOtpAttempts || 0);
        if (currentAttempts >= OTP_MAX_ATTEMPTS) {
            throw createHttpError(429, 'Too many invalid attempts. Request a new OTP to continue.');
        }

        try {
            verifyOtpAgainstHash(user, {
                hash: user.pendingEmailChange?.newEmailOtpHash,
                attemptsField: 'newEmailOtpAttempts',
                maxAttemptsMessage: 'Too many invalid attempts. Request a new OTP to continue.',
                invalidMessage: 'New email OTP is invalid.'
            }, otp);
        } catch (error) {
            await user.save();
            throw error;
        }

        const nextEmail = sanitizeEmail(user.pendingEmailChange?.newEmail);
        validateEmail(nextEmail);

        const currentMonth = getCurrentMonthKey();
        if (user.lastEmailChangeMonth !== currentMonth || !user.lastEmailChangeMonth) {
            user.emailChangeCountThisMonth = 0;
            user.lastEmailChangeMonth = currentMonth;
        }

        if (user.emailChangeCountThisMonth >= MAX_EMAIL_CHANGES_PER_MONTH) {
            throw createHttpError(429, `You can only change your email ${MAX_EMAIL_CHANGES_PER_MONTH} times per month. Please try again next month.`);
        }

        const existingUser = await User.findOne({
            email: nextEmail,
            _id: { $ne: user._id }
        }).select('_id');

        if (existingUser) {
            user.clearPendingEmailChange();
            await user.save();
            throw createHttpError(409, 'This email is already in use.');
        }

        const previousEmail = user.email;
        user.email = nextEmail;
        user.emailVerified = true;
        user.emailVerifiedAt = new Date();
        user.emailChangeCountThisMonth += 1;
        user.lastEmailChangeDate = new Date();
        user.clearPendingEmailChange();

        const msg = previousEmail 
            ? `Primary email changed from ${previousEmail} to ${nextEmail}.`
            : `Primary email set to ${nextEmail}.`;

        prependActivity(user, {
            title: previousEmail ? 'Email updated' : 'Email added',
            message: msg,
            type: 'profile',
            direction: 'credit',
            amount: 0
        });

        // Verify Email task reward trigger
        const emailClaimKey = 'task:verify-email';
        if (!user.rewardClaimKeys.includes(emailClaimKey)) {
            user.points = Number(user.points || 0) + 100;
            user.rewardClaimKeys.push(emailClaimKey);
            prependActivity(user, {
                title: 'Email verification task',
                message: '100 points rewarded for verifying email address.',
                type: 'task',
                amount: 100,
                taskId: 'verify-email'
            });
        }

        await user.save();

        return {
            step: 'completed',
            message: 'Email address updated successfully.',
            user: serializeProfileUser(user)
        };
    }

    throw createHttpError(422, 'Invalid email verification step.');
}

async function requestMobileChange(user, payload) {
    const step = String(payload?.step || '').trim().toLowerCase();

    if (step === 'old-mobile') {
        if (!user.mobileNumber) {
            return {
                step: 'old-mobile-skipped',
                message: 'No mobile number currently linked. Please proceed directly to adding a new mobile number.',
                bypassOldMobile: true
            };
        }

        ensureCooldown(user.pendingMobileChange?.oldMobileOtpRequestedAt);
        const otp = generateOtp();

        user.clearPendingMobileChange();
        user.pendingMobileChange.oldMobileOtpHash = hashOtp(otp);
        user.pendingMobileChange.oldMobileOtpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
        user.pendingMobileChange.oldMobileOtpRequestedAt = new Date();
        user.pendingMobileChange.oldMobileOtpAttempts = 0;

        await user.save();

        const normalizedPhone = user.mobileNumber;
        const apitxt = require('./apitxt.service');
        try {
            await apitxt.sendOtpSms({ mobile: normalizedPhone, otp });
        } catch (error) {
            user.clearPendingMobileChange();
            await user.save();
            throw createHttpError(500, error.message || 'Unable to send SMS OTP right now.');
        }

        return {
            step: 'old-mobile',
            deliveryTarget: normalizedPhone.slice(-4).padStart(10, '*'),
            expiresInSeconds: OTP_EXPIRY_MS / 1000,
            cooldownSeconds: OTP_COOLDOWN_MS / 1000,
            message: 'Verification OTP sent to your current mobile number.'
        };
    }

    if (step === 'new-mobile') {
        if (user.mobileNumber) {
            const verifiedAt = user.pendingMobileChange?.oldMobileVerifiedAt;
            if (!verifiedAt) {
                throw createHttpError(400, 'Verify your current mobile number first.');
            }
            const age = Date.now() - new Date(verifiedAt).getTime();
            if (age > EMAIL_CHANGE_STAGE_WINDOW_MS) {
                user.clearPendingMobileChange();
                throw createHttpError(400, 'Your mobile change session expired. Start again.');
            }
        }

        const newMobileRaw = String(payload?.newMobile || '').trim();
        const apitxt = require('./apitxt.service');
        const isValid = /^[6-9]\d{9}$/.test(newMobileRaw.replace(/\D/g, ''));
        if (!isValid) {
            throw createHttpError(422, 'Enter a valid 10-digit mobile number.');
        }
        const newMobile = apitxt.normalizeIndianMobile(newMobileRaw);

        if (user.mobileNumber && newMobile === user.mobileNumber) {
            throw createHttpError(422, 'Enter a different mobile number.');
        }

        ensureCooldown(user.pendingMobileChange?.newMobileOtpRequestedAt);

        const existingUser = await User.findOne({
            $or: [{ mobileNumber: newMobile }, { phone: newMobile }],
            _id: { $ne: user._id }
        }).select('_id');

        if (existingUser) {
            throw createHttpError(409, 'This mobile number is already in use by another account.');
        }

        const otp = generateOtp();
        user.pendingMobileChange.newMobile = newMobile;
        user.pendingMobileChange.newMobileOtpHash = hashOtp(otp);
        user.pendingMobileChange.newMobileOtpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
        user.pendingMobileChange.newMobileOtpRequestedAt = new Date();
        user.pendingMobileChange.newMobileOtpAttempts = 0;
        await user.save();

        try {
            await apitxt.sendOtpSms({ mobile: newMobile, otp });
        } catch (error) {
            user.pendingMobileChange.newMobile = '';
            user.pendingMobileChange.newMobileOtpHash = '';
            user.pendingMobileChange.newMobileOtpExpiresAt = null;
            user.pendingMobileChange.newMobileOtpAttempts = 0;
            user.pendingMobileChange.newMobileOtpRequestedAt = null;
            await user.save();
            throw createHttpError(500, error.message || 'Unable to send SMS OTP right now.');
        }

        return {
            step: 'new-mobile',
            deliveryTarget: newMobile.slice(-4).padStart(10, '*'),
            expiresInSeconds: OTP_EXPIRY_MS / 1000,
            cooldownSeconds: OTP_COOLDOWN_MS / 1000,
            message: 'Verification OTP sent to your new mobile number.'
        };
    }

    throw createHttpError(422, 'Invalid mobile change step.');
}

async function verifyMobileChange(user, payload) {
    const step = String(payload?.step || '').trim().toLowerCase();
    const otp = String(payload?.otp || '').trim();

    if (!/^\d{6}$/.test(otp)) {
        throw createHttpError(422, 'Enter a valid 6-digit OTP.');
    }

    if (step === 'old-mobile') {
        if (!user.mobileNumber) {
            throw createHttpError(400, 'No mobile number currently linked.');
        }

        ensureOtpWindow(
            user.pendingMobileChange?.oldMobileOtpExpiresAt,
            'Current mobile OTP expired. Request a new OTP.'
        );

        const currentAttempts = Number(user.pendingMobileChange?.oldMobileOtpAttempts || 0);
        if (currentAttempts >= OTP_MAX_ATTEMPTS) {
            throw createHttpError(429, 'Too many invalid attempts. Request a new OTP.');
        }

        const providedHash = hashOtp(otp);
        if (providedHash !== user.pendingMobileChange.oldMobileOtpHash) {
            user.pendingMobileChange.oldMobileOtpAttempts = currentAttempts + 1;
            await user.save();
            throw createHttpError(400, 'Current mobile OTP is invalid.', {
                remainingAttempts: OTP_MAX_ATTEMPTS - user.pendingMobileChange.oldMobileOtpAttempts
            });
        }

        user.pendingMobileChange.oldMobileOtpHash = '';
        user.pendingMobileChange.oldMobileOtpExpiresAt = null;
        user.pendingMobileChange.oldMobileOtpAttempts = 0;
        user.pendingMobileChange.oldMobileVerifiedAt = new Date();
        await user.save();

        return {
            step: 'old-mobile-verified',
            message: 'Current mobile verified. Now verify your new mobile number.'
        };
    }

    if (step === 'new-mobile') {
        if (user.mobileNumber) {
            const verifiedAt = user.pendingMobileChange?.oldMobileVerifiedAt;
            if (!verifiedAt) {
                throw createHttpError(400, 'Verify your current mobile number first.');
            }
        }
        ensureOtpWindow(
            user.pendingMobileChange?.newMobileOtpExpiresAt,
            'New mobile OTP expired. Request a new OTP.'
        );

        const currentAttempts = Number(user.pendingMobileChange?.newMobileOtpAttempts || 0);
        if (currentAttempts >= OTP_MAX_ATTEMPTS) {
            throw createHttpError(429, 'Too many attempts. Request a new OTP.');
        }

        const providedHash = hashOtp(otp);
        if (providedHash !== user.pendingMobileChange.newMobileOtpHash) {
            user.pendingMobileChange.newMobileOtpAttempts = currentAttempts + 1;
            await user.save();
            throw createHttpError(400, 'New mobile OTP is invalid.', {
                remainingAttempts: OTP_MAX_ATTEMPTS - user.pendingMobileChange.newMobileOtpAttempts
            });
        }

        const nextMobile = user.pendingMobileChange.newMobile;
        const previousMobile = user.mobileNumber;
        user.mobileNumber = nextMobile;
        user.phone = nextMobile;
        user.mobileVerified = true;
        user.clearPendingMobileChange();

        const msg = previousMobile
            ? `Primary mobile number changed from ${previousMobile} to ${nextMobile}.`
            : `Primary mobile number set to ${nextMobile}.`;

        prependActivity(user, {
            title: previousMobile ? 'Mobile updated' : 'Mobile added',
            message: msg,
            type: 'profile',
            direction: 'credit',
            amount: 0
        });

        // Verify Mobile task reward trigger
        const mobileClaimKey = 'task:verify-mobile';
        if (!user.rewardClaimKeys.includes(mobileClaimKey)) {
            user.points = Number(user.points || 0) + 100;
            user.rewardClaimKeys.push(mobileClaimKey);
            prependActivity(user, {
                title: 'Mobile verification task',
                message: '100 points rewarded for verifying mobile number.',
                type: 'task',
                amount: 100,
                taskId: 'verify-mobile'
            });
        }

        await user.save();

        return {
            step: 'completed',
            message: 'Mobile number updated successfully.',
            user: serializeProfileUser(user)
        };
    }

    throw createHttpError(422, 'Invalid mobile verification step.');
}

module.exports = {
    serializeProfileUser,
    updateProfile,
    requestEmailChange,
    verifyEmailChange,
    requestMobileChange,
    verifyMobileChange
};
