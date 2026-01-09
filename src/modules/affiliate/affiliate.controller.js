import prisma from "../../shared/lib/prisma.js";
import axios from "axios";
import { createActivationInvoice } from "../payment/payment.service.js";
import { cacheGet, cacheSet, cacheDel } from "../../shared/lib/cache.redis.js";
import paymentConfig from "../../config/payment.config.js";

const { XENDIT_API_KEY, XENDIT_API_URL, ACTIVATION_AMOUNT, INVOICE_DURATION_SECONDS } = paymentConfig;

const countTotalMembers = (referral) => {
  if (!referral) return 0;
  let count = 1;
  if (referral.referrals && referral.referrals.length > 0) {
    count += referral.referrals.reduce((sum, subRef) => sum + countTotalMembers(subRef), 0);
  }
  return count;
};

const countActiveMembers = (referral) => {
  if (!referral) return 0;
  let count = referral.status === "ACTIVE" ? 1 : 0;
  if (referral.referrals && referral.referrals.length > 0) {
    count += referral.referrals.reduce((sum, subRef) => sum + countActiveMembers(subRef), 0);
  }
  return count;
};

const buildReferralNode = (referral, currentLevel = 1, maxLevel = 10) => {
  if (!referral || currentLevel > maxLevel) {
    return null;
  }

  const node = {
    id: referral.id,
    name: referral.user?.fullName || "Unknown",
    code: referral.code,
    email: referral.user?.email || "Unknown",
    status: referral.status,
    joinDate: referral.registeredAt,
    level: currentLevel,
    subReferrals: [],
    subReferralCount: 0,
  };

      if (referral.referrals && referral.referrals.length > 0 && currentLevel < maxLevel) {
        node.subReferrals = referral.referrals
          .map((subRef) => buildReferralNode(subRef, currentLevel + 1, maxLevel))
          .filter(Boolean);
        node.subReferralCount = node.subReferrals.length;
      }

  return node;
};

const isInvoiceExpired = (expiredAt) => {
  if (!expiredAt) return false;
  return new Date() > new Date(expiredAt);
};

