import { z } from "zod";

export const GLOBAL_ROLES = ["admin", "editor", "reader"] as const;

export const GlobalRoleSchema = z.enum(GLOBAL_ROLES);
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const ReminderPreferenceSchema = z.object({
  emailEnabled: z.boolean(),
  taskAssigned: z.boolean(),
  taskDue: z.boolean(),
  taskDueLeadHours: z.number().int().positive().max(24 * 14)
});
export type ReminderPreference = z.infer<typeof ReminderPreferenceSchema>;
