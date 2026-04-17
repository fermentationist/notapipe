import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { registerSW } from "virtual:pwa-register";

// Without this, VitePWA falls back to a bare registerSW.js that only calls
// navigator.serviceWorker.register() — no controllerchange listener, so the
// page never reloads when a new SW version claims the tab. Safari in particular
// does not proactively update SWs, causing users to run stale cached code
// indefinitely until they manually clear site data.
registerSW({
  immediate: true,
  onRegistered(registration) {
    // Poll for SW updates hourly so long-lived tabs catch new deploys even if
    // the browser's native update check doesn't fire (common on Safari iOS).
    if (registration) {
      setInterval(
        () => {
          registration.update();
        },
        60 * 60 * 1000,
      );
    }
  },
});

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
