"use client";

import { Elapsed, formatClock } from "@/components/ui";
import type { TileData } from "./boardLogic";

/**
 * The time on a tile: a held booking's clock time, a live request's time
 * since it last moved, nothing once complete.
 *
 * Not BookingTime: that one turns orange and pulses as a slot comes due,
 * and the board does not move. The clock reads the same.
 */
export function TileTime({
  tile,
  className,
}: {
  tile: Pick<TileData, "status" | "since" | "slotStart">;
  className: string;
}) {
  if (tile.slotStart) {
    return (
      <span className={className} suppressHydrationWarning>
        {formatClock(tile.slotStart)}
      </span>
    );
  }
  if (tile.since && tile.status && tile.status !== "completed") {
    return (
      <span className={className}>
        <Elapsed since={tile.since} />
      </span>
    );
  }
  return null;
}
