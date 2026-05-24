"use client";

import { ReactNode, useCallback, useState } from "react";

import { ConfirmDialog } from "../components/ui";

type ConfirmDialogOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type ConfirmDialogState = ConfirmDialogOptions & {
  resolve: (confirmed: boolean) => void;
};

export function useConfirmDialog(): {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  confirmDialog: ReactNode;
} {
  const [state, setState] = useState<ConfirmDialogState | null>(null);

  const confirm = useCallback((options: ConfirmDialogOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ ...options, resolve });
    });
  }, []);

  const close = useCallback(
    (confirmed: boolean): void => {
      state?.resolve(confirmed);
      setState(null);
    },
    [state]
  );

  return {
    confirm,
    confirmDialog: state ? (
      <ConfirmDialog
        title={state.title}
        message={state.message}
        confirmLabel={state.confirmLabel}
        cancelLabel={state.cancelLabel}
        destructive={state.destructive}
        onConfirm={() => close(true)}
        onCancel={() => close(false)}
      />
    ) : null
  };
}
