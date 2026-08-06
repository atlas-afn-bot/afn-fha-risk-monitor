import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import MethodologyProjections from "./pages/MethodologyProjections.tsx";
import DevEnvironmentBanner from "@/components/DevEnvironmentBanner";

const App = () => (
  <TooltipProvider>
    <BrowserRouter>
      <DevEnvironmentBanner />
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/methodology/projections" element={<MethodologyProjections />} />
      </Routes>
      {/* Global toaster — used by the NW auto-trigger success/failure notices
          in the uploader (see src/components/tabs/FileUploads.tsx). */}
      <Toaster position="top-right" richColors closeButton />
    </BrowserRouter>
  </TooltipProvider>
);

export default App;
