import { Type } from "class-transformer";
import { IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from "class-validator";

export type InviteAccessModeInput = "all" | "selected";

export class InviteProjectAccessDto {
  @IsString()
  projectId!: string;

  @IsIn(["editor", "reader"])
  role!: "editor" | "reader";
}

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
  @IsIn(["editor", "reader"])
  defaultProjectRole?: "editor" | "reader";

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  projectIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InviteProjectAccessDto)
  projectAccess?: InviteProjectAccessDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}
