import { IsDateString, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateGitlabSshKeyDto {
  @IsString()
  @MaxLength(255)
  title!: string;

  @IsString()
  @MaxLength(20000)
  key!: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
