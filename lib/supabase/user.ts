import supabase from "./supabase";
import { handleError } from "../../utils/errorHandler";

export type UserRole = "user" | "admin" | "scouter";
export type LocalUserData = {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
};

export function storeLocalUserData(data: LocalUserData) {
  localStorage.setItem("userData", JSON.stringify(data));
}

export function getLocalUserData(): LocalUserData {
  const userData = localStorage.getItem("userData");
  if (userData) {
    const data = JSON.parse(userData);
    return {
      uid: data.uid,
      email: data.email,
      name: data.name,
      role: data.role || "user",
    };
  } else {
    return { uid: "", email: "", name: "", role: "user" };
  }
}

export function clearLocalUserData() {
  localStorage.removeItem("userData");
  localStorage.removeItem("current_event");
}

export async function fetchAllUserDetails() {
  try {
    const { data: user_profiles, error } = await supabase
      .from("user_profiles")
      .select("*");

    if (error) throw new Error(error.message);
    return user_profiles;
  } catch (err) {
    handleError(err);
    return false;
  }
}

export async function getAuthStatus(): Promise<boolean> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return !!user;
  } catch {
    return false;
  }
}

let fetchProfilePromise: Promise<LocalUserData | false> | null = null;

export async function fetchUserProfile(): Promise<LocalUserData | false> {
  if (fetchProfilePromise) {
    return fetchProfilePromise;
  }

  fetchProfilePromise = (async () => {
    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user?.id) {
        clearLocalUserData();
        throw new Error("Not logged in");
      }

      const uid = user.id;
      const email = user.email || "";

      const { data: profile, error } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("uid", uid)
        .single();

      if (error) throw new Error(error.message);
      if (!profile) throw new Error("No user found");

      const localData: LocalUserData = {
        uid: uid,
        email: email,
        name: profile.name || "",
        role: (profile.role as UserRole) || "user",
      };

      storeLocalUserData(localData);
      return localData;
    } catch (err) {
      clearLocalUserData();
      handleError(err);
      return false;
    } finally {
      fetchProfilePromise = null;
    }
  })();

  return fetchProfilePromise;
}

export async function useInviteCode(code: string): Promise<boolean> {
  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user?.id) {
      throw new Error("Must be logged in to apply invite code");
    }

    const { data, error } = await supabase.functions.invoke("useInviteCode", {
      body: { userID: user.id, inviteCode: code },
    });
    if (error) throw new Error(error.message);

    // Check if user needs to re-authenticate (role was changed)
    if (data?.requiresReauth) {
      // Sign out to force fresh JWT with new role
      await supabase.auth.signOut();
      clearLocalUserData();
      // Don't call fetchUserProfile - user needs to sign back in
      return true;
    }

    await fetchUserProfile();
    return true;
  } catch (err) {
    handleError(err);
    return false;
  }
}

export async function changeName(newName: string): Promise<boolean> {
  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user?.id) {
      throw new Error("Must be logged in to change name");
    }

    const { error } = await supabase.functions.invoke("changeName", {
      body: { userID: user.id, name: newName },
    });
    if (error) throw new Error(error.message);

    await fetchUserProfile();
    return true;
  } catch (err) {
    handleError(err);
    return false;
  }
}
