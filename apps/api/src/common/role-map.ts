import { GlobalRole } from "@prisma/client";

const roleOrder: Record<"admin" | "editor" | "reader", number> = {
  reader: 1,
  editor: 2,
  admin: 3
};

export const prismaRoleToApiRole = (role: GlobalRole): "admin" | "editor" | "reader" => {
  switch (role) {
    case GlobalRole.ADMIN:
      return "admin";
    case GlobalRole.EDITOR:
      return "editor";
    case GlobalRole.READER:
    default:
      return "reader";
  }
};

export const apiRoleToPrismaRole = (role: "admin" | "editor" | "reader"): GlobalRole => {
  switch (role) {
    case "admin":
      return GlobalRole.ADMIN;
    case "editor":
      return GlobalRole.EDITOR;
    case "reader":
    default:
      return GlobalRole.READER;
  }
};

export const pickHigherRole = (
  currentRole: "admin" | "editor" | "reader",
  invitedRole: "admin" | "editor" | "reader"
): "admin" | "editor" | "reader" => {
  return roleOrder[currentRole] >= roleOrder[invitedRole] ? currentRole : invitedRole;
};
