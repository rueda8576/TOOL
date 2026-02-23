import { SetMetadata } from "@nestjs/common";

export const ROLES_KEY = "roles";
export const Roles = (...roles: Array<"admin" | "editor" | "reader">): ReturnType<typeof SetMetadata> =>
  SetMetadata(ROLES_KEY, roles);
