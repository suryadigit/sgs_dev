import axios from "axios";
import nodemailer from "nodemailer";
import prisma from "../../shared/lib/prisma.js";
import { autoVerifyPaymentStatus } from "./payment.service.js";
import { syncUserAsSubscriber } from "../wordpress/wordpress.service.js";
import paymentConfig from "../../config/payment.config.js";
import { cacheDel } from "../../shared/lib/cache.redis.js";
const { XENDIT_API_KEY, XENDIT_API_URL, ACTIVATION_AMOUNT, INVOICE_DURATION_SECONDS } = paymentConfig;

const isInvoiceExpired = (expiredAt) => { if (!expiredAt) return false; return new Date() > new Date(expiredAt); };

const syncPaymentWithXendit = async (payment) => {
  try {
    if (!payment.xenditInvoiceId) return payment;
    const xenditResponse = await axios.get(`${XENDIT_API_URL}/${payment.xenditInvoiceId}`, { headers: { Authorization: `Basic ${Buffer.from(XENDIT_API_KEY + ":").toString("base64")}` } });
    const xenditStatus = xenditResponse.data.status;
    let newPaymentStatus = payment.status;
    if ((xenditStatus === "PAID" || xenditStatus === "SETTLED") && payment.status !== "COMPLETED") newPaymentStatus = "COMPLETED";
    else if (xenditStatus === "EXPIRED" && payment.status !== "EXPIRED") newPaymentStatus = "EXPIRED";
    else if (xenditStatus === "FAILED" && payment.status !== "FAILED") newPaymentStatus = "FAILED";
    if (newPaymentStatus !== payment.status) {
      const updatedPayment = await prisma.payment.update({ where: { id: payment.id }, data: { status: newPaymentStatus, paidAt: newPaymentStatus === "COMPLETED" ? new Date(xenditResponse.data.paid_at) : null }, include: { affiliate: true, user: true } });
      if (newPaymentStatus === "COMPLETED") { try { await syncUserAsSubscriber({ id: updatedPayment.user.id, fullName: updatedPayment.user.fullName || updatedPayment.user.email.split("@")[0], email: updatedPayment.user.email }); } catch (wpError) {} }
      return updatedPayment;
    }
    return payment;
  } catch (error) { return payment; }
};

