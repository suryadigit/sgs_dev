import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'mockWpData.json');

const readData = () => {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
};

const writeData = (data) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

const config = {
  siteUrl: process.env.WORDPRESS_SITE_URL || "https://jagobikinaplikasi.com/woo",
  classPrice: 500000,
  activationFee: 75000,
  commissionLevels: {
    1: 75000,
    2: 12500,
    3: 12500
  }
};

export const syncUserAsSubscriber = async (sgsUser) => {
  const { fullName, email } = sgsUser;
  const data = readData();
  
  console.log(`\n📝 [MOCK] Syncing user to WordPress as Subscriber...`);
  console.log(`   Email: ${email}`);
  
  let user = data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  
  if (user) {
    console.log(`   ⚠️ User already exists: ID ${user.id}`);
    return {
      wpUserId: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
      status: 'existing',
      hasPurchasedClass: user.hasPurchasedClass,
      isAffiliate: user.roles.includes('slicewp_affiliate')
    };
  }
  
  const username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const newUser = {
    id: data.nextUserId,
    username,
    email,
    name: fullName,
    roles: ['subscriber'],
    hasPurchasedClass: false
  };
  
  data.users.push(newUser);
  data.nextUserId++;
  writeData(data);
  
  console.log(`   ✅ User created: ID ${newUser.id}`);
  console.log(`   📌 Role: subscriber (belum affiliate)`);
  
  return {
    wpUserId: newUser.id,
    email: newUser.email,
    name: newUser.name,
    roles: newUser.roles,
    status: 'created',
    hasPurchasedClass: false,
    isAffiliate: false
  };
};

export const checkUserPurchase = async (email) => {
  const data = readData();
  
  console.log(`\n🛒 [MOCK] Checking purchases for: ${email}`);
  
  const orders = data.orders.filter(o => 
    o.customer_email.toLowerCase() === email.toLowerCase() &&
    o.status === 'completed'
  );
  
  const totalSpent = orders.reduce((sum, o) => sum + parseFloat(o.total), 0);
  const hasPurchased = orders.length > 0;
  
  console.log(`   Orders: ${orders.length}`);
  console.log(`   Total Spent: Rp ${totalSpent.toLocaleString('id-ID')}`);
  console.log(`   Has Purchased Class: ${hasPurchased ? '✅ YES' : '❌ NO'}`);
  
  return {
    hasPurchased,
    orders: orders.map(o => ({
      id: o.id,
      total: o.total,
      date: o.date_created,
      items: o.line_items
    })),
    totalSpent
  };
};

export const upgradeToAffiliate = async (wpUserId, email, referredByAffiliateId = null) => {
  const data = readData();
  
  console.log(`\n🤝 [MOCK] Upgrading user to affiliate...`);
  console.log(`   WP User ID: ${wpUserId}`);
  if (referredByAffiliateId) {
    console.log(`   Referred by Affiliate ID: ${referredByAffiliateId}`);
  }
  
  const userIndex = data.users.findIndex(u => u.id === wpUserId);
  if (userIndex === -1) {
    throw new Error(`User not found: ${wpUserId}`);
  }
  
  const user = data.users[userIndex];
  
  if (user.roles.includes('slicewp_affiliate')) {
    const existingAffiliate = data.affiliates.find(a => a.user_id === wpUserId);
    console.log(`   ⚠️ Already an affiliate`);
    return {
      affiliateId: existingAffiliate?.id || wpUserId,
      wpUserId,
      email: user.email,
      referralLink: getReferralLink(wpUserId),
      status: 'existing'
    };
  }
  
  if (!user.hasPurchasedClass) {
    console.log(`   ❌ User hasn't purchased class yet`);
    throw new Error('User must purchase class before becoming affiliate');
  }
  
  user.roles.push('slicewp_affiliate');
  data.users[userIndex] = user;
  
  const newAffiliate = {
    id: data.nextAffiliateId,
    user_id: wpUserId,
    email: user.email,
    name: user.name,
    status: 'active',
    paid_earnings: 0,
    unpaid_earnings: 0,
    referral_link: getReferralLink(wpUserId),
    referred_by: referredByAffiliateId
  };
  
  data.affiliates.push(newAffiliate);
  data.nextAffiliateId++;
  writeData(data);
  
  console.log(`   ✅ Upgraded to affiliate: ID ${newAffiliate.id}`);
  console.log(`   🔗 Referral Link: ${newAffiliate.referral_link}`);
  
  return {
    affiliateId: newAffiliate.id,
    wpUserId,
    email: user.email,
    referralLink: newAffiliate.referral_link,
    status: 'upgraded'
  };
};

