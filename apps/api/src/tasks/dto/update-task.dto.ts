import { IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @IsOptional()
  @IsIn(["todo", "in_progress", "blocked", "done"])
  status?: "todo" | "in_progress" | "blocked" | "done";

  @IsOptional()
  @IsIn(["low", "medium", "high", "critical"])
  priority?: "low" | "medium" | "high" | "critical";

  @IsOptional()
  @IsString()
  @MinLength(1)
  assigneeId?: string | null;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
