import { NextResponse } from "next/server";
import { ApiResult, Notification, PatchNotificationSchema } from "@/lib/contracts";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<ApiResult<Notification[]>>> {
  try {
    const notifications = await getNotifications();
    return NextResponse.json({
      ok: true,
      data: notifications,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "STORE_ERROR",
          message: (err as Error).message || "Failed to load notifications",
          retryable: true,
        },
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request
): Promise<NextResponse<ApiResult<{ updated: boolean; count?: number }>>> {
  try {
    const body = await req.json();

    if (body.markAll === true) {
      const count = await markAllNotificationsRead();
      return NextResponse.json({
        ok: true,
        data: { updated: true, count },
      });
    }

    if (!body.id || typeof body.id !== "string") {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "A valid notification 'id' or 'markAll: true' is required",
            retryable: false,
          },
        },
        { status: 400 }
      );
    }

    const parsed = PatchNotificationSchema.safeParse({ read: body.read });
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Field 'read' must be a boolean",
            retryable: false,
          },
        },
        { status: 400 }
      );
    }

    const updated = await markNotificationRead(body.id, parsed.data.read);

    return NextResponse.json({
      ok: true,
      data: { updated },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "UPDATE_FAILED",
          message: (err as Error).message || "Failed to update notification",
          retryable: false,
        },
      },
      { status: 400 }
    );
  }
}
