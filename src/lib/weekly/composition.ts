import { randomUUID } from "node:crypto";
import { weeklyStore } from "../db/weekly-repository";
import { createWeekly } from "./application";
export const weekly = createWeekly(weeklyStore, () => new Date(), randomUUID);
