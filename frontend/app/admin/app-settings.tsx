import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, shadows } from '@/src/theme';
import { PrimaryButton, inputStyle } from '@/src/ui';
import { api } from '@/src/api';

export default function AdminAppSettings() {
  const router = useRouter();
  const [rate, setRate] = useState('0.38');
  const [saved, setSaved] = useState(false);
  const [gameRates, setGameRates] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<any[]>([]);
  const [crashLive, setCrashLive] = useState<any>(null);
  const [wingoLive, setWingoLive] = useState<any>(null);
  const [dtLive, setDtLive] = useState<any>(null);

  useEffect(() => {
    const poll = setInterval(() => {
      api.liveState().then(setCrashLive).catch(() => {});
      api.wingoState(60).then(setWingoLive).catch(() => {});
      api.dtLiveState().then(setDtLive).catch(() => {});
    }, 2000);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    api.adminGetPayment().then(c => {
      setRate(String(c?.player_win_rate ?? 0.38));
      const gr = c?.game_win_rates || {};
      const asStr: Record<string, string> = {};
      Object.keys(gr).forEach(k => { asStr[k] = String(gr[k]); });
      setGameRates(asStr);
    });
    api.adminGameStats().then((d: any) => setStats(d.stats || []));
  }, []);

  const save = async () => { try { const r = await api.adminUpdateAppSettings({ player_win_rate: parseFloat(rate) }); setRate(String(r.player_win_rate)); setSaved(true); setTimeout(() => setSaved(false), 1500); } catch (e: any) { alert(e.message); } };

  const saveGameRate = async (game: string) => {
    try {
      const val = parseFloat(gameRates[game] ?? '0.38');
      await api.adminUpdateAppSettings({ game_win_rates: { [game]: val } });
      setSaved(true); setTimeout(() => setSaved(false), 1500);
    } catch (e: any) { alert(e.message); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <SafeAreaView edges={['top']} style={s.header}>
        <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={s.title}>App Settings</Text>
        <View style={{ width: 22 }} />
      </SafeAreaView>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <View style={s.card}>
          <Text style={s.section}>Global Win Rate</Text>
          <Text style={s.lbl}>Player Win Rate (0.0 - 1.0)</Text>
          <TextInput testID="win-rate" style={inputStyle.base} value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
          <Text style={s.hint}>Current: {(parseFloat(rate || '0') * 100).toFixed(0)}% win · {(100 - parseFloat(rate || '0') * 100).toFixed(0)}% loss.  Default 38% / 62%.</Text>
        </View>
        <PrimaryButton testID="save-settings" label={saved ? 'Saved ✓' : 'Save Settings'} onPress={save} />

        <View style={{ height: 20 }} />

        <View style={s.card}>
          <Text style={s.section}>Live Round Totals</Text>
          <View style={s.gameRow}>
            <Text style={s.gameName}>CRASH / AVIATOR</Text>
            <Text style={s.statLine}>
              Status: {crashLive?.status?.toUpperCase() ?? '—'} · Players: {crashLive?.round_player_count ?? 0}
            </Text>
            <Text style={s.statLine}>
              Total in pot: ₹{crashLive?.round_total_bet ?? 0}
            </Text>
          </View>
          <View style={s.gameRow}>
            <Text style={s.gameName}>WIN GO (60s)</Text>
            <Text style={s.statLine}>
              Time left: {wingoLive?.time_left ?? '—'}s · Players: {wingoLive?.round_player_count ?? 0}
            </Text>
            <Text style={s.statLine}>
              Total in pot: ₹{wingoLive?.round_total_bet ?? 0}
            </Text>
          </View>
          <View style={s.gameRow}>
            <Text style={s.gameName}>DRAGON TIGER</Text>
            <Text style={s.statLine}>
              Status: {dtLive?.status?.toUpperCase() ?? '—'} · Players: {dtLive?.round_player_count ?? 0}
            </Text>
            <Text style={s.statLine}>
              Total in pot: ₹{dtLive?.round_total_bet ?? 0}
            </Text>
          </View>
        </View>

        <View style={{ height: 20 }} />

        <View style={s.card}>
          <Text style={s.section}>Game-wise Stats & Win Rate</Text>
          {stats.length === 0 && <Text style={s.hint}>No bets placed yet.</Text>}
          {stats.map((st) => (
            <View key={st.game} style={s.gameRow}>
              <Text style={s.gameName}>{st.game.toUpperCase()}</Text>
              <Text style={s.statLine}>Bet: ₹{st.total_bet} · Won: ₹{st.total_win} · Profit: ₹{st.net_profit}</Text>
              <Text style={s.statLine}>Rounds: {st.bet_count} · Actual win rate: {(st.actual_win_rate * 100).toFixed(1)}%</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'center' }}>
                <TextInput
                  style={[inputStyle.base, { flex: 1 }]}
                  value={gameRates[st.game] ?? ''}
                  onChangeText={(v) => setGameRates((g) => ({ ...g, [st.game]: v }))}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 0.38"
                />
                <Pressable onPress={() => saveGameRate(st.game)} style={s.smallBtn}>
                  <Text style={s.smallBtnText}>Set</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, backgroundColor: '#fff', ...shadows.soft },
  title: { fontSize: 17, fontWeight: '800', color: colors.onSurface },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md, ...shadows.card },
  section: { fontSize: 14, fontWeight: '800', color: colors.onSurface, marginBottom: 10 },
  lbl: { fontSize: 13, fontWeight: '700', color: colors.onSurfaceSecondary, marginBottom: 8 },
  hint: { color: colors.onSurfaceMuted, fontSize: 12, marginTop: 8 },
  gameRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 12 },
  gameName: { fontSize: 14, fontWeight: '800', color: colors.onSurface, marginBottom: 4 },
  statLine: { fontSize: 12, color: colors.onSurfaceMuted, marginBottom: 2 },
  smallBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  smallBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
