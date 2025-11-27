import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import CreateRoom from "@/pages/create-room";
import JoinRoom from "@/pages/join-room";
import Room from "@/pages/room";
import P2PRoom from "@/pages/p2p-room";
import AdminLogin from "@/pages/admin-login";
import AdminChangePassword from "@/pages/admin-change-password";
import AdminDashboard from "@/pages/admin-dashboard";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/create" component={CreateRoom} />
      <Route path="/join" component={JoinRoom} />
      <Route path="/room/:id" component={Room} />
      <Route path="/p2p" component={P2PRoom} />
      <Route path="/admin/login" component={AdminLogin} />
      <Route path="/admin/change-password" component={AdminChangePassword} />
      <Route path="/admin/dashboard" component={AdminDashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
