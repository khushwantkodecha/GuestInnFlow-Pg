const nodemailer = require('nodemailer');

const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL;
const SUPPORT_PHONE    = process.env.SUPPORT_PHONE || '';

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[emailService] SMTP_USER / SMTP_PASS not set — emails disabled');
    return null;
  }
  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
};

const FROM = () => `"DormAxis" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`;

// ── Superadmin alert ──────────────────────────────────────────────────────────
const sendSignupAlert = async ({ name, email, phone }) => {
  const transport = getTransporter();
  if (!transport) return;

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
      <h2 style="color:#1e293b;margin:0 0 4px;">New signup on DormAxis</h2>
      <p style="color:#64748b;margin:0 0 24px;font-size:14px;">A new account is waiting for activation.</p>

      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr>
          <td style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;color:#475569;width:30%;">Name</td>
          <td style="padding:10px 12px;border:1px solid #e2e8f0;color:#1e293b;">${name}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;color:#475569;">Email</td>
          <td style="padding:10px 12px;border:1px solid #e2e8f0;color:#1e293b;">${email || '—'}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;color:#475569;">Phone</td>
          <td style="padding:10px 12px;border:1px solid #e2e8f0;color:#1e293b;">${phone || '—'}</td>
        </tr>
      </table>

      <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">
        Log in to DormAxis and activate this account from the Super Admin panel.
      </p>
    </div>
  `;

  try {
    await transport.sendMail({
      from:    FROM(),
      to:      SUPERADMIN_EMAIL,
      subject: `New signup: ${name} — activate account`,
      html,
    });
    console.info(`[emailService] signup alert sent to ${SUPERADMIN_EMAIL} for ${name}`);
  } catch (err) {
    console.warn('[emailService] signup alert failed:', err.message);
  }
};

// ── Welcome email to new user ─────────────────────────────────────────────────
const sendWelcomeEmail = async ({ name, email, phone }) => {
  const transport = getTransporter();
  if (!transport || !email) return;

  const supportEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const supportPhone = SUPPORT_PHONE;

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#ffffff;">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#4caf93 0%,#3a9b7c 100%);padding:32px 24px;text-align:center;border-radius:12px 12px 0 0;">
        <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Welcome to DormAxis</h1>
        <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px;">Your PG / Hostel management platform</p>
      </div>

      <!-- Body -->
      <div style="padding:32px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">

        <p style="color:#1e293b;font-size:15px;margin:0 0 8px;">Hi <strong>${name}</strong>,</p>
        <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px;">
          Thanks for signing up! Your account has been created and is currently
          <strong style="color:#d97706;">pending activation</strong>.
          Once activated you'll have full access to manage your properties, track rent, and more.
        </p>

        <!-- Account details -->
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
          <p style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 12px;">Your account details</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <tr>
              <td style="padding:6px 0;color:#64748b;width:30%;">Name</td>
              <td style="padding:6px 0;color:#1e293b;font-weight:600;">${name}</td>
            </tr>
            ${email ? `
            <tr>
              <td style="padding:6px 0;color:#64748b;">Email</td>
              <td style="padding:6px 0;color:#1e293b;font-weight:600;">${email}</td>
            </tr>` : ''}
            ${phone ? `
            <tr>
              <td style="padding:6px 0;color:#64748b;">Phone</td>
              <td style="padding:6px 0;color:#1e293b;font-weight:600;">${phone}</td>
            </tr>` : ''}
          </table>
        </div>

        <!-- Next steps -->
        <p style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 12px;">Next steps</p>

        <!-- Step 1 -->
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;margin-bottom:8px;">
          <tr>
            <td width="44" valign="top" style="padding:14px 0 14px 16px;">
              <table cellpadding="0" cellspacing="0"><tr><td width="28" height="28" align="center" valign="middle"
                style="background:#dbeafe;border-radius:50%;font-size:13px;font-weight:700;color:#1d4ed8;">1</td></tr></table>
            </td>
            <td style="padding:14px 16px 14px 12px;">
              <p style="margin:0 0 3px;font-size:13px;font-weight:600;color:#1e293b;">Wait for activation</p>
              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5;">Our team will review your request and activate your account, usually within a few hours.</p>
            </td>
          </tr>
        </table>

        <!-- Step 2 -->
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;margin-bottom:8px;">
          <tr>
            <td width="44" valign="top" style="padding:14px 0 14px 16px;">
              <table cellpadding="0" cellspacing="0"><tr><td width="28" height="28" align="center" valign="middle"
                style="background:#dcfce7;border-radius:50%;font-size:13px;font-weight:700;color:#15803d;">2</td></tr></table>
            </td>
            <td style="padding:14px 16px 14px 12px;">
              <p style="margin:0 0 3px;font-size:13px;font-weight:600;color:#1e293b;">Sign in &amp; set up your property</p>
              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5;">Once active, log in and add your property, rooms, and beds to get started.</p>
            </td>
          </tr>
        </table>

        <!-- Step 3 -->
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;margin-bottom:0;">
          <tr>
            <td width="44" valign="top" style="padding:14px 0 14px 16px;">
              <table cellpadding="0" cellspacing="0"><tr><td width="28" height="28" align="center" valign="middle"
                style="background:#fef9c3;border-radius:50%;font-size:13px;font-weight:700;color:#854d0e;">3</td></tr></table>
            </td>
            <td style="padding:14px 16px 14px 12px;">
              <p style="margin:0 0 3px;font-size:13px;font-weight:600;color:#1e293b;">Add tenants &amp; track rent</p>
              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5;">Assign tenants to beds, collect rent, manage expenses, and generate reports — all in one place.</p>
            </td>
          </tr>
        </table>

        <!-- Contact -->
        <div style="margin-top:24px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px 20px;">
          <p style="color:#92400e;font-size:12px;font-weight:700;margin:0 0 8px;">Need help getting activated faster?</p>
          <p style="color:#b45309;font-size:12px;margin:0 0 10px;line-height:1.5;">
            Reach out to us directly and share your registered email or phone number.
          </p>
          <a href="tel:${supportPhone.replace(/\s/g,'')}" style="display:inline-block;margin-right:12px;color:#92400e;font-size:12px;font-weight:600;text-decoration:none;">📞 ${supportPhone}</a>
          <a href="mailto:${supportEmail}" style="display:inline-block;color:#92400e;font-size:12px;font-weight:600;text-decoration:none;">✉️ ${supportEmail}</a>
        </div>

        <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;text-align:center;">
          © 2026 DormAxis · All rights reserved
        </p>
      </div>
    </div>
  `;

  try {
    await transport.sendMail({
      from:    FROM(),
      to:      email,
      subject: `Welcome to DormAxis, ${name}! Your account is pending activation`,
      html,
    });
    console.info(`[emailService] welcome email sent to ${email}`);
  } catch (err) {
    console.warn('[emailService] welcome email failed:', err.message);
  }
};

