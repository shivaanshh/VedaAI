import StudentView from "@/components/StudentView";

/**
 * The same run, read by the student who wrote it.
 *
 * Same id, same stored record, different capabilities: /a/:id is the teacher
 * workspace that drives the marking, /s/:id is the read-only result a teacher
 * shares. There is no login between them because the brief asks for none, so
 * the split is one of role and capability rather than of identity.
 */
export default function StudentResultRoute({ params }: { params: { id: string } }) {
  return <StudentView id={params.id} />;
}
