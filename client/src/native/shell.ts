/**
 * Android system back, only in the Capacitor production build.
 * Vite drops this import from the Vercel bundle when VITE_CAPACITOR is unset.
 */
export function installNativeShell(): void {
  if (import.meta.env.VITE_CAPACITOR !== "true") return;

  void import("@capacitor/app").then(({ App }) => {
    void App.addListener("backButton", () => {
      const dialog = document.querySelector(
        "[role='dialog'][aria-modal='true']",
      );
      const close = dialog?.querySelector<HTMLButtonElement>(
        "button[aria-label='Close']",
      );
      if (close) {
        close.click();
        return;
      }

      const back = new CustomEvent("janavignanam-back", { cancelable: true });
      window.dispatchEvent(back);
      if (back.defaultPrevented) return;

      const index = window.history.state?.idx;
      if (typeof index === "number" && index > 0) {
        window.history.back();
        return;
      }
      void App.exitApp();
    });
  });
}
