import { Type } from "class-transformer";
import { ArrayUnique, IsArray, IsIn, IsOptional, IsString } from "class-validator";

export class UpdateAdminUserDto {
  @IsIn(["admin", "editor", "reader"])
  globalRole!: "admin" | "editor" | "reader";

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => String)
  @IsString({ each: true })
  projectIds?: string[];
}
