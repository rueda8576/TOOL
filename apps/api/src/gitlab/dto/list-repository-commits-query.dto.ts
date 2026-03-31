import { IsOptional, IsString, MaxLength } from "class-validator";

export class ListRepositoryCommitsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  ref?: string;
}
