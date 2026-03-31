import { Body, Controller, Delete, Get, Post, Query, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";

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

  @Get("gitlab/connection")
  @UseGuards(JwtAuthGuard)
  getGitlabConnection(@CurrentUser() user: AuthenticatedUser): Promise<{
    connected: boolean;
    reconnectRequired: boolean;
    username?: string;
    name?: string;
    email?: string | null;
    avatarUrl?: string | null;
    webUrl?: string | null;
  }> {
    return this.authService.getGitlabConnectionStatus(user);
  }

  @Post("gitlab/connect")
  @UseGuards(JwtAuthGuard)
  beginGitlabConnection(@CurrentUser() user: AuthenticatedUser): Promise<{ authorizationUrl: string }> {
    return this.authService.beginGitlabConnect(user);
  }

  @Delete("gitlab/connection")
  @UseGuards(JwtAuthGuard)
  disconnectGitlabConnection(@CurrentUser() user: AuthenticatedUser): Promise<{ disconnected: true }> {
    return this.authService.disconnectGitlabConnection(user);
  }

  @Get("gitlab/callback")
  async completeGitlabConnection(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Res() response: Response
  ): Promise<void> {
    const redirectUrl = await this.authService.completeGitlabConnectCallback(code, state);
    response.redirect(redirectUrl);
  }
}
