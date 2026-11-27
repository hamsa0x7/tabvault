import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "./ui.tsx";

export interface ConfirmDialogRequest {
  title: string;
  description: string;
  confirmLabel: string;
  variant?: "danger" | "primary";
}

export function ConfirmDialog({
  request,
  onResolve,
}: {
  request: ConfirmDialogRequest | null;
  onResolve: (confirmed: boolean) => void;
}) {
  return (
    <Dialog.Root
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open) onResolve(false);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          role="alertdialog"
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm rounded-2xl border border-[var(--st-border)] bg-[var(--st-surface)] text-[var(--st-ink)] p-5 shadow-2xl space-y-4"
        >
          <div className="flex items-start justify-between gap-2">
            <Dialog.Title className="text-[15px] font-semibold leading-snug">
              {request?.title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" aria-label="Close dialog">
                <X className="w-4 h-4" />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-[13px] text-[var(--st-muted)] leading-relaxed">
            {request?.description}
          </Dialog.Description>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => onResolve(false)}>
              Cancel
            </Button>
            <Button
              variant={request?.variant === "danger" ? "danger" : "primary"}
              onClick={() => onResolve(true)}
            >
              {request?.confirmLabel || "Confirm"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
