import { IsIn, IsOptional } from "class-validator";

export class ListRepositoryMergeRequestsQueryDto {
  @IsOptional()
  @IsIn(["opened", "merged", "closed", "all"])
  state?: "opened" | "merged" | "closed" | "all";
}
