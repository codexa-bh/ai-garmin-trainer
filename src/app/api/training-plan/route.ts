import { NextResponse } from "next/server";
import {
  TRAINING_PLAN_CONTENT_MAX_LENGTH,
  TRAINING_PLAN_TITLE_MAX_LENGTH,
  replaceTrainingPlan,
  trainingPlanStatus,
} from "@/lib/db/repository";

function boundedError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function parsePlanBody(
  body: unknown,
): { title?: string; contentMarkdown: string } | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const rawContent =
    record.contentMarkdown ?? record.markdown ?? record.content;
  if (typeof rawContent !== "string") return null;
  const title = typeof record.title === "string" ? record.title : undefined;
  return { title, contentMarkdown: rawContent };
}

export async function GET() {
  return NextResponse.json(trainingPlanStatus());
}

export async function PUT(request: Request) {
  try {
    const parsed = parsePlanBody(await request.json());
    if (!parsed)
      return boundedError("Training Plan contentMarkdown is required.");
    const content = parsed.contentMarkdown.trim();
    const title = parsed.title?.trim();
    if (!content) return boundedError("Training Plan content cannot be empty.");
    if (content.length > TRAINING_PLAN_CONTENT_MAX_LENGTH)
      return boundedError(
        `Training Plan content exceeds ${TRAINING_PLAN_CONTENT_MAX_LENGTH} characters.`,
        413,
      );
    if (title && title.length > TRAINING_PLAN_TITLE_MAX_LENGTH)
      return boundedError(
        `Training Plan title exceeds ${TRAINING_PLAN_TITLE_MAX_LENGTH} characters.`,
      );
    return NextResponse.json({
      plan: replaceTrainingPlan({ title, contentMarkdown: content }),
    });
  } catch {
    return boundedError("Training Plan could not be saved.", 500);
  }
}

export const POST = PUT;
