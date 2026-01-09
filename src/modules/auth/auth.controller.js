import prisma from "../../shared/lib/prisma.js";
import { sendOtpWhatsApp, sendOtpEmail } from "../../shared/lib/sendOtp.js";
import { verifyRecaptcha } from "../../shared/lib/recaptcha.js";
import { validateReferralCode, createUserWithReferral, createOtpRecord, handleExpiredInvoice, isInvoiceExpired, verifyPassword, generateJwtToken, generateUserResponse, formatPaymentResponse } from "./auth.service.js";
import { getMenusForRole } from "../../config/menuConfig.js";
import { ROLE_PERMISSIONS } from "../../../ROLE_PERMISSIONS_CONFIG.js";

const getWordPressService = async () => {
  const useMock = process.env.USE_WORDPRESS_MOCK === "true";
  if (useMock) {
    return await import("../wordpress/Mock/wordpressMock.service.js");
  }
  return await import("../wordpress/wordpress.service.js");
};

const getReferrerLink = async (userId) => {
  try {
    const user = await prisma.user.findUnique({ 
      where: { id: userId },
      select: { referralCodeUsed: true }
    });
    
    if (!user?.referralCodeUsed) return null;
    
    const referrer = await prisma.affiliateProfile.findUnique({
      where: { code: user.referralCodeUsed },
      include: { user: { select: { fullName: true } } }
    });
    
    if (!referrer) return null;
    
    const shopBaseUrl = "https://jagobikinaplikasi.com/woo/shop/";
    
    let slicewpId = referrer.wpAffiliateId;
    
    if (!slicewpId && referrer.code) {
      // Extract ID dari kode affiliate (AFF008BUD -> 008 -> 8)
      const match = referrer.code.match(/^AFF(\d{3})/);
      if (match) {
        slicewpId = parseInt(match[1], 10); // "008" -> 8
      }
    }
    
    let shopUrl = shopBaseUrl;
    if (slicewpId) {
      shopUrl = `${shopBaseUrl}?aff=${slicewpId}`;
    }
    
    return {
      referrerName: referrer.user?.fullName || 'Referrer',
      referrerCode: referrer.code,
      slicewpId: slicewpId,
      shopUrl: shopUrl
    };
  } catch (error) {
    console.error("Error getting referrer link:", error.message);
    return null;
  }
};

const validateWhatsAppToken = (token) => {
  if (!token) return { isValid: false, error: "Token verifikasi WhatsApp wajib diisi" };
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64").toString());
    const expiresAt = new Date(decoded.expiresAt);
    if (expiresAt < new Date()) return { isValid: false, error: "Token verifikasi WhatsApp sudah kedaluwarsa. Silakan verifikasi ulang." };
    return { isValid: true, phone: decoded.phone };
  } catch (error) { return { isValid: false, error: "Token verifikasi WhatsApp tidak valid" }; }
};

