"use client";

import GroupBoard from "@/components/GroupBoard";

/**
 * My Classroom — every student whose script has been marked, and how they are
 * doing across all of them.
 *
 * The class is not configured anywhere; it is whoever appears on the runs in
 * history. That keeps the page honest with no roster to maintain, and means a
 * student joins the moment their first script is filed under their name.
 */
export default function ClassroomRoute() {
  return (
    <GroupBoard
      field="student"
      copy={{
        nav: "classroom",
        guide: "classroom",
        title: "My Classroom",
        intro:
          "Everyone whose script you have marked, with their average across every paper. Open a student to see each script and reopen the marking on it.",
        noun: "student",
        countLabel: (n) => `${n} script${n === 1 ? "" : "s"} marked`,
        unfiledTitle: "Scripts with no student on them",
        unfiledHint:
          "These were marked without a name. Give one and the script joins that student — nothing is re-run.",
        filePlaceholder: "Student name",
        emptyTitle: "No students yet",
        emptyBody:
          "Mark a script and put the student's name on it. They appear here with an average that grows as you mark more of their papers.",
      }}
    />
  );
}
