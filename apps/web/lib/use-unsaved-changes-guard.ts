"use client";

import { useCallback, useEffect } from "react";

export type GuardedShellNavigationTarget = {
  href: string;
  reason: "module" | "exit-project" | "sign-out";
};

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
  requestShellNavigation: (target?: GuardedShellNavigationTarget) => Promise<boolean>;
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

  const requestShellNavigation = useCallback(async (_target?: GuardedShellNavigationTarget): Promise<boolean> => {
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

  return { requestShellNavigation };
}
