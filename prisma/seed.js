import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting seed...");

  try {
    // Clear existing data
    console.log("🗑️  Clearing existing data...");
    await prisma.affiliateCommission.deleteMany({});
    await prisma.affiliateWithdrawal.deleteMany({});
    await prisma.affiliateProfile.deleteMany({});
    await prisma.otpRecord.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.user.deleteMany({});

    // ============================================
    // ROOT AFFILIATE - Harus sync dengan WordPress/SliceWP!
    // ============================================
    // PENTING: Data ini harus match dengan user di WordPress
    // 
    // Di WordPress:
    // 1. Buat user dengan email yang sama
    // 2. Buat affiliate di SliceWP dengan user tersebut
    // 3. Catat wpUserId dan wpAffiliateId
    // ============================================

    console.log("👤 Creating ROOT affiliate (sync dengan WP)...");
    const hashedPassword = await bcrypt.hash("password123", 10);

    // ROOT: wowo (sesuai user WordPress yang sudah ada)
    const rootUser = await prisma.user.create({
      data: {
        email: "wowo@sgs.com", // HARUS SAMA dengan email di WordPress
        password: hashedPassword,
        fullName: "wowo",
        phone: "+6281234567890",
        isEmailVerified: true,
        isPhoneVerified: true,
        role: "ADMIN",
      },
    });

    console.log(`✅ Created ROOT user: ${rootUser.email}`);

    // Create ROOT affiliate profile dengan data WordPress/SliceWP
    // wpAffiliateId = 6 (dari SliceWP, format kode: AFF006XXX)
    const rootAffiliate = await prisma.affiliateProfile.create({
      data: {
        userId: rootUser.id,
        code: "AFF006WOW",  // Format: AFF + 3digit SliceWP ID + 3 huruf nama
        wpUserId: 32,       // WordPress User ID (cek di WP Users)
        wpAffiliateId: 6,   // SliceWP Affiliate ID
        wpReferralLink: "https://jagobikinaplikasi.com/woo/shop/?aff=6",
        totalEarnings: 0,
        totalPaid: 0,
        totalOmset: 0,
        status: "ACTIVE",
        hasPurchasedClass: true, // Root sudah punya akses
        registeredAt: new Date(),
        activatedAt: new Date(),
      },
    });

    console.log(`✅ ROOT affiliate created:`);
    console.log(`   Code: ${rootAffiliate.code}`);
    console.log(`   WP User ID: ${rootAffiliate.wpUserId}`);
    console.log(`   SliceWP ID: ${rootAffiliate.wpAffiliateId}`);
    console.log(`   Referral Link: ${rootAffiliate.wpReferralLink}`);

    console.log("\n" + "═".repeat(60));
    console.log("✨ Seed completed successfully!");
    console.log("═".repeat(60));
    console.log("\n📝 ROOT AFFILIATE INFO:");
    console.log(`   Email: ${rootUser.email}`);
    console.log(`   Password: password123`);
    console.log(`   Referral Code: ${rootAffiliate.code}`);
    console.log(`   Shop URL: ${rootAffiliate.wpReferralLink}`);
    console.log("\n📝 TEST FLOW:");
    console.log("1. User baru signup dengan kode: " + rootAffiliate.code);
    console.log("2. Bayar 75K → Status ACTIVE (Subscriber di WP)");
    console.log("3. Login → Belum beli kelas → Redirect ke: " + rootAffiliate.wpReferralLink);
    console.log("4. Beli kelas 500K di WP → Webhook trigger → Upgrade ke Affiliate");
    console.log("5. Login lagi → Dapat kode affiliate sendiri → Masuk Dashboard");
    console.log("\n💰 Komisi tracking via SliceWP cookie (aff=6)");
    console.log("═".repeat(60) + "\n");
  } catch (error) {
    console.error("❌ Error during seed:", error);
    throw error;
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
