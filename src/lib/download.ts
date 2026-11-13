/**
 * Hand a generated file to the browser as a download (CSV exports, calendar
 * events). Built client-side from data already on the page — nothing is
 * uploaded. Must run inside a user-gesture handler.
 */
export function downloadFile(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  // Revoked on the next tick: Safari reads the URL after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
