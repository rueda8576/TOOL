import { IsOptional, IsString, MaxLength, Matches } from "class-validator";

export class CreateDocumentBranchDto {
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-zA-Z0-9._-]+$/)
  name!: string;

  @IsOptional()
  @IsString()
  baseVersionId?: string;
}
