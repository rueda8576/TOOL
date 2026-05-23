import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { Request } from "express";
import { createHash, createPrivateKey, createPublicKey, KeyObject } from "node:crypto";
import { JwtService } from "@nestjs/jwt";

import { generateSecureToken, hashValue } from "../common/crypto";
import { readCookieValue } from "../common/session-cookie";
import { getEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { SessionAuthService } from "../common/session-auth.service";

type OidcAuthorizeQuery = {
  client_id?: string;
  redirect_uri?: string;
  response_type?: string;
  scope?: string;
  state?: string;
  nonce?: string;
  code_challenge?: string;
  code_challenge_method?: string;
};

type OidcTokenRequest = {
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
  code_verifier?: string;
};

type OidcAccessTokenPayload = {
  sub: string;
  email: string;
  name: string;
  preferred_username: string;
  scope: string;
  token_use: "userinfo";
};

@Injectable()
export class OidcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionAuthService: SessionAuthService,
    private readonly jwtService: JwtService
  ) {}

  getDiscoveryDocument(): Record<string, unknown> {
    const issuer = this.getIssuerUrl();

    return {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      scopes_supported: ["openid", "profile", "email"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      code_challenge_methods_supported: ["S256", "plain"],
      claims_supported: ["sub", "email", "name", "preferred_username"]
    };
  }

  getJwks(): { keys: Array<Record<string, unknown>> } {
    const { publicKey, keyId } = this.getOidcKeyPair();
    const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;

    return {
      keys: [
        {
          ...jwk,
          use: "sig",
          kid: keyId,
          alg: "RS256"
        }
      ]
    };
  }

  async authorize(query: OidcAuthorizeQuery, request: Request): Promise<string> {
    const validated = this.validateAuthorizeRequest(query);
    const cookieName = getEnv().ATLASIUM_SESSION_COOKIE_NAME;
    const sessionToken = readCookieValue(request.headers.cookie, cookieName);

    if (!sessionToken) {
      return this.buildLoginRedirect(request.originalUrl || request.url);
    }

    const user = await this.sessionAuthService.authenticateToken(sessionToken, {
      invalidToken: "Invalid session",
      expiredSession: "Session expired"
    });

    const authorizationCode = generateSecureToken(32);
    await this.prisma.oidcAuthorizationCode.create({
      data: {
        codeHash: hashValue(authorizationCode),
        clientId: validated.clientId,
        userId: user.userId,
        redirectUri: validated.redirectUri,
        scope: validated.scope,
        nonce: validated.nonce,
        codeChallenge: validated.codeChallenge,
        codeChallengeMethod: validated.codeChallengeMethod,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      }
    });

    const redirectUrl = new URL(validated.redirectUri);
    redirectUrl.searchParams.set("code", authorizationCode);
    if (validated.state) {
      redirectUrl.searchParams.set("state", validated.state);
    }

    return redirectUrl.toString();
  }

  async exchangeToken(request: Request, body: OidcTokenRequest): Promise<Record<string, unknown>> {
    const clientCredentials = this.resolveClientCredentials(request, body);
    this.assertClientCredentials(clientCredentials.clientId, clientCredentials.clientSecret);

    if (body.grant_type !== "authorization_code") {
      throw new BadRequestException("Unsupported grant_type");
    }

    const code = body.code?.trim();
    const redirectUri = body.redirect_uri?.trim();
    if (!code || !redirectUri) {
      throw new BadRequestException("code and redirect_uri are required");
    }

    const authorizationCode = await this.prisma.oidcAuthorizationCode.findFirst({
      where: {
        codeHash: hashValue(code),
        clientId: clientCredentials.clientId,
        redirectUri,
        consumedAt: null,
        expiresAt: {
          gt: new Date()
        }
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            deletedAt: true,
            isActive: true
          }
        }
      }
    });

    if (!authorizationCode) {
      throw new UnauthorizedException("Invalid authorization code");
    }

    if (!authorizationCode.user.isActive || authorizationCode.user.deletedAt) {
      throw new UnauthorizedException("User is no longer active");
    }

    this.assertCodeVerifier(authorizationCode.codeChallenge, authorizationCode.codeChallengeMethod, body.code_verifier);

    await this.prisma.oidcAuthorizationCode.update({
      where: {
        id: authorizationCode.id
      },
      data: {
        consumedAt: new Date()
      }
    });

    const issuer = this.getIssuerUrl();
    const accessToken = this.signOidcToken<OidcAccessTokenPayload>(
      {
        sub: authorizationCode.user.id,
        email: authorizationCode.user.email,
        name: authorizationCode.user.name,
        preferred_username: authorizationCode.user.email,
        scope: authorizationCode.scope,
        token_use: "userinfo"
      },
      {
        issuer,
        audience: clientCredentials.clientId,
        expiresIn: "10m"
      }
    );

    const idTokenPayload: Record<string, unknown> = {
      sub: authorizationCode.user.id,
      email: authorizationCode.user.email,
      email_verified: true,
      name: authorizationCode.user.name,
      preferred_username: authorizationCode.user.email
    };
    if (authorizationCode.nonce) {
      idTokenPayload.nonce = authorizationCode.nonce;
    }

    const idToken = this.signOidcToken(idTokenPayload, {
      issuer,
      audience: clientCredentials.clientId,
      expiresIn: "10m"
    });

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 600,
      scope: authorizationCode.scope,
      id_token: idToken
    };
  }

  async getUserInfo(request: Request): Promise<Record<string, unknown>> {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const accessToken = authHeader.slice("Bearer ".length).trim();
    const payload = this.verifyOidcAccessToken(accessToken);

    const user = await this.prisma.user.findFirst({
      where: {
        id: payload.sub,
        deletedAt: null,
        isActive: true
      },
      select: {
        id: true,
        email: true,
        name: true
      }
    });

    if (!user) {
      throw new UnauthorizedException("User is no longer active");
    }

    return {
      sub: user.id,
      email: user.email,
      email_verified: true,
      name: user.name,
      preferred_username: user.email
    };
  }

  private validateAuthorizeRequest(query: OidcAuthorizeQuery): {
    clientId: string;
    redirectUri: string;
    scope: string;
    state?: string;
    nonce?: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
  } {
    const clientId = query.client_id?.trim();
    const redirectUri = query.redirect_uri?.trim();
    const responseType = query.response_type?.trim();
    const scope = query.scope?.trim();

    if (!clientId || !redirectUri || !responseType || !scope) {
      throw new BadRequestException("Missing OIDC authorize parameters");
    }
    if (responseType !== "code") {
      throw new BadRequestException("Unsupported response_type");
    }
    if (!scope.split(/\s+/).includes("openid")) {
      throw new BadRequestException("scope must include openid");
    }

    this.assertClientRedirect(clientId, redirectUri);

    const codeChallengeMethod = query.code_challenge_method?.trim();
    if (query.code_challenge && codeChallengeMethod && !["S256", "plain"].includes(codeChallengeMethod)) {
      throw new BadRequestException("Unsupported code_challenge_method");
    }

    return {
      clientId,
      redirectUri,
      scope,
      state: query.state?.trim() || undefined,
      nonce: query.nonce?.trim() || undefined,
      codeChallenge: query.code_challenge?.trim() || undefined,
      codeChallengeMethod: codeChallengeMethod || undefined
    };
  }

  private resolveClientCredentials(request: Request, body: OidcTokenRequest): { clientId: string; clientSecret: string } {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith("Basic ")) {
      const decoded = Buffer.from(authHeader.slice("Basic ".length), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator > -1) {
        return {
          clientId: decoded.slice(0, separator),
          clientSecret: decoded.slice(separator + 1)
        };
      }
    }

    return {
      clientId: body.client_id?.trim() || "",
      clientSecret: body.client_secret?.trim() || ""
    };
  }

  private assertClientCredentials(clientId: string, clientSecret: string): void {
    const env = getEnv();
    if (!env.ATLASIUM_OIDC_CLIENT_ID || !env.ATLASIUM_OIDC_CLIENT_SECRET) {
      throw new ServiceUnavailableException("Atlasium OIDC is not configured");
    }

    if (clientId !== env.ATLASIUM_OIDC_CLIENT_ID || clientSecret !== env.ATLASIUM_OIDC_CLIENT_SECRET) {
      throw new UnauthorizedException("Invalid OIDC client credentials");
    }
  }

  private assertClientRedirect(clientId: string, redirectUri: string): void {
    const env = getEnv();
    if (!env.ATLASIUM_OIDC_CLIENT_ID || !env.ATLASIUM_OIDC_CLIENT_SECRET) {
      throw new ServiceUnavailableException("Atlasium OIDC is not configured");
    }

    if (clientId !== env.ATLASIUM_OIDC_CLIENT_ID) {
      throw new BadRequestException("Unknown OIDC client_id");
    }

    const gitlabBaseUrl = (env.GITLAB_EXTERNAL_URL ?? env.GITLAB_BASE_URL)?.replace(/\/+$/, "");
    if (!gitlabBaseUrl) {
      throw new ServiceUnavailableException("GitLab external URL is not configured");
    }

    const expectedRedirectUri = `${gitlabBaseUrl}/users/auth/openid_connect/callback`;
    if (redirectUri !== expectedRedirectUri) {
      throw new BadRequestException("Invalid redirect_uri");
    }
  }

  private assertCodeVerifier(
    codeChallenge: string | null,
    codeChallengeMethod: string | null,
    codeVerifier: string | undefined
  ): void {
    if (!codeChallenge) {
      return;
    }

    const verifier = codeVerifier?.trim();
    if (!verifier) {
      throw new UnauthorizedException("Missing code_verifier");
    }

    const method = codeChallengeMethod ?? "plain";
    const computed = method === "S256"
      ? createHash("sha256").update(verifier).digest("base64url")
      : verifier;

    if (computed !== codeChallenge) {
      throw new UnauthorizedException("Invalid code_verifier");
    }
  }

  private buildLoginRedirect(returnToPath: string): string {
    const loginUrl = new URL(`${getEnv().APP_BASE_URL.replace(/\/+$/, "")}/login`);
    const returnTo = returnToPath.startsWith("http")
      ? returnToPath
      : `${this.getAppOrigin()}${returnToPath.startsWith("/") ? returnToPath : `/${returnToPath}`}`;
    loginUrl.searchParams.set("returnTo", returnTo);
    return loginUrl.toString();
  }

  private getIssuerUrl(): string {
    return `${this.getAppOrigin()}/api/auth/oidc`;
  }

  private getAppOrigin(): string {
    return getEnv().APP_BASE_URL.replace(/\/+$/, "");
  }

  private getOidcKeyPair(): { privateKey: string; publicKey: KeyObject; keyId: string } {
    const encoded = getEnv().ATLASIUM_OIDC_PRIVATE_KEY_BASE64;
    if (!encoded) {
      throw new ServiceUnavailableException("Atlasium OIDC signing key is not configured");
    }

    const privateKey = Buffer.from(encoded, "base64").toString("utf8");
    const publicKey = createPublicKey(createPrivateKey(privateKey));
    const keyId = createHash("sha256").update(publicKey.export({ type: "spki", format: "pem" })).digest("hex").slice(0, 16);

    return {
      privateKey,
      publicKey,
      keyId
    };
  }

  private signOidcToken<T extends Record<string, unknown>>(
    payload: T,
    options: { issuer: string; audience: string; expiresIn: string }
  ): string {
    const { privateKey, keyId } = this.getOidcKeyPair();
    return this.jwtService.sign(payload, {
      algorithm: "RS256",
      secret: privateKey,
      keyid: keyId,
      issuer: options.issuer,
      audience: options.audience,
      expiresIn: options.expiresIn
    });
  }

  private verifyOidcAccessToken(token: string): OidcAccessTokenPayload {
    const { publicKey } = this.getOidcKeyPair();
    return this.jwtService.verify<OidcAccessTokenPayload>(token, {
      algorithms: ["RS256"],
      secret: publicKey.export({ type: "spki", format: "pem" }),
      issuer: this.getIssuerUrl(),
      audience: getEnv().ATLASIUM_OIDC_CLIENT_ID
    });
  }
}
