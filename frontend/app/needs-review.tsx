import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/src/api/client";
import { colors, spacing, formatShortDate } from "@/src/theme";
import { Period } from "@/src/components/PeriodSelector";

function todayIso() { return new Date().toISOString().slice(0, 10); }

export default function NeedsReview() {
  const params = useLocalSearchParams<{ period?: string; refDate?: string }>();
  const router = useRouter();
  const period: Period = (params.period === "day" ? "day" : "month");
  const refDate = (params.refDate as string) || todayIso();

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await api.needsReview(period, refDate);
      setItems(rows);
    } finally { setLoading(false); setRefreshing(false); }
  }, [period, refDate]);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="needs-review-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View>
          <Text style={styles.title}>NEEDS REVIEW</Text>
          <Text style={styles.subtitle}>{items.length} ROW{items.length === 1 ? "" : "S"} · {period.toUpperCase()} · {refDate}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.hintBox}>
        <Ionicons name="information-circle-outline" size={14} color={colors.warning} />
        <Text style={styles.hintText}>Customer name didn't match any Active Customer and isn't a "New Acquisition {"<Month>"}" placeholder. Fix the name in the sheet.</Text>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="checkmark-circle" size={32} color={colors.success} />
          <Text style={styles.emptyText}>ALL CLEAR</Text>
          <Text style={styles.emptySub}>No unmatched customer names in this period.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
          renderItem={({ item }) => (
            <View style={styles.row} testID={`review-${item.id}`}>
              <View style={styles.rowLeft}>
                <View style={styles.flagPill}><Text style={styles.flagText}>UNMATCHED</Text></View>
                <Text style={styles.customer} numberOfLines={2}>{item.customer || "(EMPTY)"}</Text>
                <Text style={styles.route}>{item.from_location} → {item.to_location}</Text>
                <Text style={styles.meta}>{formatShortDate(item.date).toUpperCase()} · {item.salesperson_email} · {item.weight} MT</Text>
              </View>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontWeight: "900", letterSpacing: 2, color: colors.onSurface, textAlign: "center" },
  subtitle: { fontSize: 10, letterSpacing: 1.5, color: colors.onSurfaceSecondary, marginTop: 2, textAlign: "center" },
  hintBox: { flexDirection: "row", alignItems: "center", padding: spacing.md, backgroundColor: "#FFFBEB", borderBottomWidth: 1, borderColor: colors.border, gap: spacing.sm },
  hintText: { flex: 1, fontSize: 11, color: colors.warning, letterSpacing: 0.3, lineHeight: 15 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  emptyText: { marginTop: spacing.md, fontSize: 14, fontWeight: "900", letterSpacing: 2, color: colors.success },
  emptySub: { marginTop: spacing.sm, fontSize: 11, color: colors.onSurfaceSecondary, textAlign: "center" },
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface, borderLeftWidth: 4, borderLeftColor: colors.warning },
  rowLeft: { flex: 1 },
  flagPill: { alignSelf: "flex-start", backgroundColor: colors.warning, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 6 },
  flagText: { color: "#fff", fontSize: 9, fontWeight: "800", letterSpacing: 1.5 },
  customer: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  route: { fontSize: 11, color: colors.onSurfaceSecondary, marginTop: 4 },
  meta: { fontSize: 10, color: colors.onSurfaceSecondary, marginTop: 4, letterSpacing: 0.5 },
  sep: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.lg },
});
