import prisma from "../../shared/lib/prisma.js";
import { recordAffiliateCommissions, getCommissionsSummary } from "./commission.service.js";
import { buildReferralHierarchyBatched } from "./referralCommission.service.js";

const generateSequentialAffiliateCode = async () => {
  const lastAffiliate = await prisma.affiliateProfile.findFirst({ where: { code: { startsWith: "AFF" } }, orderBy: { code: "desc" } });
  let nextNumber = 1;
  if (lastAffiliate?.code) { const match = lastAffiliate.code.match(/AFF(\d+)/); if (match) nextNumber = parseInt(match[1], 10) + 1; }
  const code = `AFF${String(nextNumber).padStart(3, "0")}`;
  const exists = await prisma.affiliateProfile.findUnique({ where: { code } });
  if (exists) return `AFF${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  return code;
};

export const bypassRecordCommission = async (req, res) => {
  try {
    const { customerAffiliateCode, productAmount, productQty = 1, transactionId } = req.body;

    if (!customerAffiliateCode || !productAmount) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["customerAffiliateCode", "productAmount"],
        optional: ["productQty", "transactionId"],
        validation: { productAmount: "MUST be exactly 500000 (product/class purchase, NOT activation fee 75k)", productQty: "Default: 1", note: "Activation fee (75K) goes to company. Commission only for product purchase (500K)" },
        example: { customerAffiliateCode: "AFFP3NDE4", productAmount: 500000, productQty: 3, transactionId: "ORD-001" }
      });
    }

    const affiliate = await prisma.affiliateProfile.findUnique({ where: { code: customerAffiliateCode }, include: { user: { select: { email: true, fullName: true } } } });
    if (!affiliate) return res.status(404).json({ error: `Affiliate code ${customerAffiliateCode} not found` });

    const userPayment = await prisma.payment.findUnique({ where: { userId: affiliate.userId } });
    if (!userPayment || userPayment.status !== "COMPLETED") {
      return res.status(400).json({ error: `Affiliate ${customerAffiliateCode} has not completed activation payment`, status: affiliate.status, paymentStatus: userPayment?.status || "NO_PAYMENT", message: "Customer must complete activation payment (75K) first before buying product", hint: "Flow: Register → Pay 75K (activation) → Buy class 500K (trigger commission + activation)" });
    }

    if (productAmount !== 500000) {
      return res.status(400).json({ error: "REJECTED: Product amount validation failed", received: productAmount, required: 500000, message: "Product amount MUST be exactly 500000 (product/class purchase)", explanation: "Activation fee (75K) goes to company and does NOT create commissions. This endpoint is ONLY for product/class purchases (500K) which trigger parent affiliate commissions.", validAmounts: { activation_fee: "75000 (goes to company, no commission)", product_purchase: "500000 (creates commission for upline)" } });
    }

    const commissions = await recordAffiliateCommissions({ customerAffiliateId: affiliate.id, transactionId: transactionId || `manual-${Date.now()}`, productAmount, productQty });

    if (affiliate.status !== "ACTIVE") {
      await prisma.affiliateProfile.update({ where: { id: affiliate.id }, data: { status: "ACTIVE", activatedAt: new Date() } });
    }

    if (!affiliate.code) {
      const code = await generateSequentialAffiliateCode();
      await prisma.affiliateProfile.update({ where: { id: affiliate.id }, data: { code } });
    }

    const txnId = transactionId || `manual-${Date.now()}`;
    const transaction = await prisma.transaction.create({
      data: { userId: affiliate.userId, affiliateId: affiliate.id, type: "CLASS_PURCHASE", source: "MANUAL", reference: commissions[0]?.id, amount: productAmount, status: "COMPLETED" }
    });

    const updatedAffiliate = await prisma.affiliateProfile.findUnique({ where: { id: affiliate.id }, include: { user: { select: { email: true, fullName: true } } } });

    res.status(201).json({
      message: "Sales commissions recorded successfully",
      customer: { affiliateId: affiliate.id, code: updatedAffiliate.code, email: affiliate.user.email, fullName: affiliate.user.fullName },
      transaction: { id: transaction.id, productAmount, productQty, totalAmount: productAmount * productQty, type: "CLASS_PURCHASE", source: "MANUAL", reference: transaction.reference, status: "COMPLETED" },
      commissions: commissions.map((c) => ({ id: c.id, level: c.level, amount: c.amount, status: c.status, receiver: { id: c.receiver.id, email: c.receiver.email, fullName: c.receiver.fullName } })),
      summary: { totalRecipients: commissions.length, totalCommissionAmount: commissions.reduce((sum, c) => sum + c.amount, 0), affiliateCodeGenerated: !affiliate.code, transactionTracking: { message: "Transaction recorded in database for audit trail", transactionId: transaction.id, commissionReference: transaction.reference } }
    });
  } catch (error) { res.status(400).json({ error: error.message, details: error.toString() }); }
};

export const getCommissionBreakdown = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId }, select: { id: true, code: true, status: true } });
    if (!affiliate) return res.status(404).json({ error: "User is not registered as affiliate" });

    // Fix: Query by affiliateId instead of userId
    const commissions = await prisma.affiliateCommission.findMany({ 
      where: { affiliateId: affiliate.id }, 
      include: { 
        affiliate: { select: { code: true, user: { select: { fullName: true, email: true } } } },
        receiver: { select: { fullName: true, email: true } }
      } 
    });

    const breakdown = { PENDING: { count: 0, amount: 0 }, APPROVED: { count: 0, amount: 0 } };
    commissions.forEach((commission) => { if (commission.status === "PENDING" || commission.status === "APPROVED") { if (breakdown[commission.status]) { breakdown[commission.status].count += 1; breakdown[commission.status].amount += commission.amount; } } });

    const totalAmount = commissions.filter(c => c.status === "PENDING" || c.status === "APPROVED").reduce((sum, c) => sum + c.amount, 0);
    const totalPending = breakdown.PENDING.amount;
    const totalApproved = breakdown.APPROVED.amount;

    const { page = 1, limit = 10, status = "ALL" } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    let filteredCommissions = commissions;
    if (status !== "ALL") filteredCommissions = commissions.filter((c) => c.status === status);

    const total = filteredCommissions.length;
    const paginatedCommissions = filteredCommissions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice((pageNum - 1) * limitNum, pageNum * limitNum);

    res.json({
      message: "Commission breakdown retrieved",
      affiliate: { code: affiliate.code, status: affiliate.status },
      summary: {
        totalCommissions: commissions.filter(c => c.status === "PENDING" || c.status === "APPROVED").length,
        totalAmount,
        breakdown: {
          PENDING: { count: breakdown.PENDING.count, amount: breakdown.PENDING.amount, percentage: totalAmount > 0 ? Math.round((breakdown.PENDING.amount / totalAmount) * 100) : 0, description: "Menunggu review/approval dari admin" },
          APPROVED: { count: breakdown.APPROVED.count, amount: breakdown.APPROVED.amount, percentage: totalAmount > 0 ? Math.round((breakdown.APPROVED.amount / totalAmount) * 100) : 0, description: "Sudah di-approve & langsung masuk ke dompet (bisa dicairkan)" }
        }
      },
      commissions: paginatedCommissions.map((c) => ({ id: c.id, transactionId: c.transactionId, from: c.affiliate.user.fullName, level: c.level, amount: c.amount, status: c.status, createdAt: c.createdAt, approvedAt: c.approvedAt })),
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getMyCommissions = async (req, res) => {
  try {
    const userId = req.userId;
    const { page = 1, limit = 20, status } = req.query;

    const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!affiliate) return res.status(404).json({ error: "Affiliate profile not found" });

    const where = { affiliateId: affiliate.id };
    if (status) where.status = status.toUpperCase();

    const commissions = await prisma.affiliateCommission.findMany({
      where,
      include: { receiver: { select: { id: true, email: true, fullName: true } } },
      orderBy: { createdAt: "desc" },
      skip: (parseInt(page, 10) - 1) * parseInt(limit, 10),
      take: parseInt(limit, 10)
    });

    const total = await prisma.affiliateCommission.count({ where });
    const summary = await getCommissionsSummary(affiliate.id);

    res.json({ message: "Commissions retrieved", page: parseInt(page, 10), limit: parseInt(limit, 10), total, summary, commissions });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getCommissionSummary = async (req, res) => {
  try {
    const userId = req.userId;
    const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId }, select: { id: true, code: true, totalEarnings: true, totalPaid: true } });
    if (!affiliate) return res.status(404).json({ error: "Affiliate profile not found" });

    const summary = await getCommissionsSummary(affiliate.id);
    res.json({ message: "Commission summary retrieved", affiliate: { id: affiliate.id, code: affiliate.code, totalEarnings: affiliate.totalEarnings, totalPaid: affiliate.totalPaid, pending: affiliate.totalEarnings - affiliate.totalPaid }, summary });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const handleWordPressWebhook = async (req, res) => {
  try {
    const { order_id, customer_affiliate_code, product_amount, product_qty = 1, order_total } = req.body;

    if (!order_id || !customer_affiliate_code || !product_amount) {
      return res.status(400).json({
        error: "Missing required webhook fields",
        required: ["order_id", "customer_affiliate_code", "product_amount"],
        optional: ["product_qty", "order_total"],
        validation: { product_amount: "MUST be exactly 500000 per item (for class/product purchase)", product_qty: "Default: 1 (how many items purchased)", note: "Activation fee (75K) does NOT trigger commission webhook" },
        example: { order_id: "ORD-001", customer_affiliate_code: "AFFP3NDE4", product_amount: 500000, product_qty: 3, order_total: 1500000 }
      });
    }

    const affiliate = await prisma.affiliateProfile.findUnique({ where: { code: customer_affiliate_code }, include: { user: { select: { email: true, fullName: true } } } });
    if (!affiliate) return res.status(404).json({ error: `Affiliate code ${customer_affiliate_code} not found`, message: "Customer must be registered as affiliate and completed activation payment" });

    if (affiliate.status !== "ACTIVE") {
      return res.status(400).json({ error: `Customer ${customer_affiliate_code} is not ACTIVE`, status: affiliate.status, message: "Customer must have completed 75K activation payment before buying product", hint: "Activation fee (75K) → ACTIVE status, then customer can buy product (500K) to trigger commissions" });
    }

    if (product_amount !== 500000) {
      return res.status(400).json({ error: "REJECTED: Product amount validation failed", received: product_amount, required: 500000, orderId: order_id, message: "Product amount MUST be exactly 500000 per item", explanation: "This webhook is ONLY for product/class purchases (500K). Activation fee (75K) is NOT processed here. If you're trying to record activation, use payment webhook instead.", validAmounts: { activation_fee: "75000 (handled by payment webhook, goes to company)", product_purchase: "500000 (triggers affiliate commission distribution)" } });
    }

    const commissions = await recordAffiliateCommissions({ customerAffiliateId: affiliate.id, transactionId: order_id, productAmount: product_amount, productQty: product_qty });

    res.status(201).json({
      message: "WordPress webhook processed - Sales commissions recorded",
      order: { order_id, product_amount, product_qty, total_amount: product_amount * product_qty },
      customer: { code: affiliate.code, email: affiliate.user.email },
      commissions_recorded: commissions.length,
      total_commission_amount: commissions.reduce((sum, c) => sum + c.amount, 0),
      commissions: commissions.map((c) => ({ level: c.level, amount: c.amount, recipient: c.receiver.fullName }))
    });
  } catch (error) { res.status(400).json({ error: error.message, details: error.toString() }); }
};

export const getReferralHierarchyWithCommissions = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const userAffiliate = await prisma.affiliateProfile.findUnique({ where: { userId }, select: { id: true, code: true, status: true, totalEarnings: true, totalPaid: true, user: { select: { id: true, email: true, fullName: true } } } });
    if (!userAffiliate) return res.status(404).json({ error: "User is not registered as affiliate" });

    const userCommissions = await prisma.affiliateCommission.findMany({ where: { userId }, select: { status: true, amount: true } });
    const commissionSummary = {
      total: userCommissions.reduce((sum, c) => sum + c.amount, 0),
      pending: userCommissions.filter(c => c.status === "PENDING").reduce((sum, c) => sum + c.amount, 0),
      approved: userCommissions.filter(c => c.status === "APPROVED").reduce((sum, c) => sum + c.amount, 0),
      paid: userCommissions.filter(c => c.status === "PAID").reduce((sum, c) => sum + c.amount, 0)
    };

    // Get all commissions for this user's affiliate (to map buyerName -> amounts)
    const myCommissions = await prisma.affiliateCommission.findMany({
      where: { affiliateId: userAffiliate.id },
      select: { id: true, level: true, amount: true, status: true, buyerName: true, transactionId: true, createdAt: true }
    });

    // Build referral tree using batched queries per level (avoids N+1)
    const { tree: referralTree, totalDirect } = await buildReferralHierarchyBatched(userAffiliate.id, myCommissions, 10);

    res.json({ message: "Referral hierarchy with commissions retrieved", user: { id: userAffiliate.user.id, email: userAffiliate.user.email, fullName: userAffiliate.user.fullName, affiliateCode: userAffiliate.code, affiliateStatus: userAffiliate.status }, commissionSummary, referrals: referralTree, totalDirectReferrals: totalDirect });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getDashboardSummary = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, fullName: true } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId }, select: { id: true, code: true, status: true, totalEarnings: true, totalPaid: true, registeredAt: true } });
    if (!affiliate) return res.status(404).json({ error: "Affiliate profile not found" });

    const commissionStats = await prisma.affiliateCommission.groupBy({ by: ['status'], where: { affiliateId: affiliate.id }, _sum: { amount: true }, _count: true });

    const statsByStatus = {};
    let totalAmount = 0;
    let totalCount = 0;
    for (const stat of commissionStats) { statsByStatus[stat.status] = { amount: stat._sum.amount || 0, count: stat._count || 0 }; totalAmount += stat._sum.amount || 0; totalCount += stat._count || 0; }

    const pendingCommissions = { _sum: { amount: statsByStatus['PENDING']?.amount || 0 }, _count: statsByStatus['PENDING']?.count || 0 };
    const approvedCommissions = { _sum: { amount: statsByStatus['APPROVED']?.amount || 0 }, _count: statsByStatus['APPROVED']?.count || 0 };
    const paidCommissions = { _sum: { amount: statsByStatus['PAID']?.amount || 0 }, _count: statsByStatus['PAID']?.count || 0 };
    const withdrawnCommissions = { _sum: { amount: statsByStatus['WITHDRAWN']?.amount || 0 }, _count: statsByStatus['WITHDRAWN']?.count || 0 };
    const totalCommissions = { _sum: { amount: totalAmount }, _count: totalCount };

    const [pendingWithdrawals, completedWithdrawals] = await Promise.all([
      prisma.commissionWithdrawal.aggregate({ where: { userId, status: { in: ["PENDING", "APPROVED"] } }, _sum: { amount: true } }),
      prisma.commissionWithdrawal.aggregate({ where: { userId, status: "COMPLETED" }, _sum: { amount: true } })
    ]);

    const allAffiliates = await prisma.affiliateProfile.findMany({ select: { id: true, referredById: true } });
    const referralMap = new Map();
    for (const aff of allAffiliates) { if (!referralMap.has(aff.referredById)) referralMap.set(aff.referredById, []); referralMap.get(aff.referredById).push(aff.id); }

    const countByLevel = (affiliateId, maxLevel = 10) => {
      const result = { level_1: 0, level_2: 0, level_3: 0, level_4: 0, level_5: 0, level_6: 0, level_7: 0, level_8: 0, level_9: 0, level_10: 0, total: 0 };
      const queue = [[affiliateId, 1]];
      while (queue.length > 0) {
        const [currentId, level] = queue.shift();
        if (level > maxLevel) continue;
        const children = referralMap.get(currentId) || [];
        if (level <= maxLevel) { result[`level_${level}`] += children.length; result.total += children.length; }
        for (const child of children) queue.push([child, level + 1]);
      }
      return result;
    };

    const referralsByLevel = countByLevel(affiliate.id);
    const totalReferrals = referralsByLevel.total;
    const directReferralsCount = referralsByLevel.level_1;

    const totalPendingAmount = pendingCommissions._sum.amount || 0;
    const totalApprovedAmount = approvedCommissions._sum.amount || 0;
    const totalPaidAmount = paidCommissions._sum.amount || 0;
    const totalWithdrawnAmount = withdrawnCommissions._sum.amount || 0;
    const totalEarned = totalCommissions._sum.amount || 0;
    const pendingWithdrawalAmount = pendingWithdrawals._sum.amount || 0;
    const completedWithdrawalAmount = completedWithdrawals._sum.amount || 0;
    const availableForWithdrawal = Math.max(0, totalApprovedAmount - pendingWithdrawalAmount);

    res.json({
      message: "Commission dashboard summary retrieved",
      user: { id: user.id, name: user.fullName, email: user.email },
      affiliate: { code: affiliate.code, status: affiliate.status, joinDate: affiliate.registeredAt, directReferrals: directReferralsCount, totalReferrals: totalReferrals, referralsByLevel: referralsByLevel },
      commissions: {
        total: { amount: totalEarned, count: totalCommissions._count || 0 },
        pending: { amount: totalPendingAmount, count: pendingCommissions._count || 0 },
        approved: { amount: totalApprovedAmount, count: approvedCommissions._count || 0 },
        paid: { amount: totalPaidAmount, count: paidCommissions._count || 0 },
        withdrawn: { amount: totalWithdrawnAmount, count: withdrawnCommissions._count || 0 }
      },
      balance: { totalEarned: totalEarned, inWallet: totalApprovedAmount, pendingWithdrawal: pendingWithdrawalAmount, availableForWithdrawal: availableForWithdrawal, completedWithdrawal: completedWithdrawalAmount, totalWithdrawn: totalWithdrawnAmount },
      summary: { totalEarnings: totalPendingAmount + totalApprovedAmount + totalPaidAmount + totalWithdrawnAmount, totalPaid: affiliate.totalPaid, activeCommissions: totalPendingAmount + totalApprovedAmount, readyToWithdraw: availableForWithdrawal }
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

