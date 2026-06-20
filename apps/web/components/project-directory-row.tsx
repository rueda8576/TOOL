import Link from "next/link";

import type { ProjectSummary } from "../lib/api";
import { ArchiveRow, MetadataStrip } from "./ui";

export function ProjectDirectoryRow({
  createdLabel,
  deleting,
  isAdmin,
  onDeleteProject,
  onTogglePin,
  pinBusy,
  project
}: {
  createdLabel: string;
  deleting: boolean;
  isAdmin: boolean;
  onDeleteProject: (project: ProjectSummary) => void | Promise<void>;
  onTogglePin: (project: ProjectSummary) => void | Promise<void>;
  pinBusy: boolean;
  project: ProjectSummary;
}): JSX.Element {
  return (
    <ArchiveRow className="projects-directory-row">
      <div className="archive-row-main">
        <div className="stack-xxs">
          <div className="projects-list-header">
            <h4 className="archive-row-title">
              <span className="projects-key">{project.key}</span> {project.name}
            </h4>
            {project.isPinned ? <span className="badge projects-pinned-badge">Pinned</span> : null}
          </div>
          <p className="archive-row-detail">{project.description ?? "No description"}</p>
          <MetadataStrip
            items={[
              `Created ${createdLabel}`,
              project.isPinned ? "Pinned in directory" : "Unpinned"
            ]}
          />
        </div>
        <div className="archive-row-actions">
          <Link className="button button-secondary" href={`/projects/${project.id}`}>
            Open
          </Link>
          <button
            className="button button-ghost"
            type="button"
            disabled={pinBusy}
            onClick={() => {
              void onTogglePin(project);
            }}
          >
            {pinBusy ? "Saving..." : project.isPinned ? "Unpin" : "Pin"}
          </button>
          {isAdmin ? (
            <button
              className="button button-danger"
              type="button"
              disabled={deleting}
              onClick={() => {
                void onDeleteProject(project);
              }}
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          ) : null}
        </div>
      </div>
    </ArchiveRow>
  );
}
