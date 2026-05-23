import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class AcceptInviteDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  username?: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