const createXenditInvoice = async (userId, affiliateCode, email) => {
  const externalId = `ACTIVATION-${userId}-${Date.now()}`;
  const xenditPayload = {
    external_id: externalId,
    amount: ACTIVATION_AMOUNT,
    payer_email: email,
    description: `Biaya Aktivasi Akun Affiliate ${affiliateCode} - Bayar dalam 15 menit`,
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

const handleExpiredInvoice = async (userId, affiliateProfile, user) => {
  const oldPayment = await prisma.payment.findUnique({ where: { userId } });
  if (oldPayment) {
    await prisma.payment.delete({ where: { id: oldPayment.id } });
  }

  const { xenditResponse, externalId } = await createXenditInvoice(userId, affiliateProfile.code, user.email);

  return await prisma.payment.create({
    data: {
      userId,
      affiliateId: affiliateProfile.id,
      xenditInvoiceId: xenditResponse.data.id,
      externalId,
      amount: ACTIVATION_AMOUNT,
      invoiceUrl: xenditResponse.data.invoice_url,
      expiredAt: new Date(xenditResponse.data.expiry_date),
      status: "PENDING",
    },
  });
};

export const createAffiliateProfile = async (req, res) => {
  try {
    const userId = req.userId;
    const { referredCode } = req.body;

    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.isEmailVerified) return res.status(400).json({ error: "Email must be verified first" });

    const existingProfile = await prisma.affiliateProfile.findUnique({ where: { userId } });
    if (existingProfile) return res.status(400).json({ error: "Affiliate profile already exists" });

    let referredById = null;
    if (referredCode) {
      const referrer = await prisma.affiliateProfile.findUnique({ where: { code: referredCode } });
      if (!referrer) return res.status(404).json({ error: "Referrer code not found" });
      referredById = referrer.id;
    }

    const affiliateProfile = await prisma.affiliateProfile.create({
      data: { userId, code: null, referredById, status: "PENDING", registeredAt: new Date() },
    });

    // invalidate profile cache for this user
    try { await cacheDel(`affiliate:profile:${userId}`); } catch (e) {}

    let payment = null;
    try { payment = await createActivationInvoice(userId, affiliateProfile.code, user.email); } catch (e) {}

    res.status(201).json({
      message: "Affiliate profile created successfully",
      affiliateProfile: { id: affiliateProfile.id, code: null, status: affiliateProfile.status, registeredAt: affiliateProfile.registeredAt },
      payment: payment ? { id: payment.id, amount: payment.amount, invoiceUrl: payment.invoiceUrl, expiredAt: payment.expiredAt, status: payment.status } : { message: "Activation invoice not available" },
      nextSteps: ["1. Complete activation payment (75K)", "2. Buy your first class (500K)", "3. Your affiliate code will be generated after first purchase", "4. Share your code to earn commissions"],
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getAffiliateProfile = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const cacheKey = `affiliate:profile:${userId}`;
    try {
      const cached = await cacheGet(cacheKey);
      if (cached) return res.json(cached);
    } catch (e) { /* ignore cache errors */ }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        affiliateProfile: {
          include: {
            referredBy: { select: { id: true, code: true, user: { select: { fullName: true, email: true } } } },
            referrals: { select: { id: true, code: true, user: { select: { fullName: true, email: true } } } },
            commissions: { select: { id: true, amount: true, level: true, status: true, createdAt: true, affiliate: { select: { id: true, code: true, user: { select: { fullName: true, email: true } } } } } },
          },
        },
        payment: true,
      },
    });

    if (!user) return res.status(404).json({ error: "User not found in database" });
    if (user.payment && isInvoiceExpired(user.payment.expiredAt)) { try { user.payment = await handleExpiredInvoice(userId, user.affiliateProfile, user); } catch (e) {} }

    if (!user.affiliateProfile) {
      return res.json({ message: "User found but no affiliate profile", user: { id: user.id, email: user.email, fullName: user.fullName, phone: user.phone, isEmailVerified: user.isEmailVerified, isPhoneVerified: user.isPhoneVerified }, affiliateProfile: null, payment: null });
    }

    const commissions = user.affiliateProfile.commissions || [];
    const totalCommissions = commissions.reduce((sum, c) => sum + c.amount, 0);
    const approvedCommissions = commissions.filter((c) => c.status === "APPROVED").reduce((sum, c) => sum + c.amount, 0);
    const pendingCommissions = commissions.filter((c) => c.status === "PENDING").reduce((sum, c) => sum + c.amount, 0);

    const commissionsWithFromName = commissions.map((c) => ({ id: c.id, name: c.affiliate?.user?.fullName || "Unknown", code: c.affiliate?.code || "Unknown", amount: c.amount, level: c.level, status: c.status, date: c.createdAt, fromCode: c.affiliate?.code || "Unknown" }));
    const referralsWithDetails = (user.affiliateProfile.referrals || []).map((ref) => ({ id: ref.id, name: ref.user?.fullName || "Unknown", email: ref.user?.email || "Unknown", code: ref.code, status: ref.status }));

    let activationStatus = "PENDING";
    if (user.affiliateProfile.status === "ACTIVE") activationStatus = "ACTIVE";
    else if (user.payment) {
      if (user.payment.status === "COMPLETED") activationStatus = "PAID";
      else if (user.payment.status === "PENDING") activationStatus = "AWAITING_PAYMENT";
      else if (user.payment.status === "EXPIRED") activationStatus = "PAYMENT_EXPIRED";
    }

    res.json({
      message: "Affiliate profile retrieved successfully",
      user: { id: user.id, email: user.email, fullName: user.fullName, phone: user.phone, isEmailVerified: user.isEmailVerified, isPhoneVerified: user.isPhoneVerified },
      affiliateProfile: { id: user.affiliateProfile.id, code: user.affiliateProfile.code, status: user.affiliateProfile.status, activationStatus, totalEarnings: user.affiliateProfile.totalEarnings, totalPaid: user.affiliateProfile.totalPaid, registeredAt: user.affiliateProfile.registeredAt, activatedAt: user.affiliateProfile.activatedAt, referredBy: user.affiliateProfile.referredBy, referralsCount: user.affiliateProfile.referrals?.length || 0, referrals: referralsWithDetails, commissionStats: { total: totalCommissions, approved: approvedCommissions, pending: pendingCommissions, paid: user.affiliateProfile.totalPaid }, commissions: commissionsWithFromName },
      payment: user.payment ? { id: user.payment.id, status: user.payment.status, amount: user.payment.amount, invoiceUrl: user.payment.invoiceUrl, paidAt: user.payment.paidAt, expiredAt: user.payment.expiredAt } : null,
      dashboard: { status: activationStatus, requiresAction: ["PENDING", "AWAITING_PAYMENT", "PAYMENT_EXPIRED"].includes(activationStatus) },
    });
    // cache response (short TTL)
    try { await cacheSet(cacheKey, {
      message: "Affiliate profile retrieved successfully",
      user: { id: user.id, email: user.email, fullName: user.fullName, phone: user.phone, isEmailVerified: user.isEmailVerified, isPhoneVerified: user.isPhoneVerified },
      affiliateProfile: { id: user.affiliateProfile.id, code: user.affiliateProfile.code, status: user.affiliateProfile.status, activationStatus, totalEarnings: user.affiliateProfile.totalEarnings, totalPaid: user.affiliateProfile.totalPaid, registeredAt: user.affiliateProfile.registeredAt, activatedAt: user.affiliateProfile.activatedAt, referredBy: user.affiliateProfile.referredBy, referralsCount: user.affiliateProfile.referrals?.length || 0, referrals: referralsWithDetails, commissionStats: { total: totalCommissions, approved: approvedCommissions, pending: pendingCommissions, paid: user.affiliateProfile.totalPaid }, commissions: commissionsWithFromName },
      payment: user.payment ? { id: user.payment.id, status: user.payment.status, amount: user.payment.amount, invoiceUrl: user.payment.invoiceUrl, paidAt: user.payment.paidAt, expiredAt: user.payment.expiredAt } : null,
      dashboard: { status: activationStatus, requiresAction: ["PENDING", "AWAITING_PAYMENT", "PAYMENT_EXPIRED"].includes(activationStatus) }
    }, 60); } catch (e) {}
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const updateAffiliateProfile = async (req, res) => {
  try {
    const userId = req.userId;
    const { fullName, phone } = req.body;
    const user = await prisma.user.update({ where: { id: userId }, data: { ...(fullName && { fullName }), ...(phone && { phone }) }, include: { affiliateProfile: true } });
    try { await cacheDel(`affiliate:profile:${userId}`); } catch (e) {}
    res.json({ message: "Affiliate profile updated successfully", user: { id: user.id, email: user.email, fullName: user.fullName, phone: user.phone }, affiliateProfile: user.affiliateProfile });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getAffiliateStats = async (req, res) => {
  try {
    const userId = req.userId;
    const affiliateProfile = await prisma.affiliateProfile.findUnique({ where: { userId }, include: { commissions: true, referrals: true } });
    if (!affiliateProfile) return res.status(404).json({ error: "Affiliate profile not found" });

    const commissions = affiliateProfile.commissions || [];
    const totalCommissions = commissions.reduce((sum, c) => sum + c.amount, 0);
    const approvedCommissions = commissions.filter((c) => c.status === "APPROVED").reduce((sum, c) => sum + c.amount, 0);
    const pendingCommissions = commissions.filter((c) => c.status === "PENDING").reduce((sum, c) => sum + c.amount, 0);

    res.json({ message: "Affiliate statistics retrieved successfully", stats: { code: affiliateProfile.code, status: affiliateProfile.status, earnings: { total: affiliateProfile.totalEarnings, paid: affiliateProfile.totalPaid, pending: affiliateProfile.totalEarnings - affiliateProfile.totalPaid }, commissions: { total: totalCommissions, approved: approvedCommissions, pending: pendingCommissions, count: commissions.length }, referrals: { count: affiliateProfile.referrals?.length || 0 }, registeredAt: affiliateProfile.registeredAt, activatedAt: affiliateProfile.activatedAt } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getDashboardSummary = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'User ID not found in token' });

    const affiliateProfile = await prisma.affiliateProfile.findUnique({ where: { userId } });
    if (!affiliateProfile) return res.status(404).json({ error: 'Affiliate profile not found' });

    const directReferrals = await prisma.affiliateProfile.findMany({ where: { referredById: affiliateProfile.id }, select: { id: true, userId: true } });
    const directUserIds = directReferrals.map(r => r.userId).filter(Boolean);

    const directAmounts = [500000, 75000];
    let totalOmset = 0;
    let directSalesCount = 0;
    const qualifyingUserIds = [];

    if (directUserIds.length > 0) {
      // Find completed activation payments (75k) and completed purchases (500k) for direct referrals
      const [payments, purchases] = await Promise.all([
        prisma.payment.findMany({ where: { userId: { in: directUserIds }, status: 'COMPLETED', amount: 75000 }, select: { userId: true, id: true, amount: true, paidAt: true } }),
        prisma.transaction.findMany({ where: { userId: { in: directUserIds }, status: 'COMPLETED', amount: 500000 }, select: { userId: true, id: true, amount: true, createdAt: true, reference: true } }),
      ]);

      const paidSet = new Set(payments.map(p => p.userId));
      const purchaseSet = new Set(purchases.map(t => t.userId));

      for (const uid of directUserIds) {
        if (paidSet.has(uid) && purchaseSet.has(uid)) {
          totalOmset += 500000 + 75000; 
          directSalesCount += 1;
          qualifyingUserIds.push(uid);
        }
      }

      var paymentsByUser = new Map();
      for (const p of payments) {
        if (!paymentsByUser.has(p.userId)) paymentsByUser.set(p.userId, []);
        paymentsByUser.get(p.userId).push({ id: p.id, amount: p.amount, paidAt: p.paidAt });
      }
      var purchasesByUser = new Map();
      for (const t of purchases) {
        if (!purchasesByUser.has(t.userId)) purchasesByUser.set(t.userId, []);
        purchasesByUser.get(t.userId).push({ id: t.id, amount: t.amount, createdAt: t.createdAt, reference: t.reference });
      }
    }

    const [approvedCommAgg, pendingPaymentCount, totalAffiliates] = await Promise.all([
      prisma.affiliateCommission.aggregate({ where: { status: 'APPROVED', userId: affiliateProfile.userId }, _sum: { amount: true } }),
      prisma.payment.count({ where: { status: 'PENDING' } }),
      prisma.affiliateProfile.count(),
    ]);

    const approvedCommission = approvedCommAgg._sum.amount || 0;

    // Fetch recent approved commissions for the owner for debugging / details
    const recentApprovedCommissions = await prisma.affiliateCommission.findMany({ where: { userId: affiliateProfile.userId, status: 'APPROVED' }, select: { id: true, transactionId: true, userId: true, amount: true, level: true, buyerName: true, productName: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 50 });

    // Compute totalMembers as the size of the affiliate owner's network (all levels under this affiliate)
    let totalMembers = 0;
    try {
      // start with direct referrals
      let currentIds = directReferrals.map(r => r.id);
      totalMembers += currentIds.length;
      for (let level = 1; level <= 10; level++) {
        if (currentIds.length === 0) break;
        const downlines = await prisma.affiliateProfile.findMany({ where: { referredById: { in: currentIds } }, select: { id: true } });
        if (downlines.length === 0) break;
        totalMembers += downlines.length;
        currentIds = downlines.map(d => d.id);
      }
    } catch (err) {
      totalMembers = 0;
    }

    let qualifyingUsers = [];
    if (qualifyingUserIds.length > 0) {
      const users = await prisma.user.findMany({ where: { id: { in: qualifyingUserIds } }, select: { id: true, email: true, fullName: true, affiliateProfile: { select: { code: true } } } });
      const [txsForUsers, payForUsers] = await Promise.all([
        prisma.transaction.findMany({ where: { userId: { in: qualifyingUserIds }, status: 'COMPLETED', amount: 500000 }, select: { id: true, userId: true, amount: true, createdAt: true, reference: true } }),
        prisma.payment.findMany({ where: { userId: { in: qualifyingUserIds }, status: 'COMPLETED', amount: 75000 }, select: { id: true, userId: true, amount: true, paidAt: true } }),
      ]);
      const txMap = new Map();
      for (const t of txsForUsers) {
        if (!txMap.has(t.userId)) txMap.set(t.userId, []);
        txMap.get(t.userId).push({ id: t.id, amount: t.amount, createdAt: t.createdAt, reference: t.reference });
      }
      const payMap = new Map();
      for (const p of payForUsers) {
        if (!payMap.has(p.userId)) payMap.set(p.userId, []);
        payMap.get(p.userId).push({ id: p.id, amount: p.amount, paidAt: p.paidAt });
      }
      qualifyingUsers = users.map(u => ({ id: u.id, email: u.email, fullName: u.fullName, code: u.affiliateProfile?.code || null, payments: payMap.get(u.id) || [], purchases: txMap.get(u.id) || [] }));
    }

    res.json({
      message: "Dashboard totals retrieved",
      totals: {
        ownerCode: affiliateProfile.code || null,
        totalOmset,
        totalOmsetFormatted: `Rp ${Math.round(totalOmset).toLocaleString('id-ID')}`,
        approvedCommission,
        approvedCommissionsList: recentApprovedCommissions,
        approvedCommissionFormatted: `Rp ${Math.round(approvedCommission).toLocaleString('id-ID')}`,
        pendingPaymentPersons: pendingPaymentCount,
        totalMembers,
        totalAffiliates,
        directSalesCount,
        qualifyingUsers,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getActivationStatus = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const user = await prisma.user.findUnique({ where: { id: userId }, include: { affiliateProfile: true, payment: true } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.affiliateProfile) return res.json({ isActive: false, status: "NOT_REGISTERED", message: "User belum terdaftar sebagai affiliate" });

    const isActive = user.affiliateProfile.status === "ACTIVE";
    const statusDetail = { affiliateCode: user.affiliateProfile.code, affiliateStatus: user.affiliateProfile.status, registeredAt: user.affiliateProfile.registeredAt, activatedAt: user.affiliateProfile.activatedAt };

    if (isActive) return res.json({ isActive: true, status: "ACTIVE", message: "Akun sudah ACTIVE", affiliate: statusDetail, earnInfo: { canEarn: true, affiliateCode: user.affiliateProfile.code, activatedAt: user.affiliateProfile.activatedAt } });
    if (!user.payment) return res.json({ isActive: false, status: "AWAITING_PAYMENT", message: "Menunggu pembayaran aktivasi 75,000 IDR", affiliate: statusDetail, payment: { status: "INVOICE_NOT_CREATED", amount: 75000 } });

    if (user.payment.status === "PENDING") {
      const remainingTime = Math.ceil((new Date(user.payment.expiredAt) - new Date()) / 1000);
      return res.json({ isActive: false, status: "AWAITING_PAYMENT", affiliate: statusDetail, payment: { id: user.payment.id, status: "PENDING", amount: 75000, invoiceUrl: user.payment.invoiceUrl, expiredAt: user.payment.expiredAt, remainingTime } });
    }
    if (user.payment.status === "COMPLETED") return res.json({ isActive: false, status: "PAYMENT_COMPLETED", affiliate: statusDetail, payment: { status: "COMPLETED", amount: 75000, paidAt: user.payment.paidAt } });
    if (user.payment.status === "EXPIRED") return res.json({ isActive: false, status: "INVOICE_EXPIRED", affiliate: statusDetail, payment: { status: "EXPIRED", amount: 75000, expiredAt: user.payment.expiredAt } });
    if (user.payment.status === "FAILED") return res.json({ isActive: false, status: "PAYMENT_FAILED", affiliate: statusDetail, payment: { status: "FAILED", amount: 75000 } });

    return res.json({ isActive: false, status: "UNKNOWN", affiliate: statusDetail });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getDirectReferrals = async (req, res) => {
  try {
    const userId = req.userId;
    const affiliateProfile = await prisma.affiliateProfile.findUnique({ where: { userId }, include: { referrals: { select: { id: true, code: true, status: true, registeredAt: true, activatedAt: true, totalEarnings: true, user: { select: { fullName: true, email: true } } } } } });
    if (!affiliateProfile) return res.status(404).json({ error: "Affiliate profile not found" });
    res.json({ message: "Direct referrals retrieved", affiliateCode: affiliateProfile.code, count: affiliateProfile.referrals.length, referrals: affiliateProfile.referrals });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getReferralTree = async (req, res) => {
  try {
    const userId = req.userId;
    const depthLimit = parseInt(req.query.depth || "3", 10);
    const root = await prisma.affiliateProfile.findUnique({ where: { userId }, select: { id: true, code: true } });
    if (!root) return res.status(404).json({ error: "Affiliate profile not found" });

    const allProfiles = await prisma.affiliateProfile.findMany({ select: { id: true, code: true, referredById: true, status: true, totalEarnings: true, activatedAt: true, registeredAt: true, user: { select: { fullName: true, email: true } } } });
    const byParent = new Map();
    for (const p of allProfiles) { const key = p.referredById || "ROOTLESS"; if (!byParent.has(key)) byParent.set(key, []); byParent.get(key).push(p); }

    const buildNode = (id, depth) => {
      const profile = allProfiles.find((p) => p.id === id);
      if (!profile) return null;
      const node = { id: profile.id, code: profile.code, status: profile.status, totalEarnings: profile.totalEarnings, user: profile.user, activatedAt: profile.activatedAt, registeredAt: profile.registeredAt, depth, children: [] };
      if (depth < depthLimit) { const children = byParent.get(profile.id) || []; node.children = children.map((c) => buildNode(c.id, depth + 1)).filter(Boolean); }
      return node;
    };

    res.json({ message: "Referral tree retrieved", depthLimit, affiliateCode: root.code, tree: buildNode(root.id, 0) });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getUsersUsingAffiliateCode = async (req, res) => {
  try {
    const { affiliateCode } = req.query;
    if (!affiliateCode) return res.status(400).json({ error: "affiliateCode query parameter required" });

    const affiliate = await prisma.affiliateProfile.findUnique({ where: { code: affiliateCode }, include: { user: { select: { id: true, fullName: true, email: true } }, referrals: { include: { user: { select: { id: true, fullName: true, email: true, isEmailVerified: true, createdAt: true } } } } } });
    if (!affiliate) return res.status(404).json({ error: `Affiliate code ${affiliateCode} not found` });

    const usersUsingCode = (affiliate.referrals || []).map((ref) => ({ id: ref.user.id, fullName: ref.user.fullName, email: ref.user.email, isEmailVerified: ref.user.isEmailVerified, affiliateCode: ref.code, affiliateStatus: ref.status, joinedDate: ref.user.createdAt, registeredAsAffiliateAt: ref.registeredAt, activatedAt: ref.activatedAt }));
    res.json({ message: `Users using affiliate code ${affiliateCode}`, affiliateOwner: { id: affiliate.id, name: affiliate.user.fullName, code: affiliate.code, status: affiliate.status }, totalUsersUsedCode: usersUsingCode.length, users: usersUsingCode });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getReferralProgramDashboard = async (req, res) => {
  try {
    const userId = req.userId;
    const maxLevels = 10;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true, email: true } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId }, select: { id: true, code: true, status: true, totalEarnings: true, totalPaid: true, registeredAt: true, wpUserId: true, wpAffiliateId: true, wpReferralLink: true } });
    if (!affiliate) return res.status(404).json({ error: "Affiliate profile not found" });

    const commissionStats = await prisma.affiliateCommission.groupBy({ by: ["status", "level"], where: { userId }, _sum: { amount: true }, _count: true });
    const commissionByLevel = {};
    for (let level = 1; level <= maxLevels; level++) {
      const levelStats = commissionStats.filter((s) => s.level === level);
      commissionByLevel[`level_${level}`] = { count: levelStats.reduce((sum, s) => sum + s._count, 0), total: levelStats.reduce((sum, s) => sum + (s._sum.amount || 0), 0), pending: levelStats.filter((s) => s.status === "PENDING").reduce((sum, s) => sum + (s._sum.amount || 0), 0), approved: levelStats.filter((s) => s.status === "APPROVED").reduce((sum, s) => sum + (s._sum.amount || 0), 0), fixed_amount: level === 1 ? 87500 : 12500 };
    }

    const totalCommissions = Object.values(commissionByLevel).reduce((sum, l) => sum + l.total, 0);
    const pendingCommissions = Object.values(commissionByLevel).reduce((sum, l) => sum + l.pending, 0);
    const approvedCommissions = Object.values(commissionByLevel).reduce((sum, l) => sum + l.approved, 0);

    const recentCommissions = await prisma.affiliateCommission.findMany({ where: { userId }, select: { id: true, level: true, amount: true, status: true, createdAt: true, affiliate: { select: { code: true, user: { select: { fullName: true } } } } }, orderBy: { createdAt: "desc" }, take: 10 });
    const directReferrals = await prisma.affiliateProfile.findMany({ where: { referredById: affiliate.id }, select: { id: true, code: true, status: true, totalEarnings: true, registeredAt: true, activatedAt: true, user: { select: { fullName: true, email: true } }, _count: { select: { referrals: true } } }, orderBy: { registeredAt: "desc" }, take: 50 });

    const directReferralIds = directReferrals.map((r) => r.id);
    const referralCommissions = directReferralIds.length > 0 ? await prisma.affiliateCommission.groupBy({ by: ["affiliateId", "status"], where: { affiliateId: { in: directReferralIds } }, _sum: { amount: true } }) : [];
    const referralsList = directReferrals.map((ref) => { const refCommStats = referralCommissions.filter((c) => c.affiliateId === ref.id); return { id: ref.id, code: ref.code, name: ref.user?.fullName || "Unknown", email: ref.user?.email, status: ref.status, joinDate: ref.registeredAt, activatedAt: ref.activatedAt, subReferralsCount: ref._count.referrals, totalEarnings: refCommStats.reduce((sum, c) => sum + (c._sum.amount || 0), 0), pendingEarnings: refCommStats.filter((c) => c.status === "PENDING").reduce((sum, c) => sum + (c._sum.amount || 0), 0), approvedEarnings: refCommStats.filter((c) => c.status === "APPROVED").reduce((sum, c) => sum + (c._sum.amount || 0), 0) }; });

    const generateDisplayCode = (wpAffiliateId, name) => { if (!wpAffiliateId || !name) return null; return `AFF${String(wpAffiliateId).padStart(3, "0")}${name.substring(0, 3).toUpperCase()}`; };
    const wpCustomCode = generateDisplayCode(affiliate.wpAffiliateId, user.fullName);

    res.json({
      message: "Referral program dashboard retrieved",
      affiliate: { id: affiliate.id, name: user.fullName, code: affiliate.code, status: affiliate.status, joinDate: affiliate.registeredAt, totalEarnings: affiliate.totalEarnings, totalPaid: affiliate.totalPaid, wpUserId: affiliate.wpUserId, wpAffiliateId: affiliate.wpAffiliateId, wpReferralLink: affiliate.wpReferralLink, wpDisplayLink: wpCustomCode ? `https://jagobikinaplikasi.com/woo/shop/?slicewp_ref=${wpCustomCode}` : null, wpCustomCode, isWordPressAffiliate: !!affiliate.wpAffiliateId },
      earnings: { total: totalCommissions, pending: pendingCommissions, approved: approvedCommissions },
      commissionBreakdown: { byLevel: commissionByLevel },
      commissionDetails: { total_records: totalCommissions > 0 ? Object.values(commissionByLevel).reduce((sum, l) => sum + l.count, 0) : 0, recent_commissions: recentCommissions.map((c) => ({ id: c.id, level: c.level, amount: c.amount, status: c.status, from: c.affiliate?.user?.fullName || "Unknown", date: c.createdAt })) },
      referrals: { totalCount: referralsList.length, list: referralsList },
      summary: { totalMembers: directReferrals.length, activeMembers: directReferrals.filter((r) => r.status === "ACTIVE").length, totalCommissionDistributed: referralsList.reduce((sum, ref) => sum + ref.totalEarnings, 0), pendingCommissions: referralsList.reduce((sum, ref) => sum + ref.pendingEarnings, 0) },
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getPaginatedReferrals = async (req, res) => {
  try {
    const userId = req.userId;
    const { page = "1", limit = "10", level, search } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId }, select: { id: true, code: true } });
    if (!affiliate) return res.status(404).json({ error: "Affiliate profile not found" });

    let whereConditions = { referredById: affiliate.id };
    if (level) { const lvl = parseInt(level, 10); if (lvl >= 1 && lvl <= 10 && lvl !== 1) return res.status(400).json({ error: "Pagination supports level 1 only.", supportedLevels: [1] }); }
    if (search) whereConditions.AND = [{ OR: [{ user: { fullName: { contains: search, mode: "insensitive" } } }, { user: { email: { contains: search, mode: "insensitive" } } }, { code: { contains: search, mode: "insensitive" } }] }];

    const total = await prisma.affiliateProfile.count({ where: whereConditions });
    const referrals = await prisma.affiliateProfile.findMany({ where: whereConditions, select: { id: true, code: true, status: true, totalEarnings: true, totalPaid: true, registeredAt: true, activatedAt: true, user: { select: { id: true, fullName: true, email: true, phone: true } }, _count: { select: { referrals: true } } }, skip: (pageNum - 1) * limitNum, take: limitNum, orderBy: { registeredAt: "desc" } });

    const referralIds = referrals.map((r) => r.id);
    const allCommissionStats = referralIds.length > 0 ? await prisma.affiliateCommission.groupBy({ by: ["affiliateId", "status"], where: { affiliateId: { in: referralIds } }, _sum: { amount: true }, _count: true }) : [];
    const commissionMap = new Map();
    for (const stat of allCommissionStats) { if (!commissionMap.has(stat.affiliateId)) commissionMap.set(stat.affiliateId, {}); commissionMap.get(stat.affiliateId)[stat.status] = { amount: stat._sum.amount || 0, count: stat._count || 0 }; }

    const referralsWithCommissions = referrals.map((ref) => { const refCommissions = commissionMap.get(ref.id) || {}; return { id: ref.id, code: ref.code, name: ref.user?.fullName || "Unknown", email: ref.user?.email, phone: ref.user?.phone, status: ref.status, joinDate: ref.registeredAt, activatedAt: ref.activatedAt, earnings: { total: ref.totalEarnings, paid: ref.totalPaid, pending: ref.totalEarnings - ref.totalPaid }, commissions: { pending: refCommissions["PENDING"] || { amount: 0, count: 0 }, approved: refCommissions["APPROVED"] || { amount: 0, count: 0 }, paid: refCommissions["PAID"] || { amount: 0, count: 0 }, withdrawn: refCommissions["WITHDRAWN"] || { amount: 0, count: 0 } }, directReferralsCount: ref._count.referrals }; });

    res.json({ message: "Paginated referrals retrieved", pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum), hasMore: pageNum < Math.ceil(total / limitNum) }, referrals: referralsWithCommissions });
  } catch (error) { res.status(500).json({ error: error.message }); }
};
