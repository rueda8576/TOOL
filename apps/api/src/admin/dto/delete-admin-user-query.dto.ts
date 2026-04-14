import { IsIn, IsOptional } from "class-validator";

export class DeleteAdminUserQueryDto {
  @IsOptional()
  @IsIn(["soft", "hard"])
  mode?: "soft" | "hard";
}
