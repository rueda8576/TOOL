import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from "class-validator";

export class ImportWikiPageEntryDto {
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

  @IsOptional()
  @IsString()
  @MaxLength(300)
  folderPath?: string;

  @IsString()
  contentMarkdown!: string;

  @IsString()
  @MaxLength(500)
  sourcePath!: string;
}

export class ImportWikiPagesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ImportWikiPageEntryDto)
  entries!: ImportWikiPageEntryDto[];
}
