// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BackupPasswordField } from "../src/components/BackupPasswordField.tsx";
import { ConfirmDialog } from "../src/components/ConfirmDialog.tsx";
import { Button, Checkbox, Input, Select, Switch, Textarea } from "../src/components/ui.tsx";

afterEach(() => {
  cleanup();
});

describe("UI primitives contracts", () => {
  it("Button supports loading, disabled, and title-to-aria-label mapping", () => {
    const onClick = vi.fn();
    render(
      <Button title="Save session" loading onClick={onClick}>
        Save
      </Button>
    );
    const btn = screen.getByRole("button", { name: "Save session" });
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("Input, Textarea, and Select propagate aria-invalid when error is set", () => {
    render(
      <div>
        <Input aria-label="Session name" error="Required" />
        <Textarea aria-label="Collection notes" error />
        <Select aria-label="Open mode" error>
          <option value="newWindow">New window</option>
        </Select>
      </div>
    );

    expect(screen.getByLabelText("Session name").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Collection notes").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Open mode").getAttribute("aria-invalid")).toBe("true");
  });

  it("Switch and Checkbox expose accessible checked states and toggle", () => {
    const onSwitch = vi.fn();
    const onCheck = vi.fn();
    render(
      <div>
        <Switch checked={false} onCheckedChange={onSwitch} ariaLabel="Auto save" />
        <Checkbox checked={true} onCheckedChange={onCheck} ariaLabel="Select all" />
      </div>
    );

    const sw = screen.getByRole("switch", { name: "Auto save" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(onSwitch).toHaveBeenCalledWith(true);

    const cb = screen.getByRole("checkbox", { name: "Select all" });
    expect(cb.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(cb);
    expect(onCheck).toHaveBeenCalledWith(false);
  });

  it("ConfirmDialog resolves true on confirm and false on cancel", () => {
    const onResolve = vi.fn();
    render(
      <ConfirmDialog
        request={{
          title: "Delete session",
          description: "This cannot be undone.",
          confirmLabel: "Delete",
          variant: "danger",
        }}
        onResolve={onResolve}
      />
    );

    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onResolve).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onResolve).toHaveBeenLastCalledWith(true);
  });

  it("BackupPasswordField toggles visibility and announces errors", () => {
    render(
      <BackupPasswordField
        ariaLabel="Backup password"
        value="correct horse battery staple"
        onChange={() => {}}
        mode="setup"
        error="Password mismatch"
      />
    );

    const input = screen.getByLabelText("Backup password") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("Password mismatch");

    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(input.type).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" }).getAttribute("aria-pressed")).toBe("true");
  });
});
