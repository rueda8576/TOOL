import { IsOptional, IsString, MaxLength } from "class-validator";

export class CreateDocumentVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  branchName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  latexEntryFile?: string;

  @IsOptional()
  @IsString()
  latexPaths?: string;
}
