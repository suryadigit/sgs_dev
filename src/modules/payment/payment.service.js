import axios from "axios";
import prisma from "../../shared/lib/prisma.js";
import paymentConfig from "../../config/payment.config.js";

const { XENDIT_API_KEY, XENDIT_API_URL, ACTIVATION_AMOUNT } = paymentConfig;
const POLLING_INTERVAL = 10000;
const MAX_POLLING_TIME = 900000;

export const autoVerifyPaymentStatus = async (userId, xenditInvoiceId, maxAttempts = 90) => {
  try {
    console.log(`⏳ Starting auto-verify polling for invoice: ${xenditInvoiceId}`);
    
    let attempts = 0;
    const startTime = Date.now();

    const poll = async () => {
      attempts++;
      console.log(`🔍 Polling attempt ${attempts}/${maxAttempts}...`);

      try {
        const xenditResponse = await axios.get(
          `${XENDIT_API_URL}/${xenditInvoiceId}`,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(XENDIT_API_KEY + ":").toString("base64")}`,
            },
          }
        );

        const xenditStatus = xenditResponse.data.status;
        console.log(`📊 Xendit status: ${xenditStatus}`);

        const payment = await prisma.payment.findUnique({
          where: { userId },
        });

        if (!payment) {
          console.error("❌ Payment record not found for userId:", userId);
          return { success: false, error: "Payment not found" };
        }

        console.log(`📦 Current payment status in DB: ${payment.status}`);

        if (xenditStatus === "PAID" && payment.status !== "COMPLETED") {
          console.log("✅ Payment detected as PAID! Updating database...");

          const updatedPayment = await prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: "COMPLETED",
              paidAt: new Date(xenditResponse.data.paid_at),
            },
            include: {
              affiliate: true,
            },
          });

          await prisma.affiliateProfile.update({
            where: { id: payment.affiliateId },
            data: {
              status: "ACTIVE",
              activatedAt: new Date(),
            },
          });

          console.log(`✅ Affiliate ${updatedPayment.affiliate.code} activated!`);

          return {
            success: true,
            message: "Payment verified and activated",
            payment: updatedPayment,
            affiliate: updatedPayment.affiliate,
          };
        }

        if (xenditStatus === "EXPIRED" || xenditStatus === "FAILED") {
          console.log(`❌ Payment ${xenditStatus}`);
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: xenditStatus === "EXPIRED" ? "EXPIRED" : "FAILED" },
          });

          return {
            success: false,
            error: `Payment ${xenditStatus}`,
          };
        }

        if (attempts < maxAttempts && Date.now() - startTime < MAX_POLLING_TIME) {
          console.log(`⏳ Payment still pending, next poll in 10s...`);
          await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL));
          return poll();
        } else {
          console.log("⏰ Polling timeout");
          return {
            success: false,
            error: "Polling timeout",
          };
        }
      } catch (error) {
        console.error(`❌ Polling error:`, error.message);
        
        if (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL));
          return poll();
        } else {
          throw error;
        }
      }
    };

    return poll();
  } catch (error) {
    console.error("❌ Auto-verify error:", error.message);
    throw error;
  }
};

export const createActivationInvoice = async (userId, affiliateCode, email) => {
  try {
    const existingPayment = await prisma.payment.findUnique({
      where: { userId },
    });

    if (existingPayment) {
      if (existingPayment.status === "COMPLETED") {
        throw new Error("Account already activated");
      }
      if (existingPayment.status === "PENDING") {
        return existingPayment;
      }
      if (existingPayment.status === "EXPIRED") {
        await prisma.payment.delete({ where: { id: existingPayment.id } });
      }
    }

    const externalId = `ACTIVATION-${userId}-${Date.now()}`;

    const xenditPayload = {
      external_id: externalId,
      amount: ACTIVATION_AMOUNT,
      payer_email: email,
      description: `Biaya Aktivasi Akun Affiliate ${affiliateCode} - Bayar dalam 15 menit`,
      invoice_duration: paymentConfig.INVOICE_DURATION_SECONDS,
      currency: "IDR",
      ...(paymentConfig.SUCCESS_REDIRECT_URL ? { success_redirect_url: paymentConfig.SUCCESS_REDIRECT_URL } : {}),
      ...(paymentConfig.FAILURE_REDIRECT_URL ? { failure_redirect_url: paymentConfig.FAILURE_REDIRECT_URL } : {}),
    };

    console.log("🔄 Creating Xendit invoice:", xenditPayload);

    const xenditResponse = await axios.post(XENDIT_API_URL, xenditPayload, {
      headers: {
        Authorization: `Basic ${Buffer.from(XENDIT_API_KEY + ":").toString("base64")}`,
        "Content-Type": "application/json",
      },
    });

    const affiliate = await prisma.affiliateProfile.findUnique({
      where: { userId },
    });

    const payment = await prisma.payment.create({
      data: {
        userId,
        affiliateId: affiliate.id,
        xenditInvoiceId: xenditResponse.data.id,
        externalId,
        amount: ACTIVATION_AMOUNT,
        invoiceUrl: xenditResponse.data.invoice_url,
        expiredAt: new Date(xenditResponse.data.expiry_date),
        status: "PENDING",
      },
    });

    console.log("✅ Invoice created:", payment.id);
    return payment;
  } catch (error) {
    console.error("❌ Create activation invoice error:", error.response?.data || error.message);
    throw error;
  }
};

export const checkUserActivationStatus = async (userId) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        affiliateProfile: true,
        payment: true,
      },
    });

    if (!user) {
      return {
        status: "NOT_FOUND",
        needsAction: false,
      };
    }

    if (!user.affiliateProfile) {
      return {
        status: "NOT_REGISTERED",
        needsAction: false,
        message: "User is not registered as affiliate",
      };
    }

    if (user.affiliateProfile.status === "ACTIVE") {
      return {
        status: "ACTIVE",
        needsAction: false,
        message: "Account is already activated",
        activatedAt: user.affiliateProfile.activatedAt,
      };
    }

    if (!user.payment) {
      return {
        status: "PAYMENT_REQUIRED",
        needsAction: true,
        message: "User needs to pay activation fee",
        affiliateStatus: user.affiliateProfile.status,
      };
    }

    if (user.payment.status === "PENDING") {
      return {
        status: "PAYMENT_PENDING",
        needsAction: true,
        message: "Payment invoice is still pending",
        invoice: {
          id: user.payment.id,
          amount: user.payment.amount,
          invoiceUrl: user.payment.invoiceUrl,
          expiredAt: user.payment.expiredAt,
        },
      };
    }

    if (user.payment.status === "COMPLETED") {
      return {
        status: "PAID",
        needsAction: false,
        message: "Payment completed, waiting for activation",
        paidAt: user.payment.paidAt,
      };
    }

    if (user.payment.status === "EXPIRED") {
      return {
        status: "PAYMENT_EXPIRED",
        needsAction: true,
        message: "Previous payment expired, needs to create new invoice",
      };
    }

    if (user.payment.status === "FAILED") {
      return {
        status: "PAYMENT_FAILED",
        needsAction: true,
        message: "Previous payment failed, needs to retry",
      };
    }

    return {
      status: "UNKNOWN",
      needsAction: false,
    };
  } catch (error) {
    console.error("Check activation status error:", error);
    throw error;
  }
};
