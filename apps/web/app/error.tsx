"use client";

/** Route error boundary: an unexpected error renders this panel instead of a blank crash. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="loginwrap">
      <div className="login">
        <h1>Something went wrong</h1>
        <p>An unexpected error occurred while rendering this view. Your data is unaffected.</p>
        {error.digest ? <p>Error reference: {error.digest}</p> : null}
        <button type="button" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}
