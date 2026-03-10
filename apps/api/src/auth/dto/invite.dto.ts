import { IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export type InviteAccessModeInput = "all" | "selected";

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
  @IsIn(["all", "selected"])
  accessMode?: InviteAccessModeInput;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  projectIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}
