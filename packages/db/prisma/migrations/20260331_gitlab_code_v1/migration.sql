CREATE TABLE "GitLabConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "gitlabUserId" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "avatarUrl" TEXT,
  "webUrl" TEXT,
  "scope" TEXT,
  "accessTokenEncrypted" TEXT NOT NULL,
  "refreshTokenEncrypted" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "reconnectRequired" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GitLabConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectRepository" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "gitlabProjectId" TEXT NOT NULL,
  "pathWithNamespace" TEXT NOT NULL,
  "webUrl" TEXT NOT NULL,
  "defaultBranch" TEXT NOT NULL,
  "connectedByUserId" TEXT NOT NULL,
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectRepository_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GitLabConnection_userId_key" ON "GitLabConnection"("userId");
CREATE UNIQUE INDEX "GitLabConnection_gitlabUserId_key" ON "GitLabConnection"("gitlabUserId");
CREATE INDEX "GitLabConnection_username_idx" ON "GitLabConnection"("username");

CREATE UNIQUE INDEX "ProjectRepository_projectId_key" ON "ProjectRepository"("projectId");
CREATE UNIQUE INDEX "ProjectRepository_gitlabProjectId_key" ON "ProjectRepository"("gitlabProjectId");
CREATE INDEX "ProjectRepository_pathWithNamespace_idx" ON "ProjectRepository"("pathWithNamespace");

ALTER TABLE "GitLabConnection"
  ADD CONSTRAINT "GitLabConnection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectRepository"
  ADD CONSTRAINT "ProjectRepository_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectRepository"
  ADD CONSTRAINT "ProjectRepository_connectedByUserId_fkey"
  FOREIGN KEY ("connectedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
