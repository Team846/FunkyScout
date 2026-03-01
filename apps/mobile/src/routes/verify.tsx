import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import supabase from "@lib/supabase/supabase";
import { Button } from "@shadcn/ui/components/button.tsx";

export const Route = createFileRoute("/verify")({
  component: VerifyPage,
});

function VerifyPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    let handled = false;

    const resolve = (confirmed: boolean) => {
      if (handled) return;
      handled = true;
      clearTimeout(timeout);
      if (confirmed) {
        setStatus("success");
        toast.success("Email verified!");
      } else {
        setStatus("error");
      }
    };

    const timeout = setTimeout(() => resolve(false), 10000);

    // 1. Check immediately — Supabase may have already exchanged the confirmation
    //    token from the URL before this effect ran, firing INITIAL_SESSION instead
    //    of SIGNED_IN. The listener below would miss it, causing a 10s timeout.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email_confirmed_at) resolve(true);
    });

    // 2. Listen for auth events in case the token exchange is still in flight.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "INITIAL_SESSION") {
        if (session?.user?.email_confirmed_at) resolve(true);
        else if (event !== "INITIAL_SESSION") resolve(false);
        // INITIAL_SESSION without confirmation = pre-existing session, ignore
      }
    });

    return () => {
      clearTimeout(timeout);
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <div className="flex flex-col items-center gap-4">
        {status === "loading" && (
          <p className="text-muted-foreground">Verifying your email...</p>
        )}
        {status === "success" && (
          <>
            <svg className="text-primary" width="40" height="40" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M22 7.53491V16.9999C22 17.7651 21.7077 18.5014 21.1827 19.0582C20.6578 19.6149 19.9399 19.95 19.176 19.9949L19 19.9999H5C4.23479 20 3.49849 19.7076 2.94174 19.1826C2.38499 18.6577 2.04989 17.9398 2.005 17.1759L2 16.9999V7.53491L11.445 13.8319L11.561 13.8979C11.6977 13.9647 11.8478 13.9994 12 13.9994C12.1522 13.9994 12.3023 13.9647 12.439 13.8979L12.555 13.8319L22 7.53491Z" />
              <path d="M18.9999 4C20.0799 4 21.0269 4.57 21.5549 5.427L11.9999 11.797L2.44495 5.427C2.69568 5.01977 3.04016 4.6784 3.44965 4.43138C3.85915 4.18436 4.32178 4.03886 4.79895 4.007L4.99995 4H18.9999Z" />
            </svg>

            <p className="text-muted-foreground text-lg font-medium text-center">
              Email verified! You can now sign in.
            </p>
            <Button
              variant="outline"
              onClick={() => navigate({ to: "/auth" })}
              className="h-11 px-8 bg-accent text-muted-foreground"
            >
              Sign in
            </Button>
          </>
        )}
        {status === "error" && (
          <>
            <p className="text-destructive text-center mb-2">Verification failed</p>
            <Button
              variant="outline"
              onClick={() => navigate({ to: "/auth" })}
              className="h-11 w-full bg-accent text-primary px-8"
            >
              Try Again
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
