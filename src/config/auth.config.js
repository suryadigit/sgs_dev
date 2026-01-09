export const authConfig = {
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: "24h",
  
  OTP_EXPIRY_MINUTES: 5,
  
};

export const validateAuthConfig = () => {
  const required = ["JWT_SECRET"];
  const missing = required.filter(key => !authConfig[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing auth config: ${missing.join(", ")}`);
  }
};
