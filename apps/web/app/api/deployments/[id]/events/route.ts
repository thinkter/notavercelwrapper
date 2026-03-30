import { fetchDeployment } from "@/lib/deployments";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const encoder = new TextEncoder();

function sseFrame(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  let closed = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastSerialized = "";

      const sendSnapshot = async () => {
        try {
          const payload = await fetchDeployment(id);
          const serialized = JSON.stringify(payload.deployment);

          if (serialized !== lastSerialized) {
            lastSerialized = serialized;
            controller.enqueue(sseFrame("deployment", payload.deployment));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          controller.enqueue(sseFrame("error", { message }));
        }
      };

      await sendSnapshot();

      interval = setInterval(() => {
        if (closed) {
          return;
        }

        void sendSnapshot();
      }, 2000);

      heartbeat = setInterval(() => {
        if (closed) {
          return;
        }

        controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 15000);
    },
    cancel() {
      closed = true;

      if (interval) {
        clearInterval(interval);
      }

      if (heartbeat) {
        clearInterval(heartbeat);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