// ── Account activation email to user ─────────────────────────────────────────
const sendAccountActivatedEmail = async ({ name, email }) => {
  const transport = getTransporter();
  if (!transport || !email) return;

  const supportEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const supportPhone = SUPPORT_PHONE;

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#ffffff;">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#4caf93 0%,#3a9b7c 100%);padding:32px 24px;text-align:center;border-radius:12px 12px 0 0;">
        <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;margin:0 auto 16px;line-height:56px;font-size:28px;">✅</div>
        <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Account Activated!</h1>
        <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px;">You're all set to manage your properties</p>
      </div>

      <!-- Body -->
      <div style="padding:32px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">

        <p style="color:#1e293b;font-size:15px;margin:0 0 8px;">Hi <strong>${name}</strong>,</p>
        <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px;">
          Great news — your DormAxis account has been <strong style="color:#16a34a;">activated</strong>!
          You can now sign in and start managing your PG / Hostel.
        </p>

        <!-- CTA -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
          <tr>
            <td align="center">
              <a href="https://dormaxis.com/login"
                style="display:inline-block;background:#4caf93;color:#ffffff;font-size:14px;font-weight:700;
                       text-decoration:none;padding:13px 36px;border-radius:10px;letter-spacing:0.2px;">
                Sign in to DormAxis →
              </a>
            </td>
          </tr>
        </table>

        <!-- Quick start -->
        <p style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 12px;">Quick start guide</p>

        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;margin-bottom:8px;">
          <tr>
            <td width="44" valign="top" style="padding:14px 0 14px 16px;">
              <table cellpadding="0" cellspacing="0"><tr><td width="28" height="28" align="center" valign="middle"
                style="background:#dbeafe;border-radius:50%;font-size:13px;font-weight:700;color:#1d4ed8;">1</td></tr></table>
            </td>
            <td style="padding:14px 16px 14px 12px;">
              <p style="margin:0 0 3px;font-size:13px;font-weight:600;color:#1e293b;">Add your property</p>
              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5;">Go to Properties and create your PG or hostel with address and details.</p>
            </td>
          </tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;margin-bottom:8px;">
          <tr>
            <td width="44" valign="top" style="padding:14px 0 14px 16px;">
              <table cellpadding="0" cellspacing="0"><tr><td width="28" height="28" align="center" valign="middle"
                style="background:#dcfce7;border-radius:50%;font-size:13px;font-weight:700;color:#15803d;">2</td></tr></table>
            </td>
            <td style="padding:14px 16px 14px 12px;">
              <p style="margin:0 0 3px;font-size:13px;font-weight:600;color:#1e293b;">Set up rooms &amp; beds</p>
              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5;">Add rooms with base rent and bed count to define your occupancy structure.</p>
            </td>
          </tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;margin-bottom:0;">
          <tr>
            <td width="44" valign="top" style="padding:14px 0 14px 16px;">
              <table cellpadding="0" cellspacing="0"><tr><td width="28" height="28" align="center" valign="middle"
                style="background:#fef9c3;border-radius:50%;font-size:13px;font-weight:700;color:#854d0e;">3</td></tr></table>
            </td>
            <td style="padding:14px 16px 14px 12px;">
              <p style="margin:0 0 3px;font-size:13px;font-weight:600;color:#1e293b;">Add tenants &amp; collect rent</p>
              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5;">Assign tenants to beds and let DormAxis handle billing, reminders, and reports.</p>
            </td>
          </tr>
        </table>

        <!-- Support -->
        <div style="margin-top:24px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;">
          <p style="color:#15803d;font-size:12px;font-weight:700;margin:0 0 6px;">Need help getting started?</p>
          <p style="color:#166534;font-size:12px;margin:0 0 10px;line-height:1.5;">We're here to help anytime.</p>
          <a href="tel:${supportPhone.replace(/\s/g,'')}" style="display:inline-block;margin-right:12px;color:#15803d;font-size:12px;font-weight:600;text-decoration:none;">📞 ${supportPhone}</a>
          <a href="mailto:${supportEmail}" style="display:inline-block;color:#15803d;font-size:12px;font-weight:600;text-decoration:none;">✉️ ${supportEmail}</a>
        </div>

        <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;text-align:center;">
          © 2026 DormAxis · All rights reserved
        </p>
      </div>
    </div>
  `;

  try {
    await transport.sendMail({
      from:    FROM(),
      to:      email,
      subject: `Your DormAxis account is now active, ${name}!`,
      html,
    });
    console.info(`[emailService] activation email sent to ${email}`);
  } catch (err) {
    console.warn('[emailService] activation email failed:', err.message);
  }
};

// ── Tenant move-in welcome email ──────────────────────────────────────────────
const sendTenantWelcomeEmail = async ({
  name, email, phone,
  roomNumber, floor, roomType,
  bedNumber, isExtra,
  rentAmount, rentType,
  checkInDate, billingStartDate,
  depositAmount, depositStatus,
}) => {
  const transport = getTransporter();
  if (!transport || !email) return;

  const supportEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const supportPhone = SUPPORT_PHONE;

  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const inr = (n) => n != null ? `₹${Number(n).toLocaleString('en-IN')}` : '—';

  const billingDay   = billingStartDate ? new Date(billingStartDate).getDate() : null;
  const rentTypeLabel = rentType === 'per_bed' ? 'Per Bed (Fixed)' : rentType === 'per_room_split' ? 'Room Split' : rentType ?? '—';
  const depositLabel  = depositStatus === 'held' ? 'Collected' : depositStatus === 'pending' ? 'Pending' : '—';
  const bedLabel      = isExtra ? `Bed ${bedNumber} (Extra)` : `Bed ${bedNumber}`;

  const row = (label, value) => `
    <tr>
      <td style="padding:9px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-size:13px;font-weight:600;color:#475569;width:38%;">${label}</td>
      <td style="padding:9px 12px;border:1px solid #e2e8f0;font-size:13px;color:#1e293b;">${value}</td>
    </tr>`;

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#ffffff;">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#4caf93 0%,#3a9b7c 100%);padding:32px 24px;text-align:center;border-radius:12px 12px 0 0;">
        <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;margin:0 auto 16px;line-height:56px;font-size:28px;">🏠</div>
        <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">Welcome, ${name}!</h1>
        <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px;">Your stay has been confirmed</p>
      </div>

      <!-- Body -->
      <div style="padding:28px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">

        <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px;">
          Hi <strong>${name}</strong>, your bed has been assigned and your account is now active.
          Here are all your stay details for your records.
        </p>

        <!-- Room & Bed -->
        <p style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;">Room &amp; Bed</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
          ${row('Room Number', `Room ${roomNumber}`)}
          ${floor != null ? row('Floor', `Floor ${floor}`) : ''}
          ${roomType ? row('Room Type', roomType.charAt(0).toUpperCase() + roomType.slice(1)) : ''}
          ${row('Bed', bedLabel)}
        </table>

        <!-- Billing -->
        <p style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;">Billing Details</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
          ${row('Monthly Rent', inr(rentAmount))}
          ${row('Rent Type', rentTypeLabel)}
          ${row('Move-in Date', fmt(checkInDate))}
          ${billingDay ? row('Billing Cycle', `Renews on day ${billingDay} of every month`) : ''}
          ${depositAmount > 0 ? row('Security Deposit', `${inr(depositAmount)} · ${depositLabel}`) : ''}
        </table>

        <!-- Contact -->
        ${phone ? `
        <p style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;">Your Contact</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
          ${row('Phone', phone)}
          ${email ? row('Email', email) : ''}
        </table>` : ''}

        <!-- Important notes -->
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
          <p style="color:#92400e;font-size:12px;font-weight:700;margin:0 0 10px;">Important reminders</p>
          <table cellpadding="0" cellspacing="0">
            ${billingDay ? `<tr><td style="padding:3px 0;font-size:12px;color:#b45309;">• Rent is due on day <strong>${billingDay}</strong> of every month</td></tr>` : ''}
            <tr><td style="padding:3px 0;font-size:12px;color:#b45309;">• Keep this email for your records</td></tr>
            <tr><td style="padding:3px 0;font-size:12px;color:#b45309;">• Contact us for any queries about your stay</td></tr>
          </table>
        </div>

        <!-- Support -->
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 20px;">
          <p style="color:#15803d;font-size:12px;font-weight:700;margin:0 0 6px;">Need help?</p>
          <a href="tel:${supportPhone.replace(/\s/g,'')}" style="display:inline-block;margin-right:12px;color:#15803d;font-size:12px;font-weight:600;text-decoration:none;">📞 ${supportPhone}</a>
          <a href="mailto:${supportEmail}" style="display:inline-block;color:#15803d;font-size:12px;font-weight:600;text-decoration:none;">✉️ ${supportEmail}</a>
        </div>

        <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;text-align:center;">© 2026 DormAxis · All rights reserved</p>
      </div>
    </div>
  `;

  try {
    await transport.sendMail({
      from:    FROM(),
      to:      email,
      subject: `Your stay details — Room ${roomNumber}, Bed ${bedNumber}`,
      html,
    });
    console.info(`[emailService] tenant welcome sent to ${email} (${name})`);
  } catch (err) {
    console.warn('[emailService] tenant welcome failed:', err.message);
  }
};

