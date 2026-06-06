import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateNested } from "class-validator";

export class AssignWikiDocsPageDto {
  @IsString()
  @MaxLength(100)
  pageId!: string;

  @IsString()
  @MaxLength(100)
  repositoryId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  folderPath?: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(120)
  slug!: string;

  @IsOptional()
  @IsString()
  @IsIn(["research", "implementation"])
  docsKind?: "research" | "implementation";
}

export class AssignWikiDocsPagesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AssignWikiDocsPageDto)
  assignments!: AssignWikiDocsPageDto[];
}
