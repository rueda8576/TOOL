import { redirect } from "next/navigation";

export default function LegacyDocumentsEditorPage({
  params
}: {
  params: { projectId: string };
}): never {
  redirect(`/projects/${params.projectId}/documents`);
}
