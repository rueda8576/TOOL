export type AuthenticatedUser = {
  userId: string;
  email: string;
  globalRole: "admin" | "editor" | "reader";
};
