import prisma from "../../shared/lib/prisma.js";
import { invalidateAffiliateCache, invalidateUserCache } from "../../shared/utils/dashboardCache.js";
import axios from "axios";

const COMMISSION_CONFIG = {
  LEVEL_1_BASE: 75000,
  LEVEL_1_BONUS: 12500,
  LEVEL_2_10_FIXED: 12500,
  REQUIRED_PRODUCT_AMOUNT: 500000,
  MAX_LEVEL: 10,
};

const WP_CONFIG = {
  baseUrl: process.env.WORDPRESS_API || "https://jagobikinaplikasi.com/woo/wp-json",
  auth: {
    username: process.env.WORDPRESS_USER || "",
    password: process.env.WORDPRESS_APP_PASS || "",
  }
};

const syncToSliceWP = async (wpAffiliateId, transactionId, amount, level) => {
  if (!wpAffiliateId) return null;
  
  try {
    const response = await axios.post(
      `${WP_CONFIG.baseUrl}/sgs/v1/create-commission`,
      {
        affiliate_id: wpAffiliateId,
        order_id: `${transactionId}-L${level}`,
        amount: amount,
        order_total: 500000,
        level: level
      },
      { auth: WP_CONFIG.auth, timeout: 10000 }
    );
    console.log(`   ✅ Synced to SliceWP: Affiliate ${wpAffiliateId}, Rp ${amount.toLocaleString('id-ID')}`);
    return response.data;
  } catch (error) {
    console.log(`   ⚠️ SliceWP sync failed: ${error.message}`);
    return null;
  }
};

export const calculateCommissionAmount = (level) => {
  if (level > COMMISSION_CONFIG.MAX_LEVEL) {
    return 0;
  }
  if (level >= 2 && level <= COMMISSION_CONFIG.MAX_LEVEL) {
    return COMMISSION_CONFIG.LEVEL_2_10_FIXED;
  }
  return 0;
};

export const recordActivationCommission = async ({
  newAffiliateId,
}) => {
  try {
    const newAffiliate = await prisma.affiliateProfile.findUnique({
      where: { id: newAffiliateId },
      select: { id: true, code: true, referredById: true, status: true },
    });

    if (!newAffiliate) {
      throw new Error(`Affiliate ${newAffiliateId} not found`);
    }

    return [];
  } catch (error) {
    throw error;
  }
};

export const recordSingleCommission = async (data) => {
  const {
    affiliateId,
    transactionId,
    userId,
    amount,
    level,
  } = data;

  try {
    const commission = await prisma.affiliateCommission.create({
      data: {
        affiliateId,
        transactionId,
        userId,
        amount,
        level,
        status: "PENDING",
      },
      include: {
        affiliate: true,
        receiver: { select: { id: true, email: true, fullName: true } },
      },
    });

    if (commission.affiliate?.wpAffiliateId) {
      await syncToSliceWP(
        commission.affiliate.wpAffiliateId,
        transactionId,
        amount,
        level
      );
    }

    try { invalidateAffiliateCache(commission.affiliateId); } catch (e) {}
    try { invalidateUserCache(commission.userId); } catch (e) {}

    return commission;
  } catch (error) {
    throw error;
  }
};

export const recordAffiliateCommissions = async ({
  customerAffiliateId,
  transactionId,
  productAmount,
  productQty = 1,
}) => {
  try {
    if (!customerAffiliateId || !productAmount) {
      throw new Error("Missing required parameters: customerAffiliateId, productAmount");
    }

    if (productAmount !== COMMISSION_CONFIG.REQUIRED_PRODUCT_AMOUNT) {
      throw new Error(
        `Product amount must be exactly Rp ${COMMISSION_CONFIG.REQUIRED_PRODUCT_AMOUNT.toLocaleString("id-ID")}, got Rp ${productAmount.toLocaleString("id-ID")}`
      );
    }

    const customerAffiliate = await prisma.affiliateProfile.findUnique({
      where: { id: customerAffiliateId },
      select: { id: true, userId: true, code: true, referredById: true, status: true },
    });

    if (!customerAffiliate) {
      throw new Error(`Customer affiliate ${customerAffiliateId} not found`);
    }

    const customerPayment = await prisma.payment.findUnique({
      where: { userId: customerAffiliate.userId },
    });

    if (!customerPayment || customerPayment.status !== "COMPLETED") {
      throw new Error(
        `Customer affiliate ${customerAffiliate.code} has not completed activation payment. Payment status: ${customerPayment?.status || "NO_PAYMENT"}`
      );
    }

    const createdCommissions = [];

    for (let qty = 0; qty < productQty; qty++) {
      let currentAffiliateId = customerAffiliate.referredById;
      let uplineLevel = 1;

      while (uplineLevel <= COMMISSION_CONFIG.MAX_LEVEL && currentAffiliateId) {
        const uplineAffiliate = await prisma.affiliateProfile.findUnique({
          where: { id: currentAffiliateId },
          select: { id: true, userId: true, code: true, referredById: true, status: true },
        });

        if (!uplineAffiliate) {
          break;
        }

        if (uplineAffiliate.status !== "ACTIVE") {
          break;
        }

        if (uplineLevel === 1) {
          const baseCommission = await recordSingleCommission({
            affiliateId: uplineAffiliate.id,
            transactionId,
            userId: uplineAffiliate.userId,
            amount: 75000,
            level: uplineLevel,
            type: 'SALES',
          });
          createdCommissions.push(baseCommission);

          const bonusCommission = await recordSingleCommission({
            affiliateId: uplineAffiliate.id,
            transactionId,
            userId: uplineAffiliate.userId,
            amount: 12500,
            level: uplineLevel,
            type: 'SALES_BONUS',
          });
          createdCommissions.push(bonusCommission);
        } else {
          const commissionAmount = calculateCommissionAmount(uplineLevel);

          const commission = await recordSingleCommission({
            affiliateId: uplineAffiliate.id,
            transactionId,
            userId: uplineAffiliate.userId,
            amount: commissionAmount,
            level: uplineLevel,
            type: 'SALES',
          });

          createdCommissions.push(commission);
        }

        currentAffiliateId = uplineAffiliate.referredById;
        uplineLevel++;
      }
    }

    return createdCommissions;
  } catch (error) {
    throw error;
  }
};

