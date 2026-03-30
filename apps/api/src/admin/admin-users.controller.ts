import { Body, Controller, Delete, Get, Param, Patch, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { AuthenticatedUser } from "../common/authenticated-user";
import { AdminUsersService, AdminUserSummary } from "./admin-users.service";
import { UpdateAdminUserDto } from "./dto/update-admin-user.dto";

@Controller("admin/users")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  listUsers(@CurrentUser() user: AuthenticatedUser): Promise<AdminUserSummary[]> {
    return this.adminUsersService.listUsers(user);
  }

  @Patch(":userId")
  updateUser(
    @Param("userId") userId: string,
    @Body() dto: UpdateAdminUserDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<AdminUserSummary> {
    return this.adminUsersService.updateUser(userId, dto, user);
  }

  @Delete(":userId")
  deleteUser(
    @Param("userId") userId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ id: string; deletedAt: string }> {
    return this.adminUsersService.deleteUser(userId, user);
  }
}
