import { Body, Controller, Post, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { AuthenticatedUser } from "../common/authenticated-user";
import { AcceptInviteDto } from "./dto/accept-invite.dto";
import { InviteDto } from "./dto/invite.dto";
import { LoginDto } from "./dto/login.dto";
import { PasswordResetDto } from "./dto/password-reset.dto";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  login(@Body() dto: LoginDto): Promise<{
    token: string;
    expiresAt: Date;
    user: { id: string; email: string; name: string; globalRole: "admin" | "editor" | "reader" };
  }> {
    return this.authService.login(dto);
  }

  @Post("invite")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  invite(
    @Body() dto: InviteDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ inviteId: string; token: string; expiresAt: Date }> {
    return this.authService.invite(dto, user.userId);
  }

  @Post("accept-invite")
  acceptInvite(
    @Body() dto: AcceptInviteDto
  ): Promise<{ token: string; userId: string; projectId?: string | null; projectIds: string[] }> {
    return this.authService.acceptInvite(dto);
  }

  @Post("password/reset")
  passwordReset(@Body() dto: PasswordResetDto): Promise<{ accepted: true }> {
    return this.authService.requestPasswordReset(dto);
  }
}
