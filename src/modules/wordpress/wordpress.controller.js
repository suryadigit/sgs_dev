import prisma from "../../shared/lib/prisma.js";
import { getCache, setCache, CACHE_KEYS } from "../../shared/utils/dashboardCache.js";
import pLimit from 'p-limit';

const _concurrencyLimit = process.env.WP_CONCURRENCY_LIMIT ? parseInt(process.env.WP_CONCURRENCY_LIMIT, 10) : 3;
const _limit = pLimit(_concurrencyLimit);

const USE_PRODUCTION = process.env.USE_WP_PRODUCTION === 'true';

let wpService;
if (USE_PRODUCTION) {
  wpService = await import("./wordpress.service.js");
} else {
  wpService = await import("./Mock/wordpressMock.service.js");
}

const { syncUserAsSubscriber, checkUserPurchase, upgradeToAffiliate, syncAndCheckStatus, getAffiliateDashboard, getAffiliateCommissions, simulatePurchaseViaReferral, getReferralLink, findUserByEmail } = wpService;

const getNextSteps = (affiliateProfile, wpStatus) => {
  const steps = [];
  if (!affiliateProfile || affiliateProfile.status === 'PENDING') steps.push({ step: 1, action: "Bayar aktivasi SGS Rp 75.000", status: "pending", endpoint: "POST /api/affiliate/activate" });
  if (!wpStatus.user.wpUserId) steps.push({ step: 2, action: "Sync ke WordPress", status: "pending", endpoint: "POST /api/wordpress/sync" });
  if (!wpStatus.purchase.hasPurchased) steps.push({ step: 3, action: "Beli kelas Rp 500.000 di WooCommerce", status: "pending", link: "https://jagobikinaplikasi.com/woo/shop" });
  if (wpStatus.purchase.hasPurchased && !wpStatus.affiliate) steps.push({ step: 4, action: "Upgrade ke Affiliate", status: "pending", endpoint: "POST /api/wordpress/check-purchase" });
  if (wpStatus.affiliate) steps.push({ step: 5, action: "Share referral link dan dapat komisi!", status: "ready", referralLink: wpStatus.referralLink });
  return steps;
};

const processMultiLevelCommission = async ({ orderId, orderTotal, customerEmail, directAffiliateId }) => {
  const COMMISSION_LEVELS = { 1: 75000, 2: 12500, 3: 12500 };
  const MAX_LEVELS = 3;

  // collect up to MAX_LEVELS affiliates in chain (serial, small depth)
  const affiliateChain = [];
  let currentAffiliateId = directAffiliateId;
  let level = 0;
  while (currentAffiliateId && level < MAX_LEVELS) {
    level++;
    const affiliate = await prisma.affiliateProfile.findUnique({ where: { id: currentAffiliateId }, include: { user: true } });
    if (!affiliate) break;
    affiliateChain.push({ affiliate, level });
    currentAffiliateId = affiliate.referredById;
  }

  // create commissions in parallel with concurrency limit
  const results = await Promise.all(affiliateChain.map(({ affiliate, level }) => _limit(async () => {
    const commissionAmount = COMMISSION_LEVELS[level] || 0;
    if (commissionAmount <= 0) return null;

    const commission = await prisma.affiliateCommission.create({ data: { affiliateId: affiliate.id, userId: affiliate.userId, transactionId: `WC-${orderId}`, amount: commissionAmount, level: level, status: 'PENDING', buyerName: customerEmail || 'Customer', productName: 'Kelas Digital Marketing', sourceType: 'WORDPRESS_SALE' } });
    await prisma.affiliateProfile.update({ where: { id: affiliate.id }, data: { totalEarnings: { increment: commissionAmount } } });
    return { id: commission.id, affiliateId: affiliate.id, affiliateName: affiliate.user.fullName, level, amount: commissionAmount, status: 'PENDING' };
  })));

  const commissions = (results || []).filter(Boolean);
  const totalPaid = commissions.reduce((s, c) => s + (c.amount || 0), 0);
  return { orderId, orderTotal, commissions, totalPaid, levelsDistributed: commissions.length };
};

export const getWordPressStatus = async (req, res) => {
  try {
    const userId = req.userId;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true, email: true, affiliateProfile: { select: { id: true, code: true, status: true, wpUserId: true, wpReferralLink: true } } } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const wpStatus = await syncAndCheckStatus({ fullName: user.fullName, email: user.email });

    return res.json({
      message: "WordPress status retrieved",
      sgsUser: { id: user.id, name: user.fullName, email: user.email, affiliateStatus: user.affiliateProfile?.status || 'NOT_REGISTERED', affiliateCode: user.affiliateProfile?.code },
      wordpress: { wpUserId: wpStatus.user.wpUserId, isSubscriber: wpStatus.user.roles.includes('subscriber'), hasPurchasedClass: wpStatus.purchase.hasPurchased, isAffiliate: wpStatus.affiliate !== null, referralLink: wpStatus.referralLink, totalSpentInWP: wpStatus.purchase.totalSpent },
      nextSteps: getNextSteps(user.affiliateProfile, wpStatus)
    });
  } catch (error) { return res.status(500).json({ error: error.message }); }
};

