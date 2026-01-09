import express from "express";
import cors from "cors";
import * as Sentry from "@sentry/node";
import { sentryDsn, sentryOptions } from "./config/sentry.config.js";

import userRoutes from "./modules/user/user.routes.js";
import userManagementRoutes from "./modules/user/userManagement.routes.js";
import affiliateRoutes from "./modules/affiliate/affiliate.routes.js";
import paymentRoutes from "./modules/payment/payment.routes.js";
import commissionRoutes from "./modules/commission/commission.routes.js";
import commissionTransactionRoutes from "./modules/commission/commissionTransaction.routes.js";
import withdrawalRoutes from "./modules/withdrawal/withdrawal.routes.js";
import notificationRoutes from "./modules/notification/notification.routes.js";
import dynamicMenuRoutes from "./modules/menu/dynamicMenu.routes.js";
import adminAffiliateRoutes from "./modules/admin/adminAffiliate.routes.js";
import wordpressRoutes from "./modules/wordpress/wordpress.routes.js";
import webhookRoutes from "./modules/webhook/webhook.routes.js";
import debugRoutes from "./modules/debug/debug.routes.js";

import { errorHandler } from "./shared/middlewares/auth.js";
import { setupCompression, httpCaching, responseTimer } from "./shared/middlewares/performance.middleware.js";
import discordLogger from "./shared/middlewares/discordLogger.js";
import requestLogger from './shared/middlewares/requestLogger.js';

const app = express();

if (sentryDsn) {
  console.log('SENTRY_DSN=', sentryDsn ? '[present]' : '[not set]');
  Sentry.init({ dsn: sentryDsn, ...sentryOptions });
  app.use(Sentry.Handlers.requestHandler());
}

app.use(cors({
  origin: [
    'http://localhost:3002',  
    'http://localhost:3003',  
    'http://localhost:3004',  
    'http://localhost:5173', 
    'http://127.0.0.1:3002',
    'http://127.0.0.1:3003',
    'tauri://localhost',      
    'https://tauri.localhost' 
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control', 'Pragma'],
  exposedHeaders: ['Cache-Control', 'Pragma']
}));
app.use(express.json());
setupCompression(app);
app.use(responseTimer);
app.use(httpCaching);
app.use(discordLogger);
app.use(requestLogger);

app.set('json spaces', 2);

app.use(debugRoutes);
  
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/affiliate", affiliateRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/invoices", paymentRoutes); 
app.use("/api/v1/commissions", commissionRoutes);
app.use("/api/v1/commission-transactions", commissionTransactionRoutes);
app.use("/api/v1/withdrawals", withdrawalRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/admin", dynamicMenuRoutes); 
app.use("/api/v1/admin/users", userManagementRoutes); 
app.use("/api/v1/admin/affiliate", adminAffiliateRoutes);
app.use("/api/v1/wordpress", wordpressRoutes);
app.use("/api/webhook", webhookRoutes);  

if (sentryDsn) {
  app.use(Sentry.Handlers.errorHandler());
}
app.use(errorHandler);

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
