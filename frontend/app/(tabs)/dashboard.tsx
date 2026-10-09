import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, formatINR, formatShortDate } from "@/src/theme";
import { PeriodSelector, Period } from "@/src/components/PeriodSelector";
import { LastSynced } from "@/src/components/LastSynced";

function todayIso() { return new Date().toISOString().slice(0, 10); }

export default function Dashboard() {
  const router = useRouter();
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("month");
  const [refDate, setRefDate] = useState<string>(todayIso());
  const [data, setData] = useState<any>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (forceSync = false, p: Period = period, r: string = refDate) => {
    try {
      setError(null);
      if (forceSync) {
        try { await api.syncSheets(); } catch (e) { console.log("sync err", e); }
      }
      const [d, s] = await Promise.all([api.dashboard(p, r), api.syncStatus()]);
      setData(d);
      setSyncedAt(s?.synced_at || null);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period, refDate]);

  useEffect(() => { load(false); }, []);
  useEffect(() => { load(false, period, refDate); }, [period, refDate]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.brand} size="large" />
      </SafeAreaView>
    );
  }
  if (error || !data) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorBox} testID="dashboard-error">
          <Text style={styles.errorCode}>ERR / DASHBOARD</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => load()}>
            <Text style={styles.retryText}>RETRY</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const pct = data.monthly.target > 0
    ? Math.min(100, Math.round((data.monthly.placement / data.monthly.target) * 100)) : 0;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.headerBar}>
        <View>
          <Text style={styles.hello}>{user?.role === "manager" ? "TEAM VIEW" : "HELLO"}</Text>
          <Text style={styles.userName} numberOfLines={1}>{user?.name?.toUpperCase() || "USER"}</Text>
        </View>
        <View style={styles.headerRight}>
          <LastSynced syncedAt={syncedAt} />
          <Pressable testID="profile-button" style={styles.avatar} onPress={() => router.push("/profile")}>
            <Text style={styles.avatarText}>{(user?.name?.[0] || "U").toUpperCase()}</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(true); }}
            tintColor={colors.brand}
            title="SYNCING FROM SHEET…"
          />
        }
      >
        <PeriodSelector period={period} refDate={refDate} onChange={(p, r) => { setPeriod(p); setRefDate(r); }} />

        {/* Demands raised vs placed */}
        <View style={styles.section} testID="kpi-demands">
          <Text style={styles.sectionLabel}>DEMANDS — {period === "day" ? "SELECTED DAY" : `MTD (${data.month_label?.toUpperCase()})`}</Text>
          <View style={styles.demandsRow}>
            <View style={styles.dmCell}>
              <Text style={styles.dmValue} testID="kpi-raised">{data.counts.raised}</Text>
              <Text style={styles.dmLbl}>RAISED</Text>
            </View>
            <View style={[styles.dmCell, styles.dmCellMid]}>
              <Text style={[styles.dmValue, { color: colors.success }]} testID="kpi-placed">{data.counts.placed}</Text>
              <Text style={styles.dmLbl}>PLACED</Text>
            </View>
            <View style={styles.dmCell}>
              <Text style={styles.dmValue}>
                {data.counts.raised > 0 ? Math.round((data.counts.placed / data.counts.raised) * 100) : 0}%
              </Text>
              <Text style={styles.dmLbl}>FULFIL</Text>
            </View>
          </View>
        </View>

        {/* Placed Financials */}
        <View style={styles.section} testID="kpi-financials">
          <Text style={styles.sectionLabel}>FINANCIALS · PLACED ONLY</Text>
          <View style={styles.finRow}>
            <View style={styles.finCell}>
              <Text style={styles.finLbl}>FREIGHT</Text>
              <Text style={styles.finVal}>{formatINR(data.totals.freight)}</Text>
            </View>
            <View style={[styles.finCell, styles.finCellMid]}>
              <Text style={styles.finLbl}>COSTING</Text>
              <Text style={styles.finVal}>{formatINR(data.totals.costing)}</Text>
            </View>
            <View style={styles.finCell}>
              <Text style={styles.finLbl}>GM2</Text>
              <Text style={[styles.finVal, data.totals.gm2 < 0 && { color: colors.error }]}>
                {formatINR(data.totals.gm2)}
              </Text>
            </View>
          </View>
        </View>

        {/* Classification counts */}
        <View style={styles.section} testID="kpi-counts">
          <Text style={styles.sectionLabel}>DEMAND CLASSIFICATION</Text>
          <View style={styles.classRow}>
            <View style={styles.classCell}>
              <Text style={styles.classCount}>{data.counts.existing}</Text>
              <Text style={styles.classLbl}>EXISTING</Text>
            </View>
            <View style={[styles.classCell, styles.classCellMid]}>
              <Text style={[styles.classCount, { color: colors.warning }]}>{data.counts.new_acquisition}</Text>
              <Text style={styles.classLbl}>NEW ACQ</Text>
            </View>
            <Pressable
              testID="needs-review-cta"
              onPress={() => router.push({ pathname: "/needs-review", params: { period, refDate } })}
              style={[styles.classCell, data.counts.needs_review > 0 && styles.needsReviewCell]}
            >
              <Text style={[styles.classCount, data.counts.needs_review > 0 && { color: colors.error }]}>
                {data.counts.needs_review}
              </Text>
              <Text style={[styles.classLbl, data.counts.needs_review > 0 && { color: colors.error }]}>
                NEEDS REVIEW →
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Monthly Target */}
        <View style={styles.section} testID="kpi-monthly">
          <Text style={styles.sectionLabel}>MONTHLY TARGET vs ACHIEVED</Text>
          <View style={styles.targetHeader}>
            <Text style={styles.kpiValueMono}>{formatINR(data.monthly.placement)}</Text>
            <Text style={styles.targetTotal}>/ {formatINR(data.monthly.target)}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.progressPct}>{pct}% ACHIEVED</Text>
        </View>

        {/* 7-day trend of RAISED vs PLACED counts */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>7-DAY TREND · RAISED vs PLACED</Text>
          <View style={styles.chartRow}>
            {data.trend.map((t: any, i: number) => {
              const maxCount = Math.max(...data.trend.map((x: any) => Math.max(x.raised || 0, x.placed || 0)), 1);
              const rH = ((t.raised || 0) / maxCount) * 100;
              const pH = ((t.placed || 0) / maxCount) * 100;
              const isZero = (t.raised || 0) === 0 && (t.placed || 0) === 0;
              return (
                <View key={t.date} style={styles.chartCol}>
                  <Text style={styles.chartTop}>{(t.raised || 0) > 0 ? String(t.raised) : "0"}</Text>
                  <View style={styles.chartBars}>
                    {isZero ? (
                      <View style={styles.zeroMark} testID={`trend-zero-${i}`} />
                    ) : (
                      <>
                        <View testID={`trend-bar-raised-${i}`} style={[styles.bar, { height: `${Math.max(rH, 4)}%`, backgroundColor: colors.brand }]} />
                        <View testID={`trend-bar-placed-${i}`} style={[styles.bar, { height: `${Math.max(pH, 4)}%`, backgroundColor: colors.success, marginLeft: 2 }]} />
                      </>
                    )}
                  </View>
                  <Text style={styles.chartLabel}>{formatShortDate(t.date)}</Text>
                </View>
              );
            })}
          </View>
          <View style={styles.legendRow}>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.brand }]} /><Text style={styles.legendText}>RAISED</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.success }]} /><Text style={styles.legendText}>PLACED</Text></View>
          </View>
        </View>

        {/* Payments */}
        <Pressable
          style={styles.paymentBlock}
          onPress={() => router.push("/(tabs)/payments")}
          testID="chase-payments-btn"
        >
          <View style={styles.paymentRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.paymentLabel}>OUTSTANDING</Text>
              <Text style={styles.paymentValue}>{formatINR(data.payments.outstanding)}</Text>
            </View>
            <View style={styles.divider} />
            <View style={{ flex: 1, paddingLeft: spacing.md }}>
              <Text style={[styles.paymentLabel, { color: colors.error }]}>OVERDUE</Text>
              <Text style={[styles.paymentValue, { color: colors.error }]}>{formatINR(data.payments.overdue)}</Text>
            </View>
          </View>
          <View style={styles.chaseCta}>
            <Text style={styles.chaseText}>CHASE PAYMENTS</Text>
            <Ionicons name="arrow-forward" size={16} color={colors.onSurfaceInverse} />
          </View>
        </Pressable>

        <Pressable style={styles.section} onPress={() => router.push("/(tabs)/pipeline")} testID="kpi-pipeline">
          <Text style={styles.sectionLabel}>ACTIVE PIPELINE</Text>
          <View style={styles.pipelineRow}>
            <View><Text style={styles.kpiTitle}>DEALS</Text><Text style={styles.kpiValueMono}>{data.pipeline.count}</Text></View>
            <View><Text style={styles.kpiTitle}>WEIGHTED VALUE</Text><Text style={styles.kpiValueMono}>{formatINR(data.pipeline.value)}</Text></View>
            <Ionicons name="chevron-forward" size={22} color={colors.brand} />
          </View>
        </Pressable>

        {/* Manager-only per-BDM breakdown */}
        {user?.role === "manager" && data.by_bdm && data.by_bdm.length > 0 ? (
          <View style={styles.section} testID="team-breakdown">
            <Text style={styles.sectionLabel}>TEAM · {data.by_bdm.length} BDMs</Text>
            {data.by_bdm.map((b: any) => {
              const fulfil = b.raised > 0 ? Math.round((b.placed / b.raised) * 100) : 0;
              return (
                <View key={b.email} style={styles.bdmRow} testID={`bdm-${b.email}`}>
                  <View style={styles.bdmLeft}>
                    <Text style={styles.bdmName} numberOfLines={1}>{b.name.toUpperCase()}</Text>
                    <Text style={styles.bdmEmail} numberOfLines={1}>{b.email}</Text>
                  </View>
                  <View style={styles.bdmMid}>
                    <Text style={styles.bdmMidVal}>{b.placed}<Text style={styles.bdmMidSep}>/{b.raised}</Text></Text>
                    <Text style={styles.bdmMidLbl}>PLACED/RAISED</Text>
                  </View>
                  <View style={styles.bdmRight}>
                    <Text style={[styles.bdmRightVal, b.gm2 < 0 && { color: colors.error }]}>
                      {formatINR(b.freight)}
                    </Text>
                    <Text style={styles.bdmRightLbl}>{fulfil}% FULFIL</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  headerBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  hello: { color: colors.onSurfaceSecondary, fontSize: 10, letterSpacing: 2 },
  userName: { color: colors.onSurface, fontSize: 20, fontWeight: "900", marginTop: 2, letterSpacing: -0.5 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  avatar: { width: 40, height: 40, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.onSurfaceInverse, fontWeight: "900" },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  section: { borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.lg, marginBottom: spacing.lg, backgroundColor: colors.surface },
  sectionLabel: { color: colors.onSurfaceSecondary, fontSize: 10, letterSpacing: 2, marginBottom: spacing.md, fontWeight: "700" },
  demandsRow: { flexDirection: "row" },
  dmCell: { flex: 1, alignItems: "center" },
  dmCellMid: { borderLeftWidth: 2, borderRightWidth: 2, borderColor: colors.borderStrong },
  dmValue: { fontSize: 34, fontWeight: "900", letterSpacing: -1, color: colors.onSurface },
  dmLbl: { fontSize: 10, letterSpacing: 2, color: colors.onSurfaceSecondary, marginTop: 4, fontWeight: "700" },
  mtRow: { flexDirection: "row", alignItems: "baseline" },
  mtValue: { fontSize: 44, fontWeight: "900", letterSpacing: -2, color: colors.onSurface },
  mtUnit: { fontSize: 14, letterSpacing: 2, marginLeft: spacing.sm, color: colors.onSurfaceSecondary, fontWeight: "700" },
  finRow: { flexDirection: "row" },
  finCell: { flex: 1 },
  finCellMid: { borderLeftWidth: 2, borderRightWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: spacing.sm },
  finLbl: { fontSize: 9, letterSpacing: 1.5, color: colors.onSurfaceSecondary, fontWeight: "700", marginBottom: 4 },
  finVal: { fontSize: 16, fontWeight: "900", color: colors.onSurface, letterSpacing: -0.5 },
  bdmRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderBottomWidth: 1, borderColor: colors.border, gap: 8 },
  bdmLeft: { flex: 1.4 },
  bdmName: { fontSize: 12, fontWeight: "900", color: colors.onSurface, letterSpacing: 0.5 },
  bdmEmail: { fontSize: 9, color: colors.onSurfaceSecondary, letterSpacing: 0.5, marginTop: 1 },
  bdmMid: { flex: 1, alignItems: "center" },
  bdmMidVal: { fontSize: 16, fontWeight: "900", color: colors.onSurface },
  bdmMidSep: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  bdmMidLbl: { fontSize: 8, letterSpacing: 1.5, color: colors.onSurfaceSecondary, marginTop: 1, fontWeight: "700" },
  bdmRight: { flex: 1, alignItems: "flex-end" },
  bdmRightVal: { fontSize: 13, fontWeight: "900", color: colors.onSurface },
  bdmRightLbl: { fontSize: 8, letterSpacing: 1, color: colors.onSurfaceSecondary, marginTop: 2, fontWeight: "700" },
  chartTop: { fontSize: 10, fontWeight: "800", color: colors.onSurfaceSecondary, marginBottom: 4, letterSpacing: 0.5 },
  zeroMark: { width: 12, height: 2, backgroundColor: colors.border, alignSelf: "center", marginTop: "auto" },
  classRow: { flexDirection: "row" },
  classCell: { flex: 1, alignItems: "center", paddingVertical: 4 },
  classCellMid: { borderLeftWidth: 2, borderRightWidth: 2, borderColor: colors.borderStrong },
  needsReviewCell: { backgroundColor: "#FEF2F2" },
  classCount: { fontSize: 26, fontWeight: "900", color: colors.onSurface, letterSpacing: -1 },
  classLbl: { fontSize: 9, letterSpacing: 1.5, color: colors.onSurfaceSecondary, marginTop: 4, fontWeight: "700" },
  kpiTitle: { color: colors.onSurfaceSecondary, fontSize: 10, letterSpacing: 1.5, marginBottom: 4 },
  kpiValueMono: { fontSize: 22, fontWeight: "900", color: colors.onSurface, letterSpacing: -1 },
  targetHeader: { flexDirection: "row", alignItems: "flex-end" },
  targetTotal: { marginLeft: spacing.sm, marginBottom: 3, color: colors.onSurfaceSecondary, fontSize: 14 },
  progressTrack: { height: 14, backgroundColor: colors.brandTertiary, marginTop: spacing.md, borderWidth: 2, borderColor: colors.borderStrong },
  progressFill: { height: "100%", backgroundColor: colors.success },
  progressPct: { marginTop: spacing.sm, color: colors.onSurface, fontSize: 11, letterSpacing: 1.5, fontWeight: "800" },
  chartRow: { flexDirection: "row", justifyContent: "space-between", height: 140, alignItems: "flex-end" },
  chartCol: { flex: 1, alignItems: "center" },
  chartBars: { height: 110, width: "80%", flexDirection: "row", alignItems: "flex-end", justifyContent: "center" },
  bar: { width: 8, minHeight: 2 },
  chartLabel: { marginTop: 6, fontSize: 9, color: colors.onSurfaceSecondary, textAlign: "center", letterSpacing: 0.5 },
  legendRow: { flexDirection: "row", marginTop: spacing.md, gap: spacing.lg },
  legendItem: { flexDirection: "row", alignItems: "center" },
  legendDot: { width: 10, height: 10, marginRight: 6 },
  legendText: { fontSize: 10, color: colors.onSurfaceSecondary, letterSpacing: 1 },
  paymentBlock: { borderWidth: 2, borderColor: colors.error, padding: spacing.lg, marginBottom: spacing.lg, backgroundColor: colors.surface },
  paymentRow: { flexDirection: "row", alignItems: "center" },
  paymentLabel: { color: colors.onSurfaceSecondary, fontSize: 10, letterSpacing: 1.5, marginBottom: 4 },
  paymentValue: { fontSize: 22, fontWeight: "900", color: colors.onSurface, letterSpacing: -1 },
  divider: { width: 2, height: 40, backgroundColor: colors.borderStrong },
  chaseCta: { marginTop: spacing.lg, backgroundColor: colors.brand, paddingVertical: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  chaseText: { color: colors.onSurfaceInverse, fontWeight: "800", fontSize: 13, letterSpacing: 2 },
  pipelineRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  errorBox: { flex: 1, padding: spacing.lg, justifyContent: "center" },
  errorCode: { color: colors.error, fontWeight: "800", letterSpacing: 2, marginBottom: spacing.sm },
  errorText: { color: colors.onSurface, marginBottom: spacing.lg },
  retryBtn: { borderWidth: 2, borderColor: colors.borderStrong, paddingVertical: spacing.md, alignItems: "center" },
  retryText: { fontWeight: "800", letterSpacing: 2, color: colors.onSurface },
});
