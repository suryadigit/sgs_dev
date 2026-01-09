import prisma from "../../shared/lib/prisma.js";
import { sendOtpEmail, sendOtpWhatsApp } from "../../shared/lib/sendOtp.js";
import { generateOtp, generateOtpExpiry } from "../../shared/lib/generateOtp.js";
import axios from "axios";
import paymentConfig from "../../config/payment.config.js";

const OTP_EXPIRY_MINUTES = 5;
const { XENDIT_API_KEY, XENDIT_API_URL, ACTIVATION_AMOUNT, INVOICE_DURATION_SECONDS } = paymentConfig;

const createXenditInvoice = async (userId, _affiliateId, email) => {
  const externalId = `ACTIVATION-${userId}-${Date.now()}`;
  const expirationTime = new Date(Date.now() + INVOICE_DURATION_SECONDS * 1000);
  
  const xenditPayload = {
    external_id: externalId,
    amount: ACTIVATION_AMOUNT,
    payer_email: email,
    description: `Biaya Aktivasi Akun SGS`,
    invoice_duration: INVOICE_DURATION_SECONDS,
    currency: "IDR",
    ...(paymentConfig.SUCCESS_REDIRECT_URL ? { success_redirect_url: paymentConfig.SUCCESS_REDIRECT_URL } : {}),
    ...(paymentConfig.FAILURE_REDIRECT_URL ? { failure_redirect_url: paymentConfig.FAILURE_REDIRECT_URL } : {}),
  };

  const xenditResponse = await axios.post(XENDIT_API_URL, xenditPayload, {
    headers: {
      Authorization: `Basic ${Buffer.from(XENDIT_API_KEY + ":").toString("base64")}`,
      "Content-Type": "application/json",
    },
  });

  return { xenditResponse, externalId };
};

