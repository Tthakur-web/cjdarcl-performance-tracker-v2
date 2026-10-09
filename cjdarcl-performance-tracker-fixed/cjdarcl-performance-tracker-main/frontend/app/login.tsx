import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Platform,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing } from "@/src/theme";

const BG_IMAGE =
  "https://images.unsplash.com/photo-1707823942892-3316eeb091a0?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2OTV8MHwxfHNlYXJjaHwyfHxtb2Rlcm4lMjBnbGFzcyUyMG9mZmljZSUyMGJ1aWxkaW5nJTIwZXh0ZXJpb3IlMjBhcmNoaXRlY3R1cmFsJTIwcGhvdG9ncmFwaHl8ZW58MHx8fHwxNzgzODM2MDgzfDA&ixlib=rb-4.1.0&q=85";

export default function Login() {
  const router = useRouter();
  const { user, loading, processSessionId, devLogin } = useAuth();
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showDev, setShowDev] = useState(false);
  const [devEmail, setDevEmail] = useState("");

  useEffect(() => {
    if (user) router.replace("/(tabs)/dashboard");
  }, [user, router]);

  // Cold start deep-link fallback (mobile only)
  useEffect(() => {
    if (Platform.OS === "web") return;
    let sub: any;
    const handleUrl = async (url: string) => {
      try {
        const parsed = Linking.parse(url);
        const sid =
          (parsed.queryParams?.session_id as string) ||
          (parsed.hostname === "session_id" ? parsed.path : undefined);
        // Also support hash fragment via manual parse
        const hashIdx = url.indexOf("#");
        let hashSid: string | undefined;
        if (hashIdx > -1) {
          const hp = new URLSearchParams(url.slice(hashIdx + 1));
          hashSid = hp.get("session_id") || undefined;
        }
        const finalSid = sid || hashSid;
        if (finalSid) {
          setBusy(true);
          await processSessionId(finalSid);
        }
      } catch (e: any) {
        setErrorMsg(String(e?.message || e));
      } finally {
        setBusy(false);
      }
    };
    (async () => {
      const initial = await Linking.getInitialURL();
      if (initial) handleUrl(initial);
    })();
    sub = Linking.addEventListener("url", ({ url }) => handleUrl(url));
    return () => sub?.remove?.();
  }, [processSessionId]);

  const onGoogleSignIn = async () => {
    setErrorMsg(null);
    setBusy(true);
    try {
      let redirectUrl: string;
      if (Platform.OS === "web") {
        redirectUrl = window.location.origin + "/";
      } else {
        redirectUrl = Linking.createURL("");
      }
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;

      if (Platform.OS === "web") {
        window.location.href = authUrl;
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      if (result.type !== "success" || !result.url) {
        setBusy(false);
        return;
      }
      const url = result.url;
      const hashIdx = url.indexOf("#");
      let sid: string | undefined;
      if (hashIdx > -1) {
        const hp = new URLSearchParams(url.slice(hashIdx + 1));
        sid = hp.get("session_id") || undefined;
      }
      if (!sid) {
        const parsed = Linking.parse(url);
        sid = (parsed.queryParams?.session_id as string) || undefined;
      }
      if (sid) {
        await processSessionId(sid);
      } else {
        setErrorMsg("No session_id returned. Please try again.");
      }
    } catch (e: any) {
      setErrorMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onDevLogin = async () => {
    if (!devEmail.trim()) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      await devLogin(devEmail.trim());
    } catch (e: any) {
      setErrorMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Image source={BG_IMAGE} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient
        colors={["rgba(17,24,39,0.35)", "rgba(17,24,39,0.95)"]}
        style={StyleSheet.absoluteFill}
      />

      {errorMsg ? (
        <View style={styles.errorBar} testID="login-error">
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      ) : null}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.kb}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.headerBlock}>
            <Text style={styles.eyebrow}>CJ DARCL / SALES OPS</Text>
            <Text style={styles.brandTitle}>PERFORMANCE{"\n"}HUB</Text>
            <Text style={styles.tagline}>
              Demands · Placements · Pipeline · Payments
            </Text>
          </View>

          <View style={styles.actionBlock}>
            <Pressable
              testID="google-signin-button"
              onPress={onGoogleSignIn}
              disabled={busy || loading}
              style={({ pressed }) => [
                styles.primaryBtn,
                (busy || loading) && { opacity: 0.6 },
                pressed && styles.primaryBtnPressed,
              ]}
            >
              {busy || loading ? (
                <ActivityIndicator color={colors.onSurface} />
              ) : (
                <Text style={styles.primaryBtnText}>SIGN IN WITH GOOGLE</Text>
              )}
            </Pressable>

            <Pressable
              testID="dev-login-toggle"
              onPress={() => setShowDev((s) => !s)}
              style={styles.devToggle}
            >
              <Text style={styles.devToggleText}>
                {showDev ? "HIDE DEV LOGIN" : "USE DEV LOGIN"}
              </Text>
            </Pressable>

            {showDev ? (
              <View style={styles.devBox}>
                <Text style={styles.devLabel}>DEV EMAIL</Text>
                <TextInput
                  testID="dev-email-input"
                  value={devEmail}
                  onChangeText={setDevEmail}
                  placeholder="amit.sharma@cjdarcl.com"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={styles.devInput}
                />
                <Pressable
                  testID="dev-login-button"
                  onPress={onDevLogin}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    pressed && { backgroundColor: colors.brandTertiary },
                  ]}
                >
                  <Text style={styles.secondaryBtnText}>DEV SIGN IN</Text>
                </Pressable>
                <Text style={styles.devHint}>
                  Try: amit.sharma@cjdarcl.com (rep) or rohit1.singh@cjdarcl.com (manager)
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.footer}>v1.0 · INTERNAL USE ONLY</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceInverse },
  kb: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: "space-between",
    padding: spacing.xl,
    paddingTop: spacing.xxxl * 1.5,
    paddingBottom: spacing.xxl,
  },
  headerBlock: { marginTop: spacing.xxl },
  eyebrow: {
    color: "#9CA3AF",
    fontSize: 12,
    letterSpacing: 3,
    marginBottom: spacing.md,
  },
  brandTitle: {
    color: colors.onSurfaceInverse,
    fontSize: 52,
    fontWeight: "900",
    lineHeight: 54,
    letterSpacing: -1,
  },
  tagline: {
    color: "#D1D5DB",
    fontSize: 13,
    marginTop: spacing.lg,
    letterSpacing: 1,
  },
  actionBlock: { marginTop: spacing.xxl },
  primaryBtn: {
    backgroundColor: colors.onSurfaceInverse,
    paddingVertical: 20,
    alignItems: "center",
    borderWidth: 2,
    borderColor: colors.onSurfaceInverse,
  },
  primaryBtnPressed: { backgroundColor: colors.brandTertiary },
  primaryBtnText: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 2,
  },
  devToggle: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  devToggleText: {
    color: "#9CA3AF",
    fontSize: 11,
    letterSpacing: 2,
    textDecorationLine: "underline",
  },
  devBox: {
    marginTop: spacing.md,
    borderWidth: 2,
    borderColor: "#374151",
    padding: spacing.lg,
    backgroundColor: "rgba(17,24,39,0.6)",
  },
  devLabel: {
    color: "#9CA3AF",
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: spacing.xs,
  },
  devInput: {
    borderBottomWidth: 2,
    borderColor: "#374151",
    color: colors.onSurfaceInverse,
    paddingVertical: spacing.sm,
    fontSize: 15,
    marginBottom: spacing.lg,
  },
  secondaryBtn: {
    borderWidth: 2,
    borderColor: colors.onSurfaceInverse,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryBtnText: {
    color: colors.onSurfaceInverse,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 2,
  },
  devHint: {
    marginTop: spacing.md,
    color: "#9CA3AF",
    fontSize: 11,
    lineHeight: 15,
  },
  errorBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.error,
    paddingTop: 44,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    zIndex: 10,
  },
  errorText: {
    color: colors.onError,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  footer: {
    color: "#6B7280",
    fontSize: 10,
    letterSpacing: 2,
    textAlign: "center",
  },
});
