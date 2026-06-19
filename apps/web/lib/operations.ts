import { authFetch } from "./client-api";

export type BackupOperationLedgerItem = {
  id: string;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  completedAt: string | null;
  retentionUntil: string | null;
  durationMs: number | null;
  dbDumpBytes: number | null;
  storageArchiveBytes: number | null;
  dbDumpSha256: string | null;
  storageArchiveSha256: string | null;
  toolVersions: Record<string, string>;
  error: string | null;
};

export type ProjectOperationsLedger = {
  generatedAt: string;
  backups: {
    summary: {
      total: number;
      running: number;
      succeeded: number;
      failed: number;
    };
    runs: BackupOperationLedgerItem[];
  };
};

export type EnqueueBackupResult = {
  jobId: string;
  queuedAt: string;
};

export async function listProjectOperations(token: string): Promise<ProjectOperationsLedger> {
  return authFetch<ProjectOperationsLedger>("/projects/admin/operations", { token });
}

export async function enqueueBackupOperation(token: string): Promise<EnqueueBackupResult> {
  return authFetch<EnqueueBackupResult>("/projects/admin/operations/backups", {
    token,
    init: {
      method: "POST",
      body: JSON.stringify({})
    }
  });
}
