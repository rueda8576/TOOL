import { IsString, MaxLength, MinLength } from "class-validator";

export class UpdateUsernameDto {
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  username!: string;
}
