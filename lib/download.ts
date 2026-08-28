/**
 * Hands the browser a file. The only part of exporting that touches the DOM.
 *
 * Split from lib/csv.ts so the formatting rules stay testable under Node, where
 * there is no Blob and no anchor to click.
 */
export function download(name: string, text: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));

  const a = document.createElement("a");
  a.href = url;
  a.download = name;

  // Firefox will not act on a click unless the anchor is in the document.
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Revoking synchronously cancels the download in some browsers, so it waits
  // for the click to have been dispatched.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
