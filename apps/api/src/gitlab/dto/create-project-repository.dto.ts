import { IsOptional, IsString, MaxLength } from "class-validator";

export class CreateProjectRepositoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  path?: string;
}
