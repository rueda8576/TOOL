import { IsString } from "class-validator";

export class AddTaskDependencyDto {
  @IsString()
  dependsOnTaskId!: string;
}
