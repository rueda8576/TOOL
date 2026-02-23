"use client";

import { useEffect, useState } from "react";

import { ProjectSummary } from "../lib/api";
import { authFetch } from "../lib/client-api";

export function ProjectSubtitle({
  projectId,
  suffix
}: {
  projectId: string;
  suffix: string;
}): JSX.Element {
  const [projectLabel, setProjectLabel] = useState(projectId);

  useEffect(() => {
    const token = localStorage.getItem("doctoral_token");
    if (!token) {
      setProjectLabel(projectId);
      return;
    }

    let mounted = true;

    void authFetch<ProjectSummary[]>("/projects", { token })
      .then((projects) => {
        if (!mounted) {
          return;
        }

        const project = projects.find((item) => item.id === projectId);
        if (project) {
          setProjectLabel(`${project.key} - ${project.name}`);
          return;
        }

        setProjectLabel(projectId);
      })
      .catch(() => {
        if (mounted) {
          setProjectLabel(projectId);
        }
      });

    return () => {
      mounted = false;
    };
  }, [projectId]);

  return <>{`${projectLabel} - ${suffix}`}</>;
}
