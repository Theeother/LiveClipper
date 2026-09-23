// Click-through "clip marked" toast. The Rust side moves this window on/off
// screen; this script only swaps the content and plays the animation.
import { listen } from "@tauri-apps/api/event";

interface ToastPayload {
  kind: "marked" | "warn";
  title: string;
  detail: string;
}

const toast = document.getElementById("toast")!;
const icon = document.getElementById("toast-icon")!;
const title = document.getElementById("toast-title")!;
const detail = document.getElementById("toast-detail")!;

let hideTimer: number | undefined;

void listen<ToastPayload>("toast", ({ payload }) => {
  icon.textContent = payload.kind === "warn" ? "⚠" : "🔖";
  title.textContent = payload.title;
  detail.textContent = payload.detail;
  toast.dataset.kind = payload.kind;

  // Restart the animation even for rapid consecutive presses.
  toast.classList.remove("show");
  void toast.offsetWidth;
  toast.classList.add("show");

  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => toast.classList.remove("show"), 1000);
});
