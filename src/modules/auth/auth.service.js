import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import axios from "axios";
import prisma from "../../shared/lib/prisma.js";
import { authConfig } from "../../config/auth.config.js";
import paymentConfig from "../../config/payment.config.js";
import { generateOtp, generateOtpExpiry } from "../../shared/lib/generateOtp.js";
import { ROLE_PERMISSIONS, getPermissions, getRoleInfo } from "../../../ROLE_PERMISSIONS_CONFIG.js";

export const validateReferralCode = async (referralCode) => {
  const referrer = await prisma.affiliateProfile.findUnique({
    where: { code: referralCode },
    include: { user: { select: { fullName: true } } }
  });

  if (!referrer) {
    throw new Error(`Referral code "${referralCode}" tidak ditemukan`);
  }

  if (referrer.status !== "ACTIVE") {
    throw new Error(`Referrer tidak aktif (status: ${referrer.status})`);
  }

  return referrer;
};

export const createUserWithReferral = async (userData) => {
  const { email, password, fullName, phone, referralCode } = userData;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new Error("Email already registered");
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  
  const user = await prisma.user.create({
    data: { 
      email, 
      password: hashedPassword, 
      fullName, 
      phone,
      referralCodeUsed: referralCode
    },
  });

  const referrer = await prisma.affiliateProfile.findUnique({
    where: { code: referralCode }
  });

  const affiliateProfile = await prisma.affiliateProfile.create({
    data: {
      userId: user.id,
      referredById: referrer?.id || null,
      status: "PENDING",
      registeredAt: new Date()
    }
  });

  const { xenditResponse, externalId } = await createXenditInvoice(
    user.id,
    `PEND-${user.id.substring(0, 8)}`, // temporary code
    email
  );

  const payment = await prisma.payment.create({
    data: {
      userId: user.id,
      affiliateId: affiliateProfile.id,
      xenditInvoiceId: xenditResponse.data.id,
      externalId,
      amount: paymentConfig.ACTIVATION_AMOUNT,
      invoiceUrl: xenditResponse.data.invoice_url,
      expiredAt: new Date(xenditResponse.data.expiry_date),
      status: "PENDING",
    }
  });

  return {
    user,
    affiliateProfile,
    payment: {
      id: payment.id,
      amount: payment.amount,
      invoiceUrl: payment.invoiceUrl,
      expiredAt: payment.expiredAt,
      status: payment.status
    }
  };
};

export const createOtpRecord = async (userId, type = "EMAIL") => {
  const otp = generateOtp();
  const expiresAt = generateOtpExpiry(authConfig.OTP_EXPIRY_MINUTES);
  
  await prisma.otpRecord.create({
    data: { 
      userId, 
      code: otp, 
      type: type.toUpperCase(), 
      method: type === "PHONE" ? "WHATSAPP" : "EMAIL", 
      expiresAt 
    },
  });

  return otp;
};

