(function () {
    const form = document.getElementById('support-form');
    if (!form) {
        return;
    }

    const nameInput = document.getElementById('support-name');
    const emailInput = document.getElementById('support-email');
    const issueInput = document.getElementById('support-issue');
    const messageInput = document.getElementById('support-message');
    const statusBox = document.getElementById('support-status');
    const submitBtn = document.getElementById('support-submit-btn');
    const originalButtonHtml = submitBtn?.innerHTML || 'Send Message';

    const ISSUE_LABELS = {
        General: 'General',
        Rewards: 'Rewards & points',
        Wallet: 'Wallet & tokens',
        Tasks: 'Tasks',
        Login: 'Login / OTP',
        Referral: 'Referral'
    };

    const sanitize = (value, maxLength) => String(value || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);

    const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
    const isValidName = (value) => /^[\p{L}\p{N} .'-]{2,80}$/u.test(String(value || '').trim());

    const setBusy = (busy) => {
        if (!submitBtn) {
            return;
        }
        submitBtn.disabled = busy;
        submitBtn.innerHTML = busy
            ? '<i class="ri-loader-4-line"></i> Sending...'
            : originalButtonHtml;
    };

    const setStatus = (message, tone = 'info') => {
        if (!statusBox) {
            return;
        }

        const normalizedTone = ['success', 'warning', 'error', 'loading'].includes(tone) ? tone : 'info';
        statusBox.className = `support-status is-visible${normalizedTone !== 'info' ? ` is-${normalizedTone}` : ''}`;
        statusBox.textContent = message;
    };

    const clearStatus = () => {
        if (!statusBox) {
            return;
        }
        statusBox.className = 'support-status';
        statusBox.textContent = '';
    };

    const fillFromUser = () => {
        const userName = String(window.state?.user?.name || '').trim();
        const userEmail = String(window.state?.user?.email || '').trim();

        if (userName && !nameInput.value.trim()) {
            nameInput.value = userName;
        }

        if (userEmail && !emailInput.value.trim()) {
            emailInput.value = userEmail;
        }
    };

    fillFromUser();

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearStatus();

        const fullName = sanitize(nameInput.value, 80);
        const email = sanitize(emailInput.value, 254).toLowerCase();
        const issueType = sanitize(issueInput.value, 40);
        const message = sanitize(messageInput.value, 2000);

        if (!fullName) {
            setStatus('Please enter your full name.', 'error');
            nameInput.focus();
            return;
        }

        if (!isValidName(fullName)) {
            setStatus('Please enter a valid full name.', 'error');
            nameInput.focus();
            return;
        }

        if (!email) {
            setStatus('Please enter your email address.', 'error');
            emailInput.focus();
            return;
        }

        if (!isValidEmail(email)) {
            setStatus('Please enter a valid email address.', 'error');
            emailInput.focus();
            return;
        }

        if (!issueType || !Object.prototype.hasOwnProperty.call(ISSUE_LABELS, issueType)) {
            setStatus('Please choose a valid issue type.', 'error');
            issueInput.focus();
            return;
        }

        if (!message) {
            setStatus('Please write a message about your issue.', 'error');
            messageInput.focus();
            return;
        }

        if (message.length < 10) {
            setStatus('Please write at least 10 characters so we can help you properly.', 'error');
            messageInput.focus();
            return;
        }

        setBusy(true);
        setStatus('Submitting your support ticket...', 'loading');

        try {
            const response = await requestJson('/support', {
                method: 'POST',
                body: {
                    fullName,
                    email,
                    issueType,
                    message
                },
                auth: true
            });

            if (!response?.success) {
                throw new Error(response?.message || 'Unable to submit support ticket.');
            }

            const ticketId = String(response.ticketId || '').trim();
            setStatus(
                `✅ Support ticket submitted successfully.\n\nTicket ID: ${ticketId}\n\nOur team will respond as soon as possible.`,
                'success'
            );

            if (response.emailStatus === 'failed') {
                setStatus(
                    `✅ Support ticket submitted successfully.\n\nTicket ID: ${ticketId}\n\nOur team will respond as soon as possible.\n\nNote: we could not send the notification email right now, but your ticket has been saved.`,
                    'warning'
                );
            }

            form.reset();
            nameInput.value = '';
            emailInput.value = '';
            issueInput.value = 'General';
            messageInput.value = '';
        } catch (error) {
            const messageText = String(error?.message || '').trim();
            const friendlyMessage = messageText || 'Unable to submit support ticket right now. Please try again.';
            setStatus(friendlyMessage, 'error');
        } finally {
            setBusy(false);
        }
    });
})();
