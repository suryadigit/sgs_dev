import axios from "axios";
import prisma from "../../shared/lib/prisma.js";
import pLimit from 'p-limit';
import { cacheGet as _redisGet, cacheSet as _redisSet } from "../../shared/lib/cache.redis.js";

const config = {
  baseUrl: process.env.WORDPRESS_API || "https://jagobikinaplikasi.com/woo/wp-json",
  siteUrl: process.env.WORDPRESS_SITE_URL || "https://jagobikinaplikasi.com/woo",
  auth: {
    username: process.env.WORDPRESS_USER || "",
    password: process.env.WORDPRESS_APP_PASS || "",
  },
  get wpApi() { return `${this.baseUrl}/wp/v2`; },
  get wcApi() { return `${this.baseUrl}/wc/v3`; },
  get sgsApi() { return `${this.baseUrl}/sgs/v1`; },
  commissionLevels: {
    1: 75000,
    2: 12500,
    3: 12500
  },
  classProductId: 62
};

const generatePassword = () => {
  return Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-4);
};

const __shortCache = new Map();
const __getCache = async (key) => {
  try {
    const redisVal = await _redisGet(key);
    if (redisVal !== null && redisVal !== undefined) return redisVal;
  } catch (e) { /* ignore redis errors */ }

  const entry = __shortCache.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) { __shortCache.delete(key); return null; }
  return entry.value;
};
const __setCache = async (key, value, ttl = 5) => {
  try {
    await _redisSet(key, value, ttl);
  } catch (e) { /* ignore redis errors */ }

  const expires = Date.now() + ttl * 1000;
  __shortCache.set(key, { value, expires });
  setTimeout(() => { const e = __shortCache.get(key); if (e && e.expires <= Date.now()) __shortCache.delete(key); }, ttl * 1000 + 100);
};

const _concurrencyLimit = process.env.WP_CONCURRENCY_LIMIT ? parseInt(process.env.WP_CONCURRENCY_LIMIT, 10) : 3;
const _limit = pLimit(_concurrencyLimit);

export const createUser = async (user) => {
  try {
    const { name, email, password } = user;
    const username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    
    const nameParts = (name || 'User').trim().split(' ');
    const firstName = nameParts[0] || 'User';
    const lastName = nameParts.slice(1).join(' ') || '';
    
    console.log(`📝 Creating WordPress user: ${username} (${name})`);
    
    const res = await axios.post(
      `${config.wpApi}/users`,
      {
        username,
        email,
        password,
        name: name || firstName,
        first_name: firstName,
        last_name: lastName,
        nickname: name || firstName,
        roles: ['subscriber']
      },
      { auth: config.auth }
    );
    
    console.log(`✅ WordPress user created: ID ${res.data.id}`);
    return res.data;
    
  } catch (error) {
    if (error.response?.data?.code === 'existing_user_login' || 
        error.response?.data?.code === 'existing_user_email') {
      console.log(`⚠️ User already exists, finding...`);
      return await findUserByEmail(user.email);
    }
    
    console.error("❌ Error creating user:", error.response?.data?.message || error.message);
    throw new Error(`Failed to create WordPress user: ${error.response?.data?.message || error.message}`);
  }
};

export const findUserByEmail = async (email) => {
  const cacheKey = `findUserByEmail:${email}`;
  const cached = await __getCache(cacheKey);
  if (cached !== null) return cached;
  try {
    const res = await axios.get(`${config.wpApi}/users`, {
      params: { search: email },
      auth: config.auth,
    });
    const user = res.data.length > 0 ? res.data[0] : null;
    if (user) await __setCache(cacheKey, user, 5);
    return user;
    
  } catch (error) {
    console.error("❌ Error finding user:", error.message);
    return null;
  }
};

