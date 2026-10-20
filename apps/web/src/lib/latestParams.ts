/**
 * The URL's search params as they are now. React Router hands a functional `setSearchParams`
 * update the params of the last render, so two quick changes (say "Clear filters", then a sort)
 * would build the second on stale params and bring the cleared filters back. Building on the
 * live URL keeps each change.
 */
export function latestParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}
