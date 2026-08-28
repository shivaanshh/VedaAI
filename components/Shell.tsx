"use client";

import { useEffect, useState, type ReactNode } from "react";
import Sidebar, { type NavKey } from "./Sidebar";
import TopBar from "./TopBar";

/**
 * The frame every screen sits in: sidebar, application bar, one scroll region.
 *
 * The design collapses the sidebar once a screen has something worth the width
 * — the loading and results frames both show the icon rail — so routes declare
 * what they want and the teacher can still override it by hand afterwards.
 */

interface Props {
  current: NavKey;
  /** What the route wants on arrival; the toggle takes over after that. */
  sidebarCollapsed?: boolean;
  backHref?: string;
  label?: string;
  children: ReactNode;
}

export default function Shell({
  current,
  sidebarCollapsed = false,
  backHref,
  label,
  children,
}: Props) {
  const [collapsed, setCollapsed] = useState(sidebarCollapsed);

  useEffect(() => {
    setCollapsed(sidebarCollapsed);
  }, [sidebarCollapsed]);

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} current={current} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar current={current} backHref={backHref} label={label} />
        <main className="min-h-0 flex-1 overflow-hidden bg-canvas">{children}</main>
      </div>
    </div>
  );
}
