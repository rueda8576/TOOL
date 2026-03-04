import { WikiHub } from "../../../../components/wiki-hub";

export default function ProjectWikiPage({
  params
}: {
  params: { projectId: string };
}): JSX.Element {
  return <WikiHub projectId={params.projectId} />;
}
