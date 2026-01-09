import prisma from "../../shared/lib/prisma.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { authConfig } from "../../config/auth.config.js";
import { sendOtpEmail } from "../../shared/lib/sendOtp.js";

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendWhatsAppOTP = async (phone, otp) => {
  try {
    const wablasApiKey = process.env.WABLAS_API_KEY;
    const wablasApiUrl = process.env.WABLAS_API_URL || "https://pati.wablas.com";
    if (!wablasApiKey) { console.error("WABLAS_API_KEY not configured"); return { success: false, error: "WhatsApp API not configured" }; }

    let formattedPhone = phone.replace(/\D/g, "");
    if (formattedPhone.startsWith("0")) formattedPhone = "62" + formattedPhone.substring(1);
    if (!formattedPhone.startsWith("62")) formattedPhone = "62" + formattedPhone;

    const message = `Kode OTP Reset Password Anda: *${otp}*\n\nKode berlaku selama 15 menit.\nJangan bagikan kode ini kepada siapapun.\n\n- SGS Team`;

    const response = await fetch(`${wablasApiUrl}/api/send-message`, { method: "POST", headers: { "Authorization": wablasApiKey, "Content-Type": "application/json" }, body: JSON.stringify({ phone: formattedPhone, message }) });
    const data = await response.json();
    return { success: data.status === true || data.status === "success", data };
  } catch (error) { console.error("WhatsApp OTP Error:", error); return { success: false, error: error.message }; }
};

