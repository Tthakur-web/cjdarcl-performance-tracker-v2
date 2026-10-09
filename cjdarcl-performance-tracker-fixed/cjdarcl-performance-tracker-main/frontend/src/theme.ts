// Brutalist design tokens sourced from /app/design_guidelines.json
export const colors = {
  surface: "#FFFFFF",
  onSurface: "#111827",
  surfaceSecondary: "#F9FAFB",
  onSurfaceSecondary: "#374151",
  surfaceTertiary: "#F3F4F6",
  onSurfaceTertiary: "#4B5563",
  surfaceInverse: "#111827",
  onSurfaceInverse: "#FFFFFF",
  brand: "#111827",
  brandTertiary: "#E5E7EB",
  success: "#059669",
  onSuccess: "#FFFFFF",
  warning: "#D97706",
  error: "#DC2626",
  onError: "#FFFFFF",
  border: "#E5E7EB",
  borderStrong: "#111827",
  divider: "#D1D5DB",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const typography = {
  display: "Space Grotesk",
  body: "Geist",
  mono: "JetBrains Mono",
};

export const radii = { sm: 0, md: 0, lg: 0, pill: 999 };

export function formatINR(n: number): string {
  if (n === undefined || n === null || isNaN(n)) return "₹0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
