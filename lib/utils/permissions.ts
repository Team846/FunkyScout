export type UserRole = "admin" | "scout" | "user";
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
  if (picklistType === "public") return role === "scout";
  if (picklistType === "default") return role === "scout";
  if (picklistType === "private") return picklistUid === currentUid;
  return false;
}

export function canEditPicklist(
  role: UserRole,
  picklistType: PicklistType,
  picklistUid?: string,
  currentUid?: string,
): boolean {
  if (role === "admin") return true;
  if (picklistType === "public") return role === "scout";
  if (picklistType === "default") return false; // scouts view-only
  if (picklistType === "private") return picklistUid === currentUid;
  return false;
}
