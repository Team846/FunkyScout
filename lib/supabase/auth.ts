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
    const { error } = await supabase.functions.invoke("createAccount", {
      body: { email, password, username },
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
    // On desktop (Tauri), window.location.origin is "tauri://localhost" which browsers
    // can't handle when they open the email link. Use the web app URL instead so the
    // user lands on the vercel /reset page which works in any browser.
    const resetUrl = redirectTo || (
      isTauri()
        ? "https://funkyscout.vercel.app/reset?from=desktop"
        : `${window.location.origin}/reset`
    );
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
