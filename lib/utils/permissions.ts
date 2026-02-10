export type UserRole = "admin" | "scouter" | "user";
export type PicklistType = "public" | "private" | "default";

export function canCreatePicklist(role: UserRole): boolean {
  return role === "admin";
}

export function canViewPicklist(
  role: UserRole,
  picklistType: PicklistType,
  picklistUid?: string,
  currentUid?: string,
): boolean {
  if (role === "admin") return true;
  if (picklistType === "public") return role === "scouter";
  if (picklistType === "default") return role === "scouter";
  if (picklistType === "private") return picklistUid === currentUid;
  return false;
}

export function canEditPicklist(
  role: UserRole,
  picklistType: PicklistType,
  picklistUid?: string,
  currentUid?: string,
): boolean {
  if (role === "admin") return true; // Admins can always edit public and default
  if (picklistType === "default") return false; // Only admins can edit default picklists
  if (picklistType === "public") {
    return role === "scouter"; // All scouters can edit public picklists
  }
  if (picklistType === "private") {
    return picklistUid === currentUid; // Only creator can edit private
  }
  return false;
}
