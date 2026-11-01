import { NextResponse } from "next/server";
import { modelSettings } from "@/lib/model-settings/composition";
import { ModelSettingsValidationError } from "@/lib/model-settings/application";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json(modelSettings.read(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Model settings could not be loaded." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid model settings request." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    return NextResponse.json(modelSettings.save(body), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof ModelSettingsValidationError
            ? error.message
            : "Model setting could not be confirmed. Use Retry model availability in chat to check the saved state.",
      },
      {
        status: error instanceof ModelSettingsValidationError ? 400 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
