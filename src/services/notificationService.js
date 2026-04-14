/**
 * notificationService.js
 *
 * Abstracts all outbound notification transports.
 * Controllers and services call these functions — they never reference a provider directly.
 *
 * ── Provider selection ───────────────────────────────────────────────────────
 * Set WHATSAPP_PROVIDER in .env to activate real delivery:
 *
 *   WHATSAPP_PROVIDER=twilio
 *     TWILIO_SID          — Account SID (ACxxxx…)
 *     TWILIO_AUTH_TOKEN   — Auth token
 *     WHATSAPP_FROM       — Sender number in E.164 (e.g. +14155238886)
 *
 *   WHATSAPP_PROVIDER=wati
 *     WHATSAPP_API_KEY    — Access token from WATI dashboard
 *     WATI_BASE_URL       — Instance URL (e.g. https://live-server-XXXXX.wati.io)
 *
 *   WHATSAPP_PROVIDER=360dialog
 *     WHATSAPP_API_KEY    — API key from 360dialog hub
 *
 * If WHATSAPP_PROVIDER is absent or unrecognised, the stub is used:
 * messages are logged to console only — nothing is sent to the tenant.
 *
 * ── Phone number format ──────────────────────────────────────────────────────
 * All providers expect E.164 (+91XXXXXXXXXX). Use normalizePhone() before
 * passing numbers to any external API. Indian 10-digit numbers are
 * automatically prefixed with +91.
 */

'use strict';

const https = require('https');

// ─── Phone Utilities ──────────────────────────────────────────────────────────

/**
 * normalizePhone(raw)
 *
 * Converts a raw phone string to E.164 format (+countryCodeNumber).
 * Assumes Indian numbers (10 digits) when no country code is present.
 *
 * Examples:
 *   '9876543210'      → '+919876543210'
 *   '919876543210'    → '+919876543210'
 *   '+919876543210'   → '+919876543210'
 *   '+447700900123'   → '+447700900123'  (non-Indian — kept as-is)
 */
const normalizePhone = (raw) => {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length === 10)                              return `+91${digits}`;   // bare Indian mobile
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;     // 91XXXXXXXXXX
  return `+${digits}`;                                                           // best-effort
};

/**
 * isValidPhone(raw)
 *
 * Returns true if the phone string contains between 10 and 15 digits
 * (ITU-T E.164 range). Does NOT validate country codes.
 */
const isValidPhone = (raw) => {
  if (!raw) return false;
  const digits = raw.replace(/[^\d]/g, '');
  return digits.length >= 10 && digits.length <= 15;
};

// ─── Internal HTTP helper ─────────────────────────────────────────────────────

/**
 * httpsPost({ hostname, path, auth, headers, body })
 *
 * Thin wrapper around Node's built-in https module.
 * auth — optional string in 'user:password' format (HTTP Basic auth).
 * body — string or object; objects are JSON-serialised automatically.
 *
 * Resolves with the parsed JSON response body.
 * Rejects with an Error on non-2xx status or network failure.
 */
const httpsPost = ({ hostname, path, auth, headers = {}, body }) =>
  new Promise((resolve, reject) => {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const opts = {
      hostname,
      path,
      method:  'POST',
      headers: {
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers,
      },
    };
    if (auth) opts.auth = auth;

    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(raw)); } catch { resolve({ raw }); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });

// ─── Provider implementations ─────────────────────────────────────────────────

/**
 * twilioSend(to, message)
 *
 * Sends a WhatsApp message via Twilio's Messages API.
 * Docs: https://www.twilio.com/docs/whatsapp/api
 *
 * Env vars: TWILIO_SID, TWILIO_AUTH_TOKEN, WHATSAPP_FROM
 */
