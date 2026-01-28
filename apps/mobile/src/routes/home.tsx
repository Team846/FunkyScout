import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@shadcn/ui/components/button.tsx";
import { toast } from "sonner";
import { logout } from "@lib/supabase/auth";
import { getLocalUserData } from "@lib/supabase/user";

export const Route = createFileRoute("/home")({
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const userData = getLocalUserData();

  const handleLogout = async () => {
    await logout();
    toast.success("Logged out successfully");
    navigate({ to: "/auth" });
  };

  return (
    <div className="min-h-screen w-full bg-background flex flex-col items-center justify-center p-4 gap-4">
      <h1 className="text-2xl font-bold text-primary">Welcome!</h1>
      <p className="text-muted-foreground">
        Logged in as: {userData.name || userData.uid || "Unknown"}
      </p>
      <Button variant="outline" onClick={handleLogout}>
        Log Out
      </Button>
    </div>
  );
}
