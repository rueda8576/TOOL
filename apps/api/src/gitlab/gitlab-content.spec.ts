import { BadRequestException } from "@nestjs/common";

import {
  buildCreateBranchRequest,
  buildCreateMergeRequestRequest,
  buildRepositoryArchiveAttempts,
  buildRepositoryArchiveFallbackTreePath,
  buildRepositoryArchiveResolveCommitsPath,
  buildRepositoryCommitRequest,
  buildRepositoryCommitsPath,
  buildRepositoryFilePath,
  buildRepositoryRawFilePath,
  buildRepositoryBranchesCollectionPath,
  buildRepositoryRecursiveTreePath,
  buildRepositoryMergeRequestsCollectionPath,
  buildRepositoryTreePath,
  mapCreatedBranch,
  mapCreatedMergeRequest,
  mapGitlabBranch,
  mapGitlabCommit,
  mapGitlabDocsMarkdownFile,
  mapGitlabFileContent,
  mapGitlabMergeRequest,
  mapGitlabRawFile,
  mapGitlabTreeNode,
  mapRepositoryDocsCommitResult,
  normalizeRepositoryDocsFilePath,
  normalizeRepositoryFilePath,
  readTextFromGitlabFile,
  resolveArchiveCommitSha
} from "./gitlab-content";

