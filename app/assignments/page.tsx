"use client";

import GroupBoard from "@/components/GroupBoard";

/**
 * Assignments — every paper that has been marked against, and how the class
 * found it.
 *
 * A paper is set once and sat by many students, so this is where marking more
 * than one script starts paying: the average is the class average, and the
 * unanswered count is the number of times anybody left something on that paper
 * blank. A run gets its paper from the teacher, or failing that from the name
 * of the question-paper file, so scripts marked from the same upload group
 * without anyone having typed anything.
 */
export default function AssignmentsRoute() {
  return (
    <GroupBoard
      field="paper"
      copy={{
        nav: "assignments",
        guide: "assignments",
        title: "Assignments",
        intro:
          "The papers you have marked against, with the class average on each. Open one to see every script that sat it.",
        noun: "paper",
        countLabel: (n) => `${n} script${n === 1 ? "" : "s"} marked`,
        unfiledTitle: "Scripts not filed under a paper",
        unfiledHint:
          "Name the paper each was marked against and they group together — nothing is re-run.",
        filePlaceholder: "Paper name",
        emptyTitle: "No papers yet",
        emptyBody:
          "Mark a script and the question paper it came from becomes an assignment here. Mark a second script against the same paper and you get the class average on it.",
      }}
    />
  );
}
