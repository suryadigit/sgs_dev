import express from "express";
import { verifyToken } from "../../shared/middlewares/auth.js";
import {
  getCommissionTransactions,
  getCommissionTransactionsByLevel,
  getCommissionTransactionsByStatus,
} from "./commissionTransaction.controller.js";

const router = express.Router();

router.get("/", verifyToken, getCommissionTransactions);
router.get("/by-level/:level", verifyToken, getCommissionTransactionsByLevel);
router.get("/by-status/:status", verifyToken, getCommissionTransactionsByStatus);

export default router;
