import { WikiHub } from "../../../../../components/wiki-hub";

export default function ProjectWikiPathPage({
  params
}: {
  params: { projectId: string; wikiPath: string[] };
}): JSX.Element {
  const initialPath = params.wikiPath.map((segment) => decodeURIComponent(segment)).join("/");
  return <WikiHub projectId={params.projectId} initialPath={initialPath} />;
}
