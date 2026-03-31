import { IsOptional, IsString, MaxLength } from "class-validator";

export class ListRepositoryTreeQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  path?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  ref?: string;
}
