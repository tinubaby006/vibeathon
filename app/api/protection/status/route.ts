// app/api/protection/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  validateScanTargetBinding,
  getControllerStatus,
  getProtectionHistoryFromController,
} from "@/lib/protection";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const applicationId = searchParams.get("applicationId");
  const scanId = searchParams.get("scanId") || undefined;

  const runtimeStatus = await getControllerStatus();
  const history = await getProtectionHistoryFromController();

  if (!applicationId) {
    return NextResponse.json({
      eligible: false,
      reason: "No application selected.",
      runtimeStatus,
      history,
    });
  }

  const bindingCheck = await validateScanTargetBinding(applicationId, scanId);

  return NextResponse.json({
    eligible: bindingCheck.eligible,
    reason: bindingCheck.reason,
    binding: bindingCheck.binding,
    runtimeStatus,
    history,
  });
}