export const simulatePurchase = async (email, productId = 62) => {
  const data = readData();
  
  console.log(`\n💳 [MOCK] Simulating purchase...`);
  console.log(`   Email: ${email}`);
  
  const userIndex = data.users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
  if (userIndex !== -1) {
    data.users[userIndex].hasPurchasedClass = true;
  }
  
  const product = data.products.find(p => p.id === productId);
  if (!product) {
    throw new Error(`Product not found: ${productId}`);
  }
  
  const newOrder = {
    id: 100 + data.orders.length + 1,
    customer_email: email,
    status: 'completed',
    total: product.price,
    date_created: new Date().toISOString(),
    line_items: [{
      product_id: product.id,
      name: product.name,
      price: product.price
    }]
  };
  
  data.orders.push(newOrder);
  writeData(data);
  
  console.log(`   ✅ Order created: ID ${newOrder.id}`);
  console.log(`   📦 Product: ${product.name}`);
  console.log(`   💰 Total: Rp ${parseFloat(product.price).toLocaleString('id-ID')}`);
  
  return {
    orderId: newOrder.id,
    product: product.name,
    total: product.price
  };
};

export const getReferralLink = (wpUserId) => {
  return `${config.siteUrl}/?slicewp_ref=${wpUserId}`;
};

export const findUserByEmail = async (email) => {
  const data = readData();
  return data.users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
};

export const getAffiliateByUserId = async (wpUserId) => {
  const data = readData();
  return data.affiliates.find(a => a.user_id === wpUserId) || null;
};

export const getAllAffiliates = async () => {
  const data = readData();
  return data.affiliates;
};

export const getAllUsers = async () => {
  const data = readData();
  return data.users;
};

const getUplineChain = (affiliateId, affiliates, maxLevel = 10) => {
  const chain = [];
  let currentId = affiliateId;
  let level = 0;
  
  while (currentId && level < maxLevel) {
    const affiliate = affiliates.find(a => a.id === currentId);
    if (!affiliate) break;
    
    level++;
    chain.push({
      level,
      affiliateId: affiliate.id,
      userId: affiliate.user_id,
      email: affiliate.email,
      name: affiliate.name
    });
    
    currentId = affiliate.referred_by;
  }
  
  return chain;
};