// ── Shared helpers ────────────────────────────────────────────────────────────
const fmt = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const inr = (n) => n != null && n > 0 ? `₹${Number(n).toLocaleString('en-IN')}` : '—';

const tenantEmailHeader = (emoji, title, subtitle) => `
  <div style="background:linear-gradient(135deg,#4caf93 0%,#3a9b7c 100%);padding:28px 24px;text-align:center;border-radius:12px 12px 0 0;">
    <div style="width:48px;height:48px;background:rgba(255,255,255,0.2);border-radius:50%;margin:0 auto 12px;line-height:48px;font-size:24px;">${emoji}</div>
    <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700;">${title}</h1>
    <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">${subtitle}</p>
  </div>`;

const tenantEmailRow = (label, value) => `
  <tr>
    <td style="padding:9px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-size:13px;font-weight:600;color:#475569;width:40%;">${label}</td>
    <td style="padding:9px 12px;border:1px solid #e2e8f0;font-size:13px;color:#1e293b;">${value}</td>
  </tr>`;

const tenantEmailSupport = () => {
  const supportEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  return `
  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 20px;margin-top:20px;">
    <p style="color:#15803d;font-size:12px;font-weight:700;margin:0 0 6px;">Need help?</p>
    <a href="tel:${SUPPORT_PHONE.replace(/\s/g,'')}" style="display:inline-block;margin-right:12px;color:#15803d;font-size:12px;font-weight:600;text-decoration:none;">📞 ${SUPPORT_PHONE}</a>
    <a href="mailto:${supportEmail}" style="display:inline-block;color:#15803d;font-size:12px;font-weight:600;text-decoration:none;">✉️ ${supportEmail}</a>
  </div>`;
};

