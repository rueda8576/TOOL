import { Body, Controller, Delete, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { AuthenticatedUser } from "../common/authenticated-user";
import {
  AdminUserDeleteResult,
  AdminUserHardDeleteCheck,
  AdminUsersService,
  AdminUserSummary
} from "./admin-users.service";
import { DeleteAdminUserQueryDto } from "./dto/delete-admin-user-query.dto";
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

  @Get(":userId/hard-delete-check")
  getHardDeleteCheck(
    @Param("userId") userId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<AdminUserHardDeleteCheck> {
    return this.adminUsersService.getHardDeleteCheck(userId, user);
  }

  @Delete(":userId")
  deleteUser(
    @Param("userId") userId: string,
    @Query() query: DeleteAdminUserQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<AdminUserDeleteResult> {
    return this.adminUsersService.deleteUser(userId, user, query.mode ?? "soft");
  }
}
