import { IsEmail, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class InviteDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsIn(["admin", "editor", "reader"])
  globalRole?: "admin" | "editor" | "reader";

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}
