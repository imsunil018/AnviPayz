const crypto = require('crypto');

const CPX_BASE_URL = 'https://offers.cpx-research.com/index.php';
const CPX_DEFAULT_APP_ID = '33896';

const SURVEY_DEFINITIONS = [
    {
        id: 'cpx-research-wall',
        provider: 'cpx',
        providerLabel: 'CPX Research',
        title: 'CPX Research Surveys',
        description: 'Complete verified surveys and earn reward points instantly.',
        rewardPoints: 45,
        estimatedMinutes: 4,
        difficulty: 'Easy',
        category: 'Opinion',
        countryAvailability: 'India',
        status: 'available',
        ctaLabel: 'Start Survey'
    }
];

function readTrimmed(value) {
    return String(value || '').trim();
}

function getCpxSecureHashSecret() {
    return readTrimmed(process.env.CPX_APP_SECRET || process.env.CPX_SECRET_KEY);
}

function getCpxAppId() {
    return readTrimmed(process.env.CPX_APP_ID || CPX_DEFAULT_APP_ID);
}

function isCpxConfigured() {
    return Boolean(
        getCpxAppId() &&
        getCpxSecureHashSecret()
    );
}

function getSurveyDefinitions() {
    if (!isCpxConfigured()) {
        return [];
    }

    return SURVEY_DEFINITIONS.map((survey) => ({ ...survey }));
}

function buildCpxSecureHash({ userId, sessionId, surveyId }) {
    const secret = getCpxSecureHashSecret();
    if (!secret) {
        return '';
    }
    const payload = [getCpxAppId(), readTrimmed(userId), readTrimmed(sessionId), readTrimmed(surveyId)].join(':');
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function buildCpxUserSecureHash(userId) {
    const secret = getCpxSecureHashSecret();
    const safeUserId = readTrimmed(userId);
    if (!secret || !safeUserId) {
        return '';
    }

    return crypto.createHash('md5').update(`${safeUserId}-${secret}`).digest('hex');
}

function buildCpxLaunchUrl({ user, survey, sessionId }) {
    const appId = getCpxAppId();
    const userId = readTrimmed(user?._id || user?.id);
    const username = readTrimmed(user?.name || user?.fullName || user?.email || 'AnviPayz Member');
    const email = readTrimmed(user?.email || '');
    const secureHash = buildCpxSecureHash({ userId, sessionId, surveyId: survey?.id });

    const params = new URLSearchParams({
        app_id: appId,
        ext_user_id: userId,
        secure_hash: secureHash,
        username,
        email,
        subid_1: readTrimmed(sessionId),
        subid_2: readTrimmed(survey?.providerLabel || survey?.provider || 'cpx'),
        subid_3: readTrimmed(survey?.id || ''),
        platform: 'mobile'
    });

    return `${CPX_BASE_URL}?${params.toString()}`;
}

function buildCpxIframeUrl({ user }) {
    const appId = getCpxAppId();
    const userId = readTrimmed(user?._id || user?.id);
    const secureHash = readTrimmed(user?.cpxSecureHash || buildCpxUserSecureHash(userId));
    const username = readTrimmed(user?.fullName || user?.name || user?.email || 'AnviPayz Member');
    const email = user?.emailVerified ? readTrimmed(user?.email || '') : '';

    if (!appId || !userId || !secureHash) {
        return '';
    }

    const params = new URLSearchParams({
        app_id: appId,
        ext_user_id: userId,
        secure_hash: secureHash,
        username,
        email,
        subid_1: '',
        subid_2: ''
    });

    return `${CPX_BASE_URL}?${params.toString()}`;
}

function verifyCpxPostbackSecret(secret) {
    const expected = readTrimmed(process.env.CPX_POSTBACK_SECRET);
    const received = readTrimmed(secret);
    if (!expected) {
        return false;
    }

    return received === expected;
}

function getPostbackSecretCandidate(req) {
    return req.headers['x-cpx-secret']
        || req.query.secret
        || req.query.token
        || req.body?.secret
        || req.body?.token
        || req.body?.postback_secret
        || '';
}

function normalizeProviderKey(value) {
    return readTrimmed(value).toLowerCase() || 'cpx';
}

function createSurveyClaimKey({ provider, surveyId, sessionId }) {
    return [normalizeProviderKey(provider), readTrimmed(surveyId), readTrimmed(sessionId)].join(':');
}

module.exports = {
    buildCpxLaunchUrl,
    buildCpxIframeUrl,
    buildCpxSecureHash,
    buildCpxUserSecureHash,
    createSurveyClaimKey,
    getPostbackSecretCandidate,
    getSurveyDefinitions,
    isCpxConfigured,
    normalizeProviderKey,
    verifyCpxPostbackSecret
};