const tenantEmailWrapper = (header, body) => `
  <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#ffffff;">
    ${header}
    <div style="padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">
      ${body}
      ${tenantEmailSupport()}
      <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;text-align:center;">© 2026 DormAxis · All rights reserved</p>
    </div>
  </div>`;

// ── Reservation confirmation ──────────────────────────────────────────────────
const sendReservationConfirmEmail = async ({
  name, email,
  roomNumber, floor, bedNumber,
  reservedTill, moveInDate,
  advanceAmount, advanceMode,
  expectedRent,
}) => {
  const transport = getTransporter();
  if (!transport || !email) return;

  const advModeLabel = advanceMode === 'adjust' ? 'Applied as rent credit at move-in'
    : advanceMode === 'refund' ? 'Refundable on cancellation'
    : null;

  const html = tenantEmailWrapper(
    tenantEmailHeader('📋', 'Bed Reserved!', `Room ${roomNumber} · Bed ${bedNumber}`),
    `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 20px;">
      Hi <strong>${name}</strong>, your bed reservation has been confirmed. Please move in before the hold expires.
    </p>
    <p style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;">Reservation Details</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
      ${tenantEmailRow('Room', `Room ${roomNumber}${floor != null ? ` · Floor ${floor}` : ''}`)}
      ${tenantEmailRow('Bed', `Bed ${bedNumber}`)}
      ${tenantEmailRow('Hold Until', fmt(reservedTill))}
      ${moveInDate ? tenantEmailRow('Planned Move-in', fmt(moveInDate)) : ''}
      ${expectedRent ? tenantEmailRow('Rent at Move-in', inr(expectedRent) + '/mo') : ''}
      ${advanceAmount > 0 ? tenantEmailRow('Advance Paid', inr(advanceAmount)) : ''}
      ${advModeLabel ? tenantEmailRow('Advance Treatment', advModeLabel) : ''}
    </table>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;">
      <p style="color:#92400e;font-size:12px;font-weight:700;margin:0 0 6px;">Important</p>
      <p style="color:#b45309;font-size:12px;margin:0;line-height:1.5;">
        Your bed will be automatically released on <strong>${fmt(reservedTill)}</strong> if you do not move in by then.
      </p>
    </div>`
  );

  try {
    await transport.sendMail({ from: FROM(), to: email, subject: `Bed reserved — Room ${roomNumber}, Bed ${bedNumber}`, html });
    console.info(`[emailService] reservation confirmation sent to ${email}`);
  } catch (err) {
    console.warn('[emailService] reservation confirmation failed:', err.message);
  }
};

