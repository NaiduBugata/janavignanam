/** Register the website service worker. The Android WebView build skips this. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (import.meta.env.VITE_CAPACITOR === "true") return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installation stays available from the manifest even if the worker fails.
    });
  });
}
