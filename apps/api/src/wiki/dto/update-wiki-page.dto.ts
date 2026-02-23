import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class UpdateWikiPageDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  title?: string;

  @IsString()
  contentMarkdown!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeNote?: string;
}
