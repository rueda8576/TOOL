import { IsInt, IsString, MaxLength, Min, MinLength } from "class-validator";

export class SaveWikiDraftDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  title!: string;

  @IsString()
  contentMarkdown!: string;

  @IsInt()
  @Min(1)
  baseDraftVersion!: number;
}

