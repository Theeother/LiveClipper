import Box from "@mui/material/Box";
import { AppBar } from "./components/AppBar/AppBar";
import { AppStatusProvider } from "./hooks/useAppStatus";
import { ClipEditorPage } from "./pages/ClipEditor/ClipEditorPage";
import { DashboardPage } from "./pages/Dashboard/DashboardPage";
import { SessionPage } from "./pages/Session/SessionPage";
import { SettingsPage } from "./pages/Settings/SettingsPage";
import { RouterProvider, useRouter } from "./router";

function Screen() {
  const { route } = useRouter();
  switch (route.name) {
    case "dashboard":
      return <DashboardPage />;
    case "session":
      return <SessionPage key={route.id} sessionId={route.id} />;
    case "editor":
      return <ClipEditorPage key={`${route.sessionId}/${route.markerId}`} sessionId={route.sessionId} markerId={route.markerId} />;
    case "settings":
      return <SettingsPage />;
  }
}

export function App() {
  return (
    <AppStatusProvider>
      <RouterProvider>
        <Box sx={{ height: "100vh", display: "flex", flexDirection: "column" }}>
          <AppBar />
          <Box component="main" sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <Screen />
          </Box>
        </Box>
      </RouterProvider>
    </AppStatusProvider>
  );
}
