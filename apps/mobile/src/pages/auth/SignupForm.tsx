import { Button } from "@shadcn/ui/components/button.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { useState } from "react";
import { toast } from "sonner";
import { signupWithPassword } from "@lib/supabase/auth";

export function SignupForm() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (!email || !name || !password) {
      toast.error("Please fill in all fields");
      setLoading(false);
      return;
    }

    if (!validateEmail(email)) {
      toast.error("Please enter a valid email address");
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      setLoading(false);
      return;
    }

    try {
      const success = await signupWithPassword(email, password, name);
      if (success) {
        toast.success("Check your email to verify your account!");
        sessionStorage.setItem("pendingVerificationEmail", email);

        // <-- Clear the form after successful submission
        setEmail("");
        setName("");
        setPassword("");
      } else {
        toast.error("Failed to create account");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSignup}
      noValidate
      className="w-full flex flex-col gap-3 bg-accent rounded-md px-3 py-4"
    >
      <Input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        disabled={loading}
        className="h-9 w-full border border-border rounded-md text-foreground bg-accent text-sm font-thin placeholder:text-foreground"
      />

      <Input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        disabled={loading}
        className="h-9 w-full border border-border rounded-md text-foreground bg-accent text-sm font-thin placeholder:text-foreground"
      />

      <Input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password (6+ chars)"
        disabled={loading}
        className="h-9 w-full border border-border rounded-md text-foreground bg-accent text-sm font-thin placeholder:text-foreground"
      />

      <Button
        type="submit"
        variant="secondary"
        disabled={loading}
        className={`h-11 w-full border border-border text-primary text-sm transition-colors ${validateEmail(email) ? "bg-secondary" : "bg-accent"
          }`}
      >
        {loading ? "Creating..." : "Create Account"}
      </Button>
    </form>
  );
}
