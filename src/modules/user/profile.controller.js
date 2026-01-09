import prisma from "../../shared/lib/prisma.js";
import { generateUserResponse } from "../auth/auth.service.js";

export const getUserProfile = async (req, res) => {
  try {
    const userId = req.userId;
    console.log(`[profile] getUserProfile called userId=${userId}`);
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { affiliateProfile: true } });
    console.log(`[profile] prisma returned user id=${user?.id}`);
    if (!user) return res.status(404).json({ error: "User not found" });
    const userResponse = await generateUserResponse(user, user.affiliateProfile);
    res.json({ message: "Profile retrieved successfully", user: userResponse });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const updateUserProfile = async (req, res) => {
  try {
    const userId = req.userId;
    const { fullName, phone, bank, alamat } = req.body;
    const user = await prisma.user.update({ where: { id: userId }, data: { ...(fullName !== undefined && { fullName }), ...(phone !== undefined && { phone }), ...(bank !== undefined && { bank }), ...(alamat !== undefined && { alamat }) }, include: { affiliateProfile: true } });
    const userResponse = await generateUserResponse(user, user.affiliateProfile);
    res.json({ message: "Profile updated successfully", user: userResponse });
  } catch (error) { res.status(500).json({ error: error.message }); }
};
