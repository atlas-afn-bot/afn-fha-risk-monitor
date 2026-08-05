import { BrowserRouter, Route, Routes } from "react-router-dom";
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
    </BrowserRouter>
  </TooltipProvider>
);

export default App;
