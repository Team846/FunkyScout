/// <reference types="./vite-env.d.ts" />
import supabase from "./supabase.ts";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { fetchUserProfile, clearLocalUserData } from "./user.ts";
import { handleError } from "../../utils/errorHandler.ts";
import { isTauri } from "../utils/platform";


export async function getSession(): Promise<Session | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  } catch (err) {
    handleError(err);
    return null;
  }
}

export async function loginWithPassword(email: string, password: string): Promise<boolean> {
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await fetchUserProfile();
    return true;
  } catch (err) {
    handleError(err);
    return false;
  }
}

export async function signupWithPassword(email: string, password: string, username: string): Promise<boolean> {
  try {
    // Pass the redirect URL explicitly so the verification email link works for external testers.
    // Priority: VITE_REDIRECT_URL (set in .env for the deployed/tunnel URL) > window.location.origin (dev LAN).
    // Tauri is never the signup surface, so no isTauri() branch needed here.
    const appBase = import.meta.env.VITE_REDIRECT_URL || window.location.origin;
    const redirectTo = `${appBase}/verify`;
    const { error } = await supabase.functions.invoke("createAccount", {
      body: { email, password, username, redirectTo },
    });
    if (error) throw error;
    return true;
  } catch (err) {
    handleError(err);
    return false;
  }
}

export async function sendPasswordReset(email: string, redirectTo?: string): Promise<boolean> {
  try {
    // Resolve the reset redirect URL. Priority:
    //   1. Explicit override passed by caller
    //   2. VITE_REDIRECT_URL env var (set to your deployed/tunnel URL in .env)
    //   3. window.location.origin (works for same-machine / LAN dev access)
    // Tauri uses "tauri://localhost" as origin which browsers can't open, so
    // VITE_REDIRECT_URL must be set when sending resets from the desktop app.
    const appBase = import.meta.env.VITE_REDIRECT_URL || (isTauri() ? null : window.location.origin);
    const resetUrl = redirectTo || (appBase ? `${appBase}/reset` : null);
    if (!resetUrl) {
      throw new Error("No redirect URL configured. Set VITE_REDIRECT_URL in your .env file.");
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: resetUrl,
    });
    if (error) throw error;
    return true;
  } catch (err) {
    handleError(err);
    return false;
  }
}

export async function updatePassword(newPassword: string): Promise<boolean> {
  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    return true;
  } catch (err) {
    handleError(err);
    return false;
  }
}

export async function logout(): Promise<void> {
  try {
    clearLocalUserData();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (err) {
    handleError(err);
  }
}

export function listenToAuthChanges() {
  return supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, session: Session | null) => {
    if (event === "SIGNED_IN" && session) {
      await fetchUserProfile();
    } else if (event === "SIGNED_OUT") {
      clearLocalUserData();
    } else if (event === "TOKEN_REFRESHED" && session) {
      // Token refreshed - no action needed
    }
  });
}
