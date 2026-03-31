import { IsOptional, IsString, MaxLength } from "class-validator";

export class CreateRepositoryMergeRequestDto {
  @IsString()
  @MaxLength(255)
  sourceBranch!: string;

  @IsString()
  @MaxLength(255)
  targetBranch!: string;

  @IsString()
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;
}
