// app/api/protection/activate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { activateRuleOnController } from "@/lib/protection";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { approvalId?: string };

    if (!body.approvalId) {
      return NextResponse.json(
        { error: "MISSING_APPROVAL_ID", message: "approvalId is required" },
        { status: 400 }
      );
    }

    const result = await activateRuleOnController(body.approvalId);
    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("409") ? 409 : 400;
    return NextResponse.json(
      { error: "ACTIVATION_FAILED", message: msg },
      { status }
    );
  }
}
