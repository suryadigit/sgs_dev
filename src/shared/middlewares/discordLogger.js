import fs from "fs";
import path from "path";
import os from "os";
import { sendDiscordMessage, formatRequestLog, formatAsCodeBlock } from "../lib/discordWebhook.js";

function appendLocalLog(text) {
  try {
    const logsDir = path.resolve(process.cwd(), "logs");
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const file = path.join(logsDir, "discord_requests.log");
    const entry = `[${new Date().toISOString()}] ${text}\n\n`;
    fs.appendFileSync(file, entry);
  } catch (e) {
    // ignore
  }
}

export default function discordLogger(req, _res, next) {
  try {
    console.log(`[discordLogger] ${req.method} ${req.originalUrl || req.url}`);

    if (!req.requestId) req.requestId = req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const shouldLog = req.method === "GET" || req.method === "POST";
    if (shouldLog) {
      const start = Date.now();

      const resObj = _res;
      const originalSend = resObj.send;
      resObj.send = function (body) {
        try { resObj.__body = body; } catch (e) { /* ignore */ }
        return originalSend.call(this, body);
      };

      resObj.on('finish', () => {
        try {
          const duration = Date.now() - start;
          const status = resObj.statusCode;

          const redact = (obj) => {
            try {
              if (!obj) return obj;
              const clone = JSON.parse(JSON.stringify(obj));
              const walk = (o) => {
                if (!o || typeof o !== 'object') return;
                for (const k of Object.keys(o)) {
                  if (/password|token|otp|authorization|auth|secret/i.test(k)) o[k] = 'REDACTED';
                  else if (typeof o[k] === 'object') walk(o[k]);
                }
              };
              walk(clone);
              return clone;
            } catch (e) { return '[unserializable]'; }
          };

          const maskEmail = (email) => {
            try {
              if (!email || typeof email !== 'string') return email;
              const [local, domain] = email.split('@');
              if (!domain) return email;
              if (local.length <= 2) return local[0] + '*@' + domain;
              return local.slice(0,2) + '*'.repeat(Math.max(2, local.length - 4)) + local.slice(-2) + '@' + domain;
            } catch (e) { return '[masked]'; }
          };

          const maskHeaderValue = (k, v) => {
            if (!v) return v;
            if (/authorization|token|secret|cookie/i.test(k)) {
              const s = String(v);
              return s.length > 10 ? s.slice(0,6) + '...REDACTED' : 'REDACTED';
            }
            return v;
          };

          const reqBody = redact(req.body || {});
          let resBody = resObj.__body;
          try {
            if (typeof resBody === 'string') {
              try { resBody = JSON.parse(resBody); } catch (e) { /* keep string */ }
            }
          } catch (e) { resBody = '[unserializable]'; }
          resBody = redact(resBody);

          const ip = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
          const statusEmoji = status >= 500 ? '❌' : status >= 400 ? '❌' : status >= 200 && status < 300 ? '✅' : '⚠️';
          const embed = {
            title: `${statusEmoji} ${req.method} ${req.originalUrl || req.url} - ${status} (${duration}ms)`,
            color: status >= 500 ? 0xE74C3C : status >= 400 ? 0xE67E22 : 0x2ECC71,
            timestamp: new Date().toISOString(),
            fields: [],
          };
          // Basic request info
          embed.fields.push({ name: 'Request ID', value: String(req.requestId), inline: true });
          embed.fields.push({ name: 'Method', value: req.method, inline: true });
          embed.fields.push({ name: 'URL', value: String(req.originalUrl || req.url), inline: true });
          embed.fields.push({ name: 'IP', value: ip, inline: true });

          // User info (masked)
          if (req.user && (req.user.id || req.user.email)) {
            const userLabel = req.user.id ? String(req.user.id) : (req.user.email ? maskEmail(req.user.email) : 'unknown');
            const userExtra = req.user.email ? ` (${maskEmail(req.user.email)})` : '';
            embed.fields.push({ name: 'User', value: `${userLabel}${userExtra}`, inline: true });
          }

          // Path params and query
          if (req.params && Object.keys(req.params).length) embed.fields.push({ name: 'Params', value: formatAsCodeBlock(req.params), inline: false });
          if (Object.keys(req.query || {}).length) embed.fields.push({ name: 'Query', value: formatAsCodeBlock(req.query), inline: false });

          // Selected headers (masked)
          const showHeaders = {
            'user-agent': req.headers['user-agent'] || null,
            'referer': req.headers['referer'] || req.headers['referrer'] || null,
            'content-type': req.headers['content-type'] || null,
            'authorization': maskHeaderValue('authorization', req.headers['authorization'] || req.headers['Authorization']),
            'x-forwarded-for': req.headers['x-forwarded-for'] || null,
          };
          embed.fields.push({ name: 'Headers', value: formatAsCodeBlock(showHeaders), inline: false });

          // Body
          if (Object.keys(reqBody || {}).length) embed.fields.push({ name: 'Body', value: formatAsCodeBlock(reqBody), inline: false });

          // Response status
          embed.fields.push({ name: 'Response Status', value: String(status), inline: true });
          try {
            const respValue = typeof resBody === 'string' ? resBody : resBody || {};
            embed.fields.push({ name: 'Response Body', value: formatAsCodeBlock(respValue), inline: false });
          } catch (e) {
            embed.fields.push({ name: 'Response Body', value: '[unserializable]', inline: false });
          }

          // Only send Discord notifications for errors or slow responses
          const slowThresholdMs = 500; // notify if response slower than this
          const ignoredPaths = ['/health', '/favicon.ico'];
          const pathLower = String(req.originalUrl || req.url || '').toLowerCase();
          const shouldNotify = (status >= 400) || (duration >= slowThresholdMs);
          if (ignoredPaths.some(p => pathLower.startsWith(p))) {
            // skip notifications for health checks and trivial paths
            appendLocalLog(`skipped-notify ${req.method} ${req.originalUrl || req.url} - ${status} (${duration}ms)`);
          }

          if (shouldNotify && !ignoredPaths.some(p => pathLower.startsWith(p))) {
            try {
              const extractErrorMessage = (rb) => {
                try {
                  if (!rb) return 'No error message';
                  if (typeof rb === 'string') return rb.slice(0, 900);
                  return rb.error?.message || rb.message || rb.error || JSON.stringify(rb).slice(0, 900);
                } catch (ee) { return 'Error extracting message'; }
              };

              const errMsg = extractErrorMessage(respValue);
              let errStack = '[no stack]';
              try { errStack = (typeof respValue === 'object' && (respValue.stack || respValue.error?.stack)) ? (respValue.stack || respValue.error?.stack) : '[no stack]'; } catch (ee) { errStack = '[unserializable]'; }

              embed.fields.push({ name: 'Error', value: formatAsCodeBlock({ message: errMsg, stack: typeof errStack === 'string' ? errStack.slice(0, 1000) : errStack }), inline: false });

              // try to find transaction id in common places
              const txId = req.params?.transactionId || req.body?.transactionId || req.query?.transactionId || respValue?.transactionId || respValue?.error?.transactionId;
              if (txId) embed.fields.push({ name: 'Transaction', value: String(txId), inline: true });

              // if server returned suggestion or nextAction include it
              const suggestion = respValue?.suggestion || respValue?.nextAction || respValue?.nextStep;
              if (suggestion) embed.fields.push({ name: 'Suggestion', value: String(suggestion).slice(0, 500), inline: false });
            } catch (e) {
              // ignore error building error field
            }
          }

          // local text fallback (keeps previous log structure)
          const textParts = [];
          textParts.push(`**${req.method}** ${req.originalUrl || req.url} - ${status} (${duration}ms)`);
          textParts.push(`IP: ${ip}`);
          if (Object.keys(req.query || {}).length) textParts.push(`Query: ${JSON.stringify(req.query)}`);
          if (Object.keys(reqBody || {}).length) textParts.push(`Request Body: ${JSON.stringify(reqBody)}`);
          textParts.push(`Response Status: ${status}`);
          try { textParts.push(`Response Body: ${JSON.stringify(resBody).slice(0, 1500)}`); } catch (e) { textParts.push('Response Body: [unserializable]'); }

          const fullLog = textParts.join('\n');
          appendLocalLog(fullLog);
          if (shouldNotify && !ignoredPaths.some(p => pathLower.startsWith(p))) {
            sendDiscordMessage({ embeds: [embed] }).catch((err) => console.error('[discordLogger] sendDiscordMessage failed:', err?.message || err));
          }
        } catch (e) {
          console.error('[discordLogger] finish handler error:', e?.message || e);
        }
      });
    }
  } catch (e) {
    // swallow middleware errors
  }
  next();
}
