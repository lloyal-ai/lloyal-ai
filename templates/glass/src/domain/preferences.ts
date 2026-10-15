import { z } from "zod";
export const Preferences = z.object({
  detail: z.enum(["adaptive", "brief", "thorough"]).default("adaptive"),
  work: z.enum(["auto", "expanded", "compact"]).default("auto"),
  motion: z.enum(["system", "reduced"]).default("system"),
});
export type Preferences = z.infer<typeof Preferences>;
