"use client";

import { useEffect } from "react";
import { clearFlashAction } from "../actions";

/** Shows a reviewer-action message once: the cookie is cleared as soon as it has been displayed. */
export function FlashNote({ message }: { message: string }) {
  useEffect(() => {
    void clearFlashAction();
  }, []);
  return (
    <div className="flashnote" role="status">
      {message}
    </div>
  );
}
