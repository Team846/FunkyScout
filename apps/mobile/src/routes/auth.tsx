import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { LoginForm } from "../pages/auth/LoginForm";
import { SignupForm } from "../pages/auth/SignupForm";
import { Button } from "@shadcn/ui/components/button.tsx";

enum AuthMode {
  SignIn = "signin",
  SignUp = "signup",
}

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const [authMode, setAuthMode] = useState<AuthMode>(AuthMode.SignIn);

  return (
    <div className="min-h-dvh w-full bg-background flex items-center justify-center">
      <div className="w-72 px-5 py-6 flex flex-col gap-4">
        {/* Tab buttons for switching auth mode */}
        <div className="w-full h-11 flex gap-0">
          <Button
            variant="outline"
            className={`flex-1 h-full ${authMode === AuthMode.SignIn
              ? "bg-accent text-primary"
              : "bg-primary-foreground text-border"
              }`}
            onClick={() => setAuthMode(AuthMode.SignIn)}
          >
            Sign in
          </Button>
          <Button
            variant="outline"
            className={`flex-1 h-full ${authMode === AuthMode.SignUp
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
          {authMode === AuthMode.SignIn ? <LoginForm /> : <SignupForm />}
        </div>
      </div>
    </div>
  );
}
