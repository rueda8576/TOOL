import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { getEnv } from "../config/env";
import { GitlabModule } from "../gitlab/gitlab.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { OidcService } from "./oidc.service";

@Module({
  imports: [
    GitlabModule,
    JwtModule.register({
      global: true,
      secret: getEnv().JWT_SECRET,
      signOptions: {
        expiresIn: "7d"
      }
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, OidcService],
  exports: [AuthService, JwtModule]
})
export class AuthModule {}
