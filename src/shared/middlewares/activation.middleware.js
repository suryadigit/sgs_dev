import { checkUserActivationStatus } from "../../modules/payment/payment.service.js";

export const checkActivationMiddleware = async (req, res, next) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return next();
    }

    const activationStatus = await checkUserActivationStatus(userId);
    req.activationStatus = activationStatus;

    next();
  } catch (error) {
    console.error("Check activation middleware error:", error);
    next();
  }
};

export const requireActivation = async (req, res, next) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "User ID not found in token" });
    }

    const activationStatus = await checkUserActivationStatus(userId);

    if (
      activationStatus.status === "ACTIVE" ||
      activationStatus.status === "PAID"
    ) {
      return next();
    }

    res.status(403).json({
      error: "Account not activated",
      status: activationStatus.status,
      message: activationStatus.message,
      ...(activationStatus.invoice && { invoice: activationStatus.invoice }),
      hint: "Please complete payment to activate your account",
    });
  } catch (error) {
    console.error("Require activation middleware error:", error);
    res.status(500).json({ error: error.message });
  }
};
