const nodemailer = require('nodemailer');
const { createOtpEmail } = require('../../api/_lib/otp-email');
const { createWelcomeEmail } = require('../../api/_lib/welcome-email');

const SENDER_EMAIL = process.env.EMAIL_USER || 'anvipayz@gmail.com';

/**
 * Sends transactional email using Brevo HTTP API
 */
async function sendViaBrevo({ toEmail, subject, htmlContent, textContent }) {
    const BREVO_API_KEY = process.env.BREVO_API_KEY;
    const senderEmail = process.env.BREVO_SENDER_EMAIL || 'anvipayz@gmail.com';
    const senderName = process.env.BREVO_SENDER_NAME || 'AnviPayz Security';

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
            'accept': 'application/json',
            'api-key': BREVO_API_KEY,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            sender: {
                name: senderName,
                email: senderEmail
            },
            to: [
                {
                    email: toEmail
                }
            ],
            subject: subject,
            htmlContent: htmlContent,
            textContent: textContent
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Brevo API responded with status ${response.status}: ${errText}`);
    }

    return { success: true };
}

/**
 * Sends a secure verification OTP via Gmail SMTP using legacy credentials or Brevo API
 * @param {object} params - containing toEmail, otp, subject, heading, intro, purposeLine
 * @returns {Promise<object>} Result status
 */
async function sendOtpEmail({ toEmail, otp, subject, heading, intro, purposeLine }) {
    const emailContent = createOtpEmail({
        otp,
        subject,
        heading,
        intro,
        purposeLine
    });

    const emailSubject = emailContent.subject || subject;

    if (process.env.BREVO_API_KEY) {
        console.log('[Email Service] Attempting to send OTP via Brevo API...');
        try {
            await sendViaBrevo({
                toEmail,
                subject: emailSubject,
                htmlContent: emailContent.html,
                textContent: emailContent.text
            });
            console.log('[Email Service] Email sent successfully via Brevo.');
            return { success: true };
        } catch (brevoError) {
            console.error('[Email Service] Brevo sending failed:', brevoError.message);
        }
    }

    console.log('[Email Service] Falling back to legacy Gmail SMTP...');
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        if (process.env.NODE_ENV !== 'production' || process.env.BYPASS_EMAIL_ERRORS === 'true') {
            console.warn(`[DEVELOPMENT BYPASS] EMAIL_USER/EMAIL_PASS not configured. OTP for ${toEmail} is: ${otp}`);
            return { success: true };
        }
        throw new Error('EMAIL_USER and EMAIL_PASS are missing in environment variables, and Brevo API send failed.');
    }


    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    await transporter.sendMail({
        from: `"AnviPayz Security" <${SENDER_EMAIL}>`,
        to: toEmail,
        replyTo: `"AnviPayz Support" <${SENDER_EMAIL}>`,
        subject: emailSubject,
        html: emailContent.html,
        text: emailContent.text
    });

    return { success: true };
}

async function sendWelcomeEmail({ toEmail, name, subject }) {
    const emailContent = createWelcomeEmail({
        name,
        subject: subject || 'Welcome to AnviPayz'
    });

    const emailSubject = emailContent.subject || subject || 'Welcome to AnviPayz';

    if (process.env.BREVO_API_KEY) {
        console.log('[Email Service] Attempting to send welcome email via Brevo API...');
        try {
            await sendViaBrevo({
                toEmail,
                subject: emailSubject,
                htmlContent: emailContent.html,
                textContent: emailContent.text
            });
            console.log('[Email Service] Welcome email sent successfully via Brevo.');
            return { success: true };
        } catch (brevoError) {
            console.error('[Email Service] Brevo welcome email failed:', brevoError.message);
        }
    }

    console.log('[Email Service] Falling back to legacy Gmail SMTP for welcome email...');
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        throw new Error('EMAIL_USER and EMAIL_PASS are missing in environment variables, and Brevo API send failed.');
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    await transporter.sendMail({
        from: `"AnviPayz" <${SENDER_EMAIL}>`,
        to: toEmail,
        replyTo: `"AnviPayz Support" <${SENDER_EMAIL}>`,
        subject: emailSubject,
        html: emailContent.html,
        text: emailContent.text
    });

    return { success: true };
}

module.exports = {
    sendOtpEmail,
    sendWelcomeEmail
};