// ── Reservation cancelled ─────────────────────────────────────────────────────
const sendReservationCancelledEmail = async ({
  name, email,
  roomNumber, bedNumber,
  advanceAmount, advanceOutcome,
}) => {
  const transport = getTransporter();
  if (!transport || !email) return;

  const outcomeText = advanceOutcome === 'refund'  ? `₹${Number(advanceAmount).toLocaleString('en-IN')} will be refunded to you`
    : advanceOutcome === 'forfeit' ? `₹${Number(advanceAmount).toLocaleString('en-IN')} has been forfeited`
    : advanceOutcome === 'credit'  ? `₹${Number(advanceAmount).toLocaleString('en-IN')} has been kept as wallet credit for future use`
    : null;

  const html = tenantEmailWrapper(
    tenantEmailHeader('❌', 'Reservation Cancelled', `Room ${roomNumber} · Bed ${bedNumber}`),
    `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 20px;">
      Hi <strong>${name}</strong>, your reservation for Room ${roomNumber}, Bed ${bedNumber} has been cancelled and the bed is now available to others.
    </p>
    ${advanceAmount > 0 && outcomeText ? `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;margin-bottom:20px;">
      <p style="color:#991b1b;font-size:12px;font-weight:700;margin:0 0 4px;">Advance of ${inr(advanceAmount)}</p>
      <p style="color:#b91c1c;font-size:13px;margin:0;">${outcomeText}</p>
    </div>` : ''}
    <p style="color:#64748b;font-size:13px;margin:0;">Please contact us if you believe this was a mistake or to book a new bed.</p>`
  );

  try {
    await transport.sendMail({ from: FROM(), to: email, subject: `Reservation cancelled — Room ${roomNumber}, Bed ${bedNumber}`, html });
    console.info(`[emailService] reservation cancelled email sent to ${email}`);
  } catch (err) {
    console.warn('[emailService] reservation cancelled email failed:', err.message);
  }
};

