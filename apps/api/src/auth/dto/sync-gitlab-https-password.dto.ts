import { IsString, MinLength } from "class-validator";

export class SyncGitlabHttpsPasswordDto {
  @IsString()
  @MinLength(8)
  currentPassword!: string;
}
