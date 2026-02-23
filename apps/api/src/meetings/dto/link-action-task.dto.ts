import { IsString } from "class-validator";

export class LinkActionTaskDto {
  @IsString()
  taskId!: string;
}
