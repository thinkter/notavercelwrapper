import { NextResponse } from "next/server";

import { fetchDeployment } from "@/lib/deployments";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const payload = await fetchDeployment(id);
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      {
        ok: false,
        message: `Failed to fetch deployment: ${message}`,
      },
      { status: 500 },
    );
  }
}