export const signup = async (req, res) => {
  try {
    const { email, password, fullName, phone, referralCode, recaptchaToken, whatsappVerificationToken, otpChannel = "whatsapp" } = req.body;

    const recaptchaResult = await verifyRecaptcha(recaptchaToken);
    if (!recaptchaResult.success) return res.status(400).json({ error: "Verifikasi reCAPTCHA gagal", message: recaptchaResult.error || "Silakan coba lagi", action: "Refresh halaman dan coba lagi" });

    let verifiedPhone = phone;
    let isWhatsAppVerified = false;
    if (whatsappVerificationToken) {
      const waValidation = validateWhatsAppToken(whatsappVerificationToken);
      if (!waValidation.isValid) return res.status(400).json({ error: "Verifikasi WhatsApp gagal", message: waValidation.error, action: "Silakan verifikasi nomor WhatsApp terlebih dahulu" });
      verifiedPhone = waValidation.phone;
      isWhatsAppVerified = true;
    }

    if (!email || !password || !referralCode) return res.status(400).json({ error: "Email, password, and referral code are required", required: ["email", "password", "referralCode"] });

    // Validate referral code first
    const referrer = await validateReferralCode(referralCode);
    
    // Create user + affiliate profile + payment invoice
    const result = await createUserWithReferral({ email, password, fullName, phone: verifiedPhone, referralCode });
    const { user, affiliateProfile, payment } = result;

    // Sync to WordPress as Subscriber (background)
    try {
      const wpService = await getWordPressService();
      wpService.syncUserAsSubscriber(user.id, user.email, user.fullName || '')
        .then(wpResult => console.log(`[Signup] WP sync result for ${user.email}:`, wpResult?.status || 'done'))
        .catch(wpErr => console.error(`[Signup] WP sync failed for ${user.email}:`, wpErr.message));
    } catch (wpError) {
      console.error("[Signup] WordPress sync init failed:", wpError.message);
    }

    // Response with payment info for frontend to redirect
    res.status(201).json({ 
      message: "Signup berhasil! Silakan selesaikan pembayaran aktivasi.",
      user: { 
        id: user.id, 
        email: user.email, 
        fullName: user.fullName, 
        phone: verifiedPhone 
      }, 
      referral: { 
        code: referralCode, 
        referrerName: referrer.user.fullName, 
        message: "Kode referral tervalidasi" 
      }, 
      affiliate: {
        id: affiliateProfile.id,
        status: affiliateProfile.status
      },
      payment: {
        id: payment.id,
        amount: payment.amount,
        invoiceUrl: payment.invoiceUrl,
        expiredAt: payment.expiredAt,
        status: payment.status
      },
      whatsappVerified: isWhatsAppVerified,
      nextStep: "Selesaikan pembayaran 75.000 IDR untuk mengaktifkan akun",
      redirectTo: "payment" 
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const login = async (req, res) => {
  try {
    console.log(`[auth.login] handler hit - IP=${req.ip || req.headers['x-forwarded-for'] || 'unknown'} email=${req.body?.email || 'n/a'}`);
    const { email, password, recaptchaToken, otpChannel = "whatsapp" } = req.body;

    const recaptchaResult = await verifyRecaptcha(recaptchaToken);
    if (!recaptchaResult.success) return res.status(400).json({ error: "Verifikasi reCAPTCHA gagal", message: recaptchaResult.error || "Silakan coba lagi", action: "Refresh halaman dan coba lagi" });

    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: "Invalid email or password" });

    const isPasswordValid = await verifyPassword(password, user.password);
    if (!isPasswordValid) return res.status(401).json({ error: "Invalid email or password" });

    const useEmailOtp = otpChannel === "email" || !user.phone;
    if (!user.phone && otpChannel !== "email") return res.status(400).json({ error: "Nomor telepon tidak ditemukan", message: "Gunakan opsi OTP via Email atau perbarui profil dengan nomor telepon", action: "Kirim ulang dengan otpChannel: 'email'", suggestion: "Tambahkan parameter otpChannel: 'email' dalam request" });

    let otpMethod = "whatsapp";
    let otpDestination = user.phone;

    try {
      const otp = await createOtpRecord(user.id, useEmailOtp ? "EMAIL" : "PHONE");
      if (useEmailOtp) { try { await sendOtpEmail(user.email, otp); otpMethod = "email"; otpDestination = user.email; } catch (emailError) { throw emailError; } }
      else { try { await sendOtpWhatsApp(user.phone, otp); otpMethod = "whatsapp"; } catch (whatsappError) { try { await sendOtpEmail(user.email, otp); otpMethod = "email"; otpDestination = user.email; } catch (emailError) {} } }
    } catch (error) { return res.status(500).json({ error: "Gagal menghasilkan OTP", message: error.message, action: "Silakan coba lagi dalam beberapa saat" }); }

    const maskedDestination = otpMethod === "email" ? user.email.replace(/(.{2})(.*)(@.*)/, "$1***$3") : user.phone.replace(/(\d{2})(\d{6})(\d{2,4})/, "$1****$3");

    res.status(200).json({
      success: true,
      message: otpMethod === "email" ? "Kredensial valid - Kode OTP telah dikirim ke Email Anda" : "Kredensial valid - Kode OTP telah dikirim ke WhatsApp Anda",
      nextStep: "verify_otp",
      user: {
        id: user.id,
        email: user.email,
        maskedEmail: user.email.replace(/(.{2})(.*)(@.*)/, "$1***$3"),
        maskedPhone: user.phone ? user.phone.replace(/(\d{2})(\d{6})(\d{2,4})/, "$1****$3") : null
      },
      otp: {
        method: otpMethod,
        destination: maskedDestination,
        expiresInMinutes: 5,
        endpoint: "/api/users/verify-login-otp"
      },
      guidance: {
        instruction: otpMethod === "email" ? "Cek inbox Email Anda dan masukkan kode OTP" : "Cek pesan WhatsApp Anda dan masukkan kode OTP",
        note: "Kirim user.id dan kode OTP ke endpoint yang tertera di 'otp.endpoint'"
      }
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const verifyLoginOtp = async (req, res) => {
  try {
    const { userId, code } = req.body;
    if (!userId || !code) return res.status(400).json({ error: "userId and code are required", example: { userId: "user-id-from-login", code: "123456" } });

    const otpRecord = await prisma.otpRecord.findFirst({ 
      where: { userId, code, type: { in: ["PHONE", "EMAIL"] }, isUsed: false, expiresAt: { gt: new Date() } } 
    });
    if (!otpRecord) return res.status(400).json({ error: "Kode OTP tidak valid atau sudah expired", message: "Kode OTP yang Anda masukkan salah atau sudah kadaluarsa", suggestion: "Periksa kembali kode OTP yang diterima atau minta ulang", action: "Minta OTP baru jika sudah lebih dari 5 menit" });

    await prisma.otpRecord.update({ where: { id: otpRecord.id }, data: { isUsed: true } });

    const user = await prisma.user.findUnique({ where: { id: userId }, include: { affiliateProfile: true, payment: true } });
    if (!user) return res.status(404).json({ error: "User tidak ditemukan", message: "UserId yang diberikan tidak valid atau user sudah dihapus", userId, action: "Lakukan login ulang" });

    const affiliateProfile = user.affiliateProfile;

    if (!affiliateProfile) {
      try {
        const token = generateJwtToken(user.id, user);
        const userResponse = await generateUserResponse(user, null);
        const role = user.role || "MEMBER";
        const { menus, adminMenus } = getMenusForRole(role);
        const permissions = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.MEMBER || [];
        return res.status(200).json({ message: "OTP verified successfully", token, user: userResponse, menus, ...(adminMenus && { adminMenus }), permissions });
      } catch (error) { 
        console.error("Error generating token (no affiliate):", error);
        return res.status(500).json({ error: "Gagal membuat token", message: error.message, action: "Silakan coba login ulang" }); 
      }
    }

    if (affiliateProfile?.status === "PENDING") {
      let payment = affiliateProfile.payment;
      if (!payment || isInvoiceExpired(payment.expiredAt)) { try { payment = await handleExpiredInvoice(user.id, affiliateProfile, user); } catch (error) { return res.status(500).json({ error: "Gagal membuat invoice pembayaran", message: error.message, action: "Silakan coba lagi" }); } }
      return res.status(401).json({ error: "Akun Anda belum aktif", message: "Selesaikan pembayaran aktivasi 75.000 IDR untuk login", affiliate: { status: "PENDING", code: affiliateProfile.code }, payment: formatPaymentResponse(payment), action: "Selesaikan pembayaran di link invoice untuk mengaktifkan akun", nextStep: "Setelah bayar, kembali ke halaman login" });
    }

    if (affiliateProfile?.status === "SUSPENDED" || affiliateProfile?.status === "INACTIVE") return res.status(401).json({ error: "Akun Anda tidak dapat diakses", message: `Status akun: ${affiliateProfile.status}`, action: "Hubungi support untuk bantuan lebih lanjut" });

    // === AFFILIATE ACTIVE: Cek pembelian kelas 500K ===
    try {
      const token = generateJwtToken(user.id, user);
      const userResponse = await generateUserResponse(user, affiliateProfile);
      const role = user.role || "MEMBER";
      const { menus, adminMenus } = getMenusForRole(role);
      const permissions = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.MEMBER || [];

      let hasPurchased500K = affiliateProfile.hasPurchasedClass || false;
      let isAffiliateInWP = affiliateProfile.wpAffiliateId ? true : false;
      let referrerLink = null;

      // Jika belum tercatat beli kelas, cek ke WordPress
      if (!hasPurchased500K) {
        try {
          const wpService = await getWordPressService();
          
          // Cek pembelian di WooCommerce
          const purchaseResult = await wpService.checkUserPurchase(user.email);
          hasPurchased500K = purchaseResult?.hasPurchased || false;
          
          console.log(`[Login] User ${user.email} - Has purchased 500K class: ${hasPurchased500K}`);
          
          if (hasPurchased500K) {
            // Update flag di database SGS
            await prisma.affiliateProfile.update({
              where: { id: affiliateProfile.id },
              data: { hasPurchasedClass: true }
            });
            
            // User sudah beli kelas 500K tapi belum jadi affiliate di WP
            if (!isAffiliateInWP) {
              console.log(`[Login] Upgrading ${user.email} to affiliate...`);
              
              try {
                // upgradeToAffiliate(sgsUserId, wpUserId, email, fullName)
                const upgradeResult = await wpService.upgradeToAffiliate(
                  user.id, 
                  affiliateProfile.wpUserId, 
                  user.email, 
                  user.fullName || ''
                );
                
                if (upgradeResult?.wpAffiliateId) {
                  isAffiliateInWP = true;
                  const updatedProfile = await prisma.affiliateProfile.findUnique({ where: { id: affiliateProfile.id } });
                  if (updatedProfile) {
                    affiliateProfile.wpAffiliateId = updatedProfile.wpAffiliateId;
                    affiliateProfile.wpReferralLink = updatedProfile.wpReferralLink;
                    affiliateProfile.code = updatedProfile.code;
                  }
                  console.log(`[Login] Successfully upgraded ${user.email} to affiliate in WordPress`);
                }
              } catch (upgradeError) {
                console.error(`[Login] Failed to upgrade to affiliate:`, upgradeError.message);
              }
            }
          } else {
            referrerLink = await getReferrerLink(user.id);
            console.log(`[Login] User ${user.email} hasn't purchased 500K class, referrer link: ${referrerLink}`);
          }
        } catch (wpError) {
          console.error(`[Login] WordPress check failed:`, wpError.message);
        }
      }

      // Response dengan pengecekan kelas
      const loginSuccess = hasPurchased500K;
      return res.status(200).json({ 
        message: hasPurchased500K 
          ? "Login berhasil! Selamat datang di Dashboard SGS" 
          : "Login berhasil, tapi Anda perlu membeli kelas terlebih dahulu",
        loginSuccess,
        token, 
        user: {
          ...userResponse,
          hasPurchased500K,
          isAffiliateInWordPress: isAffiliateInWP,
          wpReferralLink: affiliateProfile.wpReferralLink || null
        }, 
        menus, 
        ...(adminMenus && { adminMenus }), 
        permissions,
        ...(!hasPurchased500K && {
          redirectTo: "purchase",
          purchaseRequired: true,
          purchaseMessage: "Silakan beli kelas 500K untuk menjadi affiliate aktif",
          referrerLink: referrerLink ? {
            referrerName: referrerLink.referrerName,
            referrerCode: referrerLink.referrerCode,
            shopUrl: referrerLink.shopUrl,
            message: `Beli kelas melalui link ${referrerLink.referrerName} agar komisi tercatat`
          } : null,
          instruction: "Klik link untuk membeli kelas. Setelah beli, login kembali untuk menjadi affiliate."
        })
      });
    } catch (error) { 
      console.error("Error generating token (with affiliate):", error);
      return res.status(500).json({ error: "Gagal membuat token", message: error.message, action: "Silakan coba login ulang" }); 
    }
  } catch (error) { res.status(500).json({ error: "Gagal memverifikasi OTP", message: error.message }); }
};

export const logout = async (req, res) => {
  try { res.status(200).json({ message: "Logout successful", instruction: "Delete token from localStorage pada client side" }); }
  catch (error) { res.status(500).json({ error: error.message }); }
};

export const resendLoginOtp = async (req, res) => {
  try {
    const { userId, otpChannel = "whatsapp" } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required", example: { userId: "user-id-from-login", otpChannel: "whatsapp" } });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const recentOtp = await prisma.otpRecord.findFirst({ where: { userId, type: otpChannel === "email" ? "EMAIL" : "PHONE", createdAt: { gt: new Date(Date.now() - 60 * 1000) } }, orderBy: { createdAt: "desc" } });
    if (recentOtp) { const waitTime = Math.ceil((60 * 1000 - (Date.now() - recentOtp.createdAt.getTime())) / 1000); return res.status(429).json({ error: "Tunggu sebentar sebelum kirim ulang OTP", message: `Silakan tunggu ${waitTime} detik lagi`, waitSeconds: waitTime }); }

    const useEmailOtp = otpChannel === "email" || !user.phone;
    const otp = await createOtpRecord(user.id, useEmailOtp ? "EMAIL" : "PHONE");
    let otpMethod = "whatsapp";

    if (useEmailOtp) { try { await sendOtpEmail(user.email, otp); otpMethod = "email"; } catch (emailError) { return res.status(500).json({ error: "Gagal mengirim OTP via Email", message: emailError.message }); } }
    else { try { await sendOtpWhatsApp(user.phone, otp); otpMethod = "whatsapp"; } catch (waError) { try { await sendOtpEmail(user.email, otp); otpMethod = "email"; } catch (emailError) { return res.status(500).json({ error: "Gagal mengirim OTP", message: "WhatsApp dan Email gagal, silakan coba lagi" }); } } }

    const maskedDestination = otpMethod === "email" ? user.email.replace(/(.{2})(.*)(@.*)/, "$1***$3") : user.phone.replace(/(\d{2})(\d{6})(\d{2,4})/, "$1****$3");

    res.status(200).json({ message: otpMethod === "email" ? "OTP telah dikirim ulang ke Email Anda" : "OTP telah dikirim ulang ke WhatsApp Anda", otpMethod, maskedDestination, expiresIn: "5 menit", instruction: otpMethod === "email" ? "Cek inbox Email Anda" : "Cek pesan WhatsApp Anda" });
  } catch (error) { res.status(500).json({ error: error.message }); }
};