export const createAffiliate = async (wpUserId, email) => {
  try {
    console.log(`🤝 Creating affiliate for WP User ID: ${wpUserId}`);
    
    console.log(`   [1/2] Updating WordPress role...`);
    const roleRes = await axios.post(
      `${config.wpApi}/users/${wpUserId}`,
      { roles: ['subscriber', 'slicewp_affiliate'] },
      { auth: config.auth }
    );
    console.log(`   ✅ Role updated: ${JSON.stringify(roleRes.data.roles)}`);
    
    console.log(`   [2/2] Inserting to SliceWP table...`);
    let affiliateId = null;
    try {
      const sliceRes = await axios.post(
        `${config.sgsApi}/create-affiliate`,
        { user_id: wpUserId, email: email },
        { auth: config.auth }
      );
      affiliateId = sliceRes.data.affiliate_id;
      console.log(`   ✅ SliceWP affiliate created: ID ${affiliateId}`);
    } catch (sliceError) {
      console.log(`   ⚠️ SliceWP insert failed: ${sliceError.response?.data?.message || sliceError.message}`);
    }
    
    const referralLink = affiliateId ? getReferralLink(affiliateId) : null;
    
    console.log(`✅ Affiliate created successfully!`);
    console.log(`   WP User ID: ${wpUserId}`);
    console.log(`   Affiliate ID: ${affiliateId || 'N/A'}`);
    console.log(`   Referral Link: ${referralLink || 'N/A (no affiliate ID)'}`);
    
    return {
      id: roleRes.data.id,
      user_id: wpUserId,
      affiliate_id: affiliateId,
      email: email,
      status: 'active',
      roles: roleRes.data.roles,
      referralLink: referralLink
    };
    
  } catch (error) {
    console.error("❌ Error creating affiliate:", error.response?.data?.message || error.message);
    throw new Error(`Failed to create affiliate: ${error.response?.data?.message || error.message}`);
  }
};

export const getReferralLink = (affiliateId) => {
  return `${config.siteUrl}/shop/?aff=${affiliateId}`;
};

export const syncUserToWordPress = async (sgsUser) => {
  const { fullName, email, password } = sgsUser;
  
  console.log(`\n🔄 ====== SYNC TO WORDPRESS ======`);
  console.log(`📧 ${email} | 👤 ${fullName}`);
  
  let wpUser = await findUserByEmail(email);
  if (!wpUser) {
    const wpPassword = password || generatePassword();
    wpUser = await createUser({ name: fullName, email, password: wpPassword });
  }
  
  const wpUserId = wpUser.id;
  const affiliate = await createAffiliate(wpUserId, email);
  const referralLink = affiliate.affiliate_id ? getReferralLink(affiliate.affiliate_id) : null;
  
  console.log(`✅ SYNC COMPLETE`);
  console.log(`📌 WP User ID: ${wpUserId}`);
  console.log(`📌 Referral: ${referralLink}`);
  console.log(`==============================\n`);
  
  return {
    wpUser,
    wpUserId,
    affiliate,
    referralLink
  };
};

export const checkPurchases = async (email, productId = null) => {
  try {
    const cacheKey = `checkPurchases:${email}:${productId || 'all'}`;
    const cached = await __getCache(cacheKey);
    if (cached !== null) return cached;
    const res = await axios.get(`${config.wcApi}/orders`, {
      params: {
        search: email,
        status: 'completed,processing',
        per_page: 100
      },
      auth: config.auth,
    });
    
    const orders = res.data;
    if (orders.length === 0) {
      return { hasPurchased: false, orders: [], products: [], totalSpent: 0 };
    }
    
    const products = [];
    let totalSpent = 0;
    
    for (const order of orders) {
      totalSpent += parseFloat(order.total);
      for (const item of order.line_items) {
        products.push({
          orderId: order.id,
          orderDate: order.date_created,
          productId: item.product_id,
          productName: item.name,
          price: item.total
        });
      }
    }
    
    const hasPurchased = productId 
      ? products.some(p => p.productId === productId)
      : products.length > 0;
    
    const result = { hasPurchased, orders: orders.length, products, totalSpent };
    await __setCache(cacheKey, result, 10);
    return result;
    
  } catch (error) {
    console.error("❌ Error checking purchases:", error.message);
    return { hasPurchased: false, orders: [], products: [], totalSpent: 0 };
  }
};

