import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { updatePassword } from "@lib/supabase/auth";
import supabase from "@lib/supabase/supabase";

export const Route = createFileRoute("/reset")({
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const [invalid, setInvalid] = useState(false);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setInvalid(true);
    }, 5000);

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        clearTimeout(timeout);
        setReady(true);
      }
    });

    return () => {
      clearTimeout(timeout);
      data.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const result = await updatePassword(newPassword);
      if (result) {
        setSuccess(true);
        toast.success("Password updated successfully!", { duration: 3000 });
      } else {
        toast.error("Failed to update password");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update password"
      );
    } finally {
      setLoading(false);
    }
  };

  if (!ready && !invalid) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-background">
        <p className="text-xl font-bold text-muted-foreground">
          Verifying reset link…
        </p>
      </div>
    );
  }

  if (invalid) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-background p-4">
        <div className="flex flex-col items-center gap-4">
          <p className="text-xl font-bold text-destructive text-center">
            This reset link is invalid or has expired.
          </p>
          <Button
            variant="outline"
            onClick={() => navigate({ to: "/auth" })}
            className="h-11 px-8 bg-accent text-primary"
          >
            Go to Sign In
          </Button>
        </div>
      </div>
    );
  }

  if (success) {
    // Check if we're in Tauri or browser
    const isTauri = typeof window !== "undefined" && (window as any).__TAURI__ !== undefined;

    return (
      <div className="flex items-center justify-center h-screen w-screen bg-background p-4">
        <div className="w-full max-w-md space-y-4 text-center">
          <h1 className="text-xl font-bold text-primary">Password Updated!</h1>
          <p className="text-muted-foreground">
            Your password has been successfully changed.
          </p>
          {isTauri ? (
            <Button
              variant="outline"
              onClick={() => navigate({ to: "/auth" })}
              className="h-11 px-8 bg-accent text-primary"
            >
              Go to Sign In
            </Button>
          ) : (
            <div className="space-y-3 mt-4">
              <p className="text-sm text-muted-foreground">
                Please return to the FunkyScout Desktop app and sign in with your new password.
              </p>
              <p className="text-xs text-muted-foreground opacity-70">
                You can close this browser window.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-screen w-screen bg-background p-4">
      <div className="w-full max-w-md px-5 py-6 flex flex-col gap-4">
        <div className="mb-4 text-center">
          <h1 className="text-3xl font-bold">FunkyScout Desktop</h1>
          <p className="text-muted-foreground mt-2">Reset Your Password</p>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="w-full flex flex-col gap-3 bg-accent rounded-md px-3 py-4"
        >
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            disabled={loading}
            className="h-9 w-full border border-border rounded-md text-foreground bg-accent text-sm font-thin placeholder:text-foreground"
          />

          <Input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm password"
            disabled={loading}
            className="h-9 w-full border border-border rounded-md text-foreground bg-accent text-sm font-thin placeholder:text-foreground"
          />

          <Button
            type="submit"
            variant="secondary"
            disabled={loading}
            className="h-11 w-full bg-accent border border-border text-primary text-sm mt-1"
          >
            {loading ? "Updating..." : "Update Password"}
          </Button>
        </form>
      </div>
    </div>
  );
}
