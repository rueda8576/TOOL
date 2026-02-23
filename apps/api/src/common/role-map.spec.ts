import { GlobalRole } from "@prisma/client";

import { apiRoleToPrismaRole, pickHigherRole, prismaRoleToApiRole } from "./role-map";

describe("role-map", () => {
  it("maps prisma roles to API roles", () => {
    expect(prismaRoleToApiRole(GlobalRole.ADMIN)).toBe("admin");
    expect(prismaRoleToApiRole(GlobalRole.EDITOR)).toBe("editor");
    expect(prismaRoleToApiRole(GlobalRole.READER)).toBe("reader");
  });

  it("maps API roles to prisma roles", () => {
    expect(apiRoleToPrismaRole("admin")).toBe(GlobalRole.ADMIN);
    expect(apiRoleToPrismaRole("editor")).toBe(GlobalRole.EDITOR);
    expect(apiRoleToPrismaRole("reader")).toBe(GlobalRole.READER);
  });

  it("returns higher role precedence", () => {
    expect(pickHigherRole("reader", "editor")).toBe("editor");
    expect(pickHigherRole("admin", "reader")).toBe("admin");
  });
});
