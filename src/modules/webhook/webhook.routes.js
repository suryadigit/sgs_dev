import express from "express";
import { handleOrderComplete, testWebhook, manualUpgradeAffiliate, reprocessOrder } from "./webhook.controller.js";

const router = express.Router();

router.get("/test", testWebhook);
router.post("/woocommerce/order-complete", handleOrderComplete);
router.post("/manual-upgrade", manualUpgradeAffiliate);
router.post("/woocommerce/reprocess", reprocessOrder);

export default router;