// ── Reservation expired ───────────────────────────────────────────────────────
const sendReservationExpiredEmail = async ({
  name, email,
  roomNumber, bedNumber,
  reservedTill, advanceAmount,
}) => {
  const transport = getTransporter();
  if (!transport || !email) return;

  const html = tenantEmailWrapper(
    tenantEmailHeader('⏰', 'Reservation Expired', `Room ${roomNumber} · Bed ${bedNumber}`),
    `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 20px;">
      Hi <strong>${name}</strong>, your reservation for Room ${roomNumber}, Bed ${bedNumber} expired on <strong>${fmt(reservedTill)}</strong> and has been automatically released.
    </p>
    ${advanceAmount > 0 ? `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;margin-bottom:20px;">
      <p style="color:#92400e;font-size:12px;font-weight:700;margin:0 0 4px;">Advance of ${inr(advanceAmount)}</p>
      <p style="color:#b45309;font-size:13px;margin:0;">Please contact us to arrange a refund or apply it to a new reservation.</p>
    </div>` : ''}
    <p style="color:#64748b;font-size:13px;margin:0;">If you are still interested in staying with us, please get in touch and we will find you a bed.</p>`
  );

  try {
    await transport.sendMail({ from: FROM(), to: email, subject: `Reservation expired — Room ${roomNumber}, Bed ${bedNumber}`, html });
    console.info(`[emailService] reservation expired email sent to ${email}`);
  } catch (err) {
    console.warn('[emailService] reservation expired email failed:', err.message);
  }
};

