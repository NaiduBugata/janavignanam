import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  HashRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import App from "./App.tsx";
import AdminDesk from "./news/AdminDesk.tsx";
import { installNativeShell } from "./native/shell.ts";
import { registerServiceWorker } from "./pwa/register.ts";

try {
  let theme = localStorage.getItem("theme");
  if (theme === "system" || !theme) {
    theme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  document.documentElement.classList.add(theme);
} catch {
  // Theme initialization is optional; next-themes will apply the default.
}

registerServiceWorker();
installNativeShell();

const routes = (
  <Routes>
    <Route path="/@admin" element={<AdminDesk />} />
    <Route path="/news/@admin" element={<Navigate to="/@admin" replace />} />
    <Route path="*" element={<App />} />
  </Routes>
);

createRoot(document.getElementById("root")!).render(
  import.meta.env.VITE_CAPACITOR === "true" ? (
    <HashRouter>{routes}</HashRouter>
  ) : (
    <BrowserRouter>{routes}</BrowserRouter>
  ),
);
