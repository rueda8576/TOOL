"use client";

import { useCallback, useEffect } from "react";

export function useUnsavedChangesGuard({
  isDirty,
  confirmMessage,
  confirmExit,
  enabled = true
}: {
  isDirty: boolean;
  confirmMessage: string;
  confirmExit?: (options: { title: string; message: string; confirmLabel?: string; destructive?: boolean }) => Promise<boolean>;
  enabled?: boolean;
}): {
  requestExitProject: () => Promise<boolean>;
} {
  const shouldGuard = enabled && isDirty;

  useEffect(() => {
    if (!shouldGuard) {
      return;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [shouldGuard]);

  const requestExitProject = useCallback(async (): Promise<boolean> => {
    if (!shouldGuard) {
      return true;
    }
    if (!confirmExit) {
      return false;
    }
    return confirmExit({
      title: "Discard unsaved changes",
      message: confirmMessage,
      confirmLabel: "Discard changes",
      destructive: true
    });
  }, [confirmExit, confirmMessage, shouldGuard]);

  return { requestExitProject };
}
