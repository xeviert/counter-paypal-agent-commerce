"use client";

import { useEffect } from "react";
import { markInboxRead } from "./actions";

/** Marks everything read once the maker has seen the inbox; rendering stays side-effect free. */
export function MarkRead({ unread }: { unread: boolean }) {
  useEffect(() => {
    if (unread) void markInboxRead();
  }, [unread]);
  return null;
}