export const syncToWordPress = async (req, res) => {
  try {
    const userId = req.userId;
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { affiliateProfile: true } });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.affiliateProfile?.wpUserId) return res.json({ message: "Already synced to WordPress", wpUserId: user.affiliateProfile.wpUserId, status: "existing" });

    const syncResult = await syncUserAsSubscriber({ fullName: user.fullName, email: user.email });
    if (user.affiliateProfile) await prisma.affiliateProfile.update({ where: { id: user.affiliateProfile.id }, data: { wpUserId: syncResult.wpUserId } });

    return res.json({ message: "User synced to WordPress as Subscriber", wpUserId: syncResult.wpUserId, roles: syncResult.roles, status: syncResult.status, note: "Beli kelas 500k untuk jadi affiliate dan dapat referral link" });
  } catch (error) { return res.status(500).json({ error: error.message }); }
};

export const checkAndUpgrade = async (req, res) => {
  try {
    const userId = req.userId;
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { affiliateProfile: true } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const purchaseStatus = await checkUserPurchase(user.email);
    if (!purchaseStatus.hasPurchased) return res.json({ message: "Belum beli kelas", hasPurchased: false, totalSpent: 0, action: "Beli kelas 500k di WooCommerce untuk jadi affiliate" });

    const wpUser = await findUserByEmail(user.email);
    if (!wpUser) return res.status(400).json({ error: "User belum sync ke WordPress", action: "Panggil /api/wordpress/sync dulu" });

    const affiliateResult = await upgradeToAffiliate(wpUser.id, user.email);
    if (user.affiliateProfile) await prisma.affiliateProfile.update({ where: { id: user.affiliateProfile.id }, data: { wpUserId: wpUser.id, wpReferralLink: affiliateResult.referralLink, status: 'ACTIVE' } });

    return res.json({ message: "Selamat! Anda sekarang affiliate dan dapat referral link!", hasPurchased: true, totalSpent: purchaseStatus.totalSpent, affiliate: { affiliateId: affiliateResult.affiliateId, wpUserId: wpUser.id, referralLink: affiliateResult.referralLink }, orders: purchaseStatus.orders });
  } catch (error) { return res.status(500).json({ error: error.message }); }
};

export const getWPAffiliateDashboard = async (req, res) => {
  try {
    const userId = req.userId;

    const cacheKey = CACHE_KEYS.DASHBOARD_SUMMARY(userId);
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    // Get dashboard data first; this is the most common path for affiliate users
    const dashboard = await getAffiliateDashboard(userId);

    // If service indicates no affiliate data, confirm user existence (only then hit users table)
    if (dashboard.error || !dashboard.isAffiliate) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) return res.status(404).json({ error: "User not found" });

      return res.json({ message: "Belum jadi affiliate", isAffiliate: false, hasPurchasedClass: dashboard.hasPurchasedClass || false, action: dashboard.hasPurchasedClass ? "Panggil /api/wordpress/check-purchase untuk upgrade" : "Beli kelas 500k dulu di WooCommerce" });
    }

    const response = {
      message: "WordPress Affiliate Dashboard",
      isAffiliate: true,
      affiliate: { wpUserId: dashboard.wpUserId, affiliateId: dashboard.affiliateId, name: dashboard.name, email: dashboard.email, referralLink: dashboard.referralLink },
      earnings: { total: dashboard.earnings.total, paid: dashboard.earnings.paid, unpaid: dashboard.earnings.unpaid, formatted: { total: `Rp ${dashboard.earnings.total.toLocaleString('id-ID')}`, paid: `Rp ${dashboard.earnings.paid.toLocaleString('id-ID')}`, unpaid: `Rp ${dashboard.earnings.unpaid.toLocaleString('id-ID')}` } },
      commissions: dashboard.commissions.map(c => ({ id: c.id, orderId: c.orderId, amount: c.amount, amountFormatted: `Rp ${c.amount.toLocaleString('id-ID')}`, status: c.status, date: c.date }))
    };

    // Cache dashboard summary for short TTL
    try { setCache(cacheKey, response); } catch (e) {}

    return res.json(response);
  } catch (error) { return res.status(500).json({ error: error.message }); }
};

