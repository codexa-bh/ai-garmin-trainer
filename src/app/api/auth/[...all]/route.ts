import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/better-auth-config";

export const { GET, POST } = toNextJsHandler(auth.handler);
