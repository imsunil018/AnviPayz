const express = require('express');
const nodemailer = require('nodemailer');
const SupportTicket = require('../models/SupportTicket');
const SupportCounter = require('../models/SupportCounter');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

const SUPPORT_TO_EMAIL = 'anvipayz@gmail.com';
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'anvipayz@gmail.com';
const SENDER_NAME = process.env.BREVO_SENDER_NAME || 'AnviPayz';
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 3;
const MIN_GAP_MS = 30 * 1000;

const ISSUE_TYPE_LABELS = {
    General: 'General',
    Rewards: 'Rewards & points',
    Wallet: 'Wallet & tokens',
    Tasks: 'Tasks',
    Login: 'Login / OTP',
    Referral: 'Referral'
};

const supportRateStore = new Map();

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sanitizeText(value, maxLength) {
    return String(value || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function sanitizeEmail(value) {
    return String(value || '')
        .trim()
        .toLowerCase();
}

function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateName(name) {
    return /^[\p{L}\p{N} .'-]{2,80}$/u.test(name);
}

function validateMessage(message) {
    return message.length >= 10 && message.length <= 2000;
}

function isAllowedIssueType(issueType) {
    return Object.prototype.hasOwnProperty.call(ISSUE_TYPE_LABELS, issueType);
}

function issueTypeLabel(issueType) {
    return ISSUE_TYPE_LABELS[issueType] || issueType || 'General';
}

function formatSubmittedTime(date) {
    return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
}

function readBrevoError(response) {
    return response.text().then((rawBody) => {
        try {
            const parsed = JSON.parse(rawBody);
            return parsed.message || parsed.code || rawBody;
        } catch (error) {
            return rawBody;
        }
    });
}

async function sendSupportEmail({ ticketId, name, email, issueType, message, submittedAt }) {
    if (!process.env.BREVO_API_KEY) {
        throw new Error('BREVO_API_KEY is missing. Add it in .env to send support emails.');
    }

    const subject = `[AnviPayz Support] New Ticket - ${ticketId}`;
    const submittedTime = formatSubmittedTime(submittedAt);
    const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');

    const htmlContent = `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
            <h2 style="margin:0 0 16px">New Support Ticket</h2>
            <p><strong>Ticket ID:</strong> ${escapeHtml(ticketId)}</p>
            <p><strong>Name:</strong> ${escapeHtml(name)}</p>
            <p><strong>Email:</strong> ${escapeHtml(email)}</p>
            <p><strong>Issue Type:</strong> ${escapeHtml(issueTypeLabel(issueType))}</p>
            <p><strong>Submitted Time:</strong> ${escapeHtml(submittedTime)}</p>
            <p><strong>Message:</strong></p>
            <div style="white-space:normal;padding:12px 14px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc">${safeMessage}</div>
        </div>
    `;

    const textContent = [
        `Ticket ID: ${ticketId}`,
        `Name: ${name}`,
        `Email: ${email}`,
        `Issue Type: ${issueTypeLabel(issueType)}`,
        `Submitted Time: ${submittedTime}`,
        '',
        'Message:',
        message
    ].join('\n');

    if (typeof fetch !== 'function') {
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
            to: SUPPORT_TO_EMAIL,
            replyTo: `"${name}" <${email}>`,
            subject,
            html: htmlContent,
            text: textContent
        });

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
                    email,
                    name
                },
                to: [{ email: SUPPORT_TO_EMAIL }],
                subject,
                htmlContent,
                textContent
            })
        });

        if (!response.ok) {
            const errorMessage = await readBrevoError(response);
            const isSenderInvalid = /sender.+not valid|validate your sender/i.test(errorMessage);

            if (isSenderInvalid) {
                throw new Error(`Brevo sender "${SENDER_EMAIL}" is not validated. Verify this sender or domain in Brevo before sending support emails.`);
            }

            try {
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
                    to: SUPPORT_TO_EMAIL,
                    replyTo: `"${name}" <${email}>`,
                    subject,
                    html: htmlContent,
                    text: textContent
                });

                return { success: true, via: 'smtp-fallback' };
            } catch (smtpError) {
                throw new Error(errorMessage || smtpError.message || 'Failed to send support email');
            }
        }

        return { success: true, via: 'api' };
    } catch (error) {
        if (!/sender.+not valid|validate your sender/i.test(error.message || '')) {
            try {
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
                    to: SUPPORT_TO_EMAIL,
                    replyTo: `"${name}" <${email}>`,
                    subject,
                    html: htmlContent,
                    text: textContent
                });

                return { success: true, via: 'smtp-fallback' };
            } catch (smtpError) {
                // fall through to final error below
            }
        }

        throw new Error(error.message || 'Failed to send support email');
    }
}