export const verifyEmailOtp = async (req, res) => {
  try {
    const { userId, code } = req.body;

    if (!userId || !code) {
      return res.status(400).json({ 
        error: "userId and code are required",
        required: ["userId", "code"],
        example: {
          userId: "user-uuid-from-signup",
          code: "123456"
        }
      });
    }

    const otpRecord = await prisma.otpRecord.findFirst({
      where: {
        userId,
        code,
        type: "EMAIL",
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!otpRecord) {
      return res.status(400).json({ 
        error: "OTP tidak valid atau sudah expired",
        message: "Kode OTP yang Anda masukkan salah atau sudah kadaluarsa",
        suggestion: "Periksa kembali kode OTP yang diterima atau minta ulang",
        code: code,
        action: "Minta OTP baru jika sudah lebih dari 5 menit"
      });
    }

    await Promise.all([
      prisma.otpRecord.update({
        where: { id: otpRecord.id },
        data: { isUsed: true },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { isEmailVerified: true },
      }),
    ]);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { 
        affiliateProfile: true,
        payment: true,
      },
    });

    let affiliateProfile = user.affiliateProfile;
    let payment = user.payment;
    const referralCode = user.referralCodeUsed;

    if (!affiliateProfile && referralCode) {
      try {
        const referrer = await prisma.affiliateProfile.findUnique({
          where: { code: referralCode },
          include: { user: { select: { fullName: true } } },
        });

        if (!referrer) {
          return res.status(400).json({
            error: `Kode referral "${referralCode}" TIDAK DITEMUKAN`,
            message: "Pastikan kode referral yang Anda gunakan benar dan valid",
            suggestion: "Periksa kembali kode yang diberikan saat signup",
            code: referralCode,
            action: "Hubungi pemberi kode referral atau gunakan kode yang benar"
          });
        }

        if (referrer.status !== "ACTIVE") {
          return res.status(400).json({
            error: `Pemberi kode (${referrer.user.fullName}) belum aktif`,
            message: `Status pemberi kode: ${referrer.status} (harus ACTIVE)`,
            suggestion: "Gunakan kode dari affiliate yang sudah membayar aktivasi",
            referrerName: referrer.user.fullName,
            referrerStatus: referrer.status,
            action: "Minta kode dari affiliate yang sudah aktif atau gunakan kode lain"
          });
        }

        affiliateProfile = await prisma.affiliateProfile.create({
          data: {
            userId: user.id,
            code: null,
            referredById: referrer.id,
            status: "PENDING",
            registeredAt: new Date(),
          },
        });
      } catch (affiliateError) {
      }
    }

    if (affiliateProfile && !payment && referralCode) {
      try {
        const { xenditResponse, externalId } = await createXenditInvoice(
          user.id,
          affiliateProfile.id,
          user.email
        );

        payment = await prisma.payment.create({
          data: {
            userId: user.id,
            affiliateId: affiliateProfile.id,
            xenditInvoiceId: xenditResponse.data.id,
            externalId,
            amount: ACTIVATION_AMOUNT,
            invoiceUrl: xenditResponse.data.invoice_url,
            expiredAt: new Date(xenditResponse.data.expiry_date),
            status: "PENDING",
          },
        });
      } catch (invoiceError) {
      }
    }

    res.status(200).json({
      message: "Email verified successfully",
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        isEmailVerified: true,
      },
      affiliate: affiliateProfile ? {
        id: affiliateProfile.id,
        code: affiliateProfile.code || null,
        status: affiliateProfile.status,
        referredBy: referralCode || null,
        note: "Kode affiliate akan dibuat setelah beli kelas 500k"
      } : null,
      payment: payment ? {
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        invoiceUrl: payment.invoiceUrl,
        expiredAt: payment.expiredAt,
      } : null,
      nextStep: affiliateProfile ? "Proceed to payment to activate account" : "Account verified. Login available.",
      redirectUrl: payment ? payment.invoiceUrl : null,
      note: !referralCode ? "Tidak ada referralCode - Anda belum menjadi affiliate (tidak dapat komisi). Gunakan referralCode saat signup untuk bergabung dengan program affiliate." : "Selesaikan pembayaran 75k, lalu beli kelas 500k untuk mendapatkan kode referral",
      info: {
        isAffiliateUser: !!affiliateProfile,
        hasPaymentPending: !!payment,
        canLoginNow: !affiliateProfile
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const checkOtpStatus = async (req, res) => {
  try {
    const { userId, type = "EMAIL" } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    if (!["EMAIL", "PHONE"].includes(type)) {
      return res.status(400).json({ error: "type must be EMAIL or PHONE" });
    }

    const activeOtp = await prisma.otpRecord.findFirst({
      where: {
        userId,
        type: type,
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (activeOtp) {
      const remainingTime = Math.ceil((activeOtp.expiresAt - new Date()) / 1000 / 60);
      return res.json({
        status: "valid",
        isValid: true,
        remainingMinutes: remainingTime,
        expiresAt: activeOtp.expiresAt,
        message: `OTP is still valid for ${remainingTime} more minute(s)`,
      });
    }

    res.json({
      status: "expired",
      isValid: false,
      message: "No active OTP found. Please request a new one.",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const requestEmailOtp = async (req, res) => {
  try {
    const { userId, method = "EMAIL" } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    if (!["EMAIL", "WHATSAPP"].includes(method)) {
      return res.status(400).json({ error: "method must be EMAIL or WHATSAPP" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (method === "WHATSAPP" && !user.phone) {
      return res.status(400).json({ error: "Phone number required for WhatsApp OTP" });
    }

    const otp = generateOtp();
    const expiresAt = generateOtpExpiry(OTP_EXPIRY_MINUTES);

    await prisma.otpRecord.create({
      data: {
        userId,
        code: otp,
        type: "EMAIL",
        method: method,
        expiresAt,
      },
    });

    res.json({
      message: `OTP created successfully via ${method}`,
      target: method === "EMAIL" ? user.email : user.phone,
      method: method,
      otp: otp,
      expiresIn: "5 minutes",
      note: "OTP sending disabled. Use OTP above to verify.",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const resendEmailOtp = async (req, res) => {
  try {
    const { userId, method = "EMAIL" } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    if (!["EMAIL", "WHATSAPP"].includes(method)) {
      return res.status(400).json({ error: "method must be EMAIL or WHATSAPP" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const activeOtp = await prisma.otpRecord.findFirst({
      where: {
        userId,
        type: "EMAIL",
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (activeOtp) {
      const remainingTime = Math.ceil((activeOtp.expiresAt - new Date()) / 1000 / 60);
      return res.status(429).json({
        error: "OTP still valid, please wait before requesting a new one",
        remainingMinutes: remainingTime,
        expiresAt: activeOtp.expiresAt,
        message: `Your OTP is still valid for ${remainingTime} more minute(s). Please try again later.`,
      });
    }

    if (method === "WHATSAPP" && !user.phone) {
      return res.status(400).json({ error: "Phone number required for WhatsApp OTP" });
    }

    const otp = generateOtp();
    const expiresAt = generateOtpExpiry(OTP_EXPIRY_MINUTES);

    await prisma.otpRecord.create({
      data: {
        userId,
        code: otp,
        type: "EMAIL",
        method: method,
        expiresAt,
      },
    });

    res.json({
      message: `OTP resent successfully via ${method}`,
      target: method === "EMAIL" ? user.email : user.phone,
      method: method,
      otp: otp,
      expiresIn: "5 minutes",
      note: "OTP sending disabled. Use OTP above to verify.",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const requestPhoneOtp = async (req, res) => {
  try {
    const { userId, email, method = "EMAIL" } = req.body;

    if (!userId || !email) {
      return res.status(400).json({ error: "userId and email are required" });
    }

    if (!["EMAIL", "WHATSAPP"].includes(method)) {
      return res.status(400).json({ error: "method must be EMAIL or WHATSAPP" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const activeOtp = await prisma.otpRecord.findFirst({
      where: {
        userId,
        type: "PHONE",
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (activeOtp) {
      const remainingTime = Math.ceil((activeOtp.expiresAt - new Date()) / 1000 / 60);
      return res.status(429).json({
        error: "OTP still valid, please wait before requesting a new one",
        remainingMinutes: remainingTime,
        expiresAt: activeOtp.expiresAt,
        message: `Your OTP is still valid for ${remainingTime} more minute(s). Please try again later.`,
      });
    }

    const otp = generateOtp();
    const expiresAt = generateOtpExpiry(OTP_EXPIRY_MINUTES);

    await prisma.otpRecord.create({
      data: {
        userId,
        code: otp,
        type: "PHONE",
        method: method,
        expiresAt,
      },
    });

    let sentMessage = "";
    try {
      if (method === "EMAIL") {
        await sendOtpEmail(user.email, otp);
        sentMessage = "OTP sent to email";
      } else if (method === "WHATSAPP") {
        await sendOtpWhatsApp(email, otp);
        sentMessage = "OTP sent via WhatsApp";
      }
    } catch (err) {
    }

    await prisma.user.update({
      where: { id: userId },
      data: { email },
    });

    res.json({
      message: sentMessage || `OTP created for ${method}`,
      email,
      method,
      otp: otp,
      expiresIn: "5 minutes",
      note: "OTP sending disabled. Use OTP above to verify.",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const verifyPhoneOtp = async (req, res) => {
  try {
    const { userId, code } = req.body;

    if (!userId || !code) {
      return res.status(400).json({ error: "userId and code are required" });
    }

    const otpRecord = await prisma.otpRecord.findFirst({
      where: {
        userId,
        code,
        type: "PHONE",
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!otpRecord) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    await Promise.all([
      prisma.otpRecord.update({
        where: { id: otpRecord.id },
        data: { isUsed: true },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { isPhoneVerified: true },
      }),
    ]);

    res.json({ message: "Phone verified successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
