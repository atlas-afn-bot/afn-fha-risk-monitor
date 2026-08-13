import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import MethodologyProjections from "./pages/MethodologyProjections.tsx";
import ScenarioLibraryPage from "./pages/scenarios/ScenarioLibraryPage.tsx";
import ScenarioBuilderPage from "./pages/scenarios/ScenarioBuilderPage.tsx";
import ScenarioDetailPage from "./pages/scenarios/ScenarioDetailPage.tsx";
import DevEnvironmentBanner from "@/components/DevEnvironmentBanner";

const App = () => (
  <TooltipProvider>
    <BrowserRouter>
      <DevEnvironmentBanner />
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/methodology/projections" element={<MethodologyProjections />} />
        {/* PR-C — Scenario Builder + Library. Deep links land on /scenarios/:id
            directly via the SPA fallback in public/staticwebapp.config.json. */}
        <Route path="/scenarios" element={<ScenarioLibraryPage />} />
        <Route path="/scenarios/new" element={<ScenarioBuilderPage mode="new" />} />
        <Route path="/scenarios/:id" element={<ScenarioDetailPage />} />
        <Route path="/scenarios/:id/edit" element={<ScenarioBuilderPage mode="edit" />} />
      </Routes>
      {/* Global toaster — used by the NW auto-trigger success/failure notices
          in the uploader (see src/components/tabs/FileUploads.tsx). */}
      <Toaster position="top-right" richColors closeButton />
    </BrowserRouter>
  </TooltipProvider>
);

export default App;