export const getProducts = async () => {
  try {
    const cacheKey = `getProducts:published`;
    const cached = await __getCache(cacheKey);
    if (cached !== null) return cached;

    const res = await axios.get(`${config.wcApi}/products`, {
      params: { status: 'publish', per_page: 100 },
      auth: config.auth,
    });

    const mapped = res.data.map(p => ({ id: p.id, name: p.name, price: p.price, regularPrice: p.regular_price }));
    await __setCache(cacheKey, mapped, 30);
    return mapped;
    
  } catch (error) {
    console.error("❌ Error fetching products:", error.message);
    return [];
  }
};

export const testConnection = async () => {
  try {
    const res = await axios.get(`${config.wpApi}/users/me`, { auth: config.auth });
    console.log(`✅ Connected as: ${res.data.name} (ID: ${res.data.id})`);
    return { success: true, user: res.data };
  } catch (error) {
    console.error("❌ Connection failed:", error.message);
    return { success: false, error: error.message };
  }
};

export const getCustomerDetails = async (customerId) => {
  try {
    const cacheKey = `getCustomerDetails:${customerId}`;
    const cached = await __getCache(cacheKey);
    if (cached !== null) return cached;
    const res = await axios.get(`${config.wcApi}/customers/${customerId}`, {
      auth: config.auth
    });
    const out = { id: res.data.id, email: res.data.email, role: res.data.role, firstName: res.data.first_name, lastName: res.data.last_name, isAffiliate: res.data.role === 'slicewp_affiliate' };
    await __setCache(cacheKey, out, 60);
    return out;
  } catch (error) {
    console.error("❌ Error getting customer:", error.message);
    return null;
  }
};

export const syncUserAsSubscriber = async (sgsUser) => {
  const { id: sgsUserId, fullName, email } = sgsUser;

  console.log(`\n📝 [PRODUCTION] Syncing user to WordPress as Subscriber...`);
  console.log(`   Email: ${email}`);

  if (!sgsUserId || !email) {
    console.error('❌ Tidak bisa sync: userId atau email undefined/null!', { sgsUserId, email });
    return { error: 'UserId atau email undefined/null, tidak bisa update affiliateProfile.' };
  }

  let wpUser = await findUserByEmail(email);
  let wpUserStatus = 'existing';

  if (wpUser) {
    console.log(`   ⚠️ WP User already exists: ID ${wpUser.id}`);
  } else {
    const wpPassword = generatePassword();
    wpUser = await createUser({ name: fullName, email, password: wpPassword });
    wpUserStatus = 'created';
    console.log(`   ✅ WP User created: ID ${wpUser.id}`);
  }

  await prisma.affiliateProfile.update({
    where: { userId: sgsUserId },
    data: {
      wpUserId: wpUser.id,
      status: 'ACTIVE',
      activatedAt: new Date()
    }
  });

  console.log(`   ✅ SGS Database updated`);
  console.log(`   📌 Status: ACTIVE (Subscriber only)`);
  console.log(`   ℹ️ User perlu beli kelas 500k untuk jadi Affiliate`);

  return {
    wpUserId: wpUser.id,
    email: wpUser.email,
    roles: ['subscriber'],
    status: wpUserStatus,
    isAffiliate: false,
    message: 'User synced as Subscriber. Buy class 500k to become Affiliate.'
  };
};

export const checkUserPurchase = async (email) => {
  console.log(`\n🛒 [PRODUCTION] Checking purchases for: ${email}`);
  
  const result = await checkPurchases(email, config.classProductId);
  
  console.log(`   Orders: ${result.orders}`);
  console.log(`   Total Spent: Rp ${result.totalSpent.toLocaleString('id-ID')}`);
  console.log(`   Has Purchased Class: ${result.hasPurchased ? '✅ YES' : '❌ NO'}`);
  
  return result;
};

