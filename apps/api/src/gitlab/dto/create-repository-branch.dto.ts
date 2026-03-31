import { IsString, MaxLength } from "class-validator";

export class CreateRepositoryBranchDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsString()
  @MaxLength(255)
  sourceRef!: string;
}