export const forgotPassword = async (req, res) => {
  try {
    const { phone, email } = req.body;
    if (!phone && !email) return res.status(400).json({ error: "Phone or email is required" });

    let user;
    let formattedPhone = null;
    let otpType = "PHONE";

    if (phone) {
      formattedPhone = phone.replace(/\D/g, "");
      if (formattedPhone.startsWith("0")) formattedPhone = "62" + formattedPhone.substring(1);
      if (!formattedPhone.startsWith("62")) formattedPhone = "62" + formattedPhone;

      user = await prisma.user.findFirst({ where: { OR: [{ phone: formattedPhone }, { phone: phone }, { phone: "0" + formattedPhone.substring(2) }] }, select: { id: true, email: true, fullName: true, phone: true } });
      otpType = "PHONE";
    } else {
      user = await prisma.user.findUnique({ where: { email } , select: { id: true, email: true, fullName: true, phone: true } });
      otpType = "EMAIL";
    }

    if (!user) return res.status(404).json({ error: "User not found" });

    const existingOtp = await prisma.otpRecord.findFirst({ where: { userId: user.id, type: otpType, isUsed: false, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    if (existingOtp) { const timeSinceCreation = Date.now() - new Date(existingOtp.createdAt).getTime(); const waitTime = 60000 - timeSinceCreation; if (waitTime > 0) return res.status(429).json({ error: "Please wait before requesting another OTP", waitSeconds: Math.ceil(waitTime / 1000) }); }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.otpRecord.deleteMany({ where: { userId: user.id, type: otpType } });
    await prisma.otpRecord.create({ data: { userId: user.id, code: otp, type: otpType, method: otpType === "PHONE" ? "WHATSAPP" : "EMAIL", expiresAt } });

    let whatsappSuccess = false;
    let emailSuccess = false;
    let whatsappError = null;
    let emailError = null;

    if (otpType === "PHONE") {
      try {
        const r = await sendWhatsAppOTP(formattedPhone, otp);
        whatsappSuccess = !!r.success;
        if (!whatsappSuccess) whatsappError = r.error || JSON.stringify(r.data || r);
      } catch (err) {
        whatsappError = err.message;
      }
      if (user.email) {
        try { await sendOtpEmail(user.email, otp); emailSuccess = true; } catch (err) { emailError = err.message; }
      }
    } else {
      try { await sendOtpEmail(user.email, otp); emailSuccess = true; } catch (err) { emailError = err.message; }
      if (user.phone) {
        try { const r = await sendWhatsAppOTP(user.phone, otp); whatsappSuccess = !!r.success; if (!whatsappSuccess) whatsappError = r.error || JSON.stringify(r.data || r); } catch (err) { whatsappError = err.message; }
      }
    }

    if (!whatsappSuccess && !emailSuccess) {
      await prisma.otpRecord.deleteMany({ where: { userId: user.id, type: otpType } });
      return res.status(500).json({ error: "Failed to send OTP", details: { whatsappError, emailError } });
    }

    const channels = [];
    if (whatsappSuccess) channels.push("whatsapp");
    if (emailSuccess) channels.push("email");

    res.json({ message: "OTP sent", channels, phone: formattedPhone ? formattedPhone.substring(0, 5) + "****" + formattedPhone.substring(formattedPhone.length - 3) : null, email: user.email ? user.email.replace(/(.{2})(.*)(@.*)/, "$1***$3") : null, expiresIn: "15 minutes" });
  } catch (error) { console.error("Forgot password error:", error); res.status(500).json({ error: error.message }); }
};

export const verifyResetOtp = async (req, res) => {
  try {
    const mask = (k, v) => {
      const low = String(k).toLowerCase();
      if (!v) return v;
      if (low.includes('token') || low.includes('password') || low.includes('otp') || low.includes('code') || low.includes('pin')) return '***masked***';
      return v;
    };
    try {
      const maskedBody = Object.fromEntries(Object.entries(req.body || {}).map(([k, v]) => [k, mask(k, v)]));
      const headerKeys = Object.keys(req.headers || {}).slice(0,20);
      console.log('[verifyResetOtp] request body keys:', Object.keys(req.body || {}));
      console.log('[verifyResetOtp] masked body:', JSON.stringify(maskedBody));
      console.log('[verifyResetOtp] headers keys sample:', headerKeys.join(','));
    } catch (e) { console.warn('[verifyResetOtp] logging failed', e && e.message); }
    const { phone, email } = req.body;
    const otpValue = String(req.body.otp || req.body.code || req.body.otpCode || req.body.pin || '').trim();
    if (!otpValue) return res.status(400).json({ error: "OTP is required" });

    let user;
    let formattedPhone = null;
    let otpType = null;
    let otpRecord = null;

    if (phone || email) {
      if (phone) {
        formattedPhone = phone.replace(/\D/g, "");
        if (formattedPhone.startsWith("0")) formattedPhone = "62" + formattedPhone.substring(1);
        if (!formattedPhone.startsWith("62")) formattedPhone = "62" + formattedPhone;

        user = await prisma.user.findFirst({ where: { OR: [{ phone: formattedPhone }, { phone: phone }, { phone: "0" + formattedPhone.substring(2) }] }, select: { id: true, email: true, fullName: true, phone: true } });
        otpType = "PHONE";
      } else {
        user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, fullName: true, phone: true } });
        otpType = "EMAIL";
      }

      if (!user) return res.status(404).json({ error: "User not found" });

      otpRecord = await prisma.otpRecord.findFirst({ where: { userId: user.id, code: otpValue, type: otpType, isUsed: false, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
      if (!otpRecord) return res.status(400).json({ error: "Invalid OTP" });
    } else {
      otpRecord = await prisma.otpRecord.findFirst({ where: { code: otpValue, isUsed: false, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
      if (!otpRecord) return res.status(400).json({ error: "Invalid OTP" });

      user = await prisma.user.findUnique({ where: { id: otpRecord.userId }, select: { id: true, email: true, fullName: true, phone: true } });
      if (!user) return res.status(400).json({ error: "Invalid OTP" });
      otpType = otpRecord.type;
    }

    try {
      await prisma.otpRecord.delete({ where: { id: otpRecord.id } });
      console.log('[verifyResetOtp] OTP record deleted after successful verification');
    } catch (e) {
      console.warn('[verifyResetOtp] Failed to delete OTP record, marking as used instead', e && e.message);
      await prisma.otpRecord.update({ where: { id: otpRecord.id }, data: { isUsed: true } });
    }

    const resetToken = jwt.sign({ userId: user.id, purpose: "PASSWORD_RESET" }, authConfig.JWT_SECRET, { expiresIn: "10m" });

    res.json({ message: "OTP verified successfully", resetToken, expiresIn: "10 minutes" });
  } catch (error) { console.error("Verify OTP error:", error); res.status(500).json({ error: error.message }); }
};

export const resetPassword = async (req, res) => {
  try {
    try {
      const mask = (k, v) => {
        const low = String(k).toLowerCase();
        if (!v) return v;
        if (low.includes('token') || low.includes('password') || low.includes('otp') || low.includes('code') || low.includes('pin')) return '***masked***';
        return v;
      };
      const maskedBody = Object.fromEntries(Object.entries(req.body || {}).map(([k, v]) => [k, mask(k, v)]));
      const headerKeys = Object.keys(req.headers || {}).slice(0,20);
      console.log('[resetPassword] request body keys:', Object.keys(req.body || {}));
      console.log('[resetPassword] masked body:', JSON.stringify(maskedBody));
      console.log('[resetPassword] headers keys sample:', headerKeys.join(','));
    } catch (e) { console.warn('[resetPassword] logging failed', e && e.message); }
    const body = req.body || {};
    let resetToken = body.resetToken || body.token || body.reset_token || body.reset || null;
    if (!resetToken) {
      const authHeader = req.headers?.authorization || req.headers?.Authorization || null;
      if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        resetToken = authHeader.split(' ')[1];
      }
    }
    if (!resetToken) resetToken = req.headers['x-reset-token'] || req.headers['x-reset-token'.toLowerCase()];

    let newPassword = body.newPassword || body.password || body.new_password || body.passwordBaru || body.password_baru || null;
    let confirmPassword = body.confirmPassword || body.confirm_password || body.confirm || body.konfirmasiPassword || body.konfirmasi_password || null;

    if ((!newPassword || !confirmPassword) && typeof body === 'object') {
      const nested = body.data || body.payload || body.body || null;
      if (nested && typeof nested === 'object') {
        newPassword = newPassword || nested.newPassword || nested.password || nested.passwordBaru || nested.password_baru || null;
        confirmPassword = confirmPassword || nested.confirmPassword || nested.confirm || nested.konfirmasiPassword || nested.confirm_password || null;
      }

      if (!newPassword) {
        for (const [k, v] of Object.entries(body)) {
          if (!v) continue;
          const lk = String(k).toLowerCase();
          if ((lk.includes('password') || lk.includes('pass')) && typeof v === 'string' && v.trim()) { newPassword = v; break; }
        }
      }

      if (!confirmPassword) {
        for (const [k, v] of Object.entries(body)) {
          if (!v) continue;
          const lk = String(k).toLowerCase();
          if ((lk.includes('confirm') || lk.includes('konfirmasi') || lk.includes('confirm_password') || lk.includes('password_confirm')) && typeof v === 'string' && v.trim()) { confirmPassword = v; break; }
        }
      }

      if (!newPassword) newPassword = req.query?.newPassword || req.query?.password || null;
      if (!confirmPassword) confirmPassword = req.query?.confirmPassword || req.query?.confirm || null;
    }

    console.log('[resetPassword] resolved fields - newPassword?', !!newPassword, 'confirmPassword?', !!confirmPassword);

    if (!confirmPassword && newPassword) {
      console.warn('[resetPassword] confirm password not provided; using newPassword as confirm (frontend may omit confirm)');
      confirmPassword = newPassword;
    }

    if (!resetToken) return res.status(400).json({ error: "Reset token is required (body.resetToken, body.token, header Authorization: Bearer <token>, or x-reset-token)" });
    if (!newPassword || !confirmPassword) return res.status(400).json({ error: "New password and confirm password are required" });
    if (newPassword !== confirmPassword) return res.status(400).json({ error: "Passwords do not match" });
    if (newPassword.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

    let payload;
    try {
      payload = jwt.verify(resetToken, authConfig.JWT_SECRET);
    } catch (err) {
      console.error("Reset token verification failed:", err.message);
      return res.status(400).json({ error: "Invalid or expired reset token. Please request a new OTP." });
    }

    if (!payload || payload.purpose !== "PASSWORD_RESET" || !payload.userId) return res.status(400).json({ error: "Invalid reset token payload" });

    const userId = payload.userId;

    const bcrypt = await import("bcrypt");
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({ where: { id: userId }, data: { password: hashedPassword } });

    await prisma.otpRecord.deleteMany({ where: { userId, type: { in: ["PHONE", "EMAIL"] } } });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, email: true } });

    res.json({ message: "Password reset successfully", user: { name: user.fullName, email: user.email } });
  } catch (error) { console.error("Reset password error:", error); res.status(500).json({ error: error.message }); }
};

export const resendResetOtp = async (req, res) => {
  try {
    const { phone, email } = req.body;
    if (!phone && !email) return res.status(400).json({ error: "Phone or email is required" });

    let user;
    let formattedPhone = null;
    let otpType = "PHONE";

    if (phone) {
      formattedPhone = phone.replace(/\D/g, "");
      if (formattedPhone.startsWith("0")) formattedPhone = "62" + formattedPhone.substring(1);
      if (!formattedPhone.startsWith("62")) formattedPhone = "62" + formattedPhone;

      user = await prisma.user.findFirst({ where: { OR: [{ phone: formattedPhone }, { phone: phone }, { phone: "0" + formattedPhone.substring(2) }] }, select: { id: true, email: true, fullName: true, phone: true } });
      otpType = "PHONE";
    } else {
      user = await prisma.user.findUnique({ where: { email } , select: { id: true, email: true, fullName: true, phone: true } });
      otpType = "EMAIL";
    }

    if (!user) return res.status(404).json({ error: "User not found" });

    const lastOtp = await prisma.otpRecord.findFirst({ where: { userId: user.id, type: otpType }, orderBy: { createdAt: "desc" } });
    if (lastOtp) { const timeSinceLastOtp = Date.now() - new Date(lastOtp.createdAt).getTime(); const cooldownTime = 60000; if (timeSinceLastOtp < cooldownTime) { const waitTime = Math.ceil((cooldownTime - timeSinceLastOtp) / 1000); return res.status(429).json({ error: `Please wait ${waitTime} seconds before requesting another OTP`, waitSeconds: waitTime }); } }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.otpRecord.deleteMany({ where: { userId: user.id, type: otpType } });
    await prisma.otpRecord.create({ data: { userId: user.id, code: otp, type: otpType, method: otpType === "PHONE" ? "WHATSAPP" : "EMAIL", expiresAt } });

    let whatsappSuccess2 = false;
    let emailSuccess2 = false;
    let whatsappError2 = null;
    let emailError2 = null;

    if (otpType === "PHONE") {
      try {
        const r = await sendWhatsAppOTP(formattedPhone, otp);
        whatsappSuccess2 = !!r.success;
        if (!whatsappSuccess2) whatsappError2 = r.error || JSON.stringify(r.data || r);
      } catch (err) {
        whatsappError2 = err.message;
      }

      if (user.email) {
        try {
          await sendOtpEmail(user.email, otp);
          emailSuccess2 = true;
        } catch (err) {
          emailError2 = err.message;
        }
      }
    } else {
      try {
        await sendOtpEmail(user.email, otp);
        emailSuccess2 = true;
      } catch (err) {
        emailError2 = err.message;
      }
      if (user.phone) {
        try {
          const r = await sendWhatsAppOTP(user.phone, otp);
          whatsappSuccess2 = !!r.success;
          if (!whatsappSuccess2) whatsappError2 = r.error || JSON.stringify(r.data || r);
        } catch (err) {
          whatsappError2 = err.message;
        }
      }
    }

    if (!whatsappSuccess2 && !emailSuccess2) {
      await prisma.otpRecord.deleteMany({ where: { userId: user.id, type: otpType } });
      return res.status(500).json({ error: "Failed to send OTP via WhatsApp and Email", details: { whatsappError: whatsappError2, emailError: emailError2 } });
    }

    const channels2 = [];
    if (whatsappSuccess2) channels2.push("whatsapp");
    if (emailSuccess2) channels2.push("email");

    res.json({ message: "OTP resent successfully", channels: channels2, phone: formattedPhone ? formattedPhone.substring(0, 5) + "****" + formattedPhone.substring(formattedPhone.length - 3) : null, email: user.email ? user.email.replace(/(.{2})(.*)(@.*)/, "$1***$3") : null, expiresIn: "15 minutes" });
  } catch (error) { console.error("Resend OTP error:", error); res.status(500).json({ error: error.message }); }
};
