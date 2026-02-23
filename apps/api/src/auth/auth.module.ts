import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { getEnv } from "../config/env";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: getEnv().JWT_SECRET,
      signOptions: {
        expiresIn: "7d"
      }
    })
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, JwtModule]
})
export class AuthModule {}
