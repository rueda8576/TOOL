import { IsOptional, IsString, MaxLength } from "class-validator";

export class SearchGitlabProjectsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
