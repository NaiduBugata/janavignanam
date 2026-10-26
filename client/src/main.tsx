import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App.tsx";
import AdminDesk from "./news/AdminDesk.tsx";
import ProgressPage from "./ProgressPage.tsx";
import ReportPage from "./ReportPage.tsx";
import UploadPage from "./UploadPage.tsx";

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

createRoot(document.getElementById("root")!).render(
	<BrowserRouter>
		<Routes>
			<Route path="/progress/:token" element={<ProgressPage />} />
			<Route path="/reports/:id" element={<ReportPage />} />
			<Route path="/upload" element={<UploadPage />} />
			<Route path="/@admin" element={<AdminDesk />} />
			<Route path="/news/@admin" element={<Navigate to="/@admin" replace />} />
			<Route path="*" element={<App />} />
		</Routes>
	</BrowserRouter>,
);
