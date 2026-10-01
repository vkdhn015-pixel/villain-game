import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Dimensions, Image, ImageBackground, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, shadows } from '@/src/theme';

import { api } from '@/src/api';

const { width } = Dimensions.get('window');

const GAME_TILES = [
  { id: 'crash', label: 'Crash', icon: 'rocket', color: '#FF6B6B' },
  { id: 'aviator', label: 'Aviator', icon: 'airplane', color: '#5B8CFF' },
  { id: 'dice', label: 'Dice', icon: 'dice', color: '#FFB020' },
  { id: 'spin', label: 'Spin Wheel', icon: 'sync-circle', color: '#2ECA7F' },
];

const BANNERS = [
  {
    title: 'First Deposit Bonus',
    sub: 'Get 100% up to ₹5,000',
    image: require('../../assets/images/promo1.png'),
  },
  {
    title: 'Weekend Cashback',
    sub: '15% back every Sat & Sun',
    image: require('../../assets/images/promo2.png'),
  },
  {
    title: 'Refer & Earn ₹250',
    sub: 'Invite friends, both win',
    image: require('../../assets/images/promo3.png'),
  },
];

export default function Home() {
  const router = useRouter();
 
  const [me, setMe] = useState<any>(null);
  const [showFirstDepositPopup, setShowFirstDepositPopup] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setMe(await api.me()); } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <ImageBackground
     source={require('../../assets/images/games-bg.png')}
     style={styles.screen}
     imageStyle={{height: '100%'}}
     resizeMode="cover"
    >
      <ImageBackground
       source={require('../../assets/images/header-bg.png')}
       style={styles.header}
       imageStyle={{ width: '100%', height: '130%' }}
       resizeMode= "cover"
      >
        <SafeAreaView edges={['top']} style={styles.headerInner}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{(me?.name || '?').slice(0, 1).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.hello}>Hello, {me?.name || 'Player'}</Text>
              <Text style={styles.uid}>VILLAN11 · UID {me?.uid || '—'}</Text>
            </View>
            <Pressable testID="notifications-btn" onPress={() => router.push('/notifications')} style={styles.bellBtn}>
              <Ionicons name="notifications-outline" size={22} color="#fff" />
            </Pressable>
          </View>
        </SafeAreaView>
      </ImageBackground>

       {/* FIRST DEPOSIT BONUS POPUP */}
       <Modal
        visible={showFirstDepositPopup}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFirstDepositPopup(false)}
      >
        <View style={styles.depositModalOverlay}>

          <View style={styles.depositPopupContainer}>

            {/* COMPLETE POPUP PNG */}
            <Image
              source={require('../../assets/images/first-deposit-popupp.png')}
              style={styles.depositPopupImage}
              resizeMode="contain"
            />

            {/* Invisible X touch area */}
            <Pressable
              style={styles.popupCloseHit}
              onPress={() => setShowFirstDepositPopup(false)}
              accessibilityLabel="Close first deposit bonus"
            />

            {/* Invisible Deposit Now touch area */}
            <Pressable
              style={styles.popupDepositHit}
              onPress={() => {
                setShowFirstDepositPopup(false);
                router.push('/deposit');
              }}
              accessibilityLabel="Deposit now"
            />

            {/* Invisible Maybe Later touch area */}
            <Pressable
              style={styles.popupLaterHit}
              onPress={() => setShowFirstDepositPopup(false)}
              accessibilityLabel="Maybe later"
            />

          </View>

        </View>
      </Modal>


      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6B6B" />}>
        {/* Wallet card overlapping */}
        <View style={styles.balanceWrap}>
          <ImageBackground
           source={require('../../assets/images/wallet-bg.png')}
           style={styles.balanceCard}
           imageStyle={{ width:'105%', height: '118%', borderRadius: 18 }}
           resizeMode= "cover"
           testID="home-balance-card"
          >
            <View>
              <Text style={styles.balanceLabel}>👑 Wallet Balance</Text>
              <Text style={styles.balanceValue}>₹{(me?.balance ?? 0).toFixed(2)}</Text>
              <Text style={styles.bonus}>Bonus ₹{(me?.bonus_balance ?? 0).toFixed(2)}</Text>
            </View>
            <View style={styles.vipBadge}>
              <Ionicons name="diamond" size={12} color="#fff" />
              <Text style={styles.vipText}>{(me?.vip_tier || 'bronze').toUpperCase()}</Text>
            </View>
          </ImageBackground>

          <ImageBackground
           source={require('../../assets/images/quickrow-bg.png')}
           style={styles.quickRow}
           imageStyle={{ width: '105%', height: '105%', borderRadius:25,}}
           resizeMode="cover"
           
          >
            <QuickAction testID="qa-deposit" label="Deposit" color="#FF6B6B" icon="add-circle" onPress={() => router.push('/deposit')} />
            <QuickAction testID="qa-withdraw" label="Withdraw" color="#2ECA7F" icon="cash-outline" onPress={() => router.push('/withdraw')} />
            <QuickAction testID="qa-history" label="History" color="#FFB020" icon="time-outline" onPress={() => router.push('/transactions')} />
            <QuickAction testID="qa-support" label="Support" color="#5B8CFF" icon="headset-outline" onPress={() => router.push('/support')} />
          </ImageBackground>
        </View>

        {/* Banners */}
        <Text style={styles.section}>Promotions</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: 12 }}>
          {BANNERS.map((b, i) => (
  <Pressable
    key={i}
    testID={`banner-${i}`}
    onPress={() => router.push('/promotions')}
  >
    <ImageBackground
      source={b.image}
      style={styles.banner}
      imageStyle={{ borderRadius: radius.lg }}
      resizeMode="cover"
    >
      <Ionicons
        name="sparkles"
        size={28}
        color="rgba(255,255,255,0.8)"
      />

      <Text style={styles.bannerTitle}>{b.title}</Text>

      <Text style={styles.bannerSub}>{b.sub}</Text>
    </ImageBackground>
  </Pressable>
))}
        </ScrollView>
    

        {/* Popular games */}
        <RailHeader title="Popular Games" onSeeAll={() => router.push('/(tabs)/games')} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: 12 }}>
          <Pressable testID="tile-wingo" onPress={() => router.push('/wingo')} style={styles.tile}>
          <LinearGradient colors={['#FF6B6B', '#8B5CF6']} style={styles.tileGrad}>
            <Image source={require('../../assets/images/wingo.png')} style={{ width: 95, height: 95, resizeMode: 'contain' }} />
          </LinearGradient>
          <Text style={styles.tileLabel}>Win Go</Text>
        </Pressable>
          {GAME_TILES.map((g) => (
            <GameTile key={g.id} game={g} onPress={() => router.push(`/game/${g.id}`)} />
          ))}
        </ScrollView>

        <RailHeader title="Trending Now" onSeeAll={() => router.push('/(tabs)/games')} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: 12 }}>
          {[...GAME_TILES].reverse().map((g) => (
            <GameTile key={g.id + 'x'} game={g} onPress={() => router.push(`/game/${g.id}`)} />
          ))}
        </ScrollView>

        {/* Daily rewards */}
        <Text style={styles.section}>Daily Rewards</Text>
        <View style={{ paddingHorizontal: spacing.lg }}>
          <Pressable testID="daily-rewards" onPress={() => router.push('/(tabs)/rewards')} style={styles.rewardCard}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>Claim Today's Bonus</Text>
              <Text style={{ color: 'rgba(255,255,255,0.9)', marginTop: 4, fontSize: 13 }}>Login streak reward and daily spin</Text>
            </View>
            <View style={styles.giftIcon}><Ionicons name="gift" size={30} color="#FF6B6B" /></View>
          </Pressable>
        </View>
      </ScrollView>
    </ImageBackground>
    
  );
}

