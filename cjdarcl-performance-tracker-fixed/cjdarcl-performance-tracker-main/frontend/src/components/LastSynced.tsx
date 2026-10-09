import { View, Text, StyleSheet } from "react-native";
import { colors } from "@/src/theme";

function fmt(iso?: string | null): string {
  if (!iso) return "NEVER";
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = Math.floor((now - d.getTime()) / 1000);
    if (diff < 60) return `${diff}S AGO`;
    if (diff < 3600) return `${Math.floor(diff / 60)}M AGO`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}H AGO`;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).toUpperCase();
  } catch { return "—"; }
}

export function LastSynced({ syncedAt }: { syncedAt?: string | null }) {
  return (
    <View style={styles.pill} testID="last-synced">
      <View style={styles.dot} />
      <Text style={styles.text}>SYNCED {fmt(syncedAt)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dot: { width: 6, height: 6, backgroundColor: colors.success, marginRight: 6 },
  text: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: colors.onSurfaceSecondary,
  },
});