export const createXenditInvoice = async (userId, affiliateCode, email) => {
  const externalId = `ACTIVATION-${userId}-${Date.now()}`;
  const xenditPayload = {
    external_id: externalId,
    amount: paymentConfig.ACTIVATION_AMOUNT,
    payer_email: email,
    description: `Biaya Aktivasi Akun Affiliate ${affiliateCode} (15 menit)`,
    invoice_duration: paymentConfig.INVOICE_DURATION_SECONDS,
    currency: "IDR",
    ...(paymentConfig.SUCCESS_REDIRECT_URL ? { success_redirect_url: paymentConfig.SUCCESS_REDIRECT_URL } : {}),
    ...(paymentConfig.FAILURE_REDIRECT_URL ? { failure_redirect_url: paymentConfig.FAILURE_REDIRECT_URL } : {}),
  };

  const xenditResponse = await axios.post(
    paymentConfig.XENDIT_API_URL,
    xenditPayload,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(paymentConfig.XENDIT_API_KEY + ":").toString("base64")}`,
        "Content-Type": "application/json",
      },
    }
  );

  return { xenditResponse, externalId };
};

export const isInvoiceExpired = (expiredAt) => {
  if (!expiredAt) return false;
  return new Date() > new Date(expiredAt);
};

export const handleExpiredInvoice = async (userId, affiliateProfile, user) => {
  const oldPayment = await prisma.payment.findUnique({
    where: { userId },
  });

  if (oldPayment) {
    await prisma.payment.delete({ where: { id: oldPayment.id } });
  }

  const { xenditResponse, externalId } = await createXenditInvoice(
    userId,
    affiliateProfile.code,
    user.email
  );

  const newPayment = await prisma.payment.create({
    data: {
      userId,
      affiliateId: affiliateProfile.id,
      xenditInvoiceId: xenditResponse.data.id,
      externalId,
      amount: paymentConfig.ACTIVATION_AMOUNT,
      invoiceUrl: xenditResponse.data.invoice_url,
      expiredAt: new Date(xenditResponse.data.expiry_date),
      status: "PENDING",
    },
  });

  return newPayment;
};

export const verifyPassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};

export const generateJwtToken = (userId, user) => {
  return jwt.sign(
    {
      userId,
      email: user.email,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
      isPhoneVerified: user.isPhoneVerified,
    },
    authConfig.JWT_SECRET,
    { expiresIn: authConfig.JWT_EXPIRES_IN }
  );
};

export const generateUserResponse = async (user, affiliateProfile = null) => {
  if (!user || !user.id) {
    throw new Error("User object is required and must have an id property");
  }
  
  const role = user.role || 'MEMBER';
  const roleConfig = ROLE_PERMISSIONS[role];
  const isAdmin = role === 'ADMIN' || role === 'SUPERADMIN';
  const isSuperAdmin = role === 'SUPERADMIN';
  
  const rolePermissionsFromDb = await prisma.rolePermission.findMany({
    where: { role: role, isEnabled: true },
    include: { permission: true },
  });
  const permissionIds = rolePermissionsFromDb.map(rp => rp.permission.permissionId);
  
  const roleMenusFromDb = await prisma.roleMenu.findMany({
    where: { role: role, isEnabled: true },
    include: { menu: true },
  });
  
  const sidebarMenu = roleMenusFromDb
    .filter(rm => rm.menu.isActive)
    .filter(rm => {
      if (!rm.menu.requiredPermission) return true;
      return permissionIds.includes(rm.menu.requiredPermission);
    })
    .map(rm => ({
      key: rm.menu.menuId,
      label: rm.menu.label,
      icon: rm.menu.icon,
      path: rm.menu.link,
      isAdmin: rm.menu.isAdmin,
      order: rm.menu.order,
    }))
    .sort((a, b) => a.order - b.order);
  
  const userMenus = sidebarMenu.filter(m => !m.isAdmin);
  const adminMenus = sidebarMenu.filter(m => m.isAdmin);
  
  const rolePermissions = permissionIds.length > 0 
    ? permissionIds.reduce((obj, id) => { obj[id] = true; return obj; }, {})
    : getPermissions(role);
  
  const roleInfo = getRoleInfo(role);
  
  const availableRoutes = {
    dashboard: true,
    commissions: true,
    withdrawals: true,
    referralTree: true,
    profile: permissionIds.includes('profile:view'),
    wallet: true,
    adminDashboard: isAdmin,
    adminCommissions: isAdmin,
    adminWithdrawals: isAdmin,
    approveCommissions: isAdmin,
    manageAffiliates: isAdmin,
    viewAllUsers: isAdmin,
    manageUsers: isSuperAdmin,
    manageAdmins: isSuperAdmin,
    systemConfig: isSuperAdmin,
    auditLogs: isSuperAdmin,
  };

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    bank: user.bank,
    alamat: user.alamat,
    role: role,
    isAdmin,
    isSuperAdmin,
    permissions: rolePermissions,
    availableRoutes,
    sidebarMenu: userMenus,
    ...(adminMenus.length > 0 && { adminMenu: adminMenus }),
    roleInfo: {
      name: roleInfo?.name || role,
      description: roleInfo?.description || "",
      level: isSuperAdmin ? 3 : (isAdmin ? 2 : 1)
    },
    isEmailVerified: user.isEmailVerified,
    isPhoneVerified: user.isPhoneVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    affiliate: affiliateProfile ? {
      id: affiliateProfile.id,
      code: affiliateProfile.code,
      status: affiliateProfile.status,
      totalEarnings: affiliateProfile.totalEarnings,
      totalPaid: affiliateProfile.totalPaid,
    } : null,
  };
};

export const getUserWithAffiliate = async (userId) => {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      affiliateProfile: {
        include: { payment: true }
      }
    }
  });
};

export const formatPaymentResponse = (payment) => {
  if (!payment) return null;
  
  return {
    id: payment.id,
    status: payment.status,
    amount: payment.amount,
    invoiceUrl: payment.invoiceUrl,
    expiredAt: payment.expiredAt,
    remainingMinutes: Math.ceil((new Date(payment.expiredAt) - new Date()) / 1000 / 60),
  };
};