export const upgradeToAffiliate = async (sgsUserId, wpUserId, email, fullName = '') => {
  console.log(`\n🤝 [PRODUCTION] Upgrading user to affiliate...`);
  console.log(`   WP User ID: ${wpUserId}`);
  
  const affiliate = await prisma.affiliateProfile.findUnique({
    where: { userId: sgsUserId },
    include: { user: true }
  });
  
  if (affiliate?.wpAffiliateId) {
    console.log(`   ⚠️ Already an affiliate`);
    return {
      affiliateId: affiliate.id,
      wpAffiliateId: affiliate.wpAffiliateId,
      code: affiliate.code,
      wpUserId,
      email,
      referralLink: affiliate.wpReferralLink,
      status: 'existing'
    };
  }
  
  const name = fullName || affiliate?.user?.fullName || 'USR';
  
  const wpAffiliate = await createAffiliate(wpUserId, email);
  const slicewpId = wpAffiliate.affiliate_id;
  
  if (!slicewpId) {
    throw new Error('Failed to create SliceWP affiliate');
  }
  
  console.log(`   ✅ SliceWP Affiliate created: ID ${slicewpId}`);
  
  const paddedId = String(slicewpId).padStart(3, '0');
  const namePrefix = name.substring(0, 3).toUpperCase();
  const customCode = `AFF${paddedId}${namePrefix}`;
  
  console.log(`   📌 Custom Code: ${customCode}`);
  
  const referralLink = getReferralLink(slicewpId);
  
  console.log(`   🔗 Referral Link: ${referralLink}`);
  
  await prisma.affiliateProfile.update({
    where: { userId: sgsUserId },
    data: { 
      wpUserId,
      wpAffiliateId: slicewpId,
      wpReferralLink: referralLink,
      code: customCode,
      status: 'ACTIVE',
      activatedAt: new Date()
    }
  });
  
  console.log(`   ✅ SGS Database updated`);
  console.log(`   📌 Status: ACTIVE (Full Affiliate)`);
  
  return {
    affiliateId: affiliate.id,
    wpAffiliateId: slicewpId,
    code: customCode,
    wpUserId,
    email,
    referralLink,
    status: 'upgraded'
  };
};

const getUplineChain = async (affiliateId, maxLevel = 3) => {
  const chain = [];
  let currentId = affiliateId;
  let level = 0;
  
  while (currentId && level < maxLevel) {
    const affiliate = await prisma.affiliateProfile.findUnique({
      where: { id: currentId },
      include: { user: true }
    });
    
    if (!affiliate) break;
    
    level++;
    chain.push({
      level,
      affiliateId: affiliate.id,
      sgsUserId: affiliate.userId,
      wpUserId: affiliate.wpUserId,
      wpAffiliateId: affiliate.wpAffiliateId,
      email: affiliate.user.email,
      name: affiliate.user.fullName
    });
    
    currentId = affiliate.referredById;
  }
  
  return chain;
};

const insertSliceWPCommission = async (slicewpAffiliateId, orderId, amount, orderTotal) => {
  try {
    const res = await axios.post(
      `${config.sgsApi}/create-commission`,
      {
        affiliate_id: slicewpAffiliateId,
        order_id: String(orderId),
        amount: amount,
        order_total: orderTotal
      },
      { auth: config.auth }
    );
    console.log(`   ✅ SliceWP commission inserted: Affiliate ${slicewpAffiliateId}, Rp ${amount.toLocaleString('id-ID')}`);
    return res.data;
  } catch (error) {
    console.log(`   ⚠️ SliceWP commission insert failed: ${error.response?.data?.message || error.message}`);
    return null;
  }
};

