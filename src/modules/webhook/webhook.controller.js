import prisma from "../../shared/lib/prisma.js";

const generateAffiliateCode = (wpAffiliateId, name) => {
  const paddedId = String(wpAffiliateId).padStart(3, "0");
  const nameCode = (name || "USR").substring(0, 3).toUpperCase();
  return `AFF${paddedId}${nameCode}`;
};

const handlePayload = async (payload) => {
  try {
    const { order_id, email, order_total, affiliate_id, is_class_purchase, status, line_items } = payload;
    console.log(`[DEBUG] order_id: ${order_id}, email: ${email}, order_total: ${order_total}, affiliate_id: ${affiliate_id}, is_class_purchase: ${is_class_purchase}, status: ${status}`);
    const parseCsvIds = (str) => (str || '').split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(n => !Number.isNaN(n));
    const KELAS_PRODUCT_IDS = (() => {
      const env = process.env.KELAS_PRODUCT_IDS;
      const parsed = parseCsvIds(env);
      return parsed.length ? parsed : [61];
    })();

    console.log(`[DEBUG] KELAS_PRODUCT_IDS configured: ${KELAS_PRODUCT_IDS.join(',')}`);

    let isClassPurchase = is_class_purchase;
    if (typeof isClassPurchase === 'undefined' && line_items && Array.isArray(line_items)) {
      isClassPurchase = line_items.some(item => KELAS_PRODUCT_IDS.includes(Number(item.product_id)));
      console.log(`[DEBUG] Deteksi manual isClassPurchase: ${isClassPurchase} (checked IDs: ${KELAS_PRODUCT_IDS.join(',')})`);
      console.log(`[DEBUG] Received line_items: ${JSON.stringify(line_items)}`);
    }

    const ACCEPTED_ORDER_STATUSES = ['completed', 'processing'];
    if (status && !ACCEPTED_ORDER_STATUSES.includes(status)) {
      const message = `Order ${order_id} skipped - status: ${status}`;
      console.log(`⏭️ Skipped - ${message}`);
      return { processed: false, message };
    }

    if (!email) {
      console.log("❌ Missing email in payload");
      return { processed: false, message: 'Missing email in payload' };
    }

    console.log(`[DEBUG] Mencari user SGS dengan email: ${email}`);
    const user = await prisma.user.findUnique({
      where: { email },
      include: { affiliateProfile: true }
    });

    if (!user) {
      console.log(`⚠️ User not found in SGS: ${email}`);
      await saveTransaction(order_id, email, order_total, null, null, "USER_NOT_FOUND");
      console.log(`[DEBUG] Transaksi dicatat meski user tidak ditemukan.`);
      return { processed: true, message: 'Order recorded but user not found in SGS', data: { email } };
    }

    console.log(`✅ User found: ${user.fullName} (${user.email})`);

    const affiliateProfile = user.affiliateProfile;
    if (!affiliateProfile) {
      console.log(`[DEBUG] User tidak punya affiliateProfile, transaksi tetap dicatat tanpa komisi.`);
    }

    if (isClassPurchase && affiliateProfile) {
      console.log(`📚 Class purchase detected for ${email}`);

      if (!affiliateProfile.hasPurchasedClass) {
        await prisma.affiliateProfile.update({
          where: { id: affiliateProfile.id },
          data: { hasPurchasedClass: true }
        });
        console.log(`✅ Updated affiliateProfile.hasPurchasedClass = true`);
      }
      if (typeof user.hasPurchasedClass !== 'undefined' && !user.hasPurchasedClass) {
        await prisma.user.update({
          where: { id: user.id },
          data: { hasPurchasedClass: true }
        });
        console.log(`✅ Updated user.hasPurchasedClass = true`);
      }

      if (!affiliateProfile.wpAffiliateId) {
        console.log(`🔄 Upgrading ${email} to affiliate...`);

        if (!affiliateProfile.wpUserId) {
          console.log(`⚠️ User belum punya WordPress User ID, skip upgrade`);
        } else {
          try {
            const wpService = await getWordPressService();

            const upgradeResult = await wpService.upgradeToAffiliate(
              user.id,                      // SGS User ID (UUID)
              affiliateProfile.wpUserId,    // WP User ID (integer)
              user.email,                   // Email
              user.fullName || ""           // Full name
            );

            if (upgradeResult?.wpAffiliateId) {
              console.log(`✅ Upgraded to affiliate! SliceWP ID: ${upgradeResult.wpAffiliateId}`);
              console.log(`📌 Affiliate Code: ${upgradeResult.code}`);
              console.log(`🔗 Referral Link: ${upgradeResult.referralLink}`);
            }
          } catch (upgradeError) {
            console.error(`❌ Failed to upgrade affiliate:`, upgradeError.message);
          }
        }
      } else {
        console.log(`ℹ️ Already an affiliate (SliceWP ID: ${affiliateProfile.wpAffiliateId})`);
      }
    }

    if (affiliateProfile && order_total > 0) {
      console.log(`[DEBUG] Mencatat komisi multi-level untuk affiliateProfile.id: ${affiliateProfile.id}`);
      await recordMultiLevelCommission(affiliateProfile.id, order_id, order_total, email);
    } else {
      console.log(`⚠️ No affiliate profile found, skipping commission`);
    }

    console.log(`[DEBUG] Menyimpan transaksi ke database SGS...`);
    await saveTransaction(order_id, email, order_total, user?.id, affiliateProfile?.id, "COMPLETED");

    console.log("========================================\n");

    return {
      processed: true,
      message: 'Order processed successfully',
      data: { order_id, email, is_class_purchase: isClassPurchase, user_found: true, affiliate_upgraded: affiliateProfile?.wpAffiliateId ? true : false }
    };
  } catch (error) {
    console.error("❌ [handlePayload] Error:", error.message);
    return { processed: false, message: error.message };
  }
};

