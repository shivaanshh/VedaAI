import Workspace from "@/components/Workspace";

/**
 * A run has its own URL. Reloading resumes it where it stopped, and a finished
 * one reopens from history without re-running anything.
 */
export default function AssessmentRoute({ params }: { params: { id: string } }) {
  return <Workspace id={params.id} />;
}
