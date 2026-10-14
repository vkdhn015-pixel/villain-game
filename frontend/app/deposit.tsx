import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { colors, spacing, radius, shadows } from '@/src/theme';
import { PrimaryButton, inputStyle } from '@/src/ui';
import { api } from '@/src/api';

const QUICK = [500, 1000, 2000, 5000, 10000];

export default function Deposit() {
  const router = useRouter();
  const [cfg, setCfg] = useState<any>(null);
  const [amount, setAmount] = useState('');
  const [utr, setUtr] = useState('');
  const [tab, setTab] = useState<'upi' | 'qr' | 'card'>('upi');
  const [secondsLeft, setSecondsLeft] = useState(15 * 60);
  const [qrSession, setQrSession] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { api.paymentConfig().then(setCfg).catch(() => {}); }, []);

  // Build a fresh UPI payment URI from the Admin Panel's configured URI.
  // The amount is encoded into the QR itself, so changing the amount updates it.
  const qrValue = useMemo(() => {
    const raw = String(cfg?.qr_data || '').trim();
    const amt = Number(amount);
    if (!raw || !Number.isFinite(amt) || amt <= 0) return '';
    try {
      const uri = new URL(raw);
      uri.searchParams.set('am', amt.toFixed(2).replace(/\.00$/, ''));
      uri.searchParams.set('cu', 'INR');
      return uri.toString();
    } catch {
      // If Admin Panel contains an invalid UPI URI, do not create a misleading QR.
      return '';
    }
  }, [cfg?.qr_data, amount]);

  // Each QR session is valid for 15 minutes on this screen. Refreshing the amount
  // or tapping refresh starts a new countdown; this is a UI timer, not payment verification.
  useEffect(() => {
    if (!qrValue) {
      setSecondsLeft(15 * 60);
      return;
    }
    setSecondsLeft(15 * 60);
    const timer = setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [qrValue, qrSession]);

  const timerLabel = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`;

  const copy = async (_t: string) => {};

  const submit = async () => {
    setMsg(null);
    const amt = parseFloat(amount);
    if (!amt || amt < (cfg?.min_deposit || 100)) { setMsg({ ok: false, text: `Min deposit ₹${cfg?.min_deposit || 100}` }); return; }
    if (!utr || utr.length < 4) { setMsg({ ok: false, text: 'Enter valid UTR / reference number' }); return; }
    setLoading(true);
    try {
      await api.createDeposit({ amount: amt, utr, method: tab });
      setMsg({ ok: true, text: 'Deposit request submitted. Awaiting approval.' });
      setAmount(''); setUtr('');
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#F3F1FB' }}>
      <LinearGradient colors={['#17133B', '#3B267D', '#1bdafcfb']}>
        <SafeAreaView edges={['top']} style={styles.header}>
          <Pressable onPress={() => router.back()} testID="back-btn"><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
          <Text style={styles.title}>Deposit</Text>
          <View style={{ width: 22 }} />
        </SafeAreaView>
      </LinearGradient>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.label}>Amount (₹)</Text>
          <TextInput testID="amount-input" style={inputStyle.base} value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="Enter amount" placeholderTextColor={colors.onSurfaceMuted} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 10 }}>
            {QUICK.map(v => (
              <Pressable
                key={v}
                testID={`quick-${v}`}
                onPress={() => setAmount(String(v))}
                style={[styles.quickChip, Number(amount) === v && styles.quickChipSelected]}
                accessibilityState={{ selected: Number(amount) === v }}
              >
                <Text style={[styles.quickText, Number(amount) === v && styles.quickTextSelected]}>₹{v}</Text>
                {Number(amount) === v && <Ionicons name="checkmark-circle" size={14} color="#FFFFFF" />}
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={styles.segment}>
          {(['upi', 'qr', 'card'] as const).map(k => (
            <Pressable key={k} testID={`method-${k}`} onPress={() => setTab(k)} style={[styles.segBtn, tab === k && styles.segActive]}>
              <Text style={[styles.segLabel, tab === k && styles.segLabelActive]}>{k === 'upi' ? 'UPI Transfer' : k === 'qr' ? 'Scan QR' : 'Card Payment'}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.card}>
          {tab === 'upi' ? (
            <View>
              <Text style={styles.hint}>Send money to any UPI ID below, then paste the UTR / reference number.</Text>
              {(cfg?.upi_ids || []).map((id: string) => (
                <Pressable key={id} testID={`upi-${id}`} onPress={() => copy(id)} style={styles.upiRow}>
                  <View style={styles.upiIcon}><Ionicons name="at" size={18} color="#FF6B6B" /></View>
                  <Text style={styles.upiText}>{id}</Text>
                  <Ionicons name="copy-outline" size={18} color={colors.onSurfaceMuted} />
                </Pressable>
              ))}
            </View>
          ) : tab === 'qr' ? (
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.hint}>Enter the amount above first. This QR will encode that exact amount.</Text>
              {qrValue && secondsLeft > 0 ? (
                <>
                  <View style={styles.timerPill}>
                    <Ionicons name="time-outline" size={17} color={secondsLeft <= 60 ? '#D64545' : '#5B3BC4'} />
                    <Text style={[styles.timerText, secondsLeft <= 60 && { color: '#D64545' }]}>QR expires in {timerLabel}</Text>
                  </View>
                  <View style={styles.qrFrame}>
                    <QRCode value={qrValue} size={220} ecl="M" />
                  </View>
                  <Text style={styles.payAmount}>Pay exactly ₹{Number(amount).toLocaleString('en-IN')}</Text>
                  <Text style={styles.qrNote}>Complete payment before the timer ends.</Text>
                </>
              ) : qrValue && secondsLeft <= 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: 22 }}>
                  <Ionicons name="alert-circle-outline" size={42} color="#D64545" />
                  <Text style={styles.expiredTitle}>QR session expired</Text>
                  <Text style={styles.hint}>Refresh the QR before making your payment.</Text>
                  <Pressable style={styles.refreshButton} onPress={() => setQrSession((n) => n + 1)}>
                    <Ionicons name="refresh" size={17} color="#fff" />
                    <Text style={styles.refreshText}>Refresh QR · 15 min</Text>
                  </Pressable>
                </View>
              ) : <Text style={{ color: colors.onSurfaceMuted, marginTop: 12, textAlign: 'center' }}>QR unavailable. Check the Admin Panel UPI URI and enter a valid amount.</Text>}
            </View>
          ) : (
            <View style={styles.cardPaymentBox}>
              <View style={styles.cardPaymentIcon}><Ionicons name="card-outline" size={30} color="#fff" /></View>
              <Text style={styles.cardPaymentTitle}>Debit / Credit Card</Text>
              <Text style={styles.cardPaymentSubtitle}>Visa · Mastercard · RuPay</Text>
              <Text style={styles.cardPaymentBody}>Card checkout will be available after a payment gateway is connected and its merchant credentials are configured.</Text>
              <View style={styles.gatewayNotice}>
                <Ionicons name="lock-closed-outline" size={17} color="#7A61D1" />
                <Text style={styles.gatewayNoticeText}>Secure gateway setup required</Text>
              </View>
              <View style={styles.cardPayDisabled}>
                <Text style={styles.cardPayDisabledText}>Card payments not enabled yet</Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>UTR / Reference Number</Text>
          <TextInput testID="utr-input" style={inputStyle.base} value={utr} onChangeText={setUtr} placeholder="12-digit reference" placeholderTextColor={colors.onSurfaceMuted} />
        </View>

        {msg && <View style={[styles.msg, { backgroundColor: msg.ok ? '#E7F8EE' : '#FDECEC' }]}>
          <Text style={{ color: msg.ok ? '#2ECA7F' : '#FF4D4F', fontWeight: '700' }}>{msg.text}</Text>
        </View>}

        {tab !== 'card' && (
          <Pressable
            testID="submit-deposit"
            onPress={submit}
            disabled={loading}
            style={({ pressed }) => [styles.confirmButton, pressed && styles.confirmButtonPressed, loading && styles.confirmButtonLoading]}
            accessibilityRole="button"
          >
            <LinearGradient
              colors={loading ? ['#8E83B8', '#70639D'] : ['#611507', '#130499']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.confirmButtonGradient}
            >
              <Ionicons name={loading ? 'hourglass-outline' : 'shield-checkmark'} size={20} color="#FFFFFF" />
              <Text style={styles.confirmButtonText}>{loading ? 'Processing...' : 'Confirm Deposit'}</Text>
              {!loading && <Ionicons name="arrow-forward-circle" size={21} color="#FFFFFF" />}
            </LinearGradient>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: '#E6E0FA', ...shadows.card },
  label: { fontSize: 13, fontWeight: '700', color: colors.onSurfaceSecondary, marginBottom: 8 },
  hint: { fontSize: 12, color: colors.onSurfaceMuted, marginBottom: 8 },
  quickChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: '#F0ECFF', borderWidth: 1, borderColor: '#BEB0F2' },
  quickChipSelected: { backgroundColor: '#5634B5', borderColor: '#39217F', shadowColor: '#5634B5', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.28, shadowRadius: 5, elevation: 4 },
  quickText: { color: '#5634B5', fontWeight: '800', fontSize: 13 },
  quickTextSelected: { color: '#FFFFFF' },
  confirmButton: { borderRadius: 17, overflow: 'hidden', marginTop: 2, marginBottom: 12, shadowColor: '#E56D14', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.28, shadowRadius: 8, elevation: 5 },
  confirmButtonPressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
  confirmButtonLoading: { shadowOpacity: 0.08, elevation: 1 },
  confirmButtonGradient: { minHeight: 56, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  confirmButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', letterSpacing: 0.2 },
  segment: { flexDirection: 'row', backgroundColor: '#E7E1FA', borderRadius: 18, padding: 4, marginBottom: spacing.md, ...shadows.soft },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14 },
  segActive: { backgroundColor: '#5634B5' },
  segLabel: { fontSize: 13, fontWeight: '700', color: colors.onSurfaceSecondary },
  segLabelActive: { color: '#fff' },
  upiRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  upiIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  upiText: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.onSurface },
  msg: { padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md },
  timerPill: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, backgroundColor: '#F0ECFF', marginTop: 8 },
  timerText: { color: '#5634B5', fontSize: 13, fontWeight: '800' },
  qrFrame: { backgroundColor: '#FFFFFF', padding: 14, marginTop: 12, borderRadius: 20, borderWidth: 1, borderColor: '#DDD4FA' },
  payAmount: { color: '#261B4A', fontWeight: '900', fontSize: 17, marginTop: 12 },
  qrNote: { color: '#77708F', fontSize: 12, marginTop: 5, textAlign: 'center' },
  expiredTitle: { color: '#261B4A', fontWeight: '900', fontSize: 17, marginTop: 8, marginBottom: 5 },
  refreshButton: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#5634B5', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 13, marginTop: 10 },
  refreshText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  cardPaymentBox: { alignItems: 'center', paddingVertical: 12 },
  cardPaymentIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: '#5634B5', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  cardPaymentTitle: { color: '#261B4A', fontSize: 18, fontWeight: '900' },
  cardPaymentSubtitle: { color: '#7A61D1', fontSize: 12, fontWeight: '800', marginTop: 5 },
  cardPaymentBody: { color: '#77708F', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 12 },
  gatewayNotice: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#F0ECFF', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, marginTop: 16 },
  gatewayNoticeText: { color: '#5634B5', fontWeight: '800', fontSize: 12 },
  cardPayDisabled: { backgroundColor: '#E7E3F0', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 18, width: '100%', alignItems: 'center', marginTop: 14 },
  cardPayDisabledText: { color: '#827B98', fontWeight: '800', fontSize: 13 },
});
