/**
 * apitxt.service.js — APITxT SMS integration service
 * Endpoint references:
 * - Send OTP: https://apitxt.com/api/sendOTP
 * - Send Msg (Welcome SMS): https://apitxt.com/api/sendMsg
 */

const APITXT_OTP_URL = 'https://apitxt.com/api/sendOTP';
const APITXT_MSG_URL = 'https://apitxt.com/api/sendMsg';

/**
 * Normalizes a raw phone number into an Indian mobile number with 91 prefix (E.164 without +)
 * @param {string} raw - The raw input phone number
 * @returns {string} The normalized 12-digit number (e.g. 919876543210)
 */
function normalizeIndianMobile(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length === 10) return '91' + digits;
    if (digits.length === 12 && digits.startsWith('91')) return digits;
    if (digits.length === 11 && digits.startsWith('0')) return '91' + digits.slice(1);
    return digits;
}

/**
 * Sends a 6-digit verification OTP via APITxT
 * @param {object} params - Contains mobile and otp
 * @returns {Promise<object>} Result status
 */
async function sendOtpSms({ mobile, otp }) {
    const authkey = process.env.APITXT_API_KEY;
    if (!authkey) {
        throw new Error('APITXT_API_KEY is missing in environment variables.');
    }

    const normalizedMobile = normalizeIndianMobile(mobile);
    if (!normalizedMobile || normalizedMobile.length < 10) {
        throw new Error('Invalid mobile number provided for SMS OTP.');
    }

    console.log(`[DEBUG] OTP for mobile ${normalizedMobile} is: ${otp}`);

    const params = new URLSearchParams({
        authkey,
        mobile: normalizedMobile,
        otp: String(otp)
    });

    let response;
    try {
        response = await fetch(APITXT_OTP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });
    } catch (networkError) {
        console.error('[apitxt.service] sendOtpSms network error:', networkError.message);
        throw new Error('Could not connect to SMS gateway. Please try again.');
    }

    let json;
    try {
        json = await response.json();
    } catch (_) {
        if (!response.ok) {
            throw new Error(`APITxT OTP gateway error (${response.status})`);
        }
        return { success: true };
    }

    if (json && (json.status === 'success' || response.ok)) {
        const reqId = (json.data && json.data.request_id) ? json.data.request_id : 'n/a';
        console.log(`[apitxt.service] OTP sent to ${normalizedMobile} | request_id=${reqId}`);
        return { success: true, requestId: reqId };
    }

    const errMsg = (json && (json.message || json.error)) || `APITxT status: ${json && json.status}`;
    console.error('[apitxt.service] APITxT OTP failed:', errMsg);
    throw new Error(errMsg || 'Failed to send SMS OTP');
}

/**
 * Sends the Welcome SMS to a newly registered user via APITxT
 * @param {object} params - Contains mobile number
 * @returns {Promise<object>} Result status
 */
async function sendWelcomeSms({ mobile }) {
    const authkey = process.env.APITXT_API_KEY;
    if (!authkey) {
        throw new Error('APITXT_API_KEY is missing in environment variables.');
    }

    const normalizedMobile = normalizeIndianMobile(mobile);
    if (!normalizedMobile || normalizedMobile.length < 10) {
        throw new Error('Invalid mobile number provided for Welcome SMS.');
    }

    const message = 'Welcome to AnviPayz!\nYour account has been created successfully.\nStart completing tasks and earning reward points today.';

    const params = new URLSearchParams({
        authkey,
        mobiles: normalizedMobile,
        message: message,
        route: '4' // Transactional route
    });

    let response;
    try {
        response = await fetch(APITXT_MSG_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });
    } catch (networkError) {
        console.error('[apitxt.service] sendWelcomeSms network error:', networkError.message);
        // Do not throw on welcome SMS failure to prevent blocking registration completion
        return { success: false, error: networkError.message };
    }

    let json;
    try {
        json = await response.json();
    } catch (_) {
        return { success: response.ok };
    }

    if (json && (json.status === 'success' || response.ok)) {
        console.log(`[apitxt.service] Welcome SMS sent to ${normalizedMobile}`);
        return { success: true };
    }

    const errMsg = (json && (json.message || json.error)) || `APITxT status: ${json && json.status}`;
    console.warn('[apitxt.service] Welcome SMS failed:', errMsg);
    return { success: false, error: errMsg };
}

module.exports = {
    sendOtpSms,
    sendWelcomeSms,
    normalizeIndianMobile
};
