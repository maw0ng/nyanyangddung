/** Shared style constants for the CoWork window - a small local copy of
 * ../friends/friendsStyles's own tokens (same dark editor palette), kept
 * separate on purpose rather than importing across features, so a future
 * change to Friends' styling can't accidentally reskin this unrelated
 * window and vice versa. */

export const page: React.CSSProperties = {
  minHeight: "100vh",
  background: "#14161b",
  color: "#eef0f4",
  fontFamily: "system-ui, sans-serif",
  padding: 16,
  boxSizing: "border-box",
};

export const sectionTitle: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "#8b93a3",
  marginBottom: 8,
};

export const card: React.CSSProperties = {
  background: "#1b1e26",
  border: "1px solid #2a2e38",
  borderRadius: 10,
  padding: 12,
  marginBottom: 14,
};

export const input: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "#14161b",
  border: "1px solid #3a3f4b",
  borderRadius: 6,
  color: "#eef0f4",
  padding: "8px 10px",
  fontSize: 13,
  marginBottom: 8,
};

export function button(variant: "primary" | "default" | "danger" = "default", disabled = false): React.CSSProperties {
  const palette =
    variant === "primary"
      ? { bg: "rgba(59,130,246,0.25)", border: "#3b82f6" }
      : variant === "danger"
        ? { bg: "rgba(239,68,68,0.15)", border: "#7f1d1d" }
        : { bg: "#20232b", border: "#3a3f4b" };
  return {
    padding: "7px 12px",
    borderRadius: 6,
    border: `1px solid ${palette.border}`,
    background: palette.bg,
    color: variant === "danger" ? "#f3a5a5" : "#eef0f4",
    fontSize: 12,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

export const errorText: React.CSSProperties = { fontSize: 12, color: "#f3a5a5", marginTop: 6 };
export const mutedText: React.CSSProperties = { fontSize: 11, color: "#8b93a3" };
