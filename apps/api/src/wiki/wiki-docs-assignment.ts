import type {
  WikiDocsAssignPageResult,
  WikiDocsAssignResult,
  WikiDocsKind
} from "./wiki.types";
import { wikiPathToDocsPath, WIKI_DOCS_DEFAULT_KIND } from "./wiki-docs-paths";
import { composePath, normalizeFolderPath, normalizeSlug } from "./wiki-paths";

export type WikiDocsAssignmentPageInput = {
  id: string;
  title: string;
  path: string;
};

export type WikiDocsAssignmentRepositoryInput = {
  id: string;
  name: string;
  wikiDocsPrefix: string | null;
};

export type WikiDocsAssignmentDestination = {
  docsKind: WikiDocsKind;
  slug: string;
  relativeFolderPath: string;
  folderPath: string;
  newWikiPath: string;
  docsPath: string;
};

export type PreparedDocsAssignmentLike = {
  mode: "linked" | "exportedToGit";
  repository: { id: string };
  newWikiPath: string;
};

export function buildDocsAssignmentDestination(params: {
  docsKind: WikiDocsKind;
  repositoryPrefix: string;
  slug: string;
  folderPath?: string | null;
}): WikiDocsAssignmentDestination {
  const slug = normalizeSlug(params.slug);
  const relativeFolderPath = normalizeFolderPath(params.folderPath ?? undefined);
  const folderPath = relativeFolderPath
    ? `${params.docsKind}/${params.repositoryPrefix}/${relativeFolderPath}`
    : `${params.docsKind}/${params.repositoryPrefix}`;
  const newWikiPath = composePath(folderPath, slug);

  return {
    docsKind: params.docsKind,
    slug,
    relativeFolderPath,
    folderPath,
    newWikiPath,
    docsPath: wikiPathToDocsPath(params.repositoryPrefix, newWikiPath)
  };
}

export function buildDocsAssignmentKey(repositoryId: string, docsPath: string): string {
  return `${repositoryId}:${docsPath}`;
}

export function buildDocsAssignmentResult(params: {
  page: WikiDocsAssignmentPageInput;
  repository: WikiDocsAssignmentRepositoryInput;
  oldWikiPath: string;
  newWikiPath: string;
  docsPath: string;
  docsKind?: WikiDocsKind;
  status: WikiDocsAssignPageResult["status"];
  reason: string | null;
}): WikiDocsAssignPageResult {
  return {
    pageId: params.page.id,
    title: params.page.title,
    oldWikiPath: params.oldWikiPath,
    newWikiPath: params.newWikiPath,
    repositoryId: params.repository.id,
    repositoryName: params.repository.name,
    docsPath: params.docsPath,
    docsKind: params.docsKind ?? WIKI_DOCS_DEFAULT_KIND,
    status: params.status,
    reason: params.reason
  };
}

export function groupDocsAssignmentsByRepository<TAssignment extends PreparedDocsAssignmentLike>(
  assignments: TAssignment[]
): Map<string, TAssignment[]> {
  const grouped = new Map<string, TAssignment[]>();
  for (const assignment of assignments) {
    if (assignment.mode !== "exportedToGit") {
      continue;
    }
    const repositoryAssignments = grouped.get(assignment.repository.id) ?? [];
    repositoryAssignments.push(assignment);
    grouped.set(assignment.repository.id, repositoryAssignments);
  }
  return grouped;
}

export function buildDocsAssignmentCommitMessage(assignments: PreparedDocsAssignmentLike[]): string {
  return assignments.length === 1
    ? `Assign wiki page ${assignments[0]!.newWikiPath} to Docs`
    : `Assign ${assignments.length} wiki pages to Docs`;
}

export function buildDocsAssignTotals(results: WikiDocsAssignPageResult[]): WikiDocsAssignResult["totals"] {
  return results.reduce(
    (accumulator, result) => ({
      assigned: accumulator.assigned + (result.status === "exportedToGit" || result.status === "linked" ? 1 : 0),
      exportedToGit: accumulator.exportedToGit + (result.status === "exportedToGit" ? 1 : 0),
      linked: accumulator.linked + (result.status === "linked" ? 1 : 0),
      conflicts: accumulator.conflicts + (result.status === "conflict" ? 1 : 0),
      errors: accumulator.errors + (result.status === "error" ? 1 : 0)
    }),
    {
      assigned: 0,
      exportedToGit: 0,
      linked: 0,
      conflicts: 0,
      errors: 0
    }
  );
}

export function sortDocsAssignmentResults(results: WikiDocsAssignPageResult[]): WikiDocsAssignPageResult[] {
  return [...results].sort((left, right) => left.oldWikiPath.localeCompare(right.oldWikiPath));
}
