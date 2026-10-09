import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, formatINR } from "@/src/theme";

type Payment = {
  id: string;
  customer: string;
  invoice_no: string;
  amount: number;
  outstanding?: number;
  overdue?: number;
  remarks?: string;
  due_date: string;
  status: "outstanding" | "overdue" | "paid";
  reminder_sent_at?: string | null;
};

type FilterKey = "all" | "overdue" | "outstanding";

export default function Payments() {
  const [items, setItems] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (forceSync = false) => {
    try {
      if (forceSync) {
        try { await api.syncSheets(); } catch (e) { console.log("sync failed", e); }
      }
      const p = await api.payments("all");
      // exclude paid
      setItems((p as Payment[]).filter((x) => x.status !== "paid"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((i) => i.status === filter);
  }, [items, filter]);

  const totals = useMemo(() => {
    const overdue = items.reduce((s, i) => s + (i.overdue ?? (i.status === "overdue" ? i.amount : 0)), 0);
    const outstanding = items.reduce((s, i) => s + (i.outstanding ?? (i.status === "outstanding" ? i.amount : 0)), 0);
    return { overdue, outstanding };
  }, [items]);

  const markReminder = async (p: Payment) => {
    setBusyId(p.id);
    try {
      const u = await api.markReminder(p.id);
      setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...u } : x)));
    } finally {
      setBusyId(null);
    }
  };

  const chips: { key: FilterKey; label: string }[] = [
    { key: "all", label: "ALL" },
    { key: "overdue", label: "OVERDUE" },
    { key: "outstanding", label: "OUTSTANDING" },
  ];

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.headerCellLeft}>
          <Text style={[styles.headerLabel, { color: colors.error }]}>OVERDUE</Text>
          <Text style={[styles.headerValue, { color: colors.error }]}>
            {formatINR(totals.overdue)}
          </Text>
        </View>
        <View style={styles.headerCellRight}>
          <Text style={styles.headerLabel}>OUTSTANDING</Text>
          <Text style={styles.headerValue}>{formatINR(totals.outstanding)}</Text>
        </View>
      </View>

      <View style={styles.chipsWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {chips.map((c) => {
            const active = filter === c.key;
            return (
              <Pressable
                key={c.key}
                testID={`filter-${c.key}`}
                onPress={() => setFilter(c.key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>NO PAYMENTS</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load(true);
              }}
              tintColor={colors.brand}
              title="SYNCING FROM SHEET…"
            />
          }
          renderItem={({ item }) => (
            <View
              style={[
                styles.row,
                item.status === "overdue" && styles.rowOverdue,
              ]}
              testID={`payment-${item.id}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.customer} numberOfLines={2}>
                  {item.customer}
                </Text>
                {item.remarks ? (
                  <Text style={styles.remarks} numberOfLines={2}>
                    {item.remarks}
                  </Text>
                ) : null}
                <View style={styles.metaRow}>
                  {item.reminder_sent_at ? (
                    <View style={styles.reminderTag}>
                      <Ionicons name="checkmark" size={11} color={colors.onSuccess} />
                      <Text style={styles.reminderTagText}>SENT</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <View style={styles.rowRight}>
                {typeof item.overdue === "number" && item.overdue > 0 ? (
                  <View style={styles.amtLine}>
                    <Text style={styles.amtLabel}>OD</Text>
                    <Text style={[styles.amount, { color: colors.error }]}>
                      {formatINR(item.overdue)}
                    </Text>
                  </View>
                ) : null}
                {typeof item.outstanding === "number" && item.outstanding > 0 ? (
                  <View style={styles.amtLine}>
                    <Text style={styles.amtLabel}>OS</Text>
                    <Text style={styles.amount}>{formatINR(item.outstanding)}</Text>
                  </View>
                ) : null}
                {!item.overdue && !item.outstanding ? (
                  <Text
                    style={[
                      styles.amount,
                      item.status === "overdue" && { color: colors.error },
                    ]}
                  >
                    {formatINR(item.amount)}
                  </Text>
                ) : null}
                <Pressable
                  disabled={!!item.reminder_sent_at || busyId === item.id}
                  onPress={() => markReminder(item)}
                  testID={`reminder-${item.id}`}
                  style={({ pressed }) => [
                    styles.reminderBtn,
                    item.reminder_sent_at && styles.reminderBtnDone,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  {busyId === item.id ? (
                    <ActivityIndicator size="small" color={colors.onSurfaceInverse} />
                  ) : (
                    <Text
                      style={[
                        styles.reminderBtnText,
                        item.reminder_sent_at && { color: colors.onSurfaceSecondary },
                      ]}
                    >
                      {item.reminder_sent_at ? "REMINDED" : "REMIND"}
                    </Text>
                  )}
                </Pressable>
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
  header: {
    flexDirection: "row",
    borderBottomWidth: 2,
    borderBottomColor: colors.borderStrong,
  },
  headerCellLeft: {
    flex: 1,
    padding: spacing.lg,
    borderRightWidth: 2,
    borderColor: colors.borderStrong,
  },
  headerCellRight: { flex: 1, padding: spacing.lg },
  headerLabel: { fontSize: 10, letterSpacing: 2, color: colors.onSurfaceSecondary },
  headerValue: {
    fontSize: 20,
    fontWeight: "900",
    color: colors.onSurface,
    marginTop: 4,
    letterSpacing: -0.5,
  },
  chipsWrap: { height: 56, borderBottomWidth: 1, borderBottomColor: colors.border },
  chipsRow: {
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
    height: 56,
  },
  chip: {
    height: 36,
    paddingHorizontal: spacing.md,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brand },
  chipText: {
    color: colors.onSurface,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  chipTextActive: { color: colors.onSurfaceInverse },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: 12, color: colors.onSurfaceSecondary, letterSpacing: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  rowOverdue: {
    borderLeftWidth: 4,
    borderLeftColor: colors.error,
    backgroundColor: "#FEF2F2",
  },
  customer: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  invoice: {
    fontSize: 11,
    color: colors.onSurfaceSecondary,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  remarks: {
    fontSize: 11,
    color: colors.onSurfaceSecondary,
    marginTop: 4,
    fontStyle: "italic",
  },
  amtLine: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginBottom: 2,
  },
  amtLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    color: colors.onSurfaceSecondary,
  },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 6, gap: spacing.sm },
  dueDate: {
    fontSize: 10,
    color: colors.onSurfaceSecondary,
    letterSpacing: 1.5,
    fontWeight: "700",
  },
  reminderTag: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.success,
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 2,
  },
  reminderTagText: {
    color: colors.onSuccess,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
  },
  rowRight: { alignItems: "flex-end", marginLeft: spacing.md },
  amount: { fontSize: 15, fontWeight: "900", color: colors.onSurface },
  reminderBtn: {
    marginTop: 8,
    backgroundColor: colors.brand,
    paddingVertical: 6,
    paddingHorizontal: 10,
    minWidth: 90,
    alignItems: "center",
  },
  reminderBtnDone: {
    backgroundColor: colors.brandTertiary,
  },
  reminderBtnText: {
    color: colors.onSurfaceInverse,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  sep: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.lg },
});
