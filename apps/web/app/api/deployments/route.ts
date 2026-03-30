import { NextResponse } from "next/server";

import { fetchDeployments } from "@/lib/deployments";

export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await fetchDeployments();
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      {
        ok: false,
        message: `Failed to fetch deployments: ${message}`,
      },
      { status: 500 },
    );
  }
}
