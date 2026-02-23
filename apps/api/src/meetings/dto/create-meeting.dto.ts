import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

const DATE_OR_ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T.+)?$/;

export class CreateMeetingDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  title!: string;

  @IsString()
  @Matches(DATE_OR_ISO_DATETIME_PATTERN)
  scheduledAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;

  @IsOptional()
  @IsString()
  doneMarkdown?: string;

  @IsOptional()
  @IsString()
  toDiscussMarkdown?: string;

  @IsOptional()
  @IsString()
  toDoMarkdown?: string;
}