export const approveCommission = async (commissionId) => {
  try {
    const commission = await prisma.affiliateCommission.findUnique({
      where: { id: commissionId },
      include: { affiliate: true },
    });

    if (!commission) {
      throw new Error(`Commission ${commissionId} not found`);
    }

    if (commission.status !== "PENDING") {
      throw new Error(`Commission is already ${commission.status}, cannot approve`);
    }

    const updatedCommission = await prisma.affiliateCommission.update({
      where: { id: commissionId },
      data: { 
        status: "APPROVED",
        approvedAt: new Date()
      },
    });

    await prisma.affiliateProfile.update({
      where: { id: commission.affiliateId },
      data: {
        totalEarnings: { increment: commission.amount },
        totalPaid: { increment: commission.amount },
      },
    });

    try { invalidateAffiliateCache(commission.affiliateId); } catch (e) {}
    try { invalidateUserCache(commission.userId); } catch (e) {}

    return updatedCommission;
  } catch (error) {
    throw error;
  }
};

export const markCommissionAsPaid = async (commissionId) => {
  try {
    const commission = await prisma.affiliateCommission.findUnique({
      where: { id: commissionId },
      include: { affiliate: true },
    });

    if (!commission) {
      throw new Error(`Commission ${commissionId} not found`);
    }

    if (commission.status === "PAID") {
      throw new Error("Commission already paid");
    }

    const updatedCommission = await prisma.affiliateCommission.update({
      where: { id: commissionId },
      data: { 
        status: "PAID",
        paidAt: new Date()
      },
    });

    if (commission.status === "APPROVED") {
      await prisma.affiliateProfile.update({
        where: { id: commission.affiliateId },
        data: {
          totalPaid: { increment: commission.amount },
        },
      });
    }

    try { invalidateAffiliateCache(commission.affiliateId); } catch (e) {}
    try { invalidateUserCache(commission.userId); } catch (e) {}

    return updatedCommission;
  } catch (error) {
    throw error;
  }
};

export const rejectCommission = async (commissionId, reason = "") => {
  try {
    const commission = await prisma.affiliateCommission.findUnique({
      where: { id: commissionId },
    });

    if (!commission) {
      throw new Error(`Commission ${commissionId} not found`);
    }

    if (commission.status !== "PENDING") {
      throw new Error(`Commission is already ${commission.status}, cannot reject`);
    }

    const updatedCommission = await prisma.affiliateCommission.update({
      where: { id: commissionId },
      data: { status: "REJECTED" },
    });

    try { invalidateAffiliateCache(commission.affiliateId); } catch (e) {}
    try { invalidateUserCache(commission.userId); } catch (e) {}

    return updatedCommission;
  } catch (error) {
    throw error;
  }
};

export const getCommissionsSummary = async (affiliateId) => {
  try {
    const commissions = await prisma.affiliateCommission.findMany({
      where: { affiliateId },
    });

    const summary = {
      total: commissions.reduce((sum, c) => sum + c.amount, 0),
      pending: commissions
        .filter((c) => c.status === "PENDING")
        .reduce((sum, c) => sum + c.amount, 0),
      approved: commissions
        .filter((c) => c.status === "APPROVED")
        .reduce((sum, c) => sum + c.amount, 0),
      paid: commissions
        .filter((c) => c.status === "PAID")
        .reduce((sum, c) => sum + c.amount, 0),
      rejected: commissions
        .filter((c) => c.status === "REJECTED")
        .reduce((sum, c) => sum + c.amount, 0),
      count: {
        total: commissions.length,
        pending: commissions.filter((c) => c.status === "PENDING").length,
        approved: commissions.filter((c) => c.status === "APPROVED").length,
        paid: commissions.filter((c) => c.status === "PAID").length,
        rejected: commissions.filter((c) => c.status === "REJECTED").length,
      },
    };

    return summary;
  } catch (error) {
    throw error;
  }
};