const twilioSend = async (to, message) => {
  const sid   = process.env.TWILIO_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.WHATSAPP_FROM;

  if (!sid || !token || !from) {
    throw new Error('Twilio credentials incomplete. Set TWILIO_SID, TWILIO_AUTH_TOKEN, WHATSAPP_FROM in .env');
  }

  const normalized = normalizePhone(to);
  const formBody   = new URLSearchParams({
    From: `whatsapp:${from}`,
    To:   `whatsapp:${normalized}`,
    Body: message,
  }).toString();

  const result = await httpsPost({
    hostname: 'api.twilio.com',
    path:     `/2010-04-01/Accounts/${sid}/Messages.json`,
    auth:     `${sid}:${token}`,
    headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:     formBody,
  });

  return { sent: true, provider: 'twilio', messageId: result.sid ?? null, to: normalized };
};

/**
 * watiSend(to, message)
 *
 * Sends a WhatsApp session message via WATI.
 * Docs: https://docs.wati.io/reference/post_api-v1-sendsessionmessage-whatsappnumber
 *
 * Env vars: WHATSAPP_API_KEY, WATI_BASE_URL
 */
const watiSend = async (to, message) => {
  const apiKey  = process.env.WHATSAPP_API_KEY;
  const baseUrl = process.env.WATI_BASE_URL;

  if (!apiKey || !baseUrl) {
    throw new Error('WATI credentials incomplete. Set WHATSAPP_API_KEY and WATI_BASE_URL in .env');
  }

  // WATI expects the number without +, digits only (e.g. 919876543210)
  const normalized = normalizePhone(to).replace('+', '');
  const parsedBase = new URL(baseUrl);

  const result = await httpsPost({
    hostname: parsedBase.hostname,
    path:     `/api/v1/sendSessionMessage/${normalized}`,
    headers:  {
      'Content-Type':  'application/json',
      'Authorization': apiKey,
    },
    body: { messageText: message },
  });

  return { sent: true, provider: 'wati', messageId: result.id ?? null, to: normalized };
};

/**
 * dialog360Send(to, message)
 *
 * Sends a WhatsApp message via 360dialog's Cloud API.
 * Docs: https://docs.360dialog.com/whatsapp-api/whatsapp-api/media
 *
 * Env vars: WHATSAPP_API_KEY
 */
const dialog360Send = async (to, message) => {
  const apiKey = process.env.WHATSAPP_API_KEY;

  if (!apiKey) {
    throw new Error('360dialog API key not set. Set WHATSAPP_API_KEY in .env');
  }

  // 360dialog expects digits only without +
  const normalized = normalizePhone(to).replace('+', '');

  const result = await httpsPost({
    hostname: 'waba.360dialog.io',
    path:     '/v1/messages',
    headers:  {
      'Content-Type': 'application/json',
      'D360-API-KEY': apiKey,
    },
    body: {
      to:   normalized,
      type: 'text',
      text: { body: message },
    },
  });

  return {
    sent:      true,
    provider:  '360dialog',
    messageId: result.messages?.[0]?.id ?? null,
    to:        normalized,
  };
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * sendWhatsApp(to, message)
 *
 * Routes to the configured provider based on WHATSAPP_PROVIDER env var.
 * Falls back to stub (console-only) when no provider is configured.
 *
 * @param {string} to      - Recipient phone number (any format; normalised internally)
 * @param {string} message - Plain-text message body
 * @returns {{ sent: boolean, provider: string, messageId?: string, to: string }}
 */
const sendWhatsApp = async (to, message) => {
  const provider = (process.env.WHATSAPP_PROVIDER || '').toLowerCase().trim();

  switch (provider) {
    case 'twilio':    return twilioSend(to, message);
    case 'wati':      return watiSend(to, message);
    case '360dialog': return dialog360Send(to, message);

    default:
      // Stub — no real delivery. Logs to console for development visibility.
      console.log(JSON.stringify({
        level: 'info',
        event: 'whatsapp.stub',
        ts:    new Date().toISOString(),
        to,
        message,
        note:  'Set WHATSAPP_PROVIDER=twilio|wati|360dialog and credentials in .env to enable delivery.',
      }));
      return {
        sent:     false,
        provider: 'stub',
        to,
        message,
        note:     'WhatsApp provider not configured.',
      };
  }
};

module.exports = { sendWhatsApp, normalizePhone, isValidPhone };
