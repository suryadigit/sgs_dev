import prisma from "../../shared/lib/prisma.js";
import { validateWhatsAppNumber, sendOtpWhatsApp } from "../../shared/lib/sendOtp.js";
import { generateOtp, generateOtpExpiry } from "../../shared/lib/generateOtp.js";

const WA_VERIFICATION_EXPIRY_MINUTES = 5;
const WA_RESEND_COOLDOWN_SECONDS = 30;

const formatPhoneNumber = (phone) => {
  let formattedPhone = phone.replace(/\D/g, "");
  if (formattedPhone.startsWith("0")) formattedPhone = "62" + formattedPhone.slice(1);
  else if (!formattedPhone.startsWith("62")) formattedPhone = "62" + formattedPhone;
  return formattedPhone;
};

export const validateWhatsApp = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: "Nomor WhatsApp wajib diisi" });

    const formattedPhone = formatPhoneNumber(phone);
    if (formattedPhone.length < 10) return res.status(400).json({ success: false, error: "Format nomor WhatsApp tidak valid" });

    const existingUser = await prisma.user.findFirst({ where: { phone: { contains: formattedPhone.slice(-10) } } });
    if (existingUser) return res.status(400).json({ success: false, error: "Nomor WhatsApp sudah terdaftar", message: "Silakan gunakan nomor WhatsApp lain atau login jika sudah memiliki akun" });

    const result = await validateWhatsAppNumber(phone);
    if (!result.isRegistered) return res.status(400).json({ success: false, error: "Nomor tidak terdaftar di WhatsApp", message: "Pastikan nomor yang Anda masukkan sudah terdaftar di WhatsApp" });

    res.json({ success: true, message: "Nomor WhatsApp valid", phone: result.phone, nextStep: "Klik 'Kirim Kode' untuk menerima kode verifikasi" });
  } catch (error) {
    if (error.message.includes("device disconnected")) return res.status(503).json({ success: false, error: "Layanan WhatsApp sedang tidak tersedia", message: "Silakan coba lagi dalam beberapa saat" });
    res.status(500).json({ success: false, error: "Gagal memvalidasi nomor WhatsApp", message: error.message });
  }
};

export const sendWhatsAppVerificationCode = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: "Nomor WhatsApp wajib diisi" });

    const formattedPhone = formatPhoneNumber(phone);
    const cooldownTime = new Date(Date.now() - WA_RESEND_COOLDOWN_SECONDS * 1000);
    const existingCode = await prisma.whatsAppVerification.findFirst({ where: { phone: formattedPhone, isUsed: false, createdAt: { gt: cooldownTime } } });

    if (existingCode) {
      const elapsedSeconds = Math.floor((new Date() - existingCode.createdAt) / 1000);
      const remainingSeconds = WA_RESEND_COOLDOWN_SECONDS - elapsedSeconds;
      return res.status(429).json({ success: false, error: "Kode verifikasi baru saja dikirim", message: `Silakan tunggu ${remainingSeconds} detik sebelum meminta kode baru`, remainingSeconds, canResendAt: new Date(existingCode.createdAt.getTime() + WA_RESEND_COOLDOWN_SECONDS * 1000) });
    }

    const code = generateOtp();
    const expiresAt = generateOtpExpiry(WA_VERIFICATION_EXPIRY_MINUTES);
    await prisma.whatsAppVerification.create({ data: { phone: formattedPhone, code, expiresAt } });

    try { await sendOtpWhatsApp(phone, code); } catch (whatsappError) { return res.json({ success: true, message: "Kode verifikasi telah dikirim (mode development)", phone: formattedPhone, code, expiresIn: `${WA_VERIFICATION_EXPIRY_MINUTES} menit`, note: "WhatsApp service unavailable, using development mode" }); }

    res.json({ success: true, message: "Kode verifikasi telah dikirim ke WhatsApp Anda", phone: formattedPhone, expiresIn: `${WA_VERIFICATION_EXPIRY_MINUTES} menit`, code });
  } catch (error) { res.status(500).json({ success: false, error: "Gagal mengirim kode verifikasi", message: error.message }); }
};

export const verifyWhatsAppCode = async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ success: false, error: "Nomor WhatsApp dan kode verifikasi wajib diisi" });

    const formattedPhone = formatPhoneNumber(phone);
    const verificationRecord = await prisma.whatsAppVerification.findFirst({ where: { phone: formattedPhone, code, isUsed: false, expiresAt: { gt: new Date() } } });
    if (!verificationRecord) return res.status(400).json({ success: false, error: "Kode verifikasi tidak valid atau sudah kedaluwarsa", message: "Silakan minta kode baru" });

    await prisma.whatsAppVerification.update({ where: { id: verificationRecord.id }, data: { isUsed: true, verifiedAt: new Date() } });

    const verificationToken = Buffer.from(JSON.stringify({ phone: formattedPhone, verifiedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() })).toString('base64');

    res.json({ success: true, message: "Nomor WhatsApp berhasil diverifikasi", phone: formattedPhone, verificationToken, expiresIn: "30 menit", nextStep: "Lanjutkan ke formulir registrasi" });
  } catch (error) { res.status(500).json({ success: false, error: "Gagal memverifikasi kode", message: error.message }); }
};

export const checkWhatsAppVerification = async (req, res) => {
  try {
    const { verificationToken } = req.body;
    if (!verificationToken) return res.status(400).json({ success: false, isValid: false, error: "Token verifikasi wajib diisi" });

    try {
      const decoded = JSON.parse(Buffer.from(verificationToken, 'base64').toString());
      const expiresAt = new Date(decoded.expiresAt);
      if (expiresAt < new Date()) return res.status(400).json({ success: false, isValid: false, error: "Token verifikasi sudah kedaluwarsa", message: "Silakan verifikasi ulang nomor WhatsApp Anda" });
      res.json({ success: true, isValid: true, phone: decoded.phone, verifiedAt: decoded.verifiedAt, expiresAt: decoded.expiresAt });
    } catch (decodeError) { return res.status(400).json({ success: false, isValid: false, error: "Token verifikasi tidak valid" }); }
  } catch (error) { res.status(500).json({ success: false, error: "Gagal memeriksa verifikasi", message: error.message }); }
};
