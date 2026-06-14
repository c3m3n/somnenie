export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").then((registration) => {
      registration.update().catch(() => undefined);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent("nutrio-sw-update-found", { detail: { registration } }));
          }
        });
      });
    }).catch((error: unknown) => {
      console.warn("Service worker registration failed", error);
    });
  });
  window.addEventListener("beforeinstallprompt", () => {
    // intentional no-op: keep listener for future onboarding without breaking builds in browsers without support
  });
}

export function forceServiceWorkerUpdate(): void {
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.getRegistration("/").then((registration) => {
    if (!registration?.waiting) return;
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
    registration.waiting.addEventListener("statechange", () => {
      if (registration.waiting?.state === "activated") window.location.reload();
    }, { once: true });
  });
}
