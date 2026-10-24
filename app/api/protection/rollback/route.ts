// app/api/protection/rollback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { rollbackRuleOnController } from "@/lib/protection";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const result = await rollbackRuleOnController(body.reason);
    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("409") ? 409 : 400;
    return NextResponse.json(
      { error: "ROLLBACK_FAILED", message: msg },
      { status }
    );
  }
}
