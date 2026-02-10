import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import supabase from "@lib/supabase/supabase";
import { Button } from "@shadcn/ui/components/button.tsx";

export const Route = createFileRoute("/verify")({
  component: VerifyPage,
});

function VerifyPage() {
  const [timedOut, setTimedOut] = useState(false);
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    const timeout = setTimeout(() => {
      setTimedOut(true);
      setStatus("error");
    }, 5000);

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        clearTimeout(timeout);

        if (session?.user?.email_confirmed_at) {
          setStatus("success");
          toast.success("Email verified!", { duration: 3000 });
        } else {
          setStatus("error");
        }
      }
    });

    return () => {
      clearTimeout(timeout);
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <div className="flex items-center justify-center h-screen w-screen bg-background p-4">
      <div className="w-full max-w-md flex flex-col items-center gap-6">
        <div className="mb-4 text-center">
          <h1 className="text-3xl font-bold text-primary">FunkyScout Desktop</h1>
          <p className="text-muted-foreground mt-2">Email Verification</p>
        </div>

        {status === "loading" && (
          <div className="flex flex-col items-center gap-4">
            <div className="animate-pulse">
              <svg
                className="text-primary"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="currentColor"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M22 7.53491V16.9999C22 17.7651 21.7077 18.5014 21.1827 19.0582C20.6578 19.6149 19.9399 19.95 19.176 19.9949L19 19.9999H5C4.23479 20 3.49849 19.7076 2.94174 19.1826C2.38499 18.6577 2.04989 17.9398 2.005 17.1759L2 16.9999V7.53491L11.445 13.8319L11.561 13.8979C11.6977 13.9647 11.8478 13.9994 12 13.9994C12.1522 13.9994 12.3023 13.9647 12.439 13.8979L12.555 13.8319L22 7.53491Z" />
                <path d="M18.9999 4C20.0799 4 21.0269 4.57 21.5549 5.427L11.9999 11.797L2.44495 5.427C2.69568 5.01977 3.04016 4.6784 3.44965 4.43138C3.85915 4.18436 4.32178 4.03886 4.79895 4.007L4.99995 4H18.9999Z" />
              </svg>
            </div>
            <p className="text-muted-foreground text-lg">Verifying your email...</p>
          </div>
        )}

        {status === "success" && (
          <div className="flex flex-col items-center gap-6 w-full">
            <svg
              className="text-primary"
              width="64"
              height="64"
              viewBox="0 0 24 24"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>

            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-primary">Email Verified!</h2>
              <p className="text-muted-foreground">
                Your account has been verified.
              </p>
            </div>

            {typeof window !== "undefined" && (window as any).__TAURI__ !== undefined ? (
              <Button
                variant="outline"
                onClick={() => navigate({ to: "/auth" })}
                className="h-11 px-8 bg-accent text-primary w-full"
              >
                Go to Sign In
              </Button>
            ) : (
              <div className="space-y-3 mt-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Please return to the FunkyScout Desktop app and sign in with your verified account.
                </p>
                <p className="text-xs text-muted-foreground opacity-70">
                  You can close this browser window.
                </p>
              </div>
            )}
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center gap-6 w-full">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-destructive">Verification Failed</h2>
              <p className="text-muted-foreground">
                {timedOut
                  ? "The verification link may be invalid or expired."
                  : "There was an error verifying your email."}
              </p>
            </div>

            <Button
              variant="outline"
              onClick={() => navigate({ to: "/auth" })}
              className="h-11 px-8 bg-accent text-primary w-full"
            >
              Back to Sign In
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
