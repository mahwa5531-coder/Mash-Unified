// Pure time/formatting helpers.

export function formatRelativeTime(timestamp: number | string | null | undefined): string {
  if (!timestamp) return "now";
  let time: number;
  if (typeof timestamp === "number") {
    time = timestamp > 1e11 ? timestamp : timestamp * 1000;
  } else {
    let str = String(timestamp).trim();
    // Normalize space separator to 'T'
    str = str.replace(" ", "T");
    // If no timezone specified, assume UTC if ISO format
    if (str.length >= 19 && !str.endsWith("Z") && !str.includes("+") && !str.includes("-", 10)) {
      str += "Z";
    }
    time = new Date(str).getTime();
    if (isNaN(time)) {
      time = new Date(String(timestamp)).getTime();
    }
  }
  if (isNaN(time)) return "now";

  const diffMs = Date.now() - time;
  if (diffMs < 0) return "now";
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}