function QuickAction({ label, icon, color, onPress, testID }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} style={styles.qa}>
      <View style={[styles.qaIcon, { backgroundColor: color + '1F' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={styles.qaLabel}>{label}</Text>
    </Pressable>
  );
}

function RailHeader({ title, onSeeAll }: { title: string; onSeeAll: () => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.md }}>
      <Text style={{ fontSize: 17, fontWeight: '800', color: '#fff' }}>{title}</Text>
      <Pressable onPress={onSeeAll}><Text style={{ color: colors.brandPrimary, fontWeight: '700' }}>See all</Text></Pressable>
    </View>
  );
}

const GAME_IMAGES: Record<string, any> = {
  aviator: require('../../assets/images/planee.png'),
  crash: require('../../assets/images/rocket-logo.png'),
  dice: require('../../assets/images/dice.png'),
  spin: require('../../assets/images/spin.png'),
};

function GameTile({ game, onPress }: any) {
  return (
    <Pressable testID={`tile-${game.id}`} onPress={onPress} style={styles.tile}>
      <LinearGradient colors={[game.color + 'CC', game.color]} style={styles.tileGrad}>
        {GAME_IMAGES[game.id] ? (
          <Image source={GAME_IMAGES[game.id]} style={{ width: 100, height: 100, resizeMode: 'contain' }} />
        ) : (
          <Ionicons name={game.icon as any} size={44} color="#fff" />
        )}
      </LinearGradient>
      <Text style={styles.tileLabel}>{game.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#050814'},
  header: {
  paddingBottom: 20,
  overflow: 'hidden',
  borderBottomLeftRadius: 7,
  borderBottomRightRadius: 7,
},
  headerInner: { paddingHorizontal: spacing.lg, paddingTop: 15, flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#c6c8cf', alignItems: 'center', justifyContent: 'center', borderwidth: 2, borderColor: '#42C8FF', shadowColor: '#00B7FF', shadowOpacity: 0.8, shadowRadius: 10, elevation: 8 },
  avatarText: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  hello: { color: '#fcfbfb', fontSize: 20, fontWeight: '800' },
  uid: { color: 'rgba(247, 252, 252, 0.94)', fontSize: 12, marginTop: 2 },
  bellBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#111936', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#3A4F9A' },
  notificationDot: { position: 'absolute', top: 7, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3158', borderWidth: 1, borderColor: '#FFFFFF' },
  menuBtn: { width: 40, height: 46, borderRadius: 20, backgroundColor: '#111936', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#3A4F9A' },
  balanceWrap: { paddingHorizontal: spacing.lg, marginTop: 12 },
  balanceCard: {
  borderRadius: 18,
  padding: spacing.lg,
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  overflow: 'hidden',
  ...shadows.strong,
},
  balanceLabel: { fontSize: 15, color: '#AFC4E8', fontWeight: '800' },
  balanceValue: { fontSize: 38, fontWeight: '900', color: '#FFD83D', marginTop: 0, textShadowColor: '#FFB300', textShadowOffset: {width: 0, height: 0}, textShadowRadius: 8 },
  bonus: { fontSize: 15, color: '#00F5C8', fontWeight: '800', marginTop: 4 },
  vipBadge: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 5,

  backgroundColor: '#FFC83D',

  paddingHorizontal: 14,
  paddingVertical: 8,

  borderRadius: 999,

  borderWidth: 1,
  borderColor: '#FFE99A',

  shadowColor: '#FFB300',
  shadowOpacity: 0.7,
  shadowRadius: 8,
  elevation: 6,
},
  vipText: { color: '#070503', fontSize: 11, fontWeight: '900' },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 14, paddingHorizontal: spacing.lg, gap: 10, borderWidth:0, overflow:'hidden' },
  qa: { alignItems: 'center', height:78, flex: 1, alignItems:'center', justifyContent:'center', backgroundColor: 'transparent' },
  qaIcon: { width: 38, height: 38, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  qaLabel: { marginTop: 6, fontSize: 11, fontWeight: '700', color: colors.onSurfaceSecondary },
  section: { fontSize: 17, fontWeight: '800', color: '#fff', paddingHorizontal: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.md },
  banner: { width: width * 0.75, height: 130, borderRadius: radius.lg, padding: spacing.lg, justifyContent: 'flex-end', overflow: 'hidden' },
  bannerTitle: { color: '#fff', fontWeight: '800', fontSize: 18, marginTop: 6 },
  bannerSub: { color: 'rgba(255,255,255,0.95)', marginTop: 2, fontSize: 12 },
  tile: { width: 112, alignItems: 'center' },
  tileGrad: { width: 112, height: 112, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', ...shadows.soft },
  tileLabel: { marginTop: 8, fontSize: 13, fontWeight: '700', color: '#fff' },
  rewardCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FF6B6B', borderRadius: radius.lg, padding: spacing.lg, ...shadows.card },
  giftIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },

  depositModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.86)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },

  depositPopupContainer: {
    width: '100%',
    maxWidth: 410,
    aspectRatio: 2 / 3,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },

  depositPopupImage: {
    width: '100%',
    height: '100%',
  },

  /*
   * PNG me X top-right par hai.
   * Ye sirf invisible clickable area hai.
   */
  popupCloseHit: {
    position: 'absolute',

    top: '3%',
    right: '3%',

    width: '11%',
    height: '7%',

    backgroundColor: 'transparent',
  },

  /*
   * PNG me DEPOSIT NOW button ke upar
   * invisible clickable area.
   */
  popupDepositHit: {
    position: 'absolute',

    left: '15%',
    width: '70%',

    top: '81%',
    height: '9%',

    backgroundColor: 'transparent',
  },

  /*
   * PNG me Maybe Later ke upar
   * invisible clickable area.
   */
  popupLaterHit: {
    position: 'absolute',

    left: '28%',
    width: '44%',

    top: '90%',
    height: '7%',

    backgroundColor: 'transparent',
  },
});
