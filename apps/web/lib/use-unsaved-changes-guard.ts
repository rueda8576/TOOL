"use client";

import { useCallback, useEffect } from "react";

export function useUnsavedChangesGuard({
  isDirty,
  confirmMessage,
  enabled = true
}: {
  isDirty: boolean;
  confirmMessage: string;
  enabled?: boolean;
}): {
  requestExitProject: () => boolean;
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

  const requestExitProject = useCallback((): boolean => {
    if (!shouldGuard) {
      return true;
    }
    return window.confirm(confirmMessage);
  }, [confirmMessage, shouldGuard]);

  return { requestExitProject };
}
