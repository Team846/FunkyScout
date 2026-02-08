import { Button } from "@shadcn/ui/components/button.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { loginWithPassword, sendPasswordReset } from "@lib/supabase/auth";
import { Dialog, DialogContent } from "@shadcn/ui/components/dialog.js";

export function LoginForm() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [isPracticePopup, showPracticePopup] = useState(false);

  const handlePractie = () => {
    showPracticePopup(true);
  }

  function practiceNav(AllianceColor : string) {
    navigate({
      to: "/match_start",
      search: {
        teamNum: "test",
        matchNum: "test",
        alliance: AllianceColor,
        practice: true
      }
    })
    return
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (!email || !password) {
      toast.error("Please fill in all fields");
      setLoading(false);
      return;
    }

    if (!validateEmail(email)) {
      toast.error("Please enter a valid email address");
      setLoading(false);
      return;
    }

    try {
      const success = await loginWithPassword(email, password);
      if (success) {
        toast.success("Login successful!");
        navigate({ to: "/events" });
      } else {
        toast.error("Login Failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (!resetEmail) {
      toast.error("Please enter your email");
      setLoading(false);
      return;
    }

    if (!validateEmail(resetEmail)) {
      toast.error("Please enter a valid email address");
      setLoading(false);
      return;
    }

    try {
      const success = await sendPasswordReset(resetEmail);
      if (success) {
        toast.success("Check your email for the reset link!");
        setForgotPasswordMode(false);
      } else {
        toast.error("Failed to send reset email");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send reset email");
    } finally {
      setLoading(false);
    }
  };

  if (forgotPasswordMode) {
    return (
      <form
        onSubmit={handleForgotPassword}
        noValidate
        className="w-full grid grid-cols-1 auto-rows-fr gap-3 bg-accent rounded-md px-3 py-4"
      >
        <Input
          type="email"
          value={resetEmail}
          onChange={(e) => setResetEmail(e.target.value)}
          placeholder="Email"
          disabled={loading}
          className="border border-border rounded-md text-foreground bg-accent text-sm font-thin placeholder:text-foreground h-full"
        />

        <div className="flex gap-2 w-full h-full">
          <Button
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={() => setForgotPasswordMode(false)}
            className="flex-1 h-full bg-accent border border-border text-primary"
          >
            <svg style={{ width: '24px', height: '24px' }} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 14L5 10L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5 10H16C17.0609 10 18.0783 10.4214 18.8284 11.1716C19.5786 11.9217 20 12.9391 20 14C20 15.0609 19.5786 16.0783 18.8284 16.8284C18.0783 17.5786 17.0609 18 16 18H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
          <Button
            type="submit"
            variant="secondary"
            disabled={loading}
            className={`flex-1 h-full border border-border ${validateEmail(resetEmail)
              ? "bg-secondary text-primary"
              : "bg-accent text-primary"
              }`}
          >
            <svg style={{ width: '24px', height: '24px' }} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 14L19 10L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M19 10H8C6.93913 10 5.92172 10.4214 5.17157 11.1716C4.42143 11.9217 4 12.9391 4 14C4 15.0609 4.42143 16.0783 5.17157 16.8284C5.92172 17.5786 6.93913 18 8 18H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={handleLogin}
      noValidate
      className="w-full flex flex-col gap-3 bg-accent rounded-md px-3 py-4"
    >
      <Dialog open={isPracticePopup}>
          <DialogContent className="flex w-[80vw] gap-2.5 p-2.5 justify-center items-center h-[80vw]">
            <div className="flex-1 w-full bg-black h-[40vw]">
              <Button 
              className="w-full h-full bg-background border-2 border-[#246190]"
              onClick={() => practiceNav("blue")}
              >
                <p className="text-[15px] text-[#246190]">Blue Alliance</p>
              </Button>
            </div>
            <div className="flex-1 w-full h-[40vw]">
              <Button 
              className="w-full h-full bg-background border-2 border-[#B73E3E]"
              onClick={() => practiceNav("red")}
              >
                <p className="text-[15px] text-[#B73E3E]">Red Alliance</p>
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      <Input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        disabled={loading}
        className="h-9 w-full border border-border rounded-md text-foreground bg-accent text-sm font-thin placeholder:text-foreground"
      />
      <Input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        disabled={loading}
        className="h-9 w-full border border-border rounded-md text-foreground bg-accent text-sm font-thin placeholder:text-foreground"
      />

      {/* Forgot Password row: button + arrow icon - h-9 to match inputs */}
      <div className="w-full h-9 flex pl-1 pr-3 items-center">
        <Button
          type="button"
          variant="link"
          onClick={() => setForgotPasswordMode(true)}
          className="flex-1 h-9 justify-start p-0 text-sm text-muted-foreground"
        >
          Forgot Password?
        </Button>
        <Button
          type="submit"
          variant="default"
          disabled={loading}
          className={`size-8 rounded-full flex transition-colors ${validateEmail(email) ? "bg-primary" : "bg-ring"
            }`}
        >
          <svg
            className="size-6 text-background"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M16.175 13H4V11H16.175L10.575 5.4L12 4L20 12L12 20L10.575 18.6L16.175 13Z" fill="currentColor" />
          </svg>
        </Button>
      </div>

      <Button
        type="button"
        variant="secondary"
        disabled={loading}
        onClick={handlePractie}
        className="h-11 w-full bg-accent border border-border text-primary text-sm"
      >
        Practice Mode
      </Button>
    </form>
  );
}
