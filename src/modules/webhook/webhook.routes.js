import express from "express";
import { handleOrderComplete, manualUpgradeAffiliate, reprocessOrder } from "./webhook.controller.js";

const router = express.Router();

router.post("/woocommerce/order-complete", handleOrderComplete);
router.post("/manual-upgrade", manualUpgradeAffiliate);
router.post("/woocommerce/reprocess", reprocessOrder);

export default router;
