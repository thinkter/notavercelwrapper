"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { DeploymentRecord } from "@/lib/deployments";

type DeploymentsDashboardProps = {
  initialDeployments: DeploymentRecord[];
  selectedDeploymentId?: string;
};

function formatDate(value: string | null) {
  if (!value) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function statusTone(status: string) {
  switch (status) {
    case "running":
      return "bg-emerald-500/12 text-emerald-200 ring-1 ring-emerald-500/20";
    case "failed":
      return "bg-rose-500/12 text-rose-200 ring-1 ring-rose-500/20";
    case "building":
    case "starting":
      return "bg-amber-500/12 text-amber-200 ring-1 ring-amber-500/20";
    default:
      return "bg-white/8 text-stone-200 ring-1 ring-white/10";
  }
}

function LogPanel({
  title,
  content,
}: {
  title: string;
  content: string | null;
}) {
  return (
    <section className="overflow-hidden rounded-[1.25rem] border border-white/8 bg-black/30">
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-3">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.24em] text-stone-300/70">
          {title}
        </h3>
      </div>
      <pre className="max-h-[22rem] overflow-auto px-4 py-4 font-mono text-xs leading-6 text-stone-200/90 whitespace-pre-wrap">
        {content && content.trim().length > 0 ? content : "No output yet."}
      </pre>
    </section>
  );
}

export function DeploymentsDashboard({
  initialDeployments,
  selectedDeploymentId,
}: DeploymentsDashboardProps) {
  const [deployments, setDeployments] = useState(initialDeployments);
  const [selectedId, setSelectedId] = useState(
    selectedDeploymentId ?? initialDeployments[0]?.id ?? null,
  );
  const [selectedDeployment, setSelectedDeployment] = useState<DeploymentRecord | null>(
    initialDeployments.find((deployment) => deployment.id === selectedDeploymentId) ??
      initialDeployments[0] ??
      null,
  );
  const [streamError, setStreamError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    setDeployments(initialDeployments);

    if (!selectedId && initialDeployments[0]) {
      setSelectedId(initialDeployments[0].id);
      setSelectedDeployment(initialDeployments[0]);
    }
  }, [initialDeployments, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`/api/deployments/${selectedId}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as
          | { ok: true; deployment: DeploymentRecord }
          | { ok: false; message?: string };

        if (!response.ok || !payload.ok) {
          throw new Error("Failed to load deployment");
        }

        if (cancelled) {
          return;
        }

        setSelectedDeployment(payload.deployment);
        setDeployments((current) =>
          current.map((deployment) =>
            deployment.id === payload.deployment.id ? payload.deployment : deployment,
          ),
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        setStreamError(error instanceof Error ? error.message : "Failed to load deployment");
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    eventSourceRef.current?.close();
    setStreamError(null);

    const eventSource = new EventSource(`/api/deployments/${selectedId}/events`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener("deployment", (event) => {
      const nextDeployment = JSON.parse((event as MessageEvent<string>).data) as DeploymentRecord;

      setSelectedDeployment(nextDeployment);
      setDeployments((current) => {
        const existing = current.some((deployment) => deployment.id === nextDeployment.id);

        if (!existing) {
          return [nextDeployment, ...current];
        }

        return current.map((deployment) =>
          deployment.id === nextDeployment.id ? nextDeployment : deployment,
        );
      });
    });

    eventSource.addEventListener("error", (event) => {
      if ((event as MessageEvent<string>).data) {
        try {
          const payload = JSON.parse((event as MessageEvent<string>).data) as {
            message?: string;
          };
          setStreamError(payload.message ?? "Live updates disconnected");
          return;
        } catch {}
      }

      setStreamError("Live updates disconnected");
    });

    return () => {
      eventSource.close();
      if (eventSourceRef.current === eventSource) {
        eventSourceRef.current = null;
      }
    };
  }, [selectedId]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="landing-grid pointer-events-none fixed inset-0 opacity-80" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,120,64,0.15),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(255,166,94,0.08),transparent_28%),linear-gradient(180deg,rgba(3,3,3,0.78),rgba(3,3,3,0.94))]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 sm:px-10 lg:px-14">
        <header className="flex flex-col gap-5 border-b border-white/8 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-stone-300/60">
              Deployments
            </p>
            <h1 className="text-4xl font-semibold tracking-[-0.07em] text-foreground sm:text-5xl">
              Build feed and runtime console
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-stone-300/72 sm:text-base">
              Watch builds move, inspect runtime state, and drill into logs without
              leaving the control room.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm text-stone-100"
          >
            Back Home
          </Link>
        </header>

        <section className="grid flex-1 gap-6 py-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-[1.7rem] border border-white/8 bg-[linear-gradient(180deg,rgba(14,14,14,0.92),rgba(7,7,7,0.96))]">
            <div className="border-b border-white/6 px-5 py-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-stone-300/60">
                Recent
              </p>
            </div>
            <div className="max-h-[calc(100vh-16rem)] overflow-auto p-3">
              <div className="space-y-3">
                {deployments.map((deployment) => {
                  const active = deployment.id === selectedId;

                  return (
                    <button
                      key={deployment.id}
                      type="button"
                      onClick={() => setSelectedId(deployment.id)}
                      className={`w-full rounded-[1.2rem] border px-4 py-4 text-left ${
                        active
                          ? "border-[#ff9a52]/35 bg-[#ff9a52]/10 shadow-[0_10px_28px_rgba(0,0,0,0.34)]"
                          : "border-white/8 bg-white/[0.03] hover:border-white/14 hover:bg-white/[0.05]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-stone-100">
                            {deployment.repoUrl.replace(/^https?:\/\//, "")}
                          </p>
                          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.2em] text-stone-300/55">
                            {deployment.id.slice(0, 8)}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${statusTone(
                            deployment.status,
                          )}`}
                        >
                          {deployment.status}
                        </span>
                      </div>
                      <div className="mt-4 flex items-center justify-between text-xs text-stone-300/60">
                        <span>{deployment.runtime}</span>
                        <span>{formatDate(deployment.updatedAt)}</span>
                      </div>
                    </button>
                  );
                })}

                {deployments.length === 0 ? (
                  <div className="rounded-[1.2rem] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-stone-300/60">
                    No deployments yet.
                  </div>
                ) : null}
              </div>
            </div>
          </aside>

          <section className="space-y-6">
            {selectedDeployment ? (
              <>
                <section className="overflow-hidden rounded-[1.7rem] border border-white/8 bg-[linear-gradient(180deg,rgba(13,13,13,0.96),rgba(7,7,7,0.98))]">
                  <div className="flex flex-col gap-5 border-b border-white/6 px-6 py-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-stone-300/60">
                        Selected deployment
                      </p>
                      <h2 className="break-all text-2xl font-semibold tracking-[-0.05em] text-stone-100">
                        {selectedDeployment.repoUrl}
                      </h2>
                      <div className="flex flex-wrap gap-2">
                        <span
                          className={`rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusTone(
                            selectedDeployment.status,
                          )}`}
                        >
                          {selectedDeployment.status}
                        </span>
                        <span className="rounded-full bg-white/6 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-stone-200/70">
                          {selectedDeployment.runtime}
                        </span>
                        <span className="rounded-full bg-white/6 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-stone-200/70">
                          Port {selectedDeployment.appPort}
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-3 text-sm text-stone-300/70 sm:grid-cols-2">
                      <div>
                        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-300/50">
                          Public URL
                        </p>
                        <p className="mt-2 break-all text-stone-100">
                          {selectedDeployment.publicUrl ?? "Not assigned"}
                        </p>
                      </div>
                      <div>
                        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-300/50">
                          Host Port
                        </p>
                        <p className="mt-2 text-stone-100">
                          {selectedDeployment.hostPort ?? "Not assigned"}
                        </p>
                      </div>
                      <div>
                        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-300/50">
                          Commit
                        </p>
                        <p className="mt-2 break-all text-stone-100">
                          {selectedDeployment.commitSha ?? "Unknown"}
                        </p>
                      </div>
                      <div>
                        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-300/50">
                          Updated
                        </p>
                        <p className="mt-2 text-stone-100">
                          {formatDate(selectedDeployment.updatedAt)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 px-6 py-5 md:grid-cols-3">
                    <div className="rounded-[1.2rem] border border-white/6 bg-white/[0.03] px-4 py-4">
                      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-300/50">
                        Install
                      </p>
                      <p className="mt-3 font-mono text-sm text-stone-100">
                        {selectedDeployment.installCommand}
                      </p>
                    </div>
                    <div className="rounded-[1.2rem] border border-white/6 bg-white/[0.03] px-4 py-4">
                      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-300/50">
                        Build
                      </p>
                      <p className="mt-3 font-mono text-sm text-stone-100">
                        {selectedDeployment.buildCommand?.trim() || "No build step"}
                      </p>
                    </div>
                    <div className="rounded-[1.2rem] border border-white/6 bg-white/[0.03] px-4 py-4">
                      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-300/50">
                        Start
                      </p>
                      <p className="mt-3 font-mono text-sm text-stone-100">
                        {selectedDeployment.startCommand}
                      </p>
                    </div>
                  </div>
                </section>

                {streamError ? (
                  <div className="rounded-[1.25rem] border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                    {streamError}
                  </div>
                ) : null}

                {selectedDeployment.errorMessage ? (
                  <div className="rounded-[1.25rem] border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                    {selectedDeployment.errorMessage}
                  </div>
                ) : null}

                <div className="grid gap-6 xl:grid-cols-2">
                  <LogPanel title="Build Logs" content={selectedDeployment.buildLogs} />
                  <LogPanel title="Runtime Logs" content={selectedDeployment.runtimeLogs} />
                </div>
              </>
            ) : (
              <section className="flex min-h-[26rem] items-center justify-center rounded-[1.7rem] border border-dashed border-white/10 bg-white/[0.03] px-6 text-center text-stone-300/60">
                Pick a deployment to inspect logs.
              </section>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}