export const simulateSale = async (req, res) => {
  try {
    const { buyerEmail, affiliateWpUserId } = req.body;
    if (!buyerEmail || !affiliateWpUserId) return res.status(400).json({ error: "Missing required fields", required: ["buyerEmail", "affiliateWpUserId"] });

    const result = await simulatePurchaseViaReferral(buyerEmail, affiliateWpUserId);
    return res.json({ message: "Sale simulated successfully", order: { id: result.order.id, buyer: buyerEmail, total: result.order.total }, commission: { id: result.commission.id, amount: result.commission.amount, amountFormatted: `Rp ${result.commission.amount.toLocaleString('id-ID')}`, status: result.commission.status, affiliate: result.affiliate.name } });
  } catch (error) { return res.status(500).json({ error: error.message }); }
};

export const webhookOrderCompleted = async (req, res) => {
  try {
    const orderData = req.body;
    if (!orderData || !orderData.id) return res.status(400).json({ error: "Invalid order data" });
    if (orderData.status !== 'completed' && orderData.status !== 'processing') return res.json({ message: "Order not completed, skipping" });

    const customerEmail = orderData.billing?.email;
    let upgradeResult = null;

    if (customerEmail) {
      const customerAffiliate = await prisma.affiliateProfile.findFirst({ where: { user: { email: customerEmail }, wpAffiliateId: null }, include: { user: true } });
      if (customerAffiliate && customerAffiliate.wpUserId) {
        try { upgradeResult = await upgradeToAffiliate(customerAffiliate.userId, customerAffiliate.wpUserId, customerEmail, customerAffiliate.user?.fullName); } catch (e) {}
      }
    }

    let referredByAffiliateId = null;
    if (orderData.meta_data) { const referralMeta = orderData.meta_data.find(m => m.key === '_slicewp_affiliate_id' || m.key === 'slicewp_ref' || m.key === '_referral_wp_user_id'); if (referralMeta) referredByAffiliateId = parseInt(referralMeta.value); }
    if (!referredByAffiliateId && orderData.fee_lines) { const referralFee = orderData.fee_lines.find(f => f.name?.includes('Referral')); if (referralFee && referralFee.meta_data) { const refMeta = referralFee.meta_data.find(m => m.key === 'affiliate_id'); if (refMeta) referredByAffiliateId = parseInt(refMeta.value); } }

    let commissionResult = null;
    if (referredByAffiliateId) {
      const directAffiliate = await prisma.affiliateProfile.findFirst({ where: { wpAffiliateId: referredByAffiliateId }, include: { user: true } });
      if (directAffiliate) commissionResult = await processMultiLevelCommission({ orderId: orderData.id, orderTotal: parseFloat(orderData.total), customerEmail: customerEmail, directAffiliateId: directAffiliate.id });
    }

    return res.json({ message: "Webhook processed successfully", orderId: orderData.id, customerUpgraded: upgradeResult ? true : false, upgradeResult: upgradeResult, commission: commissionResult });
  } catch (error) { return res.status(500).json({ error: error.message }); }
};

export const requestWithdrawal = async (req, res) => {
  try {
    const userId = req.userId;
    const { amount, paymentMethod, accountNumber, accountName, bankName } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });
    if (!paymentMethod || !accountNumber) return res.status(400).json({ error: "Missing payment details", required: ["paymentMethod", "accountNumber", "accountName (optional)", "bankName (for bank transfer)"] });

    const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId }, include: { user: true } });
    if (!affiliate) return res.status(404).json({ error: "Affiliate profile not found" });

    const unpaidBalance = affiliate.totalEarnings - affiliate.totalPaid;
    if (amount > unpaidBalance) return res.status(400).json({ error: "Insufficient balance", requested: amount, available: unpaidBalance });

    const MINIMUM_WITHDRAWAL = 50000;
    if (amount < MINIMUM_WITHDRAWAL) return res.status(400).json({ error: `Minimum withdrawal is Rp ${MINIMUM_WITHDRAWAL.toLocaleString('id-ID')}`, requested: amount });

    const withdrawal = await prisma.affiliateWithdrawal.create({ data: { affiliateId: affiliate.id, userId: userId, amount: amount, status: 'PENDING', paymentMethod: paymentMethod, accountNumber: accountNumber, accountName: accountName || affiliate.user.fullName, bankName: bankName || null, requestedAt: new Date() } });

    return res.json({ message: "Withdrawal request submitted successfully", withdrawal: { id: withdrawal.id, amount: amount, amountFormatted: `Rp ${amount.toLocaleString('id-ID')}`, status: 'PENDING', paymentMethod, accountNumber, requestedAt: withdrawal.requestedAt }, remainingBalance: unpaidBalance - amount });
  } catch (error) { return res.status(500).json({ error: error.message }); }
};

