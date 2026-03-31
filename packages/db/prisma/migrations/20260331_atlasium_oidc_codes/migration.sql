CREATE TABLE "OidcAuthorizationCode" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "nonce" TEXT,
  "codeChallenge" TEXT,
  "codeChallengeMethod" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OidcAuthorizationCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OidcAuthorizationCode_codeHash_key" ON "OidcAuthorizationCode"("codeHash");
CREATE INDEX "OidcAuthorizationCode_userId_expiresAt_idx" ON "OidcAuthorizationCode"("userId", "expiresAt");

ALTER TABLE "OidcAuthorizationCode"
  ADD CONSTRAINT "OidcAuthorizationCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
