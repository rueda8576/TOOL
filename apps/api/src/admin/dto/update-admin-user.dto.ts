import { Type } from "class-transformer";
import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from "class-validator";

export class UpdateAdminUserProjectAccessDto {
  @IsString()
  projectId!: string;

  @IsIn(["editor", "reader"])
  role!: "editor" | "reader";
}

export class UpdateAdminUserDto {
  @IsIn(["admin", "editor", "reader"])
  globalRole!: "admin" | "editor" | "reader";

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateAdminUserProjectAccessDto)
  projectAccess?: UpdateAdminUserProjectAccessDto[];
}
