import { BadRequestException } from "@nestjs/common";

import { GitlabBinaryResponse } from "./gitlab-client";
import {
  buildRepositoryArchiveFileName,
  buildRepositoryRawFileName,
  detectRepositoryFileContentType,
  GITLAB_DOCS_ROOT,
  isBinaryBuffer
} from "./gitlab-format";

export type GitlabContentBranchInput = {
  name: string;
  merged: boolean;
  default: boolean;
  web_url?: string;
  can_push?: boolean;
  protected?: boolean;
};

export type GitlabContentCommitInput = {
  id: string;
  short_id: string;
  title: string;
  message: string;
  authored_date: string;
  author_name: string;
  web_url?: string;
};

export type GitlabContentTreeNodeInput = {
  id: string;
  name: string;
  type: "tree" | "blob";
  path: string;
};

export type GitlabContentFileInput = {
  file_name: string;
  file_path: string;
  size: number;
  ref: string;
  blob_id: string;
  last_commit_id: string;
  content_sha256?: string;
  content: string;
};

export type GitlabContentMergeRequestInput = {
  id: number;
  iid: number;
  title: string;
  state: string;
  web_url: string;
  source_branch: string;
  target_branch: string;
  updated_at: string;
  draft?: boolean;
  work_in_progress?: boolean;
  author?: {
    username: string;
    name: string;
    avatar_url?: string | null;
  };
};

export type RepositoryContentCommitActionInput = {
  action: "create" | "update" | "delete";
  filePath: string;
  content?: string;
  lastCommitId?: string | null;
};

export type GitlabArchiveAttempt = {
  label: string;
  path: string;
  accept: string;
  authMode?: "header" | "query";
};

export function buildRepositoryBranchesPath(gitlabProjectId: string): string {
  return `/projects/${encodeURIComponent(gitlabProjectId)}/repository/branches?per_page=100`;
}

export function buildRepositoryBranchesCollectionPath(gitlabProjectId: string): string {
  return `/projects/${encodeURIComponent(gitlabProjectId)}/repository/branches`;
}

export function buildRepositoryCommitsPath(gitlabProjectId: string, ref?: string): string {
  const search = new URLSearchParams({ per_page: "25" });
  if (ref?.trim()) {
    search.set("ref_name", ref.trim());
  }
  return `/projects/${encodeURIComponent(gitlabProjectId)}/repository/commits?${search.toString()}`;
}

export function buildRepositoryArchiveResolveCommitsPath(gitlabProjectId: string, ref: string): string {
  const search = new URLSearchParams({
    per_page: "1",
    ref_name: ref
  });
  return `/projects/${encodeURIComponent(gitlabProjectId)}/repository/commits?${search.toString()}`;
}

export function buildRepositoryTreePath(params: {
  gitlabProjectId: string;
  ref: string;
  path?: string;
  perPage: number;
}): string {
  const search = new URLSearchParams({ per_page: String(params.perPage), ref: params.ref });
  if (params.path?.trim()) {
    search.set("path", params.path.trim());
  }
  return `/projects/${encodeURIComponent(params.gitlabProjectId)}/repository/tree?${search.toString()}`;
}

export function buildRepositoryRecursiveTreePath(params: {
  gitlabProjectId: string;
  ref: string;
  path: string;
  page: number;
  pageSize: number;
}): string {
  const search = new URLSearchParams({
    recursive: "true",
    per_page: String(params.pageSize),
    page: String(params.page),
    ref: params.ref,
    path: params.path
  });
  return `/projects/${encodeURIComponent(params.gitlabProjectId)}/repository/tree?${search.toString()}`;
}

export function normalizeRepositoryFilePath(filePath: string): string {
  const normalizedFilePath = filePath.trim();
  if (!normalizedFilePath) {
    throw new BadRequestException("filePath is required");
  }
  return normalizedFilePath;
}

export function normalizeRepositoryDocsFilePath(filePath: string): string {
  const normalizedFilePath = filePath.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalizedFilePath) {
    throw new BadRequestException("filePath is required");
  }
  return normalizedFilePath;
}

export function buildRepositoryFilePath(gitlabProjectId: string, filePath: string, ref: string): string {
  const search = new URLSearchParams({ ref });
  return `/projects/${encodeURIComponent(gitlabProjectId)}/repository/files/${encodeURIComponent(filePath)}?${search.toString()}`;
}

export function buildRepositoryRawFilePath(gitlabProjectId: string, filePath: string, ref: string): string {
  const search = new URLSearchParams({ ref });
  return `/projects/${encodeURIComponent(gitlabProjectId)}/repository/files/${encodeURIComponent(filePath)}/raw?${search.toString()}`;
}

export function buildRepositoryCommitPath(gitlabProjectId: string): string {
  return `/projects/${encodeURIComponent(gitlabProjectId)}/repository/commits`;
}

