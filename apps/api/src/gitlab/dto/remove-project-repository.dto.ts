import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class RemoveProjectRepositoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  confirmation!: string;
}