export const processReferralSale = async (orderData) => {
  const { orderId, customerEmail, total, slicewpAffiliateId } = orderData;
  
  console.log(`\n💰 [PRODUCTION] Processing referral sale...`);
  console.log(`   Order: #${orderId}`);
  console.log(`   Customer: ${customerEmail}`);
  console.log(`   Total: Rp ${parseFloat(total).toLocaleString('id-ID')}`);
  console.log(`   SliceWP Affiliate ID: ${slicewpAffiliateId}`);
  
  const directAffiliate = await prisma.affiliateProfile.findFirst({
    where: { wpAffiliateId: parseInt(slicewpAffiliateId) },
    include: { user: true }
  });
  
  if (!directAffiliate) {
    console.log(`   ❌ Affiliate not found for SliceWP ID: ${slicewpAffiliateId}`);
    return { error: 'Affiliate not found' };
  }
  
  console.log(`   ✅ Found affiliate: ${directAffiliate.user.fullName}`);
  
  const uplineChain = await getUplineChain(directAffiliate.id, 3);
  
  console.log(`\n   📊 MULTI-LEVEL COMMISSION BREAKDOWN:`);
  console.log(`   ═══════════════════════════════════════`);
  
  const results = await Promise.all(uplineChain.map(upline => _limit(async () => {
    const commissionAmount = config.commissionLevels[upline.level] || 0;
    if (commissionAmount <= 0) return null;

    const existingCommission = await prisma.affiliateCommission.findFirst({ where: { affiliateId: upline.affiliateId, transactionId: `WC-${orderId}` } });
    if (existingCommission) {
      console.log(`   ⚠️ Commission already exists for Level ${upline.level}: ${upline.name}`);
      return null;
    }


    const commission = await prisma.affiliateCommission.create({ data: { affiliateId: upline.affiliateId, userId: upline.sgsUserId, transactionId: `WC-${orderId}`, amount: commissionAmount, level: upline.level, status: 'PENDING', buyerName: customerEmail, productName: 'Kelas Digital Marketing', sourceType: 'WORDPRESS_SALE' } });

    await prisma.affiliateProfile.update({ where: { id: upline.affiliateId }, data: { totalEarnings: { increment: commissionAmount } } });

    try { const { invalidateAffiliateCache, invalidateUserCache } = await import('../../shared/utils/dashboardCache.js'); invalidateAffiliateCache(upline.affiliateId); invalidateUserCache(upline.sgsUserId); } catch (e) {}

    if (upline.wpAffiliateId) {
      try { await insertSliceWPCommission(upline.wpAffiliateId, orderId, commissionAmount, parseFloat(total)); } catch (e) { /* ignore */ }
    }

    const levelLabel = upline.level === 1 ? '(DIRECT)' : '';
    console.log(`   Level ${upline.level} ${levelLabel}: ${upline.name} → Rp ${commissionAmount.toLocaleString('id-ID')}`);

    return { id: commission.id, affiliateId: upline.affiliateId, wpAffiliateId: upline.wpAffiliateId, affiliateName: upline.name, level: upline.level, amount: commissionAmount };
  })));

  const commissions = (results || []).filter(Boolean);
  let totalCommissionPaid = commissions.reduce((s, c) => s + (c.amount || 0), 0);
  
  console.log(`   ═══════════════════════════════════════`);
  console.log(`   ✅ Order: #${orderId}`);
  console.log(`   💰 Order Total: Rp ${parseFloat(total).toLocaleString('id-ID')}`);
  console.log(`   🤑 Total Commission Distributed: Rp ${totalCommissionPaid.toLocaleString('id-ID')}`);
  console.log(`   👥 Affiliates Paid: ${commissions.length} levels`);
  
  return {
    orderId,
    customerEmail,
    orderTotal: parseFloat(total),
    commissions,
    summary: {
      totalCommissionPaid,
      levelsDistributed: commissions.length,
      breakdown: commissions.map(c => ({
        level: c.level,
        name: c.affiliateName,
        amount: c.amount
      }))
    }
  };
};

export const getAffiliateDashboard = async (sgsUserId) => {
  const affiliate = await prisma.affiliateProfile.findUnique({
    where: { userId: sgsUserId },
    include: {
      user: true,
      commissions: {
        orderBy: { createdAt: 'desc' },
        take: 20
      }
    }
  });
  
  if (!affiliate) {
    return { error: 'Affiliate not found' };
  }
  
  const totalUnpaid = affiliate.totalEarnings - affiliate.totalPaid;
  
  return {
    isAffiliate: !!affiliate.wpReferralLink,
    affiliateId: affiliate.id,
    wpUserId: affiliate.wpUserId,
    email: affiliate.user.email,
    referralLink: affiliate.wpReferralLink,
    earnings: {
      total: affiliate.totalEarnings,
      paid: affiliate.totalPaid,
      unpaid: totalUnpaid
    },
    commissions: affiliate.commissions.map(c => ({
      id: c.id,
      orderId: c.transactionId,
      amount: c.amount,
      level: c.level,
      status: c.status,
      buyerName: c.buyerName,
      date: c.createdAt
    }))
  };
};