// ── Checkout confirmation ─────────────────────────────────────────────────────
const sendCheckoutEmail = async ({
  name, email,
  roomNumber, bedNumber,
  checkOutDate,
  depositAmount, depositStatus, depositBalance,
}) => {
  const transport = getTransporter();
  if (!transport || !email) return;

  const depositLabel = depositStatus === 'returned' ? 'Returned'
    : depositStatus === 'held'    ? 'Held — pending return'
    : depositStatus === 'pending' ? 'Not yet collected'
    : '—';

  const html = tenantEmailWrapper(
    tenantEmailHeader('🚪', 'Check-out Confirmed', `Room ${roomNumber} · Bed ${bedNumber}`),
    `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 20px;">
      Hi <strong>${name}</strong>, your check-out has been processed. We hope you enjoyed your stay!
    </p>
    <p style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;">Check-out Summary</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
      ${tenantEmailRow('Room', `Room ${roomNumber}`)}
      ${tenantEmailRow('Bed', `Bed ${bedNumber}`)}
      ${tenantEmailRow('Check-out Date', fmt(checkOutDate))}
      ${depositAmount > 0 ? tenantEmailRow('Security Deposit', inr(depositAmount)) : ''}
      ${depositAmount > 0 ? tenantEmailRow('Deposit Status', depositLabel) : ''}
      ${depositBalance > 0 && depositStatus !== 'returned' ? tenantEmailRow('Deposit Balance', inr(depositBalance)) : ''}
    </table>
    <p style="color:#64748b;font-size:13px;margin:0;">
      Please contact us if you have any questions about your deposit or final billing. Thank you for staying with us!
    </p>`
  );

  try {
    await transport.sendMail({ from: FROM(), to: email, subject: `Check-out confirmed — Room ${roomNumber}`, html });
    console.info(`[emailService] checkout email sent to ${email}`);
  } catch (err) {
    console.warn('[emailService] checkout email failed:', err.message);
  }
};

// ── Room/bed transfer notification ────────────────────────────────────────────
const sendRoomTransferEmail = async ({
  name, email,
  fromRoom, fromBed,
  toRoom, toBed,
  newRent, rentType,
  transferDate,
}) => {
  const transport = getTransporter();
  if (!transport || !email) return;

  const rentTypeLabel = rentType === 'per_bed' ? 'Per Bed (Fixed)' : rentType === 'per_room_split' ? 'Room Split' : rentType ?? '—';
  const sameRoom = String(fromRoom) === String(toRoom);

  const html = tenantEmailWrapper(
    tenantEmailHeader('🔄', sameRoom ? 'Bed Changed' : 'Room Transferred', sameRoom ? `Room ${toRoom}` : `Room ${fromRoom} → Room ${toRoom}`),
    `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 20px;">
      Hi <strong>${name}</strong>, your ${sameRoom ? 'bed has been changed' : 'room has been transferred'} as of <strong>${fmt(transferDate)}</strong>.
    </p>
    <p style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;">Transfer Details</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
      ${tenantEmailRow('Previous', `Room ${fromRoom} · Bed ${fromBed}`)}
      ${tenantEmailRow('New', `Room ${toRoom} · Bed ${toBed}`)}
      ${newRent > 0 ? tenantEmailRow('New Monthly Rent', inr(newRent) + '/mo') : ''}
      ${newRent > 0 ? tenantEmailRow('Rent Type', rentTypeLabel) : ''}
      ${tenantEmailRow('Effective Date', fmt(transferDate))}
    </table>
    <p style="color:#64748b;font-size:13px;margin:0;">Your billing cycle remains unchanged. Contact us if you have any questions.</p>`
  );

  try {
    await transport.sendMail({ from: FROM(), to: email, subject: `${sameRoom ? 'Bed changed' : 'Room transfer'} — Room ${toRoom}, Bed ${toBed}`, html });
    console.info(`[emailService] room transfer email sent to ${email}`);
  } catch (err) {
    console.warn('[emailService] room transfer email failed:', err.message);
  }
};

module.exports = {
  sendSignupAlert,
  sendWelcomeEmail,
  sendAccountActivatedEmail,
  sendTenantWelcomeEmail,
  sendReservationConfirmEmail,
  sendReservationCancelledEmail,
  sendReservationExpiredEmail,
  sendCheckoutEmail,
  sendRoomTransferEmail,
};
