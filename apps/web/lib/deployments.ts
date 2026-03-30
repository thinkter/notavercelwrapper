export type DeploymentRecord = {
  id: string;
  status: string;
  repoUrl: string;
  runtime: string;
  branch: string | null;
  installCommand: string;
  buildCommand: string | null;
  startCommand: string;
  appPort: number;
  envVars: Record<string, string> | null;
  assignedWorkerId: string | null;
  hostPort: number | null;
  publicUrl: string | null;
  imageTag: string | null;
  containerId: string | null;
  commitSha: string | null;
  buildLogs: string | null;
  runtimeLogs: string | null;
  errorMessage: string | null;
  assignedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const API_BASE_URL = process.env.CLIRCEL_API_URL ?? "http://localhost:3001";

export async function fetchDeployments() {
  const response = await fetch(`${API_BASE_URL}/deployments`, {
    method: "GET",
    cache: "no-store",
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.message ?? "Failed to fetch deployments");
  }

  return payload as DeploymentRecord[];
}

export async function fetchDeployment(id: string) {
  const response = await fetch(`${API_BASE_URL}/deployments/${id}`, {
    method: "GET",
    cache: "no-store",
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.message ?? "Failed to fetch deployment");
  }

  return payload as { ok: true; deployment: DeploymentRecord };
}