export const getAffiliateByUserId = async (wpUserId) => {
  const affiliate = await prisma.affiliateProfile.findFirst({
    where: { wpUserId: parseInt(wpUserId) },
    include: { user: true }
  });
  
  if (!affiliate) return null;
  
  return {
    id: affiliate.id,
    sgsUserId: affiliate.userId,
    wpUserId: affiliate.wpUserId,
    email: affiliate.user.email,
    name: affiliate.user.fullName,
    referralLink: affiliate.wpReferralLink,
    referredById: affiliate.referredById,
    totalEarnings: affiliate.totalEarnings,
    totalPaid: affiliate.totalPaid
  };
};

export const getAffiliateCommissions = async (affiliateId) => {
  const commissions = await prisma.affiliateCommission.findMany({
    where: { affiliateId },
    orderBy: { createdAt: 'desc' }
  });
  
  const total = commissions.reduce((sum, c) => sum + c.amount, 0);
  const paid = commissions.filter(c => c.status === 'PAID').reduce((sum, c) => sum + c.amount, 0);
  const unpaid = total - paid;
  
  return {
    total,
    paid,
    unpaid,
    count: commissions.length,
    commissions: commissions.map(c => ({
      id: c.id,
      orderId: c.transactionId,
      amount: c.amount,
      level: c.level,
      status: c.status,
      buyerName: c.buyerName,
      date: c.createdAt
    }))
  };
};

export const syncAndCheckStatus = async (sgsUser) => {
  const { fullName, email } = sgsUser;
  
  console.log(`\n🔄 [PRODUCTION] Sync and check status for: ${email}`);
  
  let wpUser = await findUserByEmail(email);
  let userStatus = 'existing';
  
  if (!wpUser) {
    const wpPassword = generatePassword();
    wpUser = await createUser({ name: fullName, email, password: wpPassword });
    userStatus = 'created';
  }
  
  const wpUserId = wpUser.id;
  const isAffiliate = wpUser.roles?.includes('slicewp_affiliate') || false;
  
  const purchaseResult = await checkPurchases(email, config.classProductId);
  
  let affiliateInfo = null;
  let referralLink = null;
  
  if (isAffiliate) {
    referralLink = getReferralLink(wpUserId);
    affiliateInfo = {
      wpUserId,
      referralLink,
      status: 'active'
    };
  }
  
  return {
    user: {
      wpUserId,
      email: wpUser.email,
      name: wpUser.name,
      roles: wpUser.roles || ['subscriber'],
      status: userStatus
    },
    purchase: {
      hasPurchased: purchaseResult.hasPurchased,
      totalSpent: purchaseResult.totalSpent,
      orders: purchaseResult.orders
    },
    affiliate: affiliateInfo,
    referralLink,
    nextStep: !purchaseResult.hasPurchased 
      ? 'Beli kelas 500k dulu' 
      : (!isAffiliate ? 'Upgrade ke affiliate' : 'Share referral link!')
  };
};

export const getSliceWPAffiliate = async (slicewpAffiliateId) => {
  try {
    const res = await axios.get(
      `${config.sgsApi}/affiliate/${slicewpAffiliateId}`,
      { auth: config.auth }
    );
    return res.data;
  } catch (error) {
    console.error(`❌ Error getting SliceWP affiliate: ${error.message}`);
    return null;
  }
};

export const checkSliceWPCookie = async () => {
  try {
    const res = await axios.get(
      `${config.sgsApi}/check-cookie`,
      { auth: config.auth }
    );
    return res.data;
  } catch (error) {
    console.error(`❌ Error checking cookie: ${error.message}`);
    return { cookie_set: false, affiliate_id: null };
  }
};

export const createSliceWPCommission = async (affiliateId, orderId, amount, orderTotal) => {
  try {
    const res = await axios.post(
      `${config.sgsApi}/create-commission`,
      {
        affiliate_id: affiliateId,
        order_id: String(orderId),
        amount: amount,
        order_total: orderTotal
      },
      { auth: config.auth }
    );
    console.log(`✅ SliceWP commission created: ID ${res.data.commission_id}`);
    return res.data;
  } catch (error) {
    console.error(`❌ Error creating commission: ${error.response?.data?.message || error.message}`);
    return null;
  }
};

