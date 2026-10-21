"use client";

import { useState } from "react";
import { useAppState } from "@/components/useAppState";
import { BoardView, type BoardTab } from "@/components/board/BoardView";

/**
 * Big-screen board. Meant for a TV in the judges' room, read from three
 * metres away, and opened on phones from the landing page. Public: no
 * sign-in. The drawing is BoardView (src/components/board); this page only
 * polls and holds the two view choices.
 */
export default function BoardPage() {
  const { state, online } = useAppState(6000);
  const [hideDone, setHideDone] = useState(false);
  const [view, setView] = useState<BoardTab>("queue");

  return (
    <BoardView
      state={state}
      online={online}
      view={view}
      hideDone={hideDone}
      onView={setView}
      onHideDone={setHideDone}
    />
  );
}
