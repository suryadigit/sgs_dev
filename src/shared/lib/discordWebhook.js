import axios from "axios";
import fs from "fs";
import path from "path";

const WEBHOOK_STAGING = process.env.DISCORD_WEBHOOK_URL || "https://discord.com/api/webhooks/1452898995608223745/YcBHDra8Miu81gkqchGEJjWlTM0a2oPuIpGMot3EDJrsxFEZx1Dg0tBuCaGxMKWbYZOc";
const WEBHOOK_PROD = process.env.DISCORD_WEBHOOK_URL_PROD || process.env.DISCORD_WEBHOOK_URL_PRODUCTION || "https://discord.com/api/webhooks/1452898602362994728/EAHlVHomrk8Lzxjr--6DNzfSd_pIhnJLb7pz8_tGvA8FzEIzZd7jf2iAKazl3wOXgann";

const DEFAULT_WEBHOOK = process.env.NODE_ENV === "production" ? WEBHOOK_PROD : WEBHOOK_STAGING;

function safeStringify(obj, max = 1000) {
  try {
    const s = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
    return s.length > max ? s.slice(0, max) + "... (truncated)" : s;
  } catch (e) {
    return "[unserializable]";
  }
}

export function formatAsCodeBlock(obj, lang = 'json', max = 1000) {
  try {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    const out = s.length > max ? s.slice(0, max) + "... (truncated)" : s;
    return "```" + lang + "\n" + out + "\n```";
  } catch (e) {
    return "```" + lang + "\n[unserializable]\n```";
  }
}

export async function sendDiscordMessage(content, webhookUrl = DEFAULT_WEBHOOK) {
  if (!webhookUrl) {
    console.error('[sendDiscordMessage] no webhook url provided');
    return;
  }
  console.debug('[sendDiscordMessage] using webhook:', webhookUrl);
  let payload;
  if (typeof content === 'string') payload = { content };
  else if (content && typeof content === 'object') payload = content;
  else payload = { content: safeStringify(content) };
  try {
    await axios.post(webhookUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 5000,
    });
  } catch (err) {
    console.error('[sendDiscordMessage] request failed:', err?.message || err);
    try {
      const logsDir = path.resolve(process.cwd(), "logs");
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      const msg = `[${new Date().toISOString()}] Failed to send discord message: ${safeStringify(content)}\nError: ${err?.message || err}\n`;
      fs.appendFileSync(path.join(logsDir, "discord_fallback.log"), msg);
    } catch (e) {
      console.error('[sendDiscordMessage] fallback log write failed:', e?.message || e);
    }
  }
}

export function formatRequestLog(req) {
  const lines = [];
  lines.push(`Method: ${req.method}`);
  lines.push(`URL: ${req.originalUrl || req.url}`);
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
  lines.push(`IP: ${ip}`);
  if (req.user) {
    const userLabel = req.user.fullName || req.user.email || req.user.id || '[user]';
    lines.push(`User: ${userLabel}`);
  }

  // Query
  if (req.query && Object.keys(req.query).length) {
    lines.push('Query:');
    lines.push(formatAsCodeBlock(req.query, 'json', 1200));
  }

  // Body for write methods
  if (['POST', 'PUT', 'PATCH'].includes((req.method || '').toUpperCase())) {
    lines.push('Body:');
    lines.push(formatAsCodeBlock(req.body || {}, 'json', 2000));
  }

  // Selected headers (keep concise)
  const headersToShow = ['content-type', 'user-agent', 'referer', 'x-forwarded-for', 'host'];
  const selected = {};
  for (const h of headersToShow) {
    if (req.headers && req.headers[h]) selected[h] = req.headers[h];
  }
  if (Object.keys(selected).length) {
    lines.push('Headers:');
    lines.push(formatAsCodeBlock(selected, 'json', 1000));
  }

  return lines.join('\n');
}
