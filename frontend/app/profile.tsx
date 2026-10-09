import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api/client";
import { colors, spacing } from "@/src/theme";

export default function Profile() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.syncStatus();
      setSyncStatus(s);
    } catch {}
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleLogout = async () => {
    await signOut();
    router.replace("/login");
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await api.syncSheets();
      setSyncMsg(
        `SYNCED · ${r.daily_records} daily · ${r.pipeline_deals} deals · ${r.customers} customers · ${r.payments} payments`
      );
      await loadStatus();
    } catch (e: any) {
      setSyncMsg(`SYNC FAILED: ${String(e?.message || e)}`);
    } finally {
      setSyncing(false);
    }
  };

  const lastSync = syncStatus?.synced_at
    ? new Date(syncStatus.synced_at).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "NEVER";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          testID="profile-back"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>PROFILE</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.userBlock}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(user?.name?.[0] || "U").toUpperCase()}
            </Text>
          </View>
          <Text style={styles.userName}>{user?.name?.toUpperCase()}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>
          <View
            style={[
              styles.rolePill,
              user?.role === "manager" ? styles.roleManager : styles.roleRep,
            ]}
          >
            <Text
              style={[
                styles.rolePillText,
                user?.role === "manager"
                  ? { color: colors.onSurfaceInverse }
                  : { color: colors.onSurface },
              ]}
            >
              {user?.role === "manager" ? "MANAGER · TEAM VIEW" : "SALES REP"}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>GOOGLE SHEET SYNC</Text>
          <View style={styles.settingRow}>
            <Text style={styles.settingKey}>LAST SYNC</Text>
            <Text style={styles.settingVal}>{lastSync}</Text>
          </View>
          {syncStatus?.synced_at ? (
            <>
              <View style={styles.settingRow}>
                <Text style={styles.settingKey}>DAILY ROWS</Text>
                <Text style={styles.settingVal}>{syncStatus.daily_records}</Text>
              </View>
              <View style={styles.settingRow}>
                <Text style={styles.settingKey}>PIPELINE</Text>
                <Text style={styles.settingVal}>{syncStatus.pipeline_deals}</Text>
              </View>
              <View style={styles.settingRow}>
                <Text style={styles.settingKey}>CUSTOMERS</Text>
                <Text style={styles.settingVal}>{syncStatus.customers}</Text>
              </View>
              <View style={styles.settingRow}>
                <Text style={styles.settingKey}>PAYMENTS</Text>
                <Text style={styles.settingVal}>{syncStatus.payments}</Text>
              </View>
            </>
          ) : null}
          <Pressable
            testID="sync-button"
            onPress={handleSync}
            disabled={syncing}
            style={({ pressed }) => [
              styles.syncBtn,
              pressed && { opacity: 0.85 },
              syncing && { opacity: 0.6 },
            ]}
          >
            {syncing ? (
              <ActivityIndicator color={colors.onSurfaceInverse} />
            ) : (
              <>
                <Ionicons name="refresh" size={16} color={colors.onSurfaceInverse} />
                <Text style={styles.syncBtnText}>SYNC NOW</Text>
              </>
            )}
          </Pressable>
          {syncMsg ? (
            <Text
              style={[
                styles.syncMsg,
                syncMsg.startsWith("SYNC FAILED") && { color: colors.error },
              ]}
            >
              {syncMsg}
            </Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ACCESS</Text>
          <View style={styles.settingRow}>
            <Text style={styles.settingKey}>VISIBILITY</Text>
            <Text style={styles.settingVal}>
              {user?.role === "manager" ? "ALL REPS" : "OWN ROWS"}
            </Text>
          </View>
        </View>

        <Pressable
          testID="logout-button"
          style={styles.logoutBtn}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.onError} />
          <Text style={styles.logoutText}>SIGN OUT</Text>
        </Pressable>

        <Text style={styles.footer}>v1.0 · INTERNAL USE ONLY</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: colors.borderStrong,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 2,
    color: colors.onSurface,
  },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  userBlock: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 76,
    height: 76,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  avatarText: {
    color: colors.onSurfaceInverse,
    fontSize: 28,
    fontWeight: "900",
  },
  userName: {
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.5,
    color: colors.onSurface,
  },
  userEmail: {
    fontSize: 12,
    color: colors.onSurfaceSecondary,
    marginTop: 4,
  },
  rolePill: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: 2,
  },
  roleManager: { backgroundColor: colors.brand, borderColor: colors.brand },
  roleRep: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
  rolePillText: { fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  section: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    fontSize: 10,
    letterSpacing: 2,
    color: colors.onSurfaceSecondary,
    fontWeight: "700",
    marginBottom: spacing.md,
  },
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  settingKey: { fontSize: 11, color: colors.onSurfaceSecondary, letterSpacing: 1.5 },
  settingVal: { fontSize: 13, color: colors.onSurface, fontWeight: "800" },
  syncBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.brand,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  syncBtnText: {
    color: colors.onSurfaceInverse,
    fontWeight: "900",
    fontSize: 13,
    letterSpacing: 2,
  },
  syncMsg: {
    marginTop: spacing.md,
    fontSize: 11,
    color: colors.success,
    letterSpacing: 0.5,
    lineHeight: 16,
    fontWeight: "700",
  },
  logoutBtn: {
    backgroundColor: colors.error,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: spacing.sm,
  },
  logoutText: {
    color: colors.onError,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 2,
  },
  footer: {
    marginTop: spacing.xl,
    textAlign: "center",
    color: colors.onSurfaceSecondary,
    fontSize: 10,
    letterSpacing: 2,
  },
});
