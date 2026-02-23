import { IsBoolean, IsInt, IsOptional, Max, Min } from "class-validator";

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  taskAssigned?: boolean;

  @IsOptional()
  @IsBoolean()
  taskDue?: boolean;

  @IsOptional()
  @IsBoolean()
  mentionInWiki?: boolean;

  @IsOptional()
  @IsBoolean()
  mentionInTaskComments?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 14)
  taskDueLeadHours?: number;
}
