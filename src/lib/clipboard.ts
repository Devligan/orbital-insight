/**
 * Clipboard write with a legacy fallback.
 *
 * `navigator.clipboard` needs a secure context and browser policy; when it is
 * unavailable, a temporary textarea + copy command still works in user-gesture
 * handlers. The returned boolean is authoritative so the UI never shows
 * "copied" when nothing was copied.
 */

export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }
  if (typeof document === "undefined" || !document.body) return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "true");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(area);
  }
  return ok;
}
