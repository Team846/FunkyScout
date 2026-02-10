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
  if (role === "admin") return true;
  if (picklistType === "default") return role === "scouter";
  if (picklistType === "public") {
    return role === "scouter" && picklistUid === currentUid;
  }
  if (picklistType === "private") {
    return picklistUid === currentUid;
  }
  return false;
}
