import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { colors, spacing } from "@/src/theme";

export type Period = "day" | "month";

type Props = {
  period: Period;
  refDate: string; // YYYY-MM-DD
  onChange: (period: Period, refDate: string) => void;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDay(iso: string): string {
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-IN", {
      day: "2-digit", month: "short",
    });
  } catch { return iso; }
}

function formatMonth(iso: string): string {
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-IN", { month: "long", year: "2-digit" }).toUpperCase();
  } catch { return iso; }
}

function shift(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function shiftMonth(iso: string, delta: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + delta);
  // Clamp to today if going into the future
  const t = new Date(todayIso() + "T00:00:00");
  if (d > t) return todayIso();
  return d.toISOString().slice(0, 10);
}

export function PeriodSelector({ period, refDate, onChange }: Props) {
  const today = todayIso();
  const canForward = refDate < today;

  return (
    <View style={styles.wrap}>
      <View style={styles.toggleRow}>
        <Pressable
          testID="period-day"
          onPress={() => onChange("day", refDate)}
          style={[styles.toggleBtn, period === "day" && styles.toggleBtnActive]}
        >
          <Text style={[styles.toggleText, period === "day" && styles.toggleTextActive]}>DAY</Text>
        </Pressable>
        <Pressable
          testID="period-month"
          onPress={() => onChange("month", refDate)}
          style={[styles.toggleBtn, period === "month" && styles.toggleBtnActive]}
        >
          <Text style={[styles.toggleText, period === "month" && styles.toggleTextActive]}>MONTH-TO-DATE</Text>
        </Pressable>
      </View>

      <View style={styles.dateRow}>
        <Pressable
          testID="period-prev"
          style={styles.stepBtn}
          onPress={() => {
            const next = period === "day" ? shift(refDate, -1) : shiftMonth(refDate, -1);
            onChange(period, next);
          }}
        >
          <Text style={styles.stepText}>‹</Text>
        </Pressable>
        <View style={styles.dateBox}>
          <Text style={styles.dateText} testID="period-label">
            {period === "day" ? formatDay(refDate) : formatMonth(refDate)}
          </Text>
        </View>
        <Pressable
          testID="period-next"
          disabled={!canForward}
          style={[styles.stepBtn, !canForward && { opacity: 0.3 }]}
          onPress={() => {
            const next = period === "day" ? shift(refDate, +1) : shiftMonth(refDate, +1);
            onChange(period, next);
          }}
        >
          <Text style={styles.stepText}>›</Text>
        </Pressable>
        <Pressable
          testID="period-today"
          onPress={() => onChange(period, today)}
          style={styles.todayBtn}
        >
          <Text style={styles.todayText}>TODAY</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    marginBottom: spacing.lg,
  },
  toggleRow: {
    flexDirection: "row",
    borderBottomWidth: 2,
    borderColor: colors.borderStrong,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  toggleBtnActive: { backgroundColor: colors.brand },
  toggleText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: colors.onSurface,
  },
  toggleTextActive: { color: colors.onSurfaceInverse },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  stepBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 2,
    borderColor: colors.borderStrong,
  },
  stepText: { fontSize: 24, fontWeight: "900", color: colors.onSurface, lineHeight: 26 },
  dateBox: { flex: 1, alignItems: "center", justifyContent: "center", height: 44 },
  dateText: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.5,
    color: colors.onSurface,
    ...(Platform.OS === "web" ? { fontFamily: "JetBrains Mono, monospace" } : {}),
  },
  todayBtn: {
    borderLeftWidth: 2,
    borderColor: colors.borderStrong,
    paddingHorizontal: 14,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  todayText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    color: colors.onSurface,
  },
});
