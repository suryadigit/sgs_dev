-- CreateIndex
CREATE INDEX "AffiliateCommission_level_idx" ON "AffiliateCommission"("level");

-- CreateIndex
CREATE INDEX "AffiliateCommission_createdAt_idx" ON "AffiliateCommission"("createdAt");

-- CreateIndex
CREATE INDEX "AffiliateProfile_code_idx" ON "AffiliateProfile"("code");

-- CreateIndex
CREATE INDEX "AffiliateProfile_status_idx" ON "AffiliateProfile"("status");

-- CreateIndex
CREATE INDEX "AffiliateProfile_userId_idx" ON "AffiliateProfile"("userId");

-- CreateIndex
CREATE INDEX "AffiliateProfile_registeredAt_idx" ON "AffiliateProfile"("registeredAt");

-- CreateIndex
CREATE INDEX "OtpRecord_userId_idx" ON "OtpRecord"("userId");

-- CreateIndex
CREATE INDEX "OtpRecord_code_idx" ON "OtpRecord"("code");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");
