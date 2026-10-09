import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, TextInput, Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, formatINR, formatShortDate } from "@/src/theme";
import { PeriodSelector, Period } from "@/src/components/PeriodSelector";

function todayIso() { return new Date().toISOString().slice(0, 10); }

type ActiveCustomer = {
  customer: string;
  bdm_name: string;
  forecast: number;
  sales_done: number;
  weight: number;
  costing: number;
  freight: number;
  gm2: number;
  demand_count: number;
  statuses: Record<string, number>;
  last_demand_date?: string;
};

export default function Customers() {
  const [period, setPeriod] = useState<Period>("month");
  const [refDate, setRefDate] = useState<string>(todayIso());
  const [items, setItems] = useState<ActiveCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async (forceSync = false) => {
    try {
      if (forceSync) { try { await api.syncSheets(); } catch {} }
      const c = await api.customers(period, refDate);
      setItems(c as ActiveCustomer[]);
    } finally { setLoading(false); setRefreshing(false); }
  }, [period, refDate]);

  useEffect(() => { load(false); }, [period, refDate]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const s = search.toLowerCase();
    return items.filter(x => x.customer.toLowerCase().includes(s));
  }, [items, search]);

  const totals = useMemo(() => ({
    forecast: items.reduce((s, i) => s + (i.forecast || 0), 0),
    sales_done: items.reduce((s, i) => s + (i.sales_done || 0), 0),
    freight: items.reduce((s, i) => s + (i.freight || 0), 0),
    weight: items.reduce((s, i) => s + (i.weight || 0), 0),
  }), [items]);

  const attainmentPct = totals.forecast > 0 ? Math.round((totals.sales_done / totals.forecast) * 100) : 0;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerLabel}>ACTIVE CUSTOMERS</Text>
          <Text style={styles.headerValue}>{items.length}</Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.headerLabel}>FORECAST</Text>
          <Text style={styles.headerRevenue}>{formatINR(totals.forecast)}</Text>
        </View>
      </View>

      <View style={styles.subHeader}>
        <View style={styles.subCell}>
          <Text style={styles.subLbl}>SALES DONE</Text>
          <Text style={[styles.subVal, { color: colors.success }]}>{formatINR(totals.sales_done)}</Text>
        </View>
        <View style={[styles.subCell, styles.subCellMid]}>
          <Text style={styles.subLbl}>ATTAINMENT</Text>
          <Text style={styles.subVal}>{attainmentPct}%</Text>
        </View>
        <View style={styles.subCell}>
          <Text style={styles.subLbl}>WEIGHT (MT)</Text>
          <Text style={styles.subVal}>{totals.weight.toFixed(0)}</Text>
        </View>
      </View>

      <View style={styles.periodWrap}>
        <PeriodSelector period={period} refDate={refDate} onChange={(p, r) => { setPeriod(p); setRefDate(r); }} />
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={colors.onSurfaceSecondary} />
          <TextInput
            testID="customer-search"
            style={styles.searchInput}
            placeholder="SEARCH CUSTOMER"
            placeholderTextColor={colors.onSurfaceSecondary}
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <Pressable onPress={() => setSearch("")}><Ionicons name="close" size={16} color={colors.onSurfaceSecondary} /></Pressable>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : filtered.length === 0 ? (
        <View style={styles.centered}><Text style={styles.emptyText}>{items.length === 0 ? "NO ACTIVE CUSTOMERS" : "NO MATCH"}</Text></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={colors.brand} title="SYNCING FROM SHEET…" />
          }
          renderItem={({ item }) => {
            const pct = item.forecast > 0 ? Math.min(100, Math.round((item.sales_done / item.forecast) * 100)) : 0;
            const hasActivity = item.demand_count > 0;
            return (
              <View style={styles.card} testID={`customer-${item.customer}`}>
                <View style={styles.cardHead}>
                  <Text style={styles.company} numberOfLines={2}>{item.customer}</Text>
                  {hasActivity ? (
                    <View style={styles.badge}><Text style={styles.badgeText}>{item.demand_count} DMD</Text></View>
                  ) : null}
                </View>
                <View style={styles.fcRow}>
                  <View style={styles.fcCell}>
                    <Text style={styles.fcLbl}>FORECAST</Text>
                    <Text style={styles.fcVal}>{formatINR(item.forecast)}</Text>
                  </View>
                  <View style={styles.fcCell}>
                    <Text style={styles.fcLbl}>SALES DONE</Text>
                    <Text style={[styles.fcVal, { color: colors.success }]}>{formatINR(item.sales_done)}</Text>
                  </View>
                  <View style={styles.fcCell}>
                    <Text style={styles.fcLbl}>%</Text>
                    <Text style={styles.fcVal}>{pct}%</Text>
                  </View>
                </View>
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
                {hasActivity ? (
                  <>
                    <View style={styles.demandRow}>
                      <Text style={styles.demandLbl}>PERIOD ACTIVITY</Text>
                      <Text style={styles.demandDate}>{item.last_demand_date ? `LAST ${formatShortDate(item.last_demand_date).toUpperCase()}` : ""}</Text>
                    </View>
                    <View style={styles.demandGrid}>
                      <View style={styles.dCell}><Text style={styles.dLbl}>WEIGHT</Text><Text style={styles.dVal}>{item.weight.toFixed(1)} MT</Text></View>
                      <View style={styles.dCell}><Text style={styles.dLbl}>FREIGHT</Text><Text style={styles.dVal}>{formatINR(item.freight)}</Text></View>
                      <View style={styles.dCell}><Text style={styles.dLbl}>COSTING</Text><Text style={styles.dVal}>{formatINR(item.costing)}</Text></View>
                      <View style={styles.dCell}>
                        <Text style={styles.dLbl}>GM2</Text>
                        <Text style={[styles.dVal, item.gm2 < 0 && { color: colors.error }]}>{formatINR(item.gm2)}</Text>
                      </View>
                    </View>
                    {Object.keys(item.statuses).length > 0 ? (
                      <View style={styles.statusRow}>
                        {Object.entries(item.statuses).map(([s, n]) => (
                          <View key={s} style={styles.statusChip}><Text style={styles.statusText}>{s.toUpperCase()} · {n}</Text></View>
                        ))}
                      </View>
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.noActivity}>NO DEMAND ACTIVITY IN PERIOD</Text>
                )}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 2, borderBottomColor: colors.borderStrong, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  headerLabel: { fontSize: 10, letterSpacing: 2, color: colors.onSurfaceSecondary },
  headerValue: { fontSize: 24, fontWeight: "900", color: colors.onSurface, marginTop: 2 },
  headerRight: { alignItems: "flex-end" },
  headerRevenue: { fontSize: 18, fontWeight: "900", color: colors.onSurface, marginTop: 2 },
  subHeader: { flexDirection: "row", borderBottomWidth: 2, borderColor: colors.borderStrong, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  subCell: { flex: 1 },
  subCellMid: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, alignItems: "center" },
  subLbl: { fontSize: 9, letterSpacing: 1.5, color: colors.onSurfaceSecondary, fontWeight: "700", marginBottom: 4 },
  subVal: { fontSize: 16, fontWeight: "900", color: colors.onSurface },
  periodWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  searchWrap: { flexDirection: "row", alignItems: "center", borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, height: 44, marginBottom: spacing.lg, gap: spacing.sm },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: 13, fontWeight: "700", letterSpacing: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: 12, color: colors.onSurfaceSecondary, letterSpacing: 2 },
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.lg, borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, backgroundColor: colors.surface },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: spacing.md, gap: spacing.md },
  company: { flex: 1, fontSize: 14, fontWeight: "900", color: colors.onSurface, letterSpacing: -0.3 },
  badge: { backgroundColor: colors.brand, paddingHorizontal: 6, paddingVertical: 3 },
  badgeText: { color: colors.onSurfaceInverse, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  fcRow: { flexDirection: "row", marginBottom: spacing.sm },
  fcCell: { flex: 1 },
  fcLbl: { fontSize: 9, letterSpacing: 1.5, color: colors.onSurfaceSecondary, fontWeight: "700", marginBottom: 2 },
  fcVal: { fontSize: 13, fontWeight: "900", color: colors.onSurface },
  progressTrack: { height: 6, backgroundColor: colors.brandTertiary, marginBottom: spacing.md },
  progressFill: { height: "100%", backgroundColor: colors.success },
  demandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.sm, marginBottom: spacing.xs, paddingTop: spacing.sm, borderTopWidth: 1, borderColor: colors.border },
  demandLbl: { fontSize: 10, letterSpacing: 2, fontWeight: "800", color: colors.onSurface },
  demandDate: { fontSize: 9, letterSpacing: 1, color: colors.onSurfaceSecondary, fontWeight: "700" },
  demandGrid: { flexDirection: "row", flexWrap: "wrap" },
  dCell: { width: "50%", paddingVertical: 4 },
  dLbl: { fontSize: 9, letterSpacing: 1.5, color: colors.onSurfaceSecondary, fontWeight: "700" },
  dVal: { fontSize: 13, fontWeight: "900", color: colors.onSurface, marginTop: 2 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm, gap: 4 },
  statusChip: { paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: colors.border },
  statusText: { fontSize: 9, letterSpacing: 1, color: colors.onSurfaceSecondary, fontWeight: "700" },
  noActivity: { fontSize: 10, color: colors.onSurfaceSecondary, letterSpacing: 1, marginTop: 4, fontStyle: "italic" },
});
