import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, shadows } from '@/src/theme';
import { PrimaryButton, inputStyle } from '@/src/ui';
import { api } from '@/src/api';

type Method = 'upi' | 'bank';

export default function Withdraw() {
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>('upi');
  const [upi, setUpi] = useState('');
  const [name, setName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [confirmAccountNumber, setConfirmAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.me().then(m => { setMe(m); setName(m?.name || ''); }).catch(() => {});
    api.paymentConfig().then(setCfg).catch(() => {});
  }, []);

  const selectMethod = (next: Method) => { setMethod(next); setMsg(null); };

  const submit = async () => {
    setMsg(null);
    const amt = Number(amount);
    const min = Number(cfg?.min_withdraw ?? 200);
    const max = Number(cfg?.max_withdraw ?? 100000);
    if (!Number.isFinite(amt) || amt <= 0 || amt < min) {
      setMsg({ ok: false, text: `Minimum withdrawal ₹${min}` }); return;
    }
    if (amt > max) { setMsg({ ok: false, text: `Maximum withdrawal ₹${max}` }); return; }
    if (!name.trim()) { setMsg({ ok: false, text: 'Enter account holder name' }); return; }
    if (method === 'upi') {
      if (!/^[\w.\-]{2,}@[\w.-]{2,}$/.test(upi.trim())) {
        setMsg({ ok: false, text: 'Enter a valid UPI ID' }); return;
      }
    } else {
      const acct = accountNumber.trim();
      if (!/^\d{8,18}$/.test(acct)) { setMsg({ ok: false, text: 'Account number must contain 8–18 digits' }); return; }
      if (acct !== confirmAccountNumber.trim()) { setMsg({ ok: false, text: 'Account numbers do not match' }); return; }
      if (!/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(ifsc.trim().toUpperCase())) {
        setMsg({ ok: false, text: 'Enter a valid IFSC code' }); return;
      }
    }
    setLoading(true);
    try {
      await api.createWithdraw(method === 'upi'
        ? { amount: amt, method, upi_id: upi.trim(), account_name: name.trim() }
        : { amount: amt, method, account_name: name.trim(), account_number: accountNumber.trim(), ifsc_code: ifsc.trim().toUpperCase() });
      setMsg({ ok: true, text: 'Withdrawal request submitted. Awaiting admin approval and payment processing.' });
      setAmount(''); setUpi(''); setAccountNumber(''); setConfirmAccountNumber(''); setIfsc('');
      setMe(await api.me());
    } catch (e: any) { setMsg({ ok: false, text: e.message || 'Unable to submit withdrawal request' }); }
    finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
      <LinearGradient colors={['#28105C', '#5421A8', '#7A32C8']}>
        <SafeAreaView edges={['top']} style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn"><Ionicons name="chevron-back" size={23} color="#fff" /></Pressable>
          <View style={{ flex: 1 }}><Text style={styles.headerTitle}>Withdraw Funds</Text><Text style={styles.headerSub}>Choose where to receive your payout</Text></View>
          <View style={{ width: 42 }} />
        </SafeAreaView>
      </LinearGradient>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <LinearGradient colors={['#3A176D', '#251044']} style={styles.balanceCard}>
          <View style={styles.balanceTop}><View style={styles.walletIcon}><Ionicons name="wallet-outline" size={22} color="#E5C7FF" /></View><Text style={styles.balanceLabel}>AVAILABLE BALANCE</Text></View>
          <Text style={styles.balance}>₹{Number(me?.balance ?? 0).toFixed(2)}</Text>
          <Text style={styles.balanceFoot}>Select a withdrawal method below</Text>
        </LinearGradient>

        <Text style={styles.sectionTitle}>Withdrawal method</Text>
        <View style={styles.methodRow}>
          <Pressable onPress={() => selectMethod('upi')} style={[styles.methodCard, method === 'upi' && styles.methodSelected]}>
            <View style={[styles.methodIcon, method === 'upi' && styles.methodIconSelected]}><Ionicons name="phone-portrait-outline" size={22} color={method === 'upi' ? '#fff' : '#B9A6D7'} /></View>
            <Text style={[styles.methodTitle, method === 'upi' && styles.selectedText]}>UPI ID</Text><Text style={styles.methodDesc}>Instant ID entry</Text>
            {method === 'upi' && <Ionicons name="checkmark-circle" size={18} color="#D9B8FF" style={styles.check} />}
          </Pressable>
          <Pressable onPress={() => selectMethod('bank')} style={[styles.methodCard, method === 'bank' && styles.methodSelected]}>
            <View style={[styles.methodIcon, method === 'bank' && styles.methodIconSelected]}><Ionicons name="business-outline" size={22} color={method === 'bank' ? '#fff' : '#B9A6D7'} /></View>
            <Text style={[styles.methodTitle, method === 'bank' && styles.selectedText]}>Bank Account</Text><Text style={styles.methodDesc}>Account number + IFSC</Text>
            {method === 'bank' && <Ionicons name="checkmark-circle" size={18} color="#D9B8FF" style={styles.check} />}
          </Pressable>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.sectionTitle}>Payout details</Text>
          <Text style={styles.label}>Account holder name</Text>
          <TextInput testID="withdraw-name" style={styles.input} value={name} onChangeText={setName} placeholder="Name registered with your account" placeholderTextColor="#9B8BB2" autoCapitalize="words" />
          {method === 'upi' ? <>
            <Text style={styles.label}>UPI ID</Text>
            <TextInput testID="withdraw-upi" style={styles.input} value={upi} onChangeText={setUpi} placeholder="username@upi" placeholderTextColor="#9B8BB2" autoCapitalize="none" autoCorrect={false} />
          </> : <>
            <Text style={styles.label}>Bank account number</Text>
            <TextInput testID="withdraw-account-number" style={styles.input} value={accountNumber} onChangeText={v => setAccountNumber(v.replace(/\D/g, '').slice(0, 18))} placeholder="Enter account number" placeholderTextColor="#9B8BB2" keyboardType="number-pad" />
            <Text style={styles.label}>Confirm account number</Text>
            <TextInput testID="withdraw-confirm-account-number" style={styles.input} value={confirmAccountNumber} onChangeText={v => setConfirmAccountNumber(v.replace(/\D/g, '').slice(0, 18))} placeholder="Re-enter account number" placeholderTextColor="#9B8BB2" keyboardType="number-pad" />
            <Text style={styles.label}>IFSC code</Text>
            <TextInput testID="withdraw-ifsc" style={styles.input} value={ifsc} onChangeText={v => setIfsc(v.toUpperCase().replace(/\s/g, '').slice(0, 11))} placeholder="e.g. SBIN0001234" placeholderTextColor="#9B8BB2" autoCapitalize="characters" autoCorrect={false} maxLength={11} />
            <View style={styles.secureNote}><Ionicons name="shield-checkmark-outline" size={16} color="#C9A5FF" /><Text style={styles.secureText}>Check the account number and IFSC carefully before submitting.</Text></View>
          </>}
        </View>

        <View style={styles.formCard}>
          <Text style={styles.sectionTitle}>Withdrawal amount</Text>
          <TextInput testID="withdraw-amount" style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Enter amount in ₹" placeholderTextColor="#9B8BB2" />
          <Text style={styles.hint}>Minimum ₹{cfg?.min_withdraw ?? 200} · Maximum ₹{cfg?.max_withdraw ?? 100000}</Text>
        </View>

        {msg && <View style={[styles.msg, { backgroundColor: msg.ok ? '#173E35' : '#4A202E', borderColor: msg.ok ? '#2CA77A' : '#D65A72' }]}><Ionicons name={msg.ok ? 'checkmark-circle' : 'alert-circle'} size={18} color={msg.ok ? '#62E2B0' : '#FF9BAE'} /><Text style={[styles.msgText, { color: msg.ok ? '#A7F0D2' : '#FFC0CB' }]}>{msg.text}</Text></View>}

        <Pressable testID="submit-withdraw" onPress={submit} disabled={loading} style={({ pressed }) => [styles.submitWrap, (pressed || loading) && { opacity: 0.82 }]}>
          <LinearGradient colors={['#FFCE63', '#FF8A3D']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submitButton}>
            {loading ? <Text style={styles.submitText}>Submitting…</Text> : <><Ionicons name="arrow-up-circle-outline" size={21} color="#32164B" /><Text style={styles.submitText}>Request Withdrawal</Text></>}
          </LinearGradient>
        </Pressable>
        <Text style={styles.footerNote}>Requests are reviewed by the admin. Approval does not automatically transfer funds unless a payout service is configured.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#160B27' },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: 12 },
  back: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#FFFFFF1C', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '900' }, headerSub: { color: '#D8C4F0', fontSize: 11, marginTop: 3 },
  content: { padding: spacing.lg, paddingBottom: 36 },
  balanceCard: { borderRadius: 22, padding: 20, marginBottom: 24, borderWidth: 1, borderColor: '#8B5CC5' },
  balanceTop: { flexDirection: 'row', alignItems: 'center', gap: 10 }, walletIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#FFFFFF18', alignItems: 'center', justifyContent: 'center' },
  balanceLabel: { color: '#D8C4F0', fontSize: 11, fontWeight: '800', letterSpacing: 1 }, balance: { color: '#fff', fontSize: 32, fontWeight: '900', marginTop: 12 }, balanceFoot: { color: '#CBB4E7', fontSize: 12, marginTop: 5 },
  sectionTitle: { color: '#F4EAFE', fontSize: 15, fontWeight: '800', marginBottom: 12 }, methodRow: { flexDirection: 'row', gap: 12, marginBottom: 18 },
  methodCard: { flex: 1, minHeight: 126, backgroundColor: '#241536', borderWidth: 1.5, borderColor: '#3C2853', borderRadius: 18, padding: 14, position: 'relative' }, methodSelected: { backgroundColor: '#392052', borderColor: '#C08AFF' },
  methodIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#38264A', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }, methodIconSelected: { backgroundColor: '#7942A8' },
  methodTitle: { color: '#D9CCE8', fontSize: 13, fontWeight: '800' }, selectedText: { color: '#fff' }, methodDesc: { color: '#A998BC', fontSize: 10, marginTop: 5 }, check: { position: 'absolute', top: 12, right: 12 },
  formCard: { backgroundColor: '#241536', borderRadius: 18, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#3C2853' }, label: { color: '#D9C8EA', fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 7 },
  input: { backgroundColor: '#170D25', color: '#fff', borderWidth: 1, borderColor: '#4B3563', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14 }, hint: { color: '#B5A2CA', fontSize: 11, marginTop: 8 },
  secureNote: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 13 }, secureText: { color: '#CBB6E2', fontSize: 11, flex: 1 },
  msg: { padding: 13, borderRadius: 13, borderWidth: 1, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 9 }, msgText: { fontWeight: '700', flex: 1, fontSize: 12 },
  submitWrap: { borderRadius: 15, overflow: 'hidden', marginTop: 2 }, submitButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 15 }, submitText: { color: '#32164B', fontSize: 15, fontWeight: '900' }, footerNote: { color: '#A895BD', textAlign: 'center', fontSize: 10, lineHeight: 15, marginTop: 13, paddingHorizontal: 8 },
});
