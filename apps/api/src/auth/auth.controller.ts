import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { Request, Response } from "express";

import { CurrentSessionToken } from "../common/current-session-token.decorator";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { AuthenticatedUser } from "../common/authenticated-user";
import { buildSessionCookie } from "../common/session-cookie";
import { AcceptInviteDto } from "./dto/accept-invite.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { CreateGitlabSshKeyDto } from "./dto/create-gitlab-ssh-key.dto";
import { InviteDto } from "./dto/invite.dto";
import { LoginDto } from "./dto/login.dto";
import { OidcService } from "./oidc.service";
import { PasswordResetDto } from "./dto/password-reset.dto";
import { SyncGitlabHttpsPasswordDto } from "./dto/sync-gitlab-https-password.dto";
import { UpdateUsernameDto } from "./dto/update-username.dto";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly oidcService: OidcService
  ) {}

  @Post("login")
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response
  ): Promise<{
    token: string;
    expiresAt: Date;
    user: { id: string; email: string; username: string; name: string; globalRole: "admin" | "editor" | "reader" };
  }> {
    const result = await this.authService.login(dto);
    response.setHeader("Set-Cookie", buildSessionCookie(result.token, result.expiresAt));
    return result;
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

  @Get("me")
  @UseGuards(JwtAuthGuard)
  getCurrentUserProfile(@CurrentUser() user: AuthenticatedUser): Promise<{
    id: string;
    name: string;
    email: string;
    username: string;
    globalRole: "admin" | "editor" | "reader";
    timezone: string;
  }> {
    return this.authService.getCurrentUserProfile(user);
  }

  @Patch("me/username")
  @UseGuards(JwtAuthGuard)
  updateUsername(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUsernameDto
  ): Promise<{
    id: string;
    name: string;
    email: string;
    username: string;
    globalRole: "admin" | "editor" | "reader";
    timezone: string;
  }> {
    return this.authService.updateUsername(user, dto);
  }

  @Post("password/change")
  @UseGuards(JwtAuthGuard)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSessionToken() currentSessionToken: string | undefined,
    @Body() dto: ChangePasswordDto
  ): Promise<{ changed: true }> {
    return this.authService.changePassword(user, currentSessionToken, dto);
  }

  @Get("oidc/.well-known/openid-configuration")
  getOidcDiscovery(): Record<string, unknown> {
    return this.oidcService.getDiscoveryDocument();
  }

  @Get("oidc/jwks")
  getOidcJwks(): { keys: Array<Record<string, unknown>> } {
    return this.oidcService.getJwks();
  }

  @Get("oidc/authorize")
  async authorizeOidcRequest(
    @Query() query: Record<string, string | undefined>,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    const redirectUrl = await this.oidcService.authorize(query, request);
    response.redirect(redirectUrl);
  }

  @Post("oidc/token")
  exchangeOidcToken(
    @Req() request: Request,
    @Body() body: Record<string, string | undefined>
  ): Promise<Record<string, unknown>> {
    return this.oidcService.exchangeToken(request, body);
  }

  @Get("oidc/userinfo")
  getOidcUserInfo(@Req() request: Request): Promise<Record<string, unknown>> {
    return this.oidcService.getUserInfo(request);
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

  @Post("gitlab/https-password")
  @UseGuards(JwtAuthGuard)
  syncGitlabHttpsPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SyncGitlabHttpsPasswordDto
  ): Promise<{ enabled: true; username: string }> {
    return this.authService.syncGitlabHttpsPassword(user, dto);
  }

  @Get("gitlab/ssh-keys")
  @UseGuards(JwtAuthGuard)
  listGitlabSshKeys(@CurrentUser() user: AuthenticatedUser): Promise<Array<{
    id: number;
    title: string;
    key: string;
    createdAt: string;
    expiresAt: string | null;
    usageType: string | null;
  }>> {
    return this.authService.listGitlabSshKeys(user);
  }

  @Post("gitlab/ssh-keys")
  @UseGuards(JwtAuthGuard)
  createGitlabSshKey(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGitlabSshKeyDto
  ): Promise<{
    id: number;
    title: string;
    key: string;
    createdAt: string;
    expiresAt: string | null;
    usageType: string | null;
  }> {
    return this.authService.createGitlabSshKey(user, dto);
  }

  @Delete("gitlab/ssh-keys/:keyId")
  @UseGuards(JwtAuthGuard)
  deleteGitlabSshKey(
    @CurrentUser() user: AuthenticatedUser,
    @Param("keyId") keyId: string
  ): Promise<{ deleted: true }> {
    return this.authService.deleteGitlabSshKey(user, keyId);
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
