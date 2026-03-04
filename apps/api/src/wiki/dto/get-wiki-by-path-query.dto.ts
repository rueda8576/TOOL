import { IsString } from "class-validator";

export class GetWikiByPathQueryDto {
  @IsString()
  path!: string;
}
