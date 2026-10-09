import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, formatINR, formatShortDate } from "@/src/theme";
import { PeriodSelector, Period } from "@/src/components/PeriodSelector";

const STAGES = ["Lead", "Contacted", "Demo", "Negotiation", "Won"] as const;
type Stage = (typeof STAGES)[number];

type Deal = {
  id: string; salesperson_email: string; company: string; contact: string;
  value: number; stage: Stage; sheet_stage?: string;
  location?: string; exp_closer_date?: string | null;
};

function todayIso() { return new Date().toISOString().slice(0, 10); }

export default function Pipeline() {
  const [period, setPeriod] = useState<Period>("month");
  const [refDate, setRefDate] = useState<string>(todayIso());
  const [deals, setDeals] = useState<Deal[]>([]);
  const [actual, setActual] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedStage, setSelectedStage] = useState<Stage | "All">("All");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async (forceSync = false) => {
    try {
      if (forceSync) { try { await api.syncSheets(); } catch {} }
      const d = await api.pipeline(period, refDate);
      setDeals(d.deals || []);
      setActual(d.actual_activity || {});
    } finally { setLoading(false); setRefreshing(false); }
  }, [period, refDate]);

  useEffect(() => { load(false); }, [period, refDate]);

  const filtered = useMemo(() => (
    selectedStage === "All" ? deals : deals.filter(d => d.stage === selectedStage)
  ), [deals, selectedStage]);

  const grouped = useMemo(() => {
    const g: Record<Stage, Deal[]> = { Lead: [], Contacted: [], Demo: [], Negotiation: [], Won: [] };
    for (const d of filtered) g[d.stage].push(d);
    return g;
  }, [filtered]);

  const totalValue = useMemo(() => deals.filter(d => d.stage !== "Won").reduce((s, d) => s + d.value, 0), [deals]);
  const wonCount = useMemo(() => deals.filter(d => d.stage === "Won").length, [deals]);

  const advance = async (deal: Deal, dir: 1 | -1) => {
    const idx = STAGES.indexOf(deal.stage);
    const next = idx + dir;
    if (next < 0 || next >= STAGES.length) return;
    setUpdatingId(deal.id);
    try {
      const updated = await api.updatePipelineStage(deal.id, STAGES[next]);
      setDeals(prev => prev.map(d => d.id === deal.id ? { ...d, ...updated } : d));
    } finally { setUpdatingId(null); }
  };

  const chips: (Stage | "All")[] = ["All", ...STAGES];

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerLabel}>PIPELINE VALUE</Text>
          <Text style={styles.headerValue}>{formatINR(totalValue)}</Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.headerLabel}>ACTIVE / WON</Text>
          <Text style={styles.headerCount}>{deals.length - wonCount} / {wonCount}</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
        <PeriodSelector period={period} refDate={refDate} onChange={(p, r) => { setPeriod(p); setRefDate(r); }} />

        <View style={styles.actualBlock} testID="new-acq-activity">
          <Text style={styles.actualLbl}>NEW-ACQUISITION DEMAND ACTIVITY</Text>
          <View style={styles.aTopRow}>
            <View style={styles.aBig}>
              <Text style={styles.aBigLbl}>SALES DONE</Text>
              <Text style={[styles.aBigVal, { color: colors.success }]}>{formatINR(actual.sales_done || 0)}</Text>
            </View>
            <View style={styles.aBig}>
              <Text style={styles.aBigLbl}>FORECAST</Text>
              <Text style={styles.aBigVal}>{formatINR(actual.forecast || 0)}</Text>
            </View>
            <View style={styles.aBig}>
              <Text style={styles.aBigLbl}>ATTAIN</Text>
              <Text style={styles.aBigVal}>{Math.round(actual.attainment_pct || 0)}%</Text>
            </View>
          </View>
          {actual.per_bdm && actual.per_bdm.length > 0 ? (
            <View style={styles.perBdmWrap}>
              <Text style={styles.perBdmHdr}>PER-BDM BREAKDOWN</Text>
              {actual.per_bdm.map((b: any) => {
                const p = b.forecast > 0 ? Math.round((b.sales_done / b.forecast) * 100) : 0;
                return (
                  <View key={b.email} style={styles.perBdmRow} testID={`na-${b.email}`}>
                    <Text style={styles.perBdmName} numberOfLines={1}>{b.bdm_name.toUpperCase()}</Text>
                    <Text style={styles.perBdmDone}>{formatINR(b.sales_done)}</Text>
                    <Text style={styles.perBdmForecast}>/ {formatINR(b.forecast)}</Text>
                    <Text style={[styles.perBdmPct, p >= 100 && { color: colors.success }]}>{p}%</Text>
                  </View>
                );
              })}
            </View>
          ) : null}
          <Text style={styles.actualNote}>Sourced from Active Customer sheet — rows tagged &quot;New Acquisition {actual.month_label || ""}&quot;</Text>
        </View>
      </View>

      <View style={styles.chipsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {chips.map(c => {
            const active = selectedStage === c;
            return (
              <Pressable key={c} testID={`chip-${c}`} onPress={() => setSelectedStage(c)} style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={colors.brand} title="SYNCING FROM SHEET…" />
          }
        >
          {STAGES.map(stage => {
            const items = grouped[stage];
            if (selectedStage !== "All" && selectedStage !== stage) return null;
            if (items.length === 0 && selectedStage === "All") return null;
            return (
              <View key={stage}>
                <View style={styles.stageHeader}>
                  <Text style={styles.stageHeaderText}>{stage.toUpperCase()}</Text>
                  <Text style={styles.stageCount}>{items.length}</Text>
                </View>
                {items.length === 0 ? (
                  <View style={styles.emptyRow}><Text style={styles.emptyText}>NO DEALS IN STAGE</Text></View>
                ) : items.map(d => (
                  <View key={d.id} style={styles.card} testID={`deal-${d.id}`}>
                    <View style={styles.cardHeader}>
                      <Text style={styles.company} numberOfLines={2}>{d.company}</Text>
                      <Text style={styles.value}>{formatINR(d.value)}</Text>
                    </View>
                    <View style={styles.cardMeta}>
                      <Text style={styles.contact}>{d.contact}</Text>
                      {d.sheet_stage ? <Text style={styles.sheetStage}>· {d.sheet_stage}</Text> : null}
                    </View>
                    {d.location ? <Text style={styles.location}>{d.location}</Text> : null}
                    {d.exp_closer_date ? <Text style={styles.expDate}>EXP CLOSE {formatShortDate(d.exp_closer_date).toUpperCase()}</Text> : null}
                    <View style={styles.cardActions}>
                      <Pressable disabled={d.stage === "Lead" || updatingId === d.id} onPress={() => advance(d, -1)} style={[styles.actionBtn, (d.stage === "Lead" || updatingId === d.id) && { opacity: 0.3 }]} testID={`revert-${d.id}`}>
                        <Ionicons name="arrow-back" size={14} color={colors.onSurface} />
                        <Text style={styles.actionText}>BACK</Text>
                      </Pressable>
                      <Pressable disabled={d.stage === "Won" || updatingId === d.id} onPress={() => advance(d, 1)} style={[styles.actionBtnPrimary, (d.stage === "Won" || updatingId === d.id) && { opacity: 0.3 }]} testID={`advance-${d.id}`}>
                        {updatingId === d.id ? <ActivityIndicator color={colors.onSurfaceInverse} size="small" /> : (<>
                          <Text style={styles.actionTextPrimary}>{d.stage === "Negotiation" ? "MARK WON" : "ADVANCE"}</Text>
                          <Ionicons name="arrow-forward" size={14} color={colors.onSurfaceInverse} />
                        </>)}
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            );
          })}
          {filtered.length === 0 && !loading ? <View style={styles.emptyRow}><Text style={styles.emptyText}>NO DEALS</Text></View> : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 2, borderBottomColor: colors.borderStrong, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  headerLabel: { fontSize: 10, letterSpacing: 2, color: colors.onSurfaceSecondary },
  headerValue: { fontSize: 22, fontWeight: "900", color: colors.onSurface, letterSpacing: -1, marginTop: 2 },
  headerRight: { alignItems: "flex-end" },
  headerCount: { fontSize: 20, fontWeight: "900", color: colors.brand },
  actualBlock: { borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, marginBottom: spacing.lg, backgroundColor: colors.surfaceSecondary },
  actualLbl: { fontSize: 10, letterSpacing: 2, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.sm },
  aTopRow: { flexDirection: "row", marginBottom: spacing.sm },
  aBig: { flex: 1, alignItems: "center" },
  aBigLbl: { fontSize: 9, letterSpacing: 1.5, color: colors.onSurfaceSecondary, fontWeight: "700" },
  aBigVal: { fontSize: 15, fontWeight: "900", color: colors.onSurface, marginTop: 4, letterSpacing: -0.5 },
  perBdmWrap: { marginTop: spacing.md, borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.md },
  perBdmHdr: { fontSize: 9, letterSpacing: 2, fontWeight: "800", color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  perBdmRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4, gap: 6 },
  perBdmName: { flex: 1.3, fontSize: 11, fontWeight: "800", color: colors.onSurface, letterSpacing: 0.5 },
  perBdmDone: { fontSize: 11, fontWeight: "800", color: colors.success },
  perBdmForecast: { fontSize: 10, color: colors.onSurfaceSecondary },
  perBdmPct: { width: 46, textAlign: "right", fontSize: 11, fontWeight: "800", color: colors.onSurface },
  actualNote: { fontSize: 9, color: colors.onSurfaceSecondary, marginTop: spacing.sm, fontStyle: "italic", letterSpacing: 0.5 },
  chipsWrap: { height: 56, borderBottomWidth: 1, borderColor: colors.border },
  chipsRow: { paddingHorizontal: spacing.lg, alignItems: "center", gap: spacing.sm, height: 56 },
  chip: { height: 36, paddingHorizontal: spacing.md, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", flexShrink: 0, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.brand },
  chipText: { color: colors.onSurface, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  chipTextActive: { color: colors.onSurfaceInverse },
  stageHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 2, borderColor: colors.borderStrong },
  stageHeaderText: { fontSize: 12, fontWeight: "900", letterSpacing: 2, color: colors.onSurface },
  stageCount: { fontSize: 12, fontWeight: "900", color: colors.onSurfaceSecondary, letterSpacing: 1 },
  card: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  company: { flex: 1, fontSize: 14, fontWeight: "800", color: colors.onSurface },
  value: { fontSize: 14, fontWeight: "900", color: colors.onSurface },
  cardMeta: { flexDirection: "row", marginTop: 2, gap: 4 },
  contact: { fontSize: 11, color: colors.onSurfaceSecondary, fontWeight: "700" },
  sheetStage: { fontSize: 11, color: colors.onSurfaceSecondary, fontStyle: "italic" },
  location: { fontSize: 11, color: colors.onSurfaceSecondary, marginTop: 2 },
  expDate: { fontSize: 10, color: colors.onSurfaceSecondary, marginTop: 4, letterSpacing: 1, fontWeight: "700" },
  cardActions: { flexDirection: "row", marginTop: spacing.md, gap: spacing.sm },
  actionBtn: { flex: 1, borderWidth: 2, borderColor: colors.borderStrong, paddingVertical: spacing.sm, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  actionBtnPrimary: { flex: 2, backgroundColor: colors.brand, paddingVertical: spacing.sm, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  actionText: { color: colors.onSurface, fontWeight: "800", fontSize: 11, letterSpacing: 1 },
  actionTextPrimary: { color: colors.onSurfaceInverse, fontWeight: "800", fontSize: 11, letterSpacing: 1 },
  emptyRow: { padding: spacing.xl, alignItems: "center" },
  emptyText: { fontSize: 12, color: colors.onSurfaceSecondary, letterSpacing: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
});