export function buildRepositoryMergeRequestsPath(gitlabProjectId: string, state?: string): string {
  const search = new URLSearchParams({
    state: state ?? "opened",
    per_page: "20",
    order_by: "updated_at",
    sort: "desc"
  });
  return `/projects/${encodeURIComponent(gitlabProjectId)}/merge_requests?${search.toString()}`;
}

export function buildRepositoryMergeRequestsCollectionPath(gitlabProjectId: string): string {
  return `/projects/${encodeURIComponent(gitlabProjectId)}/merge_requests`;
}

export function buildRepositoryArchivePath(gitlabProjectId: string, sha: string, format?: "zip"): string {
  const search = new URLSearchParams({ sha });
  const suffix = format ? `.${format}` : "";
  return `/projects/${encodeURIComponent(gitlabProjectId)}/repository/archive${suffix}?${search.toString()}`;
}

export function buildRepositoryArchiveAttempts(gitlabProjectId: string, archiveSha: string): GitlabArchiveAttempt[] {
  return [
    {
      label: "archive_zip_header_auth",
      path: buildRepositoryArchivePath(gitlabProjectId, archiveSha, "zip"),
      accept: "*/*"
    },
    {
      label: "archive_no_extension_accept_zip",
      path: buildRepositoryArchivePath(gitlabProjectId, archiveSha),
      accept: "application/zip"
    },
    {
      label: "archive_zip_query_auth",
      path: buildRepositoryArchivePath(gitlabProjectId, archiveSha, "zip"),
      accept: "*/*",
      authMode: "query"
    }
  ];
}

export function buildRepositoryArchiveFallbackTreePath(
  gitlabProjectId: string,
  archiveSha: string,
  page: number
): string {
  const search = new URLSearchParams({
    recursive: "true",
    per_page: "100",
    page: String(page),
    ref: archiveSha
  });
  return `/projects/${encodeURIComponent(gitlabProjectId)}/repository/tree?${search.toString()}`;
}

export function mapGitlabBranch(branch: GitlabContentBranchInput) {
  return {
    name: branch.name,
    default: branch.default,
    merged: branch.merged,
    canPush: branch.can_push ?? false,
    protected: branch.protected ?? false,
    webUrl: branch.web_url ?? null
  };
}

export function mapGitlabCommit(commit: GitlabContentCommitInput) {
  return {
    id: commit.id,
    shortId: commit.short_id,
    title: commit.title,
    message: commit.message,
    authoredDate: commit.authored_date,
    authorName: commit.author_name,
    webUrl: commit.web_url ?? null
  };
}

export function mapRepositoryDocsCommitResult(commit: GitlabContentCommitInput) {
  return {
    id: commit.id,
    shortId: commit.short_id,
    title: commit.title,
    message: commit.message,
    webUrl: commit.web_url ?? null
  };
}

export function mapGitlabTreeNode(entry: GitlabContentTreeNodeInput) {
  return {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    type: entry.type
  };
}

export function mapGitlabFileContent(gitlabFile: GitlabContentFileInput) {
  const rawBuffer = Buffer.from(gitlabFile.content, "base64");
  const binary = isBinaryBuffer(rawBuffer);

  return {
    filePath: gitlabFile.file_path,
    fileName: gitlabFile.file_name,
    ref: gitlabFile.ref,
    size: gitlabFile.size,
    binary,
    content: binary ? null : rawBuffer.toString("utf8")
  };
}

export function mapGitlabRawFile(filePath: string, rawFile: GitlabBinaryResponse) {
  return {
    buffer: rawFile.buffer,
    fileName: buildRepositoryRawFileName(filePath),
    contentType: rawFile.contentType ?? detectRepositoryFileContentType(filePath) ?? "application/octet-stream"
  };
}

export function mapGitlabDocsMarkdownFile(
  gitlabFile: Omit<GitlabContentFileInput, "content"> & { content: string },
  docsRoot = GITLAB_DOCS_ROOT
) {
  return {
    docsPath: gitlabFile.file_path,
    relativePath: gitlabFile.file_path.startsWith(`${docsRoot}/`)
      ? gitlabFile.file_path.slice(`${docsRoot}/`.length)
      : gitlabFile.file_path,
    fileName: gitlabFile.file_name,
    ref: gitlabFile.ref,
    blobId: gitlabFile.blob_id,
    lastCommitId: gitlabFile.last_commit_id,
    contentSha256: gitlabFile.content_sha256 ?? null,
    content: gitlabFile.content
  };
}

