// app/api/protection/tests/route.ts
import { NextRequest, NextResponse } from "next/server";
import { runTestOnController } from "@/lib/protection";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { proposalId?: string };

    if (!body.proposalId) {
      return NextResponse.json(
        { error: "MISSING_PROPOSAL_ID", message: "proposalId is required" },
        { status: 400 }
      );
    }

    const testRun = await runTestOnController(body.proposalId);
    return NextResponse.json(testRun, { status: 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("409") ? 409 : 500;
    return NextResponse.json(
      { error: "TEST_EXECUTION_FAILED", message: msg },
      { status }
    );
  }
}
