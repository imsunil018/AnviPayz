function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function createWelcomeEmail({ name, subject }) {
    const safeName = escapeHtml(name || 'there');
    const safeSubject = subject || 'Welcome to AnviPayz';
    const preheader = `Welcome ${safeName}. Start earning rewards with AnviPayz today.`;

    return {
        subject: safeSubject,
        text: [
            `Hi ${name || 'there'},`,
            '',
            'Welcome to AnviPayz.',
            'We are glad to have you here.',
            '',
            'With your account, you can earn points, unlock recharge discounts, complete daily tasks, and take surveys for extra rewards.',
            '',
            'Open your dashboard to start exploring the latest earning opportunities.',
            '',
            'If you did not create or access this account, please secure it right away.'
        ].join('\n'),
        html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(safeSubject)}</title>
</head>
<body style="margin:0;padding:0;background:linear-gradient(180deg,#f4f7fb 0%,#eef2ff 100%);font-family:Arial,Helvetica,sans-serif;color:#14213d;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${preheader}
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0;padding:28px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:620px;background-color:#ffffff;border:1px solid #dbe4ff;border-radius:20px;overflow:hidden;box-shadow:0 20px 48px rgba(15,23,42,0.10);">
          <tr>
            <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 60%,#111827 100%);padding:24px 28px;">
              <div style="font-size:22px;line-height:1.3;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">AnviPayz</div>
              <div style="margin-top:4px;font-size:13px;line-height:1.5;color:#cbd5e1;">Your rewards journey starts here</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 10px 28px;">
              <div style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:#ecfdf5;color:#059669;font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">Welcome</div>
              <h1 style="margin:18px 0 12px 0;font-size:30px;line-height:1.2;color:#0f172a;letter-spacing:-0.03em;">Welcome to AnviPayz, ${safeName}</h1>
              <p style="margin:0 0 10px 0;font-size:16px;line-height:1.7;color:#475569;">Your account is ready. You can now start earning points, unlock recharge discounts, and explore daily tasks and surveys.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 8px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:linear-gradient(180deg,#ecfdf5 0%,#dcfce7 100%);border-radius:18px;border:1px solid #bbf7d0;">
                <tr>
                  <td style="padding:20px 18px;font-size:14px;line-height:1.7;color:#14532d;">
                    <strong style="color:#052e16;">What you can do next:</strong> Visit your dashboard to complete daily tasks, participate in surveys, earn more points, and save on recharge with rewards.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 30px 28px;">
              <p style="margin:0;font-size:13px;line-height:1.7;color:#64748b;">If you did not expect this email, please secure your account immediately.</p>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #e5e7eb;padding:18px 28px 24px 28px;background-color:#fafafa;">
              <div style="font-size:12px;line-height:1.7;color:#94a3b8;">Sent by AnviPayz authentication system.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
    };
}

module.exports = {
    createWelcomeEmail
};
