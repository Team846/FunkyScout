import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { LoginForm } from "../-components/auth/LoginForm";
import { SignupForm } from "../-components/auth/SignupForm";
import { Button } from "@shadcn/ui/components/button.tsx";
import supabase from "@lib/supabase/supabase";

enum AuthMode {
  SignIn = "signin",
  SignUp = "signup",
}

export const Route = createFileRoute("/auth/")({
  beforeLoad: async () => {
    // If already logged in, redirect to dashboard
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  const [authMode, setAuthMode] = useState<AuthMode>(AuthMode.SignIn);

  return (
    <div className="flex flex-col items-center justify-center h-screen w-screen bg-background">
      <div className="w-full max-w-md p-8">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-primary">FunkyScout Desktop</h1>
          <p className="text-muted-foreground mt-2">Admin Dashboard</p>
        </div>

        {/* Tab buttons for switching auth mode */}
        <div className="w-full h-11 flex gap-0 mb-4">
          <Button
            variant="outline"
            className={`flex-1 h-full ${
              authMode === AuthMode.SignIn
                ? "bg-accent text-primary"
                : "bg-primary-foreground text-border"
            }`}
            onClick={() => setAuthMode(AuthMode.SignIn)}
          >
            Sign in
          </Button>
          <Button
            variant="outline"
            className={`flex-1 h-full ${
              authMode === AuthMode.SignUp
                ? "bg-accent text-primary"
                : "bg-primary-foreground text-border"
            }`}
            onClick={() => setAuthMode(AuthMode.SignUp)}
          >
            Sign up
          </Button>
        </div>

        {/* Content based on auth mode */}
        <div className="w-full flex">
          {authMode === AuthMode.SignIn ? (
            <LoginForm />
          ) : (
            <SignupForm onSignupSuccess={() => setAuthMode(AuthMode.SignIn)} />
          )}
        </div>
      </div>
    </div>
  );
}
