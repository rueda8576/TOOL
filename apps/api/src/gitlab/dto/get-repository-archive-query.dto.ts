import { IsOptional, IsString, MaxLength } from "class-validator";

export class GetRepositoryArchiveQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  ref?: string;
}
