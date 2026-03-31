import { IsOptional, IsString, MaxLength } from "class-validator";

export class GetRepositoryFileQueryDto {
  @IsString()
  @MaxLength(1000)
  filePath!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  ref?: string;
}