// Internal helper: send invoice email for a payment record
const sendInvoiceEmailInternal = async (payment) => {
  try {
    // ensure payment has user
    let p = payment;
    if (!p.user) {
      p = await prisma.payment.findUnique({ where: { id: payment.id }, include: { user: true } });
      if (!p) throw new Error('Payment not found for email sending');
    }

    if (!p.user || !p.user.email) {
      throw new Error('User email not available');
    }

    const emailTransporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || "gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD }
    });

    const expiration = p.expiredAt ? new Date(p.expiredAt).toLocaleString() : null;
    const mailHtml = `
      <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f5f5f5;">
        <div style="background-color: white; padding: 30px; border-radius: 8px; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Invoice Pembayaran</h2>
          <p>Halo ${p.user.fullName || p.user.email},</p>
          <p>Silakan selesaikan pembayaran sebesar <strong>Rp ${p.amount?.toLocaleString?.() || p.amount}</strong> dengan klik tombol di bawah ini:</p>
          <p style="text-align:center; margin: 20px 0;"><a href="${p.invoiceUrl}" style="background:#007bff;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;">Selesaikan Pembayaran</a></p>
          ${expiration ? `<p style="color:#999">Invoice berlaku hingga: ${expiration}</p>` : ''}
          <p style="color:#666; font-size:12px;">Jika Anda tidak merasa melakukan permintaan ini, abaikan email ini.</p>
        </div>
      </div>
    `;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: p.user.email,
      subject: `Invoice Pembayaran - Rp ${p.amount}`,
      html: mailHtml,
    };

    await emailTransporter.sendMail(mailOptions);
    console.log(`✓ Invoice email sent to ${p.user.email}`);
    return { success: true };
  } catch (err) {
    console.error('Failed to send invoice email:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
};

export const checkActivationStatus = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const user = await prisma.user.findUnique({ where: { id: userId }, include: { affiliateProfile: true, payment: true } });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.affiliateProfile) return res.json({ status: "NOT_REGISTERED", message: "User is not registered as affiliate", needsAction: "Register as affiliate first", nextEndpoint: "POST /api/v1/affiliate/register" });
    if (user.affiliateProfile.status === "ACTIVE") return res.json({ status: "ACTIVE", message: "Account is already activated", activatedAt: user.affiliateProfile.activatedAt, affiliateCode: user.affiliateProfile.code });

    if (user.payment) {
      if (user.payment.status === "COMPLETED") return res.json({ status: "PAID", message: "Payment already completed", paidAt: user.payment.paidAt });
      if (user.payment.status === "PENDING") { if (isInvoiceExpired(user.payment.expiredAt)) await prisma.payment.delete({ where: { id: user.payment.id } }); else return res.json({ status: "PAYMENT_PENDING", message: "Payment invoice is still pending", invoice: { id: user.payment.id, amount: user.payment.amount, invoiceUrl: user.payment.invoiceUrl, expiredAt: user.payment.expiredAt } }); }
      if (user.payment.status === "EXPIRED") await prisma.payment.delete({ where: { id: user.payment.id } });
    }

    const externalId = `ACTIVATION-${userId}-${Date.now()}`;
    const xenditPayload = { external_id: externalId, amount: ACTIVATION_AMOUNT, payer_email: user.email, description: `Biaya Aktivasi Akun Affiliate ${user.affiliateProfile.code} - Bayar dalam 15 menit`, invoice_duration: INVOICE_DURATION_SECONDS, currency: "IDR" };
    const xenditResponse = await axios.post(XENDIT_API_URL, xenditPayload, { headers: { Authorization: `Basic ${Buffer.from(XENDIT_API_KEY + ":").toString("base64")}`, "Content-Type": "application/json" } });
    const payment = await prisma.payment.create({ data: { userId, affiliateId: user.affiliateProfile.id, xenditInvoiceId: xenditResponse.data.id, externalId, amount: ACTIVATION_AMOUNT, invoiceUrl: xenditResponse.data.invoice_url, expiredAt: new Date(xenditResponse.data.expiry_date), status: "PENDING" } });

    // attempt to send invoice email (async)
    sendInvoiceEmailInternal(payment).then((r) => { if (!r.success) console.warn('[checkActivationStatus] Email not sent:', r.error); }).catch((e) => console.warn('[checkActivationStatus] send email failed', e && e.message));

    res.json({ status: "ACTIVATION_REQUIRED", message: "Activation invoice created", invoice: { id: payment.id, amount: payment.amount, invoiceUrl: payment.invoiceUrl, expiredAt: payment.expiredAt }, affiliateCode: user.affiliateProfile.code });
  } catch (error) { res.status(500).json({ error: error.response?.data?.message || error.message }); }
};

export const createPaymentInvoice = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const affiliateProfile = await prisma.affiliateProfile.findUnique({ where: { userId } });
    if (!affiliateProfile) return res.status(400).json({ error: "Affiliate profile not found" });
    if (affiliateProfile.status === "ACTIVE") return res.status(400).json({ error: "Account already activated" });

    const existingPayment = await prisma.payment.findUnique({ where: { userId } });
    if (existingPayment && existingPayment.status === "PENDING") return res.status(400).json({ error: "Payment already in progress", paymentId: existingPayment.id, invoiceUrl: existingPayment.invoiceUrl });

    const externalId = `ACTIVATION-${userId}-${Date.now()}`;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const xenditPayload = { external_id: externalId, amount: ACTIVATION_AMOUNT, payer_email: user.email, description: `Biaya Aktivasi Akun Affiliate ${affiliateProfile.code} - Bayar dalam 15 menit`, invoice_duration: INVOICE_DURATION_SECONDS, currency: "IDR" };
    const xenditResponse = await axios.post(XENDIT_API_URL, xenditPayload, { headers: { Authorization: `Basic ${Buffer.from(XENDIT_API_KEY + ":").toString("base64")}`, "Content-Type": "application/json" } });
    const payment = await prisma.payment.create({ data: { userId, affiliateId: affiliateProfile.id, xenditInvoiceId: xenditResponse.data.id, externalId, amount: ACTIVATION_AMOUNT, invoiceUrl: xenditResponse.data.invoice_url, expiredAt: new Date(xenditResponse.data.expiry_date), status: "PENDING" } });

    // try to send invoice email asynchronously (non-blocking)
    sendInvoiceEmailInternal(payment).then((r) => { if (!r.success) console.warn('[createPaymentInvoice] Email not sent:', r.error); }).catch((e) => console.warn('[createPaymentInvoice] send email failed', e && e.message));

    res.status(201).json({ message: "Payment invoice created successfully", payment: { id: payment.id, amount: payment.amount, invoiceUrl: payment.invoiceUrl, externalId: payment.externalId, expiredAt: payment.expiredAt } });
  } catch (error) { res.status(500).json({ error: error.response?.data?.message || error.message }); }
};