export const reprocessOrder = async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.order_id) {
      return res.status(400).json({ success: false, message: 'order_id is required' });
    }
    const result = await handlePayload(payload);
    return res.status(200).json({ success: !!result.processed, processed: !!result.processed, message: result.message, details: result.data || null });
  } catch (err) {
    console.error('❌ [reprocessOrder] Error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getWordPressService = async () => {
  const useMock = process.env.USE_WORDPRESS_MOCK === "true";
  if (useMock) {
    return await import("../wordpress/Mock/wordpressMock.service.js");
  }
  return await import("../wordpress/wordpress.service.js");
};

export const handleOrderComplete = async (req, res) => {
  try {
    const payload = req.body;

    console.log("\n========================================");
    console.log("📦 [WEBHOOK] WooCommerce Order Complete");
    console.log("Headers:", JSON.stringify(req.headers, null, 2));
    console.log("Payload:", JSON.stringify(payload, null, 2));
    console.log("========================================");
    const result = await handlePayload(payload);

    return res.status(200).json({
      success: true,
      processed: !!result.processed,
      message: result.message,
      details: result.data || null
    });

  } catch (error) {
    console.error("❌ [WEBHOOK] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
};

const saveTransaction = async (orderId, email, amount, userId, affiliateId, status) => {
  try {
    const existing = await prisma.transaction.findFirst({
      where: { reference: `WC-${orderId}` }
    });
    
    if (existing) {
      console.log(`ℹ️ Transaction WC-${orderId} already exists`);
      return existing;
    }
    
    const transaction = await prisma.transaction.create({
      data: {
        type: "WOOCOMMERCE_ORDER",
        amount: parseFloat(amount) || 0,
        source: "WOOCOMMERCE",
        reference: `WC-${orderId}`,
        status: status,
        userId: userId || null,
        affiliateId: affiliateId || null
      }
    });
    
    console.log(`✅ Transaction saved: WC-${orderId} (User: ${userId}, Affiliate: ${affiliateId})`);
    return transaction;
  } catch (error) {
    console.error(`❌ Failed to save transaction:`, error.message);
  }
};

const recordMultiLevelCommission = async (buyerAffiliateId, orderId, orderTotal, customerEmail) => {
  try {
    console.log(`\n💰 Recording multi-level commission...`);
    console.log(`   Buyer Affiliate ID: ${buyerAffiliateId}`);
    console.log(`   Order: ${orderId}, Total: Rp ${parseFloat(orderTotal).toLocaleString('id-ID')}`);
    
    const buyerProfile = await prisma.affiliateProfile.findUnique({
      where: { id: buyerAffiliateId },
      include: { user: true }
    });
    
    if (!buyerProfile) {
      console.log(`⚠️ Buyer affiliate profile not found`);
      return;
    }
    
    const DIRECT_SELLING = 75000;  // Level 1 direct
    const LEVEL_BONUS = 12500;     // Level 1-10 bonus
    const MAX_LEVELS = 10;
    
    let currentReferrerId = buyerProfile.referredById;
    let level = 1;
    let commissionsCreated = [];
    
    while (currentReferrerId && level <= MAX_LEVELS) {
      const referrer = await prisma.affiliateProfile.findUnique({
        where: { id: currentReferrerId },
        include: { user: true }
      });
      
      if (!referrer) {
        console.log(`   Level ${level}: Referrer not found, stopping chain`);
        break;
      }
      
      let commissionAmount = LEVEL_BONUS; 
      if (level === 1) {
        commissionAmount = DIRECT_SELLING + LEVEL_BONUS; // 75,000 + 12,500 = 87,500
      }
      
      // Cek apakah komisi sudah ada
      const existingCommission = await prisma.affiliateCommission.findFirst({
        where: {
          affiliateId: referrer.id,
          transactionId: `WC-${orderId}`,
          level: level
        }
      });
      
      if (existingCommission) {
        console.log(`   Level ${level}: Commission already exists for ${referrer.code}`);
        currentReferrerId = referrer.referredById;
        level++;
        continue;
      }
      
      await prisma.affiliateProfile.update({
        where: { id: referrer.id },
        data: {
          totalEarnings: { increment: commissionAmount },
          totalOmset: level === 1 ? { increment: parseFloat(orderTotal) } : undefined
        }
      });

      try { const { invalidateAffiliateCache, invalidateUserCache } = await import('../../shared/utils/dashboardCache.js'); invalidateAffiliateCache(referrer.id); invalidateUserCache(referrer.userId); } catch (e) {}
      
      commissionsCreated.push({
        level,
        code: referrer.code,
        amount: commissionAmount
      });
      
      console.log(`   ✅ Level ${level}: ${referrer.code} → Rp ${commissionAmount.toLocaleString('id-ID')}`);
      
      currentReferrerId = referrer.referredById;
      level++;
    }
    
    console.log(`\n💰 Commission Summary:`);
    console.log(`   Total levels: ${commissionsCreated.length}`);
    console.log(`   Total amount: Rp ${commissionsCreated.reduce((sum, c) => sum + c.amount, 0).toLocaleString('id-ID')}`);
    
    return commissionsCreated;
  } catch (error) {
    console.error(`❌ Failed to record multi-level commission:`, error.message);
  }
};

export const testWebhook = async (req, res) => {
  res.status(200).json({
    success: true,
    message: "Webhook endpoint is working!",
    timestamp: new Date().toISOString()
  });
};


export const manualUpgradeAffiliate = async (req, res) => {
  try {
    const { email, wpAffiliateId } = req.body;

    console.log("\n========================================");
    console.log("🔄 [MANUAL] Upgrade to Affiliate");
    console.log("========================================");
    console.log(`Email: ${email}`);
    console.log(`WP Affiliate ID: ${wpAffiliateId}`);

    if (!email || !wpAffiliateId) {
      return res.status(400).json({
        success: false,
        error: "email dan wpAffiliateId required"
      });
    }

    // Cari user
    const user = await prisma.user.findUnique({
      where: { email },
      include: { affiliateProfile: true }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: `User dengan email ${email} tidak ditemukan`
      });
    }

    if (!user.affiliateProfile) {
      return res.status(400).json({
        success: false,
        error: `User ${email} belum punya affiliate profile (belum bayar 75K?)`
      });
    }

    const affiliateProfile = user.affiliateProfile;

    // Cek apakah sudah punya kode affiliate
    if (affiliateProfile.code && affiliateProfile.wpAffiliateId) {
      return res.status(200).json({
        success: true,
        message: "User sudah jadi affiliate",
        data: {
          email: user.email,
          code: affiliateProfile.code,
          wpAffiliateId: affiliateProfile.wpAffiliateId,
          wpReferralLink: affiliateProfile.wpReferralLink
        }
      });
    }

    // Generate affiliate code
    const affiliateCode = generateAffiliateCode(wpAffiliateId, user.fullName);
    const wpReferralLink = `https://jagobikinaplikasi.com/woo/shop/?aff=${wpAffiliateId}`;

    // Update affiliate profile
    const updated = await prisma.affiliateProfile.update({
      where: { id: affiliateProfile.id },
      data: {
        hasPurchasedClass: true,
        code: affiliateCode,
        wpAffiliateId: parseInt(wpAffiliateId),
        wpReferralLink: wpReferralLink,
      },
    });

    console.log(`✅ Upgraded to affiliate!`);
    console.log(`   Code: ${updated.code}`);
    console.log(`   WP Affiliate ID: ${updated.wpAffiliateId}`);
    console.log(`   Referral Link: ${updated.wpReferralLink}`);
    console.log("========================================\n");

    res.status(200).json({
      success: true,
      message: "User berhasil upgrade ke affiliate!",
      data: {
        email: user.email,
        fullName: user.fullName,
        affiliateCode: updated.code,
        wpAffiliateId: updated.wpAffiliateId,
        wpReferralLink: updated.wpReferralLink,
        hasPurchasedClass: updated.hasPurchasedClass
      }
    });

  } catch (error) {
    console.error("❌ [MANUAL] Error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};
