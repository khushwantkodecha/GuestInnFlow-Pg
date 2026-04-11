/**
 * notificationService.js
 *
 * Abstracts all outbound notification transports.
 * Controllers call these functions — they never reference a specific provider.
 *
 * To add WhatsApp later, replace the stub in sendWhatsApp() with the
 * provider SDK (Twilio, WATI, 360dialog, etc.) and set the env vars below.
 * No changes needed outside this file.
 *
 * Required env vars when a real provider is wired:
 *   WHATSAPP_PROVIDER   = twilio | wati | 360dialog
 *   WHATSAPP_API_KEY    = <provider api key>
 *   WHATSAPP_FROM       = <sender number / channel id>
 */

/**
 * sendWhatsApp(to, message)
 *
 * @param {string} to      - Recipient phone number (E.164 format recommended: +91XXXXXXXXXX)
 * @param {string} message - Plain-text message body
 * @returns {{ sent: boolean, provider: string, to: string, message: string, note?: string }}
 */
const sendWhatsApp = async (to, message) => {
  // ── Plug real provider here ──────────────────────────────────────────────
  //
  // Example (Twilio):
  //   const twilio = require('twilio');
  //   const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
  //   await client.messages.create({
  //     from: `whatsapp:${process.env.WHATSAPP_FROM}`,
  //     to:   `whatsapp:${to}`,
  //     body: message,
  //   });
  //
  // Example (WATI):
  //   await axios.post(`${process.env.WATI_BASE_URL}/api/v1/sendSessionMessage/${to}`,
  //     { messageText: message },
  //     { headers: { Authorization: process.env.WHATSAPP_API_KEY } }
  //   );
  // ────────────────────────────────────────────────────────────────────────

  // Stub — logs locally, returns preview payload
  console.log(`[WhatsApp stub] To: ${to} | Message: ${message}`);

  return {
    sent: false,
    provider: 'stub',
    to,
    message,
    note: 'WhatsApp provider not configured. Set WHATSAPP_PROVIDER and credentials in .env to enable.',
  };
};

/**
 * buildRentReminderMessage(tenant, rentRecord)
 *
 * Centralises message templating so copy changes never touch controller logic.
 */
const buildRentReminderMessage = (tenant, rentRecord) => {
  const due = new Date(rentRecord.dueDate).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    `Hi ${tenant.name}, your rent ₹${rentRecord.amount.toLocaleString('en-IN')} ` +
    `is due on ${due}. Please make the payment on time to avoid late fees. Thank you!`
  );
};

module.exports = { sendWhatsApp, buildRentReminderMessage };
