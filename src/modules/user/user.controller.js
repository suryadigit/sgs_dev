import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../../shared/lib/prisma.js";
import { generateOtp, generateOtpExpiry, OTP_EXPIRY_MINUTES } from "../../shared/utils/otp.js";
import { sendOtpWhatsApp, sendOtpEmail } from "../../shared/lib/sendOtp.js";
import { validateReferralCode, createOtpRecord } from "../auth/auth.service.js";

const JWT_SECRET = process.env.JWT_SECRET;

const getWordPressService = async () => {
  const useMock = process.env.USE_WORDPRESS_MOCK === "true";
  if (useMock) {
    return await import("../wordpress/Mock/wordpressMock.service.js");
  }
  return await import("../wordpress/wordpress.service.js");
};

const syncToWordPressAfterSignup = async (user, password) => {
  try {
    const wpService = await getWordPressService();
    console.log(`\n🔄 Auto-syncing user ${user.email} to WordPress...`);
    
    const result = await wpService.syncUserToWordPress({
      fullName: user.fullName,
      email: user.email,
      password: password 
    });
    
    if (result.wpUserId || result.affiliate?.affiliate_id) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          wpUserId: result.wpUserId || null,
        }
      });
      
      const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId: user.id } });
      if (affiliate && result.affiliate?.affiliate_id) {
        await prisma.affiliateProfile.update({
          where: { id: affiliate.id },
          data: {
            wpUserId: result.wpUserId || null,
            wpAffiliateId: result.affiliate.affiliate_id || null,
            wpReferralLink: result.referralLink || null,
          }
        });
      }
    }
    
    console.log(`✅ WordPress sync completed for ${user.email}`);
    return result;
  } catch (error) {
    console.error(`⚠️ WordPress sync failed for ${user.email}:`, error.message);
    return null;
  }
};

// Helper: Verify WhatsApp verification token
const verifyWhatsAppToken = (verificationToken) => {
  try {
    if (!verificationToken) return null;
    const decoded = JSON.parse(Buffer.from(verificationToken, 'base64').toString());
    const expiresAt = new Date(decoded.expiresAt);
    if (expiresAt < new Date()) return null; 
    return decoded; // { phone, verifiedAt, expiresAt }
  } catch {
    return null;
  }
};

