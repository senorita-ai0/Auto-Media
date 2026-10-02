import { HashRouter, Routes, Route } from "react-router-dom";
import { AppProvider } from "./context/AppContext";
import { ToastProvider } from "./context/ToastContext";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import Users from "./pages/Users";
import Profiles from "./pages/Profiles";
import ContentTypes from "./pages/ContentTypes";
import Automations from "./pages/Automations";
import Content from "./pages/Content";
import Accounts from "./pages/Accounts";
import N8nWorkflows from "./pages/N8nWorkflows";
import ReviewQueue from "./pages/ReviewQueue";
import Logs from "./pages/Logs";
import Calendar from "./pages/Calendar";
import Team from "./pages/Team";
import Observability from "./pages/Observability";
import AiProviders from "./pages/AiProviders";
import Setup from "./pages/Setup";
import Media from "./pages/Media";
import StudioOverview from "./pages/StudioOverview";
import SheetSetup from "./pages/SheetSetup";
import Connectors from "./pages/Connectors";
import Dashboard from "./pages/Dashboard";
import Guides from "./pages/Guides";
import Queue from "./pages/Queue";
import Operations from "./pages/Operations";
import Jobs from "./pages/Jobs";
import ErrorBoundary from "./components/ErrorBoundary";
import HelpAssistant from "./components/HelpAssistant";

export default function App() {
  return (
    <ErrorBoundary><ToastProvider><AppProvider>
      <HashRouter>
        <div className="app-shell flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex-1 flex flex-col overflow-hidden">
            <TopBar />
            <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
              <Routes>
                <Route path="/" element={<Users />} />
                <Route path="/profiles" element={<Profiles />} />
                <Route path="/content-types" element={<ContentTypes />} />
                <Route path="/automations" element={<Automations />} />
                <Route path="/content" element={<Content />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/n8n" element={<N8nWorkflows />} />
                <Route path="/review" element={<ReviewQueue />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/calendar" element={<Calendar />} />
                <Route path="/team" element={<Team />} />
                <Route path="/observability" element={<Observability />} />
                <Route path="/ai" element={<AiProviders />} />
                <Route path="/setup" element={<Setup />} />
                <Route path="/media" element={<Media />} />
                <Route path="/studio" element={<StudioOverview />} />
                <Route path="/sheet" element={<SheetSetup />} />
                <Route path="/connectors" element={<Connectors />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/guides" element={<Guides />} />
                <Route path="/queue" element={<Queue />} />
                <Route path="/operations" element={<Operations />} />
                <Route path="/jobs" element={<Jobs />} />
              </Routes>
            </main>
          </div>
        </div>
        <HelpAssistant />
      </HashRouter>
    </AppProvider></ToastProvider></ErrorBoundary>
  );
}
