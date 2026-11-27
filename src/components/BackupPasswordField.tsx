import { useId, useState } from "react";
import { AlertTriangle, Eye, EyeOff } from "lucide-react";
import { evaluatePasswordStrength } from "../shared/password-strength.ts";
import { Button, Input, cn } from "./ui.tsx";

export interface BackupPasswordFieldProps {
  id?: string;
  ariaLabel?: string;
  value: string;
  onChange: (next: string) => void;
  mode: "setup" | "unlock";
  placeholder?: string;
  disabled?: boolean;
  error?: string | null;
  showStrength?: boolean;
  showRecoveryWarning?: boolean;
  className?: string;
  inputClassName?: string;
}

const STRENGTH_BAR_COLORS: Record<number, string> = {
  1: "bg-[var(--st-danger)]",
  2: "bg-[var(--st-star)]",
  3: "bg-[var(--st-accent)]",
  4: "bg-[var(--st-success)]",
};

export function BackupPasswordField({
  id,
  ariaLabel,
  value,
  onChange,
  mode,
  placeholder,
  disabled = false,
  error = null,
  showStrength = mode === "setup",
  showRecoveryWarning = false,
  className,
  inputClassName,
}: BackupPasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const inputId = id || generatedId;
  const errorId = `${inputId}-error`;
  const strength = showStrength ? evaluatePasswordStrength(value) : null;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="relative flex items-center">
        <Input
          id={inputId}
          aria-label={ariaLabel}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            placeholder || (mode === "setup" ? "12+ characters or passphrase" : "Enter backup password")
          }
          disabled={disabled}
          autoComplete={mode === "setup" ? "new-password" : "current-password"}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn("w-full pr-9", error && "border-[var(--st-danger)]", inputClassName)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute right-0.5 h-7 w-7 text-[var(--st-muted)] hover:text-[var(--st-ink)]"
        >
          {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </Button>
      </div>

      {strength && value.length > 0 && (
        <div className="space-y-1" aria-live="polite">
          <div className="grid grid-cols-4 gap-1" aria-hidden="true">
            {[1, 2, 3, 4].map((step) => (
              <div
                key={step}
                className={cn(
                  "h-1 rounded-full transition-colors",
                  strength.score >= step
                    ? STRENGTH_BAR_COLORS[strength.score]
                    : "bg-[var(--st-border)]"
                )}
              />
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--st-muted)]">
            <span className="font-semibold text-[var(--st-ink)]">{strength.label}</span>
            <span className="truncate">{strength.guidance}</span>
          </div>
        </div>
      )}

      {showRecoveryWarning && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--st-warn-bd)] bg-[var(--st-warn-bg)] px-2.5 py-2 text-[11.5px] leading-snug text-[var(--st-warn-ink)]">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <strong>No password reset:</strong> Your password never leaves this device. If you forget it,
            encrypted cloud backups cannot be recovered—save it in a password manager first.
          </div>
        </div>
      )}

      {error && (
        <p id={errorId} role="alert" className="text-[11.5px] text-[var(--st-danger)] font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