export const signup = async (req, res) => {
  try {
    const { email, password, fullName, phone, referralCode, whatsappVerificationToken } = req.body;
    if (!email || !password || !fullName) return res.status(400).json({ error: "Email, password, and fullName are required" });

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(400).json({ error: "Email already registered" });

    const waVerification = verifyWhatsAppToken(whatsappVerificationToken);
    const isWaVerified = !!waVerification;

    const referrer = referralCode ? await validateReferralCode(referralCode) : null;
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        fullName,
        phone: waVerification?.phone || phone,
        referralCodeUsed: referralCode || null,
        isEmailVerified: isWaVerified, 
        isPhoneVerified: isWaVerified,
      }
    });

    syncToWordPressAfterSignup(user, password).catch(err => {
      console.error("Background WordPress sync error:", err.message);
    });

    if (isWaVerified) {
      console.log(`✓ User ${email} created with WA verification - email auto-verified`);
      return res.status(201).json({ 
        message: "Registrasi berhasil! Email dan WhatsApp sudah terverifikasi.", 
        userId: user.id, 
        isVerified: true,
        nextStep: "login",
        storedReferralCode: referralCode || null 
      });
    }

    const otp = generateOtp();
    const otpExpiry = generateOtpExpiry(OTP_EXPIRY_MINUTES);
    await createOtpRecord(user.id, otp, otpExpiry, "EMAIL");

    res.status(201).json({ 
      message: "User created. Verify email with OTP.", 
      userId: user.id, 
      otp: otp, 
      expiresIn: "5 minutes", 
      nextStep: "verify-email-otp", 
      storedReferralCode: referralCode || null 
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const verifyEmailOtp = async (req, res) => {
  try {
    const { userId, code } = req.body;
    if (!userId || !code) return res.status(400).json({ error: "userId and code are required" });

    const otpRecord = await prisma.otpRecord.findFirst({ where: { userId, code, type: "EMAIL", isUsed: false, expiresAt: { gt: new Date() } } });
    if (!otpRecord) return res.status(400).json({ error: "Invalid or expired OTP" });

    await Promise.all([
      prisma.otpRecord.update({ where: { id: otpRecord.id }, data: { isUsed: true } }),
      prisma.user.update({ where: { id: userId }, data: { isEmailVerified: true } })
    ]);

    res.json({ message: "Email verified successfully", nextStep: "Silakan login" });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const checkOtpStatus = async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { isEmailVerified: true, email: true } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const otpRecords = await prisma.otpRecord.findMany({ where: { userId, type: "EMAIL" }, orderBy: { createdAt: "desc" }, take: 5 });
    const validOtp = otpRecords.find((otp) => !otp.isUsed && otp.expiresAt > new Date());

    res.json({ userId, email: user.email, isEmailVerified: user.isEmailVerified, hasValidOtp: !!validOtp, validOtpExpiresAt: validOtp?.expiresAt || null, recentOtpCount: otpRecords.length });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const requestEmailOtp = async (req, res) => {
  try {
    const { userId, method = "EMAIL" } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    if (!["EMAIL", "WHATSAPP"].includes(method)) return res.status(400).json({ error: "method must be EMAIL or WHATSAPP" });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const activeOtp = await prisma.otpRecord.findFirst({ where: { userId, type: "EMAIL", isUsed: false, expiresAt: { gt: new Date() } } });
    if (activeOtp) { const remainingTime = Math.ceil((activeOtp.expiresAt - new Date()) / 1000 / 60); return res.status(429).json({ error: "OTP still valid, please wait before requesting a new one", remainingMinutes: remainingTime, expiresAt: activeOtp.expiresAt, message: `Your OTP is still valid for ${remainingTime} more minute(s). Please try again later.` }); }

    if (method === "WHATSAPP" && !user.phone) return res.status(400).json({ error: "Phone number required for WhatsApp OTP" });

    const otp = generateOtp();
    const expiresAt = generateOtpExpiry(OTP_EXPIRY_MINUTES);
    await prisma.otpRecord.create({ data: { userId, code: otp, type: "EMAIL", method: method, expiresAt } });

    res.json({ message: `OTP created successfully via ${method}`, target: method === "EMAIL" ? user.email : user.phone, method: method, otp: otp, expiresIn: "5 minutes", note: "OTP sending disabled. Use OTP above to verify." });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const resendEmailOtp = async (req, res) => {
  try {
    const { userId, method = "EMAIL" } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    if (!["EMAIL", "WHATSAPP"].includes(method)) return res.status(400).json({ error: "method must be EMAIL or WHATSAPP" });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const activeOtp = await prisma.otpRecord.findFirst({ where: { userId, type: "EMAIL", isUsed: false, expiresAt: { gt: new Date() } } });
    if (activeOtp) { const remainingTime = Math.ceil((activeOtp.expiresAt - new Date()) / 1000 / 60); return res.status(429).json({ error: "OTP still valid, please wait before requesting a new one", remainingMinutes: remainingTime, expiresAt: activeOtp.expiresAt, message: `Your OTP is still valid for ${remainingTime} more minute(s). Please try again later.` }); }

    if (method === "WHATSAPP" && !user.phone) return res.status(400).json({ error: "Phone number required for WhatsApp OTP" });

    const otp = generateOtp();
    const expiresAt = generateOtpExpiry(OTP_EXPIRY_MINUTES);
    await prisma.otpRecord.create({ data: { userId, code: otp, type: "EMAIL", method: method, expiresAt } });

    res.json({ message: `OTP resent successfully via ${method}`, target: method === "EMAIL" ? user.email : user.phone, method: method, otp: otp, expiresIn: "5 minutes", note: "OTP sending disabled. Use OTP above to verify." });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const requestPhoneOtp = async (req, res) => {
  try {
    const { userId, phone, method = "EMAIL" } = req.body;
    if (!userId || !phone) return res.status(400).json({ error: "userId and phone are required" });
    if (!["EMAIL", "WHATSAPP"].includes(method)) return res.status(400).json({ error: "method must be EMAIL or WHATSAPP" });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const activeOtp = await prisma.otpRecord.findFirst({ where: { userId, type: "PHONE", isUsed: false, expiresAt: { gt: new Date() } } });
    if (activeOtp) { const remainingTime = Math.ceil((activeOtp.expiresAt - new Date()) / 1000 / 60); return res.status(429).json({ error: "OTP still valid, please wait before requesting a new one", remainingMinutes: remainingTime, expiresAt: activeOtp.expiresAt, message: `Your OTP is still valid for ${remainingTime} more minute(s). Please try again later.` }); }

    const otp = generateOtp();
    const expiresAt = generateOtpExpiry(OTP_EXPIRY_MINUTES);
    await prisma.otpRecord.create({ data: { userId, code: otp, type: "PHONE", method: method, expiresAt } });

    let sentMessage = "";
    try { if (method === "EMAIL") { await sendOtpEmail(user.email, otp); sentMessage = "OTP sent to email"; } else if (method === "WHATSAPP") { await sendOtpWhatsApp(phone, otp); sentMessage = "OTP sent via WhatsApp"; } } catch (err) { sentMessage = ""; }

    await prisma.user.update({ where: { id: userId }, data: { phone } });

    res.json({ message: sentMessage || `OTP created for ${method}`, phone, method, otp: otp, expiresIn: "5 minutes", note: "OTP sending disabled. Use OTP above to verify." });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const verifyPhoneOtp = async (req, res) => {
  try {
    const { userId, code } = req.body;
    if (!userId || !code) return res.status(400).json({ error: "userId and code are required" });

    const otpRecord = await prisma.otpRecord.findFirst({ where: { userId, code, type: "PHONE", isUsed: false, expiresAt: { gt: new Date() } } });
    if (!otpRecord) return res.status(400).json({ error: "Invalid or expired OTP" });

    await Promise.all([
      prisma.otpRecord.update({ where: { id: otpRecord.id }, data: { isUsed: true } }),
      prisma.user.update({ where: { id: userId }, data: { isPhoneVerified: true } })
    ]);

    res.json({ message: "Phone verified successfully" });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

    const user = await prisma.user.findUnique({ where: { email }, include: { affiliateProfile: { select: { id: true, status: true, referralCode: true } } } });
    if (!user) return res.status(401).json({ error: "Email tidak terdaftar", code: "EMAIL_NOT_FOUND", message: "Email yang Anda masukkan tidak terdaftar dalam sistem" });

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(401).json({ error: "Password salah", code: "WRONG_PASSWORD", message: "Password yang Anda masukkan salah" });

    if (!user.whatsappVerified) return res.status(403).json({ error: "WhatsApp belum diverifikasi", code: "WHATSAPP_NOT_VERIFIED", nextStep: "Verifikasi OTP WhatsApp terlebih dahulu", redirectTo: "/verify-otp" });

    const isActivated = user.affiliateProfile?.status === "ACTIVE";
    const token = jwt.sign({ userId: user.id, email: user.email, isEmailVerified: user.isEmailVerified, isPhoneVerified: user.isPhoneVerified, isActivated: isActivated }, JWT_SECRET, { expiresIn: "24h" });

    if (!isActivated) return res.json({ message: "Login successful - Aktivasi diperlukan", token, user: { id: user.id, email: user.email, fullName: user.fullName, phone: user.phone, isEmailVerified: user.isEmailVerified, isPhoneVerified: user.isPhoneVerified, whatsappVerified: user.whatsappVerified, isActivated: false }, requiresActivation: true, redirectTo: "/payment", nextStep: "Selesaikan pembayaran Rp 75.000 untuk aktivasi akun" });

    res.json({ message: "Login successful", token, user: { id: user.id, email: user.email, fullName: user.fullName, phone: user.phone, isEmailVerified: user.isEmailVerified, isPhoneVerified: user.isPhoneVerified, whatsappVerified: user.whatsappVerified, isActivated: true, referralCode: user.affiliateProfile?.referralCode || null }, requiresActivation: false, redirectTo: "/dashboard-affiliate" });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getUserProfile = async (req, res) => {
  try {
    const userId = req.userId;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, fullName: true, phone: true, isEmailVerified: true, isPhoneVerified: true, createdAt: true, updatedAt: true } });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const updateUserProfile = async (req, res) => {
  try {
    const userId = req.userId;
    const { fullName, phone } = req.body;
    const user = await prisma.user.update({ where: { id: userId }, data: { ...(fullName && { fullName }), ...(phone && { phone }) }, select: { id: true, email: true, fullName: true, phone: true, isEmailVerified: true, isPhoneVerified: true } });
    res.json({ message: "Profile updated successfully", user });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

