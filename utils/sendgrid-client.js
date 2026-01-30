/**
 * utils/sendgrid-client.js
 * Minimal wrapper for @sendgrid/mail
 *
 * ENV REQUIRED:
 *  - SENDGRID_API_KEY
 */

const sgMail = require("@sendgrid/mail");
if (!process.env.SENDGRID_API_KEY) {
  console.error("Missing SENDGRID_API_KEY env var.");
}
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * send(message) -> returns SendGrid response (array: [response, body]) or throws.
 * We return the raw send() Promise result so caller can inspect response headers.
 */
async function send(message) {
  // send returns a promise; node runtime in certain SendGrid versions resolves to array
  return sgMail.send(message);
}

module.exports = { send };