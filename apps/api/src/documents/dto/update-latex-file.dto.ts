import { IsString, MaxLength } from "class-validator";

export class UpdateLatexFileDto {
  @IsString()
  @MaxLength(400)
  path!: string;

  @IsString()
  content!: string;
}
