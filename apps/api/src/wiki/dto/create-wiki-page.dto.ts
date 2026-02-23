import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class CreateWikiPageDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  title!: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(120)
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  templateType?: string;

  @IsString()
  contentMarkdown!: string;
}
