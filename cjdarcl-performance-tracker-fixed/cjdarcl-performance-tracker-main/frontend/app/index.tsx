import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet, Platform } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { colors } from "@/src/theme";

export default function Index() {
  const { user, loading, processSessionId } = useAuth();

  // Web: parse #session_id or ?session_id from URL after Google Auth redirect
  useEffect(() => {
    if (Platform.OS !== "web") return;
    try {
      const hash = window.location.hash || "";
      const search = window.location.search || "";
      const hashParams = new URLSearchParams(
        hash.startsWith("#") ? hash.slice(1) : hash
      );
      const searchParams = new URLSearchParams(search);
      const sid = hashParams.get("session_id") || searchParams.get("session_id");
      if (sid) {
        processSessionId(sid).finally(() => {
          window.history.replaceState(null, "", window.location.pathname);
        });
      }
    } catch {}
  }, [processSessionId]);

  if (loading) {
    return (
      <View style={styles.center} testID="index-loading">
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;
  return <Redirect href="/(tabs)/dashboard" />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
});
