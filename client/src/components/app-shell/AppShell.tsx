/* AppShell.tsx — thin orchestrator: wires @devdigest/ui AppFrame to the command
   palette, shortcuts help, global keyboard shortcuts, and the shell context.
   All concerns live in ./hooks; overlay open/close is local view state. */
"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { AppFrame, CommandPalette, ShortcutsHelp, type Crumb } from "@devdigest/ui";
import { useGlobalShortcuts, useShellCommands, useShellContext } from "./hooks";

export function AppShell({ children, crumb }: { children: React.ReactNode; crumb?: Crumb[] }) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const openPalette = React.useCallback(() => setPaletteOpen(true), []);
  const closePalette = React.useCallback(() => setPaletteOpen(false), []);
  const openHelp = React.useCallback(() => setHelpOpen(true), []);
  const closeHelp = React.useCallback(() => setHelpOpen(false), []);
  // The drawer is view state, so it lives here rather than in the design system:
  // the vendored shell only reads `sidebarOpen` and calls the toggle.
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const toggleSidebar = React.useCallback(() => setSidebarOpen((o) => !o), []);
  // Following a nav link is the drawer's whole purpose, so arriving closes it.
  const pathname = usePathname();
  React.useEffect(() => setSidebarOpen(false), [pathname]);

  useGlobalShortcuts({ onOpenPalette: openPalette, onOpenHelp: openHelp });
  const commands = useShellCommands();
  const ctx = useShellContext({
    onOpenCommandPalette: openPalette,
    sidebarOpen,
    onToggleSidebar: toggleSidebar,
  });

  return (
    <>
      <AppFrame ctx={ctx} crumb={crumb}>
        {children}
      </AppFrame>
      <CommandPalette open={paletteOpen} commands={commands} onClose={closePalette} />
      <ShortcutsHelp open={helpOpen} onClose={closeHelp} />
    </>
  );
}