export function readTextFromGitlabFile<TFile extends { content: string }>(
  gitlabFile: TFile,
  filePathForError: string
): Omit<TFile, "content"> & { content: string } {
  const rawBuffer = Buffer.from(gitlabFile.content, "base64");
  if (isBinaryBuffer(rawBuffer)) {
    throw new BadRequestException(`Repository file is binary and cannot be synced as Markdown: ${filePathForError}`);
  }

  return {
    ...gitlabFile,
    content: rawBuffer.toString("utf8")
  };
}

export function buildRepositoryCommitRequest(params: {
  branch: string;
  commitMessage: string;
  actions: RepositoryContentCommitActionInput[];
}) {
  const normalizedActions = params.actions.map((action) => ({
    ...action,
    filePath: action.filePath.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  }));

  if (normalizedActions.length === 0) {
    throw new BadRequestException("At least one repository file action is required");
  }
  if (normalizedActions.some((action) => !action.filePath)) {
    throw new BadRequestException("Repository file action paths are required");
  }
  if (
    normalizedActions.some(
      (action) => (action.action === "create" || action.action === "update") && typeof action.content !== "string"
    )
  ) {
    throw new BadRequestException("Repository create/update actions require content");
  }

  return {
    normalizedActions,
    payload: {
      branch: params.branch,
      commit_message: params.commitMessage.trim() || "Sync Atlasium Wiki Docs",
      actions: normalizedActions.map((action) => ({
        action: action.action,
        file_path: action.filePath,
        ...(action.content !== undefined ? { content: action.content } : {}),
        ...(action.lastCommitId ? { last_commit_id: action.lastCommitId } : {})
      }))
    }
  };
}

export function buildCreateBranchRequest(dto: { name: string; sourceRef: string }) {
  const branchName = dto.name.trim();
  const sourceRef = dto.sourceRef.trim();
  if (!branchName) {
    throw new BadRequestException("Branch name is required.");
  }
  if (!sourceRef) {
    throw new BadRequestException("Source ref is required.");
  }

  return {
    branchName,
    sourceRef,
    payload: {
      branch: branchName,
      ref: sourceRef
    }
  };
}

export function mapCreatedBranch(branch: Pick<GitlabContentBranchInput, "name" | "default" | "web_url">) {
  return {
    name: branch.name,
    webUrl: branch.web_url ?? null,
    default: branch.default
  };
}

export function buildCreateMergeRequestRequest(dto: {
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description?: string | null;
}) {
  const sourceBranch = dto.sourceBranch.trim();
  const targetBranch = dto.targetBranch.trim();
  const title = dto.title.trim();
  const description = dto.description?.trim() || undefined;
  if (!sourceBranch) {
    throw new BadRequestException("Source branch is required.");
  }
  if (!targetBranch) {
    throw new BadRequestException("Target branch is required.");
  }
  if (!title) {
    throw new BadRequestException("Merge request title is required.");
  }
  if (sourceBranch === targetBranch) {
    throw new BadRequestException("Source and target branches must be different.");
  }

  return {
    sourceBranch,
    targetBranch,
    payload: {
      source_branch: sourceBranch,
      target_branch: targetBranch,
      title,
      description
    }
  };
}

export function mapGitlabMergeRequest(mergeRequest: GitlabContentMergeRequestInput) {
  return {
    id: mergeRequest.id,
    iid: mergeRequest.iid,
    title: mergeRequest.title,
    state: mergeRequest.state,
    webUrl: mergeRequest.web_url,
    sourceBranch: mergeRequest.source_branch,
    targetBranch: mergeRequest.target_branch,
    updatedAt: mergeRequest.updated_at,
    draft:
      mergeRequest.draft ??
      mergeRequest.work_in_progress ??
      /^(draft|wip):/i.test(mergeRequest.title),
    author: mergeRequest.author
      ? {
          name: mergeRequest.author.name,
          username: mergeRequest.author.username,
          avatarUrl: mergeRequest.author.avatar_url ?? null
        }
      : null
  };
}

export function mapCreatedMergeRequest(mergeRequest: Pick<GitlabContentMergeRequestInput, "id" | "iid" | "title" | "state" | "web_url">) {
  return {
    id: mergeRequest.id,
    iid: mergeRequest.iid,
    title: mergeRequest.title,
    state: mergeRequest.state,
    webUrl: mergeRequest.web_url
  };
}

export function resolveArchiveCommitSha(commits: GitlabContentCommitInput[]): string {
  const commitSha = commits[0]?.id;
  if (!commitSha) {
    throw new BadRequestException("GitLab archive ref could not be resolved");
  }
  return commitSha;
}

export function mapRepositoryArchiveResponse(params: {
  pathWithNamespace: string;
  ref: string;
  archive: GitlabBinaryResponse;
}) {
  return {
    buffer: params.archive.buffer,
    fileName: buildRepositoryArchiveFileName(params.pathWithNamespace, params.ref),
    contentType: params.archive.contentType ?? "application/zip"
  };
}