export const getPaymentStatus = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });
    const payment = await prisma.payment.findUnique({ where: { userId } });
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    res.json({ message: "Payment status retrieved successfully", payment: { id: payment.id, status: payment.status, amount: payment.amount, invoiceUrl: payment.invoiceUrl, paidAt: payment.paidAt, expiredAt: payment.expiredAt } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getCompleteActivationStatus = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const user = await prisma.user.findUnique({ where: { id: userId }, include: { affiliateProfile: true, payment: true } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.affiliateProfile) return res.status(400).json({ error: "User is not registered as affiliate" });

    let overallStatus = "PENDING";
    let message = "";
    let requiresAction = false;

    if (user.affiliateProfile.status === "ACTIVE") { overallStatus = "ACTIVE"; message = "✅ Akun sudah ACTIVE! Anda bisa mulai earning"; }
    else if (!user.payment) { overallStatus = "PAYMENT_REQUIRED"; message = "❌ Belum ada invoice, silakan buat"; requiresAction = true; }
    else if (user.payment.status === "COMPLETED") { if (user.affiliateProfile.status !== "ACTIVE") { overallStatus = "PAYMENT_COMPLETED"; message = "✅ Pembayaran selesai! Sekarang silakan beli kelas untuk aktivasi"; } else { overallStatus = "ACTIVE"; message = "✅ Akun sudah ACTIVE! Anda bisa mulai earning"; } }
    else if (user.payment.status === "PENDING") { if (isInvoiceExpired(user.payment.expiredAt)) { overallStatus = "INVOICE_EXPIRED"; message = "⏰ Invoice expired, silakan buat yang baru"; requiresAction = true; } else { overallStatus = "AWAITING_PAYMENT"; message = "⏳ Menunggu pembayaran"; requiresAction = true; } }
    else if (user.payment.status === "EXPIRED" || user.payment.status === "FAILED") { overallStatus = "PAYMENT_FAILED"; message = "❌ Pembayaran gagal/expired, silakan buat ulang"; requiresAction = true; }

    if (overallStatus === "PAYMENT_COMPLETED") requiresAction = false;

    res.json({ message: "Activation status retrieved", overallStatus, requiresAction, statusMessage: message, affiliate: { id: user.affiliateProfile.id, code: user.affiliateProfile.code, status: user.affiliateProfile.status, registeredAt: user.affiliateProfile.registeredAt, activatedAt: user.affiliateProfile.activatedAt }, payment: user.payment ? { id: user.payment.id, status: user.payment.status, amount: user.payment.amount, invoiceUrl: user.payment.invoiceUrl, paidAt: user.payment.paidAt, expiredAt: user.payment.expiredAt, remainingTime: user.payment.expiredAt ? Math.ceil((new Date(user.payment.expiredAt) - new Date()) / 1000) : null } : null });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const refreshPaymentInvoice = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const user = await prisma.user.findUnique({ where: { id: userId }, include: { affiliateProfile: true, payment: true } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.affiliateProfile) return res.status(400).json({ error: "User is not registered as affiliate" });
    if (user.affiliateProfile.status === "ACTIVE") return res.json({ status: "ACTIVE", message: "Account already activated", activatedAt: user.affiliateProfile.activatedAt });

    if (user.payment) {
      if (user.payment.status === "COMPLETED") return res.json({ status: "PAID", message: "Payment already completed", paidAt: user.payment.paidAt });
      if (user.payment.status === "PENDING" && !isInvoiceExpired(user.payment.expiredAt)) return res.json({ status: "PAYMENT_PENDING", message: "Invoice is still valid", invoice: { id: user.payment.id, amount: user.payment.amount, invoiceUrl: user.payment.invoiceUrl, expiredAt: user.payment.expiredAt, remainingTime: Math.ceil((new Date(user.payment.expiredAt) - new Date()) / 1000) } });
      if (isInvoiceExpired(user.payment.expiredAt) || user.payment.status === "EXPIRED" || user.payment.status === "FAILED") await prisma.payment.delete({ where: { id: user.payment.id } });
    }

    const externalId = `ACTIVATION-${userId}-${Date.now()}`;
    const xenditPayload = { external_id: externalId, amount: ACTIVATION_AMOUNT, payer_email: user.email, description: `Biaya Aktivasi Akun Affiliate ${user.affiliateProfile.code} - Bayar dalam 15 menit`, invoice_duration: INVOICE_DURATION_SECONDS, currency: "IDR" };
    const xenditResponse = await axios.post(XENDIT_API_URL, xenditPayload, { headers: { Authorization: `Basic ${Buffer.from(XENDIT_API_KEY + ":").toString("base64")}`, "Content-Type": "application/json" } });
    const payment = await prisma.payment.create({ data: { userId, affiliateId: user.affiliateProfile.id, xenditInvoiceId: xenditResponse.data.id, externalId, amount: ACTIVATION_AMOUNT, invoiceUrl: xenditResponse.data.invoice_url, expiredAt: new Date(xenditResponse.data.expiry_date), status: "PENDING" } });

    // attempt to send invoice email (async)
    sendInvoiceEmailInternal(payment).then((r) => { if (!r.success) console.warn('[refreshPaymentInvoice] Email not sent:', r.error); }).catch((e) => console.warn('[refreshPaymentInvoice] send email failed', e && e.message));

    res.json({ status: "PAYMENT_REQUIRED", message: "Fresh payment invoice generated", invoice: { id: payment.id, amount: payment.amount, invoiceUrl: payment.invoiceUrl, expiredAt: payment.expiredAt, remainingTime: Math.ceil((new Date(payment.expiredAt) - new Date()) / 1000) } });
  } catch (error) { res.status(500).json({ error: error.response?.data?.message || error.message }); }
};

export const handlePaymentWebhook = async (req, res) => {
  try {
    const { id, external_id, status } = req.body;
    if (!external_id) return res.status(400).json({ error: "Missing external_id" });

    const payment = await prisma.payment.findUnique({ where: { externalId: external_id }, include: { affiliate: true, user: true } });
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    let paymentStatus = "PENDING";
    if (status === "PAID") paymentStatus = "COMPLETED";
    else if (status === "EXPIRED") paymentStatus = "EXPIRED";
    else if (status === "FAILED") paymentStatus = "FAILED";

    const updatedPayment = await prisma.payment.update({ where: { id: payment.id }, data: { status: paymentStatus, paidAt: status === "PAID" ? new Date() : null } });
    if (paymentStatus === "COMPLETED") {
      try { await syncUserAsSubscriber({ id: payment.user.id, fullName: payment.user.fullName || payment.user.email.split("@")[0], email: payment.user.email }); } catch (wpError) {}
      try {
        // invalidate caches related to this user
        await cacheDel(`affiliate:dashboard:komisi:${payment.user.id}`);
        await cacheDel(`commissions:referral-hierarchy:${payment.user.id}`);
      } catch (e) {
        console.warn('[cache] invalidation failed for payment webhook', e?.message || e);
      }
    }

    res.json({ message: "Webhook processed successfully", payment: updatedPayment });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const verifyPaymentFromXendit = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const payment = await prisma.payment.findUnique({ where: { userId }, include: { affiliate: true, user: true } });
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    if (!payment.xenditInvoiceId) return res.status(400).json({ error: "Invalid payment record - no xenditInvoiceId" });

    const xenditResponse = await axios.get(`${XENDIT_API_URL}/${payment.xenditInvoiceId}`, { headers: { Authorization: `Basic ${Buffer.from(XENDIT_API_KEY + ":").toString("base64")}` } });
    const xenditStatus = xenditResponse.data.status;
    let newPaymentStatus = payment.status;

    if (xenditStatus === "PAID" || xenditStatus === "SETTLED") newPaymentStatus = "COMPLETED";
    else if (xenditStatus === "EXPIRED") newPaymentStatus = "EXPIRED";
    else if (xenditStatus === "FAILED") newPaymentStatus = "FAILED";
    else if (xenditStatus === "PENDING") newPaymentStatus = "PENDING";

    if (newPaymentStatus !== payment.status) {
      const updatedPayment = await prisma.payment.update({ where: { id: payment.id }, data: { status: newPaymentStatus, paidAt: newPaymentStatus === "COMPLETED" ? new Date(xenditResponse.data.paid_at) : null } });
      res.json({ message: "Payment status verified and updated", payment: updatedPayment, affiliate: { code: payment.affiliate.code, status: payment.affiliate.status } });
    } else {
      res.json({ message: "Payment status already correct", payment: { id: payment.id, status: newPaymentStatus, amount: payment.amount, paidAt: payment.paidAt }, affiliate: { code: payment.affiliate.code, status: payment.affiliate.status } });
    }
  } catch (error) { res.status(500).json({ error: error.response?.data?.message || error.message }); }
};

export const sendInvoiceEmail = async (req, res) => {
  try {
    const { paymentId, userId } = req.body || {};
    if (!paymentId && !userId) return res.status(400).json({ error: "Either paymentId or userId is required" });

    let payment = await prisma.payment.findUnique({ where: paymentId ? { id: paymentId } : { userId }, include: { user: true } });
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    // Use internal helper to send invoice email
    const sendResult = await sendInvoiceEmailInternal(payment);
    if (sendResult.success) return res.status(200).json({ message: "Invoice email sent", invoiceUrl: payment.invoiceUrl, payment: { id: payment.id, status: payment.status, amount: payment.amount } });
    return res.status(200).json({ message: "Invoice email not sent automatically; returning invoiceUrl", invoiceUrl: payment.invoiceUrl, error: sendResult.error });
  } catch (error) {
    return res.status(500).json({ error: error.response?.data?.message || error.message });
  }
};

export const verifyPaymentNoAuth = async (req, res) => {
  try {
    const { paymentId, userId } = req.query;
    if (!paymentId && !userId) return res.status(400).json({ error: "Either paymentId or userId is required", examples: { byPaymentId: "POST /api/v1/payments/verify-no-auth?paymentId=xxx", byUserId: "POST /api/v1/payments/verify-no-auth?userId=xxx" } });

    let payment = await prisma.payment.findUnique({ where: paymentId ? { id: paymentId } : { userId }, include: { affiliate: true, user: true } });
    if (!payment) return res.status(404).json({ error: "Payment not found", ...(paymentId && { paymentId }), ...(userId && { userId }) });
    if (!payment.xenditInvoiceId) return res.status(400).json({ error: "Invalid payment record - no xenditInvoiceId" });

    const xenditResponse = await axios.get(`${XENDIT_API_URL}/${payment.xenditInvoiceId}`, { headers: { Authorization: `Basic ${Buffer.from(XENDIT_API_KEY + ":").toString("base64")}` } });
    const xenditStatus = xenditResponse.data.status;
    let newPaymentStatus = payment.status;

    if (xenditStatus === "PAID" || xenditStatus === "SETTLED") newPaymentStatus = "COMPLETED";
    else if (xenditStatus === "EXPIRED") newPaymentStatus = "EXPIRED";
    else if (xenditStatus === "FAILED") newPaymentStatus = "FAILED";
    else if (xenditStatus === "PENDING") newPaymentStatus = "PENDING";

    if (newPaymentStatus !== payment.status) {
      const updatedPayment = await prisma.payment.update({ where: { id: payment.id }, data: { status: newPaymentStatus, paidAt: newPaymentStatus === "COMPLETED" ? new Date(xenditResponse.data.paid_at) : null } });
      return res.json({ message: "✅ Payment verified and updated from Xendit", status: newPaymentStatus, payment: { id: updatedPayment.id, amount: updatedPayment.amount, status: newPaymentStatus, paidAt: updatedPayment.paidAt }, affiliate: { code: payment.affiliate.code, status: payment.affiliate.status }, nextAction: newPaymentStatus === "COMPLETED" ? "Proceed to login" : "Complete payment" });
    }
    return res.json({ message: "✅ Payment status verified", status: newPaymentStatus, payment: { id: payment.id, amount: payment.amount, status: newPaymentStatus, paidAt: payment.paidAt }, affiliate: { code: payment.affiliate.code, status: payment.affiliate.status }, nextAction: newPaymentStatus === "COMPLETED" ? "Proceed to login" : "Complete payment" });
  } catch (error) { res.status(500).json({ error: "Failed to verify payment", details: error.response?.data?.message || error.message }); }
};

export const startPaymentPolling = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const payment = await prisma.payment.findUnique({ where: { userId } });
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    if (!payment.xenditInvoiceId) return res.status(400).json({ error: "Invalid payment record" });
    if (payment.status === "COMPLETED") return res.json({ message: "Payment already completed", status: "COMPLETED", payment: { id: payment.id, status: payment.status, paidAt: payment.paidAt } });

    res.json({ message: "Payment polling started", status: "POLLING", invoice: { id: payment.xenditInvoiceId, amount: payment.amount, invoiceUrl: payment.invoiceUrl }, note: "Backend akan otomatis mengecek status payment setiap 10 detik selama 15 menit" });
    autoVerifyPaymentStatus(userId, payment.xenditInvoiceId).then((result) => {}).catch((error) => {});
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const checkPaymentStatusById = async (req, res) => {
  try {
    const { paymentId } = req.params;
    if (!paymentId) return res.status(400).json({ error: "Payment ID is required", example: "/api/v1/invoices/8227660f-d530-4cc8-b88e-da6d8ef9a764/status" });

    let payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { user: { select: { id: true, email: true, fullName: true, isEmailVerified: true } }, affiliate: { select: { id: true, code: true, status: true, referredBy: true } } } });
    if (!payment) return res.status(404).json({ error: "Payment not found", paymentId, action: "Verify payment ID is correct" });

    payment = await syncPaymentWithXendit(payment);

    if (payment.status === "COMPLETED") return res.status(200).json({ message: "✅ Payment successful!", paymentStatus: "COMPLETED", payment: { id: payment.id, amount: payment.amount, paidAt: payment.paidAt, status: payment.status }, user: { id: payment.user.id, email: payment.user.email, fullName: payment.user.fullName }, affiliate: { code: payment.affiliate.code, status: payment.affiliate.status }, nextAction: "Proceed to login", nextStep: "POST /api/v1/users/login", note: "Your affiliate account is now ACTIVE and ready to use" });

    if (payment.status === "PENDING") {
      const now = new Date();
      const expiredAt = new Date(payment.expiredAt);
      const remainingSeconds = Math.floor((expiredAt - now) / 1000);
      const remainingMinutes = Math.ceil(remainingSeconds / 60);
      if (remainingSeconds <= 0) return res.status(400).json({ error: "Invoice expired", paymentStatus: "EXPIRED", payment: { id: payment.id, status: payment.status, expiredAt: payment.expiredAt }, user: { email: payment.user.email }, nextAction: "Request new invoice", nextStep: "POST /api/v1/payments/refresh-invoice (requires auth)", note: "Invoice expired. Create new payment invoice to continue." });
      return res.status(200).json({ message: "⏳ Payment pending", paymentStatus: "PENDING", payment: { id: payment.id, amount: payment.amount, invoiceUrl: payment.invoiceUrl, status: payment.status, expiredAt: payment.expiredAt, remainingMinutes, remainingSeconds }, user: { email: payment.user.email }, affiliate: { code: payment.affiliate.code, status: payment.affiliate.status }, nextAction: "Complete payment", nextStep: `Continue payment at: ${payment.invoiceUrl}`, note: `Please complete payment within ${remainingMinutes} minute(s)` });
    }

    if (payment.status === "FAILED") return res.status(400).json({ error: "Payment failed", paymentStatus: "FAILED", payment: { id: payment.id, status: payment.status }, user: { email: payment.user.email }, nextAction: "Retry payment", nextStep: "POST /api/v1/payments/refresh-invoice (requires auth)", note: "Payment failed. Try again with a new invoice." });

    return res.status(400).json({ error: "Invoice expired", paymentStatus: payment.status, payment: { id: payment.id, status: payment.status, expiredAt: payment.expiredAt }, user: { email: payment.user.email }, nextAction: "Request new invoice", nextStep: "POST /api/v1/payments/refresh-invoice (requires auth)", note: "Invoice expired. Request new payment invoice." });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const checkPaymentStatusByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: "User ID is required", example: "/api/v1/users/{userId}/payment-status" });

    let payment = await prisma.payment.findUnique({ where: { userId }, include: { user: { select: { id: true, email: true, fullName: true, isEmailVerified: true } }, affiliate: { select: { id: true, code: true, status: true, referredBy: true } } } });
    if (!payment) return res.status(404).json({ error: "Payment not found for this user", userId, action: "User may not have completed signup yet" });

    payment = await syncPaymentWithXendit(payment);

    if (payment.status === "COMPLETED") return res.status(200).json({ message: "✅ Payment successful!", paymentStatus: "COMPLETED", payment: { id: payment.id, amount: payment.amount, paidAt: payment.paidAt, status: payment.status }, user: { id: payment.user.id, email: payment.user.email, fullName: payment.user.fullName }, affiliate: { code: payment.affiliate.code, status: payment.affiliate.status }, nextAction: "Proceed to login", nextStep: "POST /api/v1/users/login", note: "Your affiliate account is now ACTIVE and ready to use" });

    if (payment.status === "PENDING") {
      const now = new Date();
      const expiredAt = new Date(payment.expiredAt);
      const remainingSeconds = Math.floor((expiredAt - now) / 1000);
      const remainingMinutes = Math.ceil(remainingSeconds / 60);
      if (remainingSeconds <= 0) return res.status(400).json({ error: "Invoice expired", paymentStatus: "EXPIRED", payment: { id: payment.id, status: payment.status, expiredAt: payment.expiredAt }, user: { email: payment.user.email }, affiliate: { code: payment.affiliate.code }, nextAction: "Request new invoice", nextStep: "POST /api/v1/payments/refresh-invoice (requires login)", note: "Invoice expired. Create new payment invoice to continue." });
      return res.status(200).json({ message: "⏳ Payment pending", paymentStatus: "PENDING", payment: { id: payment.id, amount: payment.amount, invoiceUrl: payment.invoiceUrl, status: payment.status, expiredAt: payment.expiredAt, remainingMinutes, remainingSeconds }, user: { email: payment.user.email }, affiliate: { code: payment.affiliate.code, status: payment.affiliate.status }, nextAction: "Complete payment", nextStep: `Continue payment at: ${payment.invoiceUrl}`, note: `Please complete payment within ${remainingMinutes} minute(s)` });
    }

    if (payment.status === "FAILED") return res.status(400).json({ error: "Payment failed", paymentStatus: "FAILED", payment: { id: payment.id, status: payment.status }, user: { email: payment.user.email }, nextAction: "Retry payment", nextStep: "POST /api/v1/payments/refresh-invoice (requires login)", note: "Payment failed. Try again with a new invoice." });

    return res.status(400).json({ error: "Invoice expired", paymentStatus: payment.status, payment: { id: payment.id, status: payment.status, expiredAt: payment.expiredAt }, user: { email: payment.user.email }, nextAction: "Request new invoice", nextStep: "POST /api/v1/payments/refresh-invoice (requires login)", note: "Invoice expired. Request new payment invoice." });
  } catch (error) { res.status(500).json({ error: error.message }); }
};