describe("gitlab content helpers", () => {
  it("builds content API paths with current query ordering", () => {
    expect(buildRepositoryBranchesCollectionPath("123")).toBe("/projects/123/repository/branches");
    expect(buildRepositoryCommitsPath("123", " feature/nav ")).toBe(
      "/projects/123/repository/commits?per_page=25&ref_name=feature%2Fnav"
    );
    expect(buildRepositoryArchiveResolveCommitsPath("123", "feature/nav")).toBe(
      "/projects/123/repository/commits?per_page=1&ref_name=feature%2Fnav"
    );
    expect(buildRepositoryTreePath({
      gitlabProjectId: "123",
      ref: "main",
      path: "Docs/Research",
      perPage: 200
    })).toBe("/projects/123/repository/tree?per_page=200&ref=main&path=Docs%2FResearch");
    expect(buildRepositoryRecursiveTreePath({
      gitlabProjectId: "123",
      ref: "main",
      path: "Docs",
      page: 2,
      pageSize: 100
    })).toBe("/projects/123/repository/tree?recursive=true&per_page=100&page=2&ref=main&path=Docs");
    expect(buildRepositoryFilePath("123", "Docs/Research/index.md", "main")).toBe(
      "/projects/123/repository/files/Docs%2FResearch%2Findex.md?ref=main"
    );
    expect(buildRepositoryRawFilePath("123", "plots/nav.png", "main")).toBe(
      "/projects/123/repository/files/plots%2Fnav.png/raw?ref=main"
    );
    expect(buildRepositoryMergeRequestsCollectionPath("123")).toBe("/projects/123/merge_requests");
  });

  it("maps branches, commits, and tree entries to API responses", () => {
    expect(mapGitlabBranch({
      name: "main",
      default: true,
      merged: false,
      protected: true
    })).toEqual({
      name: "main",
      default: true,
      merged: false,
      canPush: false,
      protected: true,
      webUrl: null
    });

    expect(mapGitlabCommit({
      id: "abc",
      short_id: "abc",
      title: "Initial",
      message: "Initial commit",
      authored_date: "2026-06-18T12:00:00.000Z",
      author_name: "Ada"
    })).toEqual({
      id: "abc",
      shortId: "abc",
      title: "Initial",
      message: "Initial commit",
      authoredDate: "2026-06-18T12:00:00.000Z",
      authorName: "Ada",
      webUrl: null
    });
    expect(mapRepositoryDocsCommitResult({
      id: "def",
      short_id: "def",
      title: "Sync docs",
      message: "Sync docs",
      authored_date: "2026-06-18T12:00:00.000Z",
      author_name: "Ada",
      web_url: "https://git.atlasium.info/atlasium/nav/-/commit/def"
    })).toEqual({
      id: "def",
      shortId: "def",
      title: "Sync docs",
      message: "Sync docs",
      webUrl: "https://git.atlasium.info/atlasium/nav/-/commit/def"
    });

    expect(mapGitlabTreeNode({
      id: "tree-1",
      name: "Docs",
      path: "Docs",
      type: "tree"
    })).toEqual({
      id: "tree-1",
      name: "Docs",
      path: "Docs",
      type: "tree"
    });
  });

  it("normalizes file paths and maps text, raw, and Docs Markdown files", () => {
    expect(normalizeRepositoryFilePath(" Docs/Research/index.md ")).toBe("Docs/Research/index.md");
    expect(normalizeRepositoryDocsFilePath(" /Docs\\Research\\index.md/ ")).toBe("Docs/Research/index.md");
    expect(() => normalizeRepositoryFilePath("   ")).toThrow(BadRequestException);

    const gitlabFile = {
      file_name: "index.md",
      file_path: "Docs/Research/index.md",
      size: 7,
      ref: "main",
      blob_id: "blob-1",
      last_commit_id: "commit-1",
      content_sha256: undefined,
      content: Buffer.from("# Index").toString("base64")
    };

    expect(mapGitlabFileContent(gitlabFile)).toEqual({
      filePath: "Docs/Research/index.md",
      fileName: "index.md",
      ref: "main",
      size: 7,
      binary: false,
      content: "# Index"
    });
    expect(mapGitlabRawFile("plots/nav.png", { buffer: Buffer.from([1, 2]), contentType: null })).toEqual({
      buffer: Buffer.from([1, 2]),
      fileName: "nav.png",
      contentType: "image/png"
    });
    expect(mapGitlabDocsMarkdownFile(readTextFromGitlabFile(gitlabFile, gitlabFile.file_path))).toEqual({
      docsPath: "Docs/Research/index.md",
      relativePath: "Research/index.md",
      fileName: "index.md",
      ref: "main",
      blobId: "blob-1",
      lastCommitId: "commit-1",
      contentSha256: null,
      content: "# Index"
    });
  });

  it("builds commit, branch, and merge request payloads with existing validation", () => {
    expect(buildRepositoryCommitRequest({
      branch: "main",
      commitMessage: "   ",
      actions: [
        {
          action: "update",
          filePath: " /Docs\\Implementation\\notes.md ",
          content: "Body",
          lastCommitId: "commit-1"
        }
      ]
    })).toEqual({
      normalizedActions: [
        {
          action: "update",
          filePath: "Docs/Implementation/notes.md",
          content: "Body",
          lastCommitId: "commit-1"
        }
      ],
      payload: {
        branch: "main",
        commit_message: "Sync Atlasium Wiki Docs",
        actions: [
          {
            action: "update",
            file_path: "Docs/Implementation/notes.md",
            content: "Body",
            last_commit_id: "commit-1"
          }
        ]
      }
    });
    expect(() => buildRepositoryCommitRequest({ branch: "main", commitMessage: "msg", actions: [] })).toThrow(
      "At least one repository file action is required"
    );

    expect(buildCreateBranchRequest({ name: " feature/nav ", sourceRef: " main " })).toEqual({
      branchName: "feature/nav",
      sourceRef: "main",
      payload: {
        branch: "feature/nav",
        ref: "main"
      }
    });
    expect(mapCreatedBranch({ name: "feature/nav", default: false })).toEqual({
      name: "feature/nav",
      webUrl: null,
      default: false
    });

    expect(buildCreateMergeRequestRequest({
      sourceBranch: " feature/nav ",
      targetBranch: " main ",
      title: " Merge navigation ",
      description: " "
    })).toEqual({
      sourceBranch: "feature/nav",
      targetBranch: "main",
      payload: {
        source_branch: "feature/nav",
        target_branch: "main",
        title: "Merge navigation",
        description: undefined
      }
    });
  });

  it("maps merge requests and archive helpers without changing fallback semantics", () => {
    expect(mapGitlabMergeRequest({
      id: 91,
      iid: 14,
      title: "Draft: navigation",
      state: "opened",
      web_url: "https://git.atlasium.info/atlasium/nav/-/merge_requests/14",
      source_branch: "feature/nav",
      target_branch: "main",
      updated_at: "2026-06-18T12:00:00.000Z",
      author: {
        name: "Ada",
        username: "ada"
      }
    })).toEqual({
      id: 91,
      iid: 14,
      title: "Draft: navigation",
      state: "opened",
      webUrl: "https://git.atlasium.info/atlasium/nav/-/merge_requests/14",
      sourceBranch: "feature/nav",
      targetBranch: "main",
      updatedAt: "2026-06-18T12:00:00.000Z",
      draft: true,
      author: {
        name: "Ada",
        username: "ada",
        avatarUrl: null
      }
    });
    expect(mapCreatedMergeRequest({
      id: 91,
      iid: 14,
      title: "Merge navigation",
      state: "opened",
      web_url: "https://git.atlasium.info/atlasium/nav/-/merge_requests/14"
    })).toEqual({
      id: 91,
      iid: 14,
      title: "Merge navigation",
      state: "opened",
      webUrl: "https://git.atlasium.info/atlasium/nav/-/merge_requests/14"
    });

    expect(buildRepositoryArchiveAttempts("123", "abc").map((attempt) => attempt.label)).toEqual([
      "archive_zip_header_auth",
      "archive_no_extension_accept_zip",
      "archive_zip_query_auth"
    ]);
    expect(buildRepositoryArchiveAttempts("123", "abc")[2]).toMatchObject({
      path: "/projects/123/repository/archive.zip?sha=abc",
      accept: "*/*",
      authMode: "query"
    });
    expect(buildRepositoryArchiveFallbackTreePath("123", "abc", 3)).toBe(
      "/projects/123/repository/tree?recursive=true&per_page=100&page=3&ref=abc"
    );
    expect(resolveArchiveCommitSha([{ id: "abc", short_id: "abc", title: "", message: "", authored_date: "", author_name: "" }])).toBe("abc");
    expect(() => resolveArchiveCommitSha([])).toThrow("GitLab archive ref could not be resolved");
  });
});
