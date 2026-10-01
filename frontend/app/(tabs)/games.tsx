import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ImageBackground } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, shadows } from '@/src/theme';

const CATEGORIES = [
  { id: 'all', name: 'All' },
  { id: 'crash', name: 'Crash' },
  { id: 'cards', name: 'Cards' },
  { id: 'dice', name: 'Dice' },
  { id: 'number', name: 'Number' },
  { id: 'spin', name: 'Spin' },
  { id: 'arcade', name: 'Arcade' },
  { id: 'puzzle', name: 'Puzzle' },
  { id: 'casual', name: 'Casual' },
  { id: 'skill', name: 'Skill' },
  { id: 'tournament', name: 'Tournaments' },
];

const GAMES = [
  { id: 'crash', title: 'Crash', tag: 'crash', icon: 'rocket', color: '#FF6B6B', playable: true, image: require('../../assets/images/crash-bg.png') },
  { id: 'aviator', title: 'Aviator', tag: 'crash', icon: 'airplane', color: '#5B8CFF', playable: true, image: require('../../assets/images/aviator-bg.png') },
  { id: 'dice', title: 'Lucky Dice', tag: 'dice', icon: 'dice', color: '#FFB020', playable: true, image: require('../../assets/images/dice-bg.png') },
  { id: 'spin', title: 'Spin Wheel', tag: 'spin', icon: 'sync-circle', color: '#2ECA7F', playable: true, image: require('../../assets/images/spin-bg.png') },
  { id: 'andar-bahar', title: 'Andar Bahar', tag: 'cards', icon: 'albums', color: '#4A4A4A', playable: true, image: require('../../assets/images/andar-bg.png') },
  { id: 'teenpatti', title: 'Teen Patti', tag: 'cards', icon: 'grid', color: '#E53935', playable: true, image: require('../../assets/images/teen-bg.png') },
  { id: 'number-king', title: 'Number King', tag: 'number', icon: 'apps', color: '#FF7E67', playable: true, image: require('../../assets/images/king-bg.png') },
  { id: 'plinko', title: 'Plinko', tag: 'arcade', icon: 'game-controller', color: '#FF9A9E', playable: true, image: require('../../assets/images/plinko-bg.png') },
  { id: 'mines', title: 'Mines', tag: 'arcade', icon: 'flame', color: '#FF6B6B', playable: true, image: require('../../assets/images/mines-bg.png') },
  { id: 'sudoku', title: 'Sudoku', tag: 'puzzle', icon: 'grid-outline', color: '#5B8CFF', playable: true, image: require('../../assets/images/sudoku-bg.png') },
  { id: 'match3', title: 'Match Three', tag: 'casual', icon: 'shapes', color: '#FFB020', playable: true, image: require('../../assets/images/match-bg.png') },
  { id: 'bullseye', title: 'Bull\'s Eye', tag: 'skill', icon: 'radio-button-on', color: '#2ECA7F', playable: true, image: require('../../assets/images/bull-bg.png') },
  { id: 'tournament', title: 'Weekly Cup', tag: 'tournament', icon: 'trophy', color: '#E53935', playable: true, image: require('../../assets/images/weekly-bg.png') },
];

export default function Games() {
  const router = useRouter();
  const [cat, setCat] = useState('all');

  const filtered = cat === 'all' ? GAMES : GAMES.filter(g => g.tag === cat);

  return (
    <ImageBackground
     source={require('../../assets/images/games-bg.png')}
     style={{ flex: 1 }}
     resizeMode="cover"
    >
      <ImageBackground
       source={require('../../assets/images/header-bg.png')}
       style={styles.header}
       imageStyle={{
       width: '100%',
       height: '100%'
       }}
       resizeMode="stretch"
      >
        <SafeAreaView edges={['top']} style={styles.headerInner}>
          <Text style={styles.title}>Game Lobby</Text>
          <Text style={styles.sub}>Choose your game and start winning</Text>
        </SafeAreaView>
      </ImageBackground>
      <ImageBackground
       source={require('../../assets/images/games-bg.png')}
       style={styles.chipWrap}
       imageStyle={{ borderRadius: 0 }}
       resizeMode="cover"
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: 8 }}>
          {CATEGORIES.map(c => (
            <Pressable key={c.id} testID={`cat-${c.id}`} onPress={() => setCat(c.id)} style={[styles.chip, cat === c.id && styles.chipActive]}>
              <Text style={[styles.chipLabel, cat === c.id && styles.chipLabelActive]}>{c.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </ImageBackground>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: 0 }}>
        <Pressable testID="wingo-featured" onPress={() => router.push('/wingo')} style={{ marginTop: spacing.lg }}>
          <ImageBackground
           source={require('../../assets/images/wingo-bg.png')}
           style={styles.featured}
           imageStyle={{ borderRadius: 18, width:'100%', height:'110%' }}
           resizeMode="stretch"
          >
            <View style={{ flex: 1 }}>
              <View style={styles.hotBadge}><Ionicons name="flame" size={11} color="#fff" /><Text style={styles.hotText}>HOT</Text></View>
              <Text style={styles.featuredTitle}>.</Text>
              <Text style={styles.featuredSub}>·</Text>
            </View>
            
          </ImageBackground>
        </Pressable>
        <View style={styles.grid}>
          {filtered.map(g => (
            <Pressable
              key={g.id}
              testID={`game-${g.id}`}
              onPress={() => (g.playable ? router.push(`/game/${g.id}`) : router.push({ pathname: '/game/coming-soon', params: { title: g.title } }))}
              style={styles.card}
            >
              <ImageBackground
               source={g.image || undefined}
               style={styles.thumb}
               imageStyle={{ borderRadius: 16, width:'100%', height:'100%' }}
               resizeMode="cover"
              >
               {!g.image && (
                <Ionicons name={g.icon as any} size={40} color="#fff" />
               )}

               {!g.playable && (
               <View style={styles.badge}>
               <Text style={styles.badgeText}>SOON</Text>
               </View>
               )}
              </ImageBackground>
              <Text style={styles.cardTitle}>{g.title}</Text>
              <Text style={styles.cardTag}>{g.tag.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  header: { borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  headerInner: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  title: { color: '#fcfbfb', fontSize: 26, fontWeight: '800' },
  sub: { color: 'rgba(253, 253, 251, 0.92)', marginTop: 4, fontSize: 13, fontWeight:'800' },
  chipsWrap: { height: 56, backgroundColor: 'rgb(250, 253, 251)', justifyContent: 'center', ...shadows.soft },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, flexShrink: 0 },
  chipActive: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  chipLabel: { fontSize: 13, fontWeight: '600', color: colors.onSurfaceSecondary },
  chipLabelActive: { color: colors.brandPrimary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: spacing.lg },
  featured: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.lg, padding: spacing.lg, ...shadows.card },
  hotBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.25)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  hotText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  featuredTitle: { color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 8 },
  featuredSub: { color: 'rgba(255,255,255,0.92)', fontSize: 12, marginTop: 4, maxWidth: 210 },
  featuredBalls: { flexDirection: 'row' },
  fBall: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' },
  fBallText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  card: { width: '48%', backgroundColor: '#fff', borderRadius: radius.lg, padding: spacing.md, ...shadows.card },
  thumb: { height: 110, borderRadius: 16, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  cardTitle: { marginTop: 10, fontSize: 15, fontWeight: '800', color: colors.onSurface },
  cardTag: { fontSize: 11, color: colors.onSurfaceMuted, fontWeight: '700', marginTop: 2 },
  badge: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});