import { type DriveAction, DriveControls } from "./drive-controls";

/** Each finger owns its action; releasing one finger never releases another. */
export class DrivePad {
  private readonly pointers = new Map<number, { button: HTMLButtonElement; source: string }>();
  private readonly buttons: HTMLButtonElement[];

  constructor(private readonly root: HTMLElement, private readonly controls: DriveControls,
    onInput: () => void) {
    this.buttons = [...root.querySelectorAll<HTMLButtonElement>("[data-drive]")];
    root.addEventListener("contextmenu", event => event.preventDefault());
    root.addEventListener("pointerdown", event => {
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-drive]");
      if (!button || button.disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.preventDefault(); // Keep game focus and allow simultaneous finger presses.
      const source = "pad:" + event.pointerId;
      this.pointers.set(event.pointerId, { button, source });
      controls.pressAction(source, button.dataset.drive as DriveAction);
      button.setPointerCapture(event.pointerId);
      onInput(); this.refresh();
    });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      root.addEventListener(name, event => {
        const held = this.pointers.get(event.pointerId);
        if (!held) return;
        this.pointers.delete(event.pointerId);
        controls.releaseAction(held.source);
        if (held.button.hasPointerCapture(event.pointerId)) held.button.releasePointerCapture(event.pointerId);
        this.refresh();
      });
    }
    // The on-screen controls also remain usable with Tab + Space/Enter.
    root.addEventListener("keydown", event => {
      if (event.code !== "Space" && event.code !== "Enter") return;
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-drive]");
      if (!button || button.disabled) return;
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) {
        controls.pressAction("pad-key:" + button.dataset.drive, button.dataset.drive as DriveAction);
        onInput(); this.refresh();
      }
    });
    root.addEventListener("keyup", event => {
      if (event.code !== "Space" && event.code !== "Enter") return;
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-drive]");
      if (!button) return;
      event.preventDefault(); event.stopPropagation();
      controls.releaseAction("pad-key:" + button.dataset.drive); this.refresh();
    });
    root.addEventListener("focusout", event => {
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-drive]");
      if (button) controls.releaseAction("pad-key:" + button.dataset.drive);
      this.refresh();
    });
  }
  setTurboAvailable(available: boolean): void {
    const button = this.buttons.find(button => button.dataset.drive === "turbo")!;
    button.disabled = !available;
    button.title = available ? "Hold with throttle for turbo" : "Turbo is available on BuggY";
  }
  private refresh(): void {
    for (const button of this.buttons) {
      const active = this.controls.actionHeld(button.dataset.drive as DriveAction);
      button.classList.toggle("is-held", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }
  clear(): void {
    const held = [...this.pointers.entries()];
    this.pointers.clear();
    for (const [id, entry] of held) {
      this.controls.releaseAction(entry.source);
      if (entry.button.hasPointerCapture(id)) entry.button.releasePointerCapture(id);
    }
    for (const button of this.buttons) this.controls.releaseAction("pad-key:" + button.dataset.drive);
    this.refresh();
  }
}
