export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").then((registration) => {
      registration.update().catch(() => undefined);
    }).catch((error: unknown) => {
      console.warn("Service worker registration failed", error);
    });
  });
}
