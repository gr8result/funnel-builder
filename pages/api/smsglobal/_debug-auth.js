// /pages/api/smsglobal/_debug-auth.js
// FULL REPLACEMENT — shows what SMSGlobal auth is actually available at runtime (masked)

function s(v) {
  return String(v ?? "").trim();
}

function mask(v) {
  const x = s(v);
  if (!x) return "";
  if (x.length <= 6) return "*".repeat(x.length);
  return `${x.slice(0, 3)}***${x.slice(-3)}`;
}

export default function handler(req, res) {
  const bearer =
    s(process.env.SMSGLOBAL_BEARER_TOKEN) ||
    s(process.env.SMSGLOBAL_TOKEN) ||
    s(process.env.SMSGLOBAL_API_TOKEN);

  const key =
    s(process.env.SMSGLOBAL_API_KEY) ||
    s(process.env.SMSGLOBAL_KEY) ||
    s(process.env.SMSGLOBAL_USERNAME);

  const secret =
    s(process.env.SMSGLOBAL_API_SECRET) ||
    s(process.env.SMSGLOBAL_SECRET) ||
    s(process.env.SMSGLOBAL_PASSWORD);

  const rawAuth = s(process.env.SMSGLOBAL_AUTH); // optional: full "Basic xxx" or "Bearer xxx"
  const origin =
    s(process.env.SMSGLOBAL_ORIGIN) ||
    s(process.env.SMSGLOBAL_FROM) ||
    s(process.env.SMS_FROM);

  res.status(200).json({
    ok: true,
    has_bearer: !!bearer,
    bearer_mask: bearer ? mask(bearer) : null,
    has_basic_pair: !!(key && secret),
    key_mask: key ? mask(key) : null,
    secret_mask: secret ? mask(secret) : null,
    has_raw_auth: !!rawAuth,
    raw_auth_prefix: rawAuth ? rawAuth.split(" ")[0] : null,
    origin: origin || null,
  });
}