export const simulatePurchaseViaReferral = async (buyerEmail, affiliateWpUserId, productId = 62) => {
  const data = readData();
  
  console.log(`\n💳 [MOCK] Purchase via referral link...`);
  console.log(`   Buyer: ${buyerEmail}`);
  console.log(`   Direct Referrer: WP User ID ${affiliateWpUserId}`);
  
  const directAffiliate = data.affiliates.find(a => a.user_id === affiliateWpUserId);
  if (!directAffiliate) {
    throw new Error(`Affiliate not found for WP User ID: ${affiliateWpUserId}`);
  }
  
  const product = data.products.find(p => p.id === productId);
  if (!product) {
    throw new Error(`Product not found: ${productId}`);
  }
  
  const orderTotal = parseFloat(product.price);
  
  const newOrder = {
    id: 200 + data.orders.length + 1,
    customer_email: buyerEmail,
    status: 'completed',
    total: product.price,
    date_created: new Date().toISOString(),
    referred_by: affiliateWpUserId,
    line_items: [{
      product_id: product.id,
      name: product.name,
      price: product.price
    }]
  };
  data.orders.push(newOrder);
  
  const uplineChain = getUplineChain(directAffiliate.id, data.affiliates, 10);
  
  console.log(`\n   📊 MULTI-LEVEL COMMISSION BREAKDOWN:`);
  console.log(`   ═══════════════════════════════════════`);
  
  const commissions = [];
  let totalCommissionPaid = 0;
  
  for (const upline of uplineChain) {
    const commissionAmount = config.commissionLevels[upline.level] || 0;
    
    if (commissionAmount > 0) {
      const newCommission = {
        id: data.nextCommissionId,
        affiliate_id: upline.affiliateId,
        order_id: newOrder.id,
        amount: commissionAmount,
        level: upline.level,
        status: 'unpaid',
        type: 'sale',
        date_created: new Date().toISOString(),
        reference: `Order #${newOrder.id} - ${buyerEmail} | Level ${upline.level} commission`
      };
      
      data.commissions.push(newCommission);
      data.nextCommissionId++;
      
      const affIndex = data.affiliates.findIndex(a => a.id === upline.affiliateId);
      if (affIndex !== -1) {
        data.affiliates[affIndex].unpaid_earnings = 
          (data.affiliates[affIndex].unpaid_earnings || 0) + commissionAmount;
      }
      
      commissions.push({
        ...newCommission,
        affiliateName: upline.name,
        affiliateEmail: upline.email
      });
      
      totalCommissionPaid += commissionAmount;
      
      const levelLabel = upline.level === 1 ? '(DIRECT)' : '';
      console.log(`   Level ${upline.level} ${levelLabel}: ${upline.name} → Rp ${commissionAmount.toLocaleString('id-ID')}`);
    }
  }
  
  writeData(data);
  
  console.log(`   ═══════════════════════════════════════`);
  console.log(`   ✅ Order: #${newOrder.id}`);
  console.log(`   💰 Order Total: Rp ${orderTotal.toLocaleString('id-ID')}`);
  console.log(`   🤑 Total Commission Distributed: Rp ${totalCommissionPaid.toLocaleString('id-ID')}`);
  console.log(`   👥 Affiliates Paid: ${commissions.length} levels`);
  
  return {
    order: newOrder,
    commissions: commissions,
    summary: {
      orderTotal,
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

export const getAffiliateCommissions = async (affiliateId) => {
  const data = readData();
  
  const commissions = data.commissions.filter(c => c.affiliate_id === affiliateId);
  const totalEarnings = commissions.reduce((sum, c) => sum + c.amount, 0);
  const paidEarnings = commissions
    .filter(c => c.status === 'paid')
    .reduce((sum, c) => sum + c.amount, 0);
  const unpaidEarnings = commissions
    .filter(c => c.status === 'unpaid')
    .reduce((sum, c) => sum + c.amount, 0);
  
  return {
    affiliateId,
    totalEarnings,
    paidEarnings,
    unpaidEarnings,
    commissions: commissions.map(c => ({
      id: c.id,
      orderId: c.order_id,
      amount: c.amount,
      status: c.status,
      date: c.date_created,
      reference: c.reference
    }))
  };
};

export const getAffiliateDashboard = async (email) => {
  const data = readData();
  
  const user = data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return { error: 'User not found' };
  }
  
  if (!user.roles.includes('slicewp_affiliate')) {
    return {
      isAffiliate: false,
      message: 'User belum jadi affiliate. Harus beli kelas dulu.',
      hasPurchasedClass: user.hasPurchasedClass
    };
  }
  
  const affiliate = data.affiliates.find(a => a.user_id === user.id);
  if (!affiliate) {
    return { error: 'Affiliate data not found' };
  }
  
  const commissionsData = await getAffiliateCommissions(affiliate.id);
  
  return {
    isAffiliate: true,
    wpUserId: user.id,
    affiliateId: affiliate.id,
    name: user.name,
    email: user.email,
    referralLink: affiliate.referral_link,
    earnings: {
      total: commissionsData.totalEarnings,
      paid: commissionsData.paidEarnings,
      unpaid: commissionsData.unpaidEarnings
    },
    commissions: commissionsData.commissions
  };
};

export const syncAndCheckStatus = async (sgsUser) => {
  const { fullName, email } = sgsUser;
  
  console.log(`\n🔄 ====== SYNC & CHECK STATUS ======`);
  console.log(`📧 ${email}`);
  
  const userResult = await syncUserAsSubscriber(sgsUser);
  const purchaseResult = await checkUserPurchase(email);
  
  let affiliateResult = null;
  if (purchaseResult.hasPurchased && !userResult.isAffiliate) {
    const data = readData();
    const userIndex = data.users.findIndex(u => u.id === userResult.wpUserId);
    if (userIndex !== -1) {
      data.users[userIndex].hasPurchasedClass = true;
      writeData(data);
    }
    
    affiliateResult = await upgradeToAffiliate(userResult.wpUserId, email);
  } else if (userResult.isAffiliate) {
    affiliateResult = {
      affiliateId: userResult.wpUserId,
      referralLink: getReferralLink(userResult.wpUserId),
      status: 'existing'
    };
  }
  
  console.log(`\n✅ ====== STATUS COMPLETE ======`);
  console.log(`📌 WP User ID: ${userResult.wpUserId}`);
  console.log(`📌 Has Purchased: ${purchaseResult.hasPurchased ? 'YES' : 'NO'}`);
  console.log(`📌 Is Affiliate: ${affiliateResult ? 'YES' : 'NO'}`);
  if (affiliateResult) {
    console.log(`📌 Referral Link: ${affiliateResult.referralLink}`);
  }
  console.log(`==============================\n`);
  
  return {
    user: userResult,
    purchase: purchaseResult,
    affiliate: affiliateResult,
    referralLink: affiliateResult?.referralLink || null
  };
};

export default {
  syncUserAsSubscriber,
  checkUserPurchase,
  upgradeToAffiliate,
  syncAndCheckStatus,
  simulatePurchaseViaReferral,
  getAffiliateCommissions,
  getAffiliateDashboard,
  simulatePurchase,
  getReferralLink,
  findUserByEmail,
  getAffiliateByUserId,
  getAllAffiliates,
  getAllUsers
};
