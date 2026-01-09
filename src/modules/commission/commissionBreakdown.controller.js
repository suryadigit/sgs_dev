import { getCache, setCache } from "../../shared/utils/dashboardCache.js";
import { getCommissionBreakdownWithDetails, calculateSummaryFromBreakdown, queryRecentCommissions } from "./referralCommission.service.js";

export const getCommissionBreakdown = async (req, res) => {
  try {
    const userId = req.userId;
    const cacheKey = `commission_breakdown:${userId}`;
    const cachedData = getCache(cacheKey);
    if (cachedData) return res.json({ ...cachedData, _cached: true });

    const commissionByLevel = await getCommissionBreakdownWithDetails(userId);
    const summary = calculateSummaryFromBreakdown(commissionByLevel);

    const responseData = { message: "Commission breakdown by level", summary, byLevel: commissionByLevel, note: "Includes referrer name, code, and detailed transaction information", performance: { query: "detailed query with affiliate joins", cached: true, cacheExpiry: "5 minutes" } };

    setCache(cacheKey, responseData);
    res.json(responseData);
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getRecentCommissionsDetails = async (req, res) => {
  try {
    const userId = req.userId;
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
    const cacheKey = `recent_commissions:${userId}:limit${limit}`;
    const cachedData = getCache(cacheKey);
    if (cachedData) return res.json({ ...cachedData, _cached: true });

    const commissions = await queryRecentCommissions(userId, limit);
    const responseData = { message: "Recent commissions retrieved", limit, count: commissions.length, commissions: commissions.map(c => ({ id: c.id, level: c.level, amount: c.amount, status: c.status, from: c.affiliate?.user?.fullName || 'Unknown', affiliateCode: c.affiliate?.code, date: c.createdAt })), performance: { optimized: true, cached: true } };

    setCache(cacheKey, responseData, 300);
    res.json(responseData);
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getCommissionStatsByLevel = async (req, res) => {
  try {
    const userId = req.userId;
    const cacheKey = `commission_stats_by_level:${userId}`;
    const cachedData = getCache(cacheKey);
    if (cachedData) return res.json({ ...cachedData, _cached: true });

    const commissionByLevel = await getCommissionBreakdown(userId);
    const chartData = Object.entries(commissionByLevel).map(([level, stats]) => ({ level: parseInt(level.split('_')[1]), total: stats.total, pending: stats.pending, approved: stats.approved, count: stats.count, percentage: stats.total > 0 ? ((stats.approved / stats.total) * 100).toFixed(2) : 0 }));

    const responseData = { message: "Commission statistics by level", chartData, summary: { totalLevels: chartData.filter(c => c.count > 0).length, topLevel: chartData.reduce((max, c) => c.total > max.total ? c : max, { total: 0 }) } };

    setCache(cacheKey, responseData, 600);
    res.json(responseData);
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export default { getCommissionBreakdown, getRecentCommissionsDetails, getCommissionStatsByLevel };
