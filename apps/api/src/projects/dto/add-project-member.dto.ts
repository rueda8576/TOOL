import { IsEmail, IsOptional, IsString, ValidateIf } from "class-validator";

export class AddProjectMemberDto {
  @ValidateIf((o: AddProjectMemberDto) => !o.email)
  @IsString()
  @IsOptional()
  userId?: string;

  @ValidateIf((o: AddProjectMemberDto) => !o.userId)
  @IsEmail()
  @IsOptional()
  email?: string;
}
