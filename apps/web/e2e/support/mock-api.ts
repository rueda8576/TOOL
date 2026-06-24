import type { Page, Route } from "@playwright/test";

import {
  documentItem,
  documentVersion,
  meetingItems,
  operationsLedger,
  projectAccess,
  projectOverview,
  projectSummary,
  qaProject,
  qaUser,
  repository,
  taskItems,
  wikiPage,
  wikiResearchPage,
  wikiTree
} from "./mock-data";

type JsonValue = Record<string, unknown> | Array<unknown>;

function json(route: Route, payload: JsonValue, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
    headers: {
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function notFound(route: Route): Promise<void> {
  return json(route, { message: "Mock route not found" }, 404);
}

export async function installMockApi(page: Page): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();

    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
      return;
    }

    if (method === "POST" && path === "/auth/login") {
      await json(route, { token: "qa-token", expiresAt: "2026-06-18T23:00:00.000Z", user: qaUser });
      return;
    }
    if (method === "POST" && path === "/auth/password/reset") {
      await json(route, { requested: true });
      return;
    }
    if (method === "POST" && path === "/auth/password/reset/confirm") {
      await json(route, { reset: true });
      return;
    }
    if (method === "POST" && path === "/auth/accept-invite") {
      await json(route, { token: "qa-token", expiresAt: "2026-06-18T23:00:00.000Z", user: qaUser });
      return;
    }

    if (method === "GET" && path === "/auth/me") {
      await json(route, { ...qaUser, timezone: "Europe/Madrid" });
      return;
    }
    if (method === "GET" && path === "/users/me/notification-preferences") {
      await json(route, {
        emailEnabled: true,
        taskAssigned: true,
        taskDue: true,
        mentionInWiki: true,
        mentionInTaskComments: true,
        taskDueLeadHours: 48
      });
      return;
    }
    if (method === "GET" && path === "/auth/gitlab/connection") {
      await json(route, {
        connected: true,
        username: "atlasium-admin",
        webUrl: "https://gitlab.example.test/atlasium-admin",
        httpsClone: { passwordSyncedAt: "2026-06-18T09:00:00.000Z" }
      });
      return;
    }
    if (method === "GET" && path === "/auth/gitlab/ssh-keys") {
      await json(route, []);
      return;
    }

    if (method === "GET" && path === "/projects") {
      await json(route, [projectSummary]);
      return;
    }
    if (method === "GET" && path === "/projects/admin/operations") {
      await json(route, operationsLedger);
      return;
    }
    if (method === "POST" && path === "/projects/admin/operations/backups") {
      await json(route, { jobId: "backup-job-1", queuedAt: "2026-06-19T10:01:00.000Z" }, 201);
      return;
    }
    if (method === "GET" && path === `/projects/${qaProject.id}/access`) {
      await json(route, projectAccess);
      return;
    }
    if (method === "GET" && path === `/projects/${qaProject.id}/overview`) {
      await json(route, projectOverview);
      return;
    }

    if (method === "GET" && path === `/projects/${qaProject.id}/documents`) {
      await json(route, [documentItem]);
      return;
    }
    if (method === "GET" && path === `/projects/${qaProject.id}/documents/${documentItem.id}`) {
      await json(route, { ...documentItem, createdAt: "2026-06-01T09:00:00.000Z" });
      return;
    }
    if (method === "GET" && path === `/document-versions/${documentVersion.id}/pdf`) {
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: "%PDF-1.4\n% Atlasium QA placeholder\n"
      });
      return;
    }
    if (method === "GET" && path === `/document-versions/${documentVersion.id}/compile-log`) {
      await json(route, { documentVersionId: documentVersion.id, compileStatus: "succeeded", compileLog: "Compiled successfully.", compiledPdfFileId: "pdf-1" });
      return;
    }

    if (method === "GET" && path === `/projects/${qaProject.id}/wiki-pages/tree`) {
      await json(route, wikiTree);
      return;
    }
    if (method === "GET" && path === `/projects/${qaProject.id}/wiki-pages/by-path`) {
      const wikiPath = url.searchParams.get("path");
      await json(route, wikiPath === "home" ? wikiPage : wikiResearchPage);
      return;
    }
    if (method === "GET" && path === `/projects/${qaProject.id}/wiki-pages/docs-sync/status`) {
      await json(route, {
        repositories: [
          {
            repositoryId: repository.id,
            name: repository.name,
            pathWithNamespace: repository.pathWithNamespace,
            defaultBranch: repository.defaultBranch,
            wikiDocsPrefix: "atlasium-research-archive",
            docsRoot: "Docs",
            lastSyncedAt: "2026-06-18T08:00:00.000Z",
            lastSyncError: null,
            bindings: { active: 1, deleted: 0 },
            structure: {
              research: 1,
              implementation: 0,
              legacy: 0,
              migrationAvailable: false
            }
          }
        ],
        unassigned: []
      });
      return;
    }

    if (method === "GET" && path === `/projects/${qaProject.id}/repositories`) {
      await json(route, [repository]);
      return;
    }
    if (method === "GET" && path === `/projects/${qaProject.id}/repositories/${repository.id}/branches`) {
      await json(route, [{ name: "main", webUrl: repository.webUrl, default: true }]);
      return;
    }
    if (method === "GET" && path === `/projects/${qaProject.id}/repositories/${repository.id}/commits`) {
      await json(route, [{ id: "commit-1", shortId: "a1b2c3d", title: "Initialize archive", message: "Initialize archive", authorName: qaUser.name, authoredDate: "2026-06-18T08:00:00.000Z", webUrl: repository.webUrl }]);
      return;
    }
    if (method === "GET" && path === `/projects/${qaProject.id}/repositories/${repository.id}/tree`) {
      await json(route, {
        ref: "main",
        path: "",
        entries: [
          { id: "readme", name: "README.md", path: "README.md", type: "blob", mode: "100644" },
          { id: "docs", name: "Docs", path: "Docs", type: "tree", mode: "040000" }
        ]
      });
      return;
    }
    if (method === "GET" && path === `/projects/${qaProject.id}/repositories/${repository.id}/merge-requests`) {
      await json(route, []);
      return;
    }

    if (method === "GET" && path === `/projects/${qaProject.id}/tasks`) {
      await json(route, taskItems);
      return;
    }
    if (method === "GET" && path === `/projects/${qaProject.id}/members`) {
      await json(route, [{ userId: qaUser.id, name: qaUser.name, email: qaUser.email }]);
      return;
    }

    if (method === "GET" && path === `/projects/${qaProject.id}/meetings`) {
      await json(route, meetingItems);
      return;
    }

    await notFound(route);
  });
}

export async function seedSession(page: Page, role: "admin" | "editor" | "reader" = "admin"): Promise<void> {
  await page.addInitScript(
    ({ userRole }) => {
      window.localStorage.setItem("doctoral_token", "qa-token");
      window.localStorage.setItem(
        "doctoral_user",
        JSON.stringify({
          id: "user-admin",
          email: "admin@atlasium.test",
          username: "atlasium-admin",
          name: "Atlasium Admin",
          globalRole: userRole
        })
      );
    },
    { userRole: role }
  );
}
