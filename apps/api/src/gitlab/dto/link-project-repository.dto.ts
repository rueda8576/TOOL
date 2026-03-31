import { IsString } from "class-validator";

export class LinkProjectRepositoryDto {
  @IsString()
  gitlabProjectId!: string;
}
