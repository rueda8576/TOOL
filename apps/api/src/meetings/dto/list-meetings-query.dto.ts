import { IsOptional, IsString, Matches } from "class-validator";

const DATE_OR_ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T.+)?$/;

export class ListMeetingsQueryDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_OR_ISO_DATETIME_PATTERN)
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_OR_ISO_DATETIME_PATTERN)
  to?: string;
}
