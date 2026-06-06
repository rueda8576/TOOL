import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, MaxLength, MinLength, ValidateNested } from "class-validator";

export class WikiDocsStructureMigrationOperationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  bindingId!: string;

  @IsString()
  @IsIn(["research", "implementation"])
  targetKind!: "research" | "implementation";
}

export class WikiDocsStructureMigrationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => WikiDocsStructureMigrationOperationDto)
  operations!: WikiDocsStructureMigrationOperationDto[];
}