async function nextTicketSequence() {
    const counterId = 'support-ticket';
    const existing = await SupportCounter.findById(counterId).lean();

    if (!existing) {
        try {
            await SupportCounter.create({
                _id: counterId,
                sequence: 1000
            });
        } catch (error) {
            if (error.code !== 11000) {
                throw error;
            }
        }
    }

    const counter = await SupportCounter.findByIdAndUpdate(
        counterId,
        { $inc: { sequence: 1 } },
        { new: true }
    ).lean();

    return Number(counter?.sequence || 1001);
}

function getRateLimitKey(req, email) {
    return `${String(req.userId || req.ip || 'global')}:${String(email || '').toLowerCase()}`;
}

function enforceRateLimit(req, email) {
    const key = getRateLimitKey(req, email);
    const now = Date.now();
    const recent = (supportRateStore.get(key) || []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

    if (recent.length >= RATE_LIMIT_MAX) {
        const error = new Error('Too many support requests. Please wait a little before sending another ticket.');
        error.statusCode = 429;
        throw error;
    }

    if (recent.length && (now - recent[recent.length - 1]) < MIN_GAP_MS) {
        const error = new Error('Please wait a few seconds before sending another ticket.');
        error.statusCode = 429;
        throw error;
    }

    recent.push(now);
    supportRateStore.set(key, recent);
}

router.post('/support', protect, async (req, res) => {
    try {
        const user = req.user || null;
        const name = sanitizeText(req.body?.fullName || req.body?.name, 80);
        const email = sanitizeEmail(req.body?.email);
        const issueType = sanitizeText(req.body?.issueType, 40);
        const message = sanitizeText(req.body?.message, 2000);

        if (!name) {
            return res.status(400).json({ success: false, message: 'Full name is required.' });
        }

        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required.' });
        }

        if (!issueType) {
            return res.status(400).json({ success: false, message: 'Issue type is required.' });
        }

        if (!message) {
            return res.status(400).json({ success: false, message: 'Message is required.' });
        }

        if (!validateName(name)) {
            return res.status(400).json({
                success: false,
                message: 'Full name must be 2 to 80 characters and use valid letters or spaces.'
            });
        }

        if (!validateEmail(email)) {
            return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
        }

        if (!isAllowedIssueType(issueType)) {
            return res.status(400).json({ success: false, message: 'Please choose a valid issue type.' });
        }

        if (!validateMessage(message)) {
            return res.status(400).json({
                success: false,
                message: 'Message must be at least 10 characters and no more than 2000 characters.'
            });
        }

        enforceRateLimit(req, email);

        const sequence = await nextTicketSequence();
        const ticketId = `SUP-${sequence}`;
        const submittedAt = new Date();

        const ticket = await SupportTicket.create({
            kind: 'ticket',
            ticketId,
            sequence,
            userId: user?._id || null,
            name,
            email,
            issueType,
            message,
            status: 'open',
            notificationStatus: 'sent',
            notificationError: ''
        });

        let emailStatus = 'sent';
        let emailError = '';

        try {
            await sendSupportEmail({
                ticketId,
                name,
                email,
                issueType,
                message,
                submittedAt
            });
        } catch (error) {
            emailStatus = 'failed';
            emailError = error.message || 'Failed to send support email';
        }

        if (emailStatus === 'failed') {
            await SupportTicket.updateOne(
                { _id: ticket._id },
                {
                    $set: {
                        notificationStatus: 'failed',
                        notificationError: emailError
                    }
                }
            );
        }

        return res.status(201).json({
            success: true,
            message: emailStatus === 'sent'
                ? 'Support ticket submitted successfully.'
                : 'Support ticket submitted successfully, but the email notification could not be sent right now.',
            ticketId,
            status: 'open',
            emailStatus,
            emailError: emailStatus === 'failed' ? emailError : '',
            ticket: {
                ticketId,
                status: 'open',
                createdAt: ticket.createdAt,
                issueType: issueTypeLabel(issueType)
            }
        });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
            success: false,
            message: error.message || 'Unable to submit support ticket right now.'
        });
    }
});

module.exports = router;