export const setSliceWPAffiliateParent = async (affiliateId, parentAffiliateId) => {
  try {
    const res = await axios.post(
      `${config.sgsApi}/set-affiliate-parent`,
      {
        affiliate_id: affiliateId,
        parent_affiliate_id: parentAffiliateId
      },
      { auth: config.auth }
    );
    console.log(`✅ Parent set: Affiliate ${affiliateId} → Parent ${parentAffiliateId}`);
    return res.data;
  } catch (error) {
    console.error(`❌ Error setting parent: ${error.response?.data?.message || error.message}`);
    return null;
  }
};

export const getAffiliateBySliceWPId = async (slicewpAffiliateId) => {
  const affiliate = await prisma.affiliateProfile.findFirst({
    where: { wpAffiliateId: parseInt(slicewpAffiliateId) },
    include: { user: true }
  });
  
  if (!affiliate) return null;
  
  return {
    id: affiliate.id,
    sgsUserId: affiliate.userId,
    wpUserId: affiliate.wpUserId,
    wpAffiliateId: affiliate.wpAffiliateId,
    email: affiliate.user.email,
    name: affiliate.user.fullName,
    referralLink: affiliate.wpReferralLink,
    referredById: affiliate.referredById,
    totalEarnings: affiliate.totalEarnings,
    totalPaid: affiliate.totalPaid
  };
};

export const syncSliceWPAffiliateToSGS = async (slicewpAffiliateId) => {
  console.log(`\n🔄 Syncing SliceWP affiliate ${slicewpAffiliateId} to SGS...`);
  
  const sliceData = await getSliceWPAffiliate(slicewpAffiliateId);
  if (!sliceData || !sliceData.affiliate) {
    console.log(`   ❌ Affiliate not found in SliceWP`);
    return null;
  }
  
  const { affiliate, stats, parent_affiliate_id } = sliceData;
  
  let sgsAffiliate = await prisma.affiliateProfile.findFirst({
    where: { wpAffiliateId: slicewpAffiliateId }
  });
  
  if (!sgsAffiliate) {
    sgsAffiliate = await prisma.affiliateProfile.findFirst({
      where: { wpUserId: affiliate.user_id }
    });
  }
  
  if (sgsAffiliate) {
    await prisma.affiliateProfile.update({
      where: { id: sgsAffiliate.id },
      data: {
        wpAffiliateId: slicewpAffiliateId,
        wpUserId: affiliate.user_id
      }
    });
    console.log(`   ✅ Updated SGS affiliate: ${sgsAffiliate.id}`);
  } else {
    console.log(`   ⚠️ SGS affiliate not found for SliceWP ID ${slicewpAffiliateId}`);
  }
  
  return {
    slicewp: sliceData,
    sgs: sgsAffiliate
  };
};

export const getFullAffiliateDashboard = async (sgsUserId) => {
  const sgsData = await getAffiliateDashboard(sgsUserId);
  if (sgsData.error) return sgsData;
  
  let slicewpData = null;
  if (sgsData.wpAffiliateId) {
    slicewpData = await getSliceWPAffiliate(sgsData.wpAffiliateId);
  }
  
  return {
    ...sgsData,
    slicewp: slicewpData ? {
      visits: slicewpData.stats?.visits || 0,
      commissionsCount: slicewpData.stats?.commissions_count || 0,
      commissionsTotal: slicewpData.stats?.commissions_total || 0
    } : null
  };
};

export default {
  createUser,
  findUserByEmail,
  createAffiliate,
  getReferralLink,
  syncUserToWordPress,
  syncUserAsSubscriber,
  checkUserPurchase,
  upgradeToAffiliate,
  processReferralSale,
  getAffiliateDashboard,
  getFullAffiliateDashboard,
  getAffiliateCommissions,
  getAffiliateByUserId,
  getAffiliateBySliceWPId,
  syncAndCheckStatus,
  getSliceWPAffiliate,
  checkSliceWPCookie,
  createSliceWPCommission,
  setSliceWPAffiliateParent,
  syncSliceWPAffiliateToSGS,
  checkPurchases,
  getProducts,
  getCustomerDetails,
  testConnection,
  config
};
