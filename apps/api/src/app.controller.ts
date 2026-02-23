import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  @Get()
  root(): { name: string; version: string } {
    return {
      name: "doctoral-platform-api",
      version: "0.1.0"
    };
  }
}