export const getWithdrawalHistory = async (req, res) => {
  try {
    const userId = req.userId;
    const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId } });
    if (!affiliate) return res.status(404).json({ error: "Affiliate profile not found" });

    const withdrawals = await prisma.affiliateWithdrawal.findMany({ where: { affiliateId: affiliate.id }, orderBy: { requestedAt: 'desc' }, take: 50 });

    return res.json({ message: "Withdrawal history", total: withdrawals.length, withdrawals: withdrawals.map(w => ({ id: w.id, amount: w.amount, amountFormatted: `Rp ${w.amount.toLocaleString('id-ID')}`, status: w.status, paymentMethod: w.paymentMethod, accountNumber: w.accountNumber, bankName: w.bankName, requestedAt: w.requestedAt, processedAt: w.processedAt, rejectionReason: w.rejectionReason })) });
  } catch (error) { return res.status(500).json({ error: error.message }); }
};

export const processWithdrawal = async (req, res) => {
  try {
    const { withdrawalId, action, rejectionReason, transactionRef } = req.body;
    if (!withdrawalId || !action) return res.status(400).json({ error: "Missing required fields", required: ["withdrawalId", "action (approve/reject)"] });
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: "Action must be 'approve' or 'reject'" });

    const withdrawal = await prisma.affiliateWithdrawal.findUnique({ where: { id: withdrawalId }, include: { affiliate: true } });
    if (!withdrawal) return res.status(404).json({ error: "Withdrawal not found" });
    if (withdrawal.status !== 'PENDING') return res.status(400).json({ error: "Withdrawal already processed", currentStatus: withdrawal.status });

    if (action === 'approve') {
      await prisma.affiliateWithdrawal.update({ where: { id: withdrawalId }, data: { status: 'COMPLETED', processedAt: new Date(), transactionRef: transactionRef || null } });
      await prisma.affiliateProfile.update({ where: { id: withdrawal.affiliateId }, data: { totalPaid: { increment: withdrawal.amount } } });
      await prisma.affiliateCommission.updateMany({ where: { affiliateId: withdrawal.affiliateId, status: 'PENDING' }, data: { status: 'PAID', paidAt: new Date() } });
      try { const { invalidateAffiliateCache, invalidateUserCache } = await import('../../shared/utils/dashboardCache.js'); invalidateAffiliateCache(withdrawal.affiliateId); invalidateUserCache(withdrawal.userId); } catch (e) {}
      return res.json({ message: "Withdrawal approved successfully", withdrawal: { id: withdrawalId, amount: withdrawal.amount, status: 'COMPLETED', processedAt: new Date() } });
    } else {
      if (!rejectionReason) return res.status(400).json({ error: "Rejection reason is required" });
      await prisma.affiliateWithdrawal.update({ where: { id: withdrawalId }, data: { status: 'REJECTED', processedAt: new Date(), rejectionReason } });
      try { const { invalidateAffiliateCache, invalidateUserCache } = await import('../../shared/utils/dashboardCache.js'); invalidateAffiliateCache(withdrawal.affiliateId); invalidateUserCache(withdrawal.userId); } catch (e) {}
      return res.json({ message: "Withdrawal rejected", withdrawal: { id: withdrawalId, status: 'REJECTED', rejectionReason } });
    }
  } catch (error) { return res.status(500).json({ error: error.message }); }
};

export const getUserCommissions = async (req, res) => {
  try {
    const userId = req.userId;
    const { status, page = 1, limit = 20 } = req.query;

    const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId } });
    if (!affiliate) return res.status(404).json({ error: "Affiliate profile not found" });

    const where = { affiliateId: affiliate.id };
    if (status) where.status = status;

    const [commissions, total] = await Promise.all([
      prisma.affiliateCommission.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: parseInt(limit) }),
      prisma.affiliateCommission.count({ where })
    ]);

    const byLevel = { level1: commissions.filter(c => c.level === 1).reduce((sum, c) => sum + c.amount, 0), level2: commissions.filter(c => c.level === 2).reduce((sum, c) => sum + c.amount, 0), level3: commissions.filter(c => c.level === 3).reduce((sum, c) => sum + c.amount, 0) };

    return res.json({
      message: "Commission history",
      summary: { totalCommissions: total, byLevel, totalEarnings: affiliate.totalEarnings, totalPaid: affiliate.totalPaid, availableBalance: affiliate.totalEarnings - affiliate.totalPaid },
      pagination: { page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / limit) },
      commissions: commissions.map(c => ({ id: c.id, orderId: c.transactionId, amount: c.amount, amountFormatted: `Rp ${c.amount.toLocaleString('id-ID')}`, level: c.level, levelLabel: c.level === 1 ? 'Direct Referral' : `Level ${c.level}`, status: c.status, buyerName: c.buyerName, productName: c.productName, date: c.createdAt }))
    });
  } catch (error) { return res.status(500).json({ error: error.message }); }
};

export default { getWordPressStatus, syncToWordPress, checkAndUpgrade, getWPAffiliateDashboard, simulateSale, webhookOrderCompleted, requestWithdrawal, getWithdrawalHistory, processWithdrawal, getUserCommissions };
