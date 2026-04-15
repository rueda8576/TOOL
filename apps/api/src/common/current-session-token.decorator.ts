import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export const CurrentSessionToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<{ authToken?: string }>();
    return request.authToken;
  }
);
