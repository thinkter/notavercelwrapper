import { DeploymentsDashboard } from "@/components/deployments-dashboard";
import { fetchDeployments } from "@/lib/deployments";

export const metadata = {
  title: "Deployments | totally-not-vercel",
  description: "Live deployment feed with build and runtime logs.",
};

export default async function DeploymentsPage() {
  const deployments = await fetchDeployments().catch(() => []);

  return <DeploymentsDashboard initialDeployments={deployments} />;
}
