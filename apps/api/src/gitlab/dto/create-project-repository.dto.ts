import { IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateProjectRepositoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  path?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
