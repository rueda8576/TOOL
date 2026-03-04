import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class PublishWikiPageDto {
  @IsInt()
  @Min(1)
  baseDraftVersion!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeNote?: string;
}

